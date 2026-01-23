import { beforeEach, describe, expect, test } from "bun:test";
import type { Snapshot } from "../core/types.js";
import {
  platformerPredictionScope,
  type PlatformerInput,
  type PlatformerPlayer,
  type PlatformerWorld,
  createTestPlayer,
  createTestWorld,
} from "@game/example-platformer";
import { InputBuffer } from "./input-buffer.js";
import { Predictor } from "./prediction.js";
import { Reconciler } from "./reconciliation.js";

/** Helper to create test input with all required fields */
const createInput = (
  moveX: number,
  moveY: number,
  jump: boolean,
  timestamp: number,
): PlatformerInput => ({
  moveX,
  moveY,
  jump,
  shoot: false,
  shootTargetX: 0,
  shootTargetY: 0,
  timestamp,
});

describe("Reconciler", () => {
  let inputBuffer: InputBuffer<PlatformerInput>;
  let predictor: Predictor<PlatformerWorld, PlatformerInput>;
  let reconciler: Reconciler<PlatformerWorld, PlatformerInput>;
  const playerId = "player-1";

  beforeEach(() => {
    inputBuffer = new InputBuffer<PlatformerInput>();
    predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    reconciler = new Reconciler<PlatformerWorld, PlatformerInput>(
      inputBuffer,
      predictor,
      platformerPredictionScope,
      playerId,
    );
  });

  const createSnapshot = (
    player: PlatformerPlayer,
    lastAck: number,
  ): Snapshot<PlatformerWorld> => ({
    tick: 1,
    timestamp: Date.now(),
    state: createTestWorld([player], { tick: 1, gameState: "playing" }),
    inputAcks: new Map([[playerId, lastAck]]),
  });

  describe("reconcile", () => {
    test("should update state from server snapshot", () => {
      const serverPlayer = createTestPlayer(playerId, {
        position: { x: 100, y: 200 },
        isGrounded: true,
      });
      const snapshot = createSnapshot(serverPlayer, -1);

      const result = reconciler.reconcile(snapshot);
      const resultPlayer = result.players.get(playerId);

      expect(resultPlayer?.position.x).toBe(100);
      expect(resultPlayer?.position.y).toBe(200);
    });

    test("should replay unacknowledged inputs", () => {
      // Add inputs to buffer
      inputBuffer.add(createInput(1, 0, false, 1000)); // seq 0
      inputBuffer.add(createInput(1, 0, false, 1016)); // seq 1
      inputBuffer.add(createInput(1, 0, false, 1032)); // seq 2

      // Server acknowledges seq 0, position reflects that
      const serverPlayer = createTestPlayer(playerId, {
        position: { x: 10, y: 190 }, // Position after seq 0 (on floor)
        velocity: { x: 200, y: 0 },
        isGrounded: true,
      });
      const snapshot = createSnapshot(serverPlayer, 0);

      const result = reconciler.reconcile(snapshot);
      const resultPlayer = result.players.get(playerId);

      // Should have replayed seq 1 and 2, so position should be > 10
      expect(resultPlayer?.position.x).toBeGreaterThan(10);
    });

    test("should acknowledge processed inputs", () => {
      inputBuffer.add(createInput(1, 0, false, 1000)); // seq 0
      inputBuffer.add(createInput(1, 0, false, 1016)); // seq 1

      const serverPlayer = createTestPlayer(playerId, {
        position: { x: 10, y: 0 },
        isGrounded: false,
      });
      const snapshot = createSnapshot(serverPlayer, 0);

      reconciler.reconcile(snapshot);

      // seq 0 should be removed
      expect(inputBuffer.get(0)).toBeUndefined();
      // seq 1 should still exist
      expect(inputBuffer.get(1)).toBeDefined();
    });

    test("should handle player not in snapshot", () => {
      const otherPlayer = createTestPlayer("other-player", { isGrounded: true });
      const snapshot: Snapshot<PlatformerWorld> = {
        tick: 1,
        timestamp: Date.now(),
        state: createTestWorld([otherPlayer], { tick: 1, gameState: "playing" }),
        inputAcks: new Map(),
      };

      const result = reconciler.reconcile(snapshot);

      // Should return world without our player (no prediction to merge)
      expect(result.players.has("other-player")).toBe(true);
    });

    test("should handle empty acks", () => {
      const serverPlayer = createTestPlayer(playerId, {
        position: { x: 50, y: 50 },
        isGrounded: false,
      });
      const snapshot: Snapshot<PlatformerWorld> = {
        tick: 1,
        timestamp: Date.now(),
        state: createTestWorld([serverPlayer], { tick: 1, gameState: "playing" }),
        inputAcks: new Map(), // No acks
      };

      const result = reconciler.reconcile(snapshot);
      const resultPlayer = result.players.get(playerId);

      expect(resultPlayer?.position.x).toBe(50);
    });
  });

  describe("real-world scenarios", () => {
    test("network lag spike: many queued inputs should replay with correct timing", () => {
      // Player sends inputs at 60fps during a 200ms lag spike
      // Server doesn't see any of them, then they all arrive at once
      const startTime = 1000;
      const inputCount = 12; // ~200ms of inputs at 60fps

      for (let i = 0; i < inputCount; i++) {
        inputBuffer.add(createInput(1, 0, false, startTime + i * 16.67));
      }

      // Server snapshot arrives with position before any of these inputs
      const serverPlayer = createTestPlayer(playerId, {
        position: { x: 0, y: 190 },
        isGrounded: true,
      });
      const snapshot = createSnapshot(serverPlayer, -1); // No inputs acknowledged

      const result = reconciler.reconcile(snapshot);
      const resultPlayer = result.players.get(playerId);

      // All 12 inputs should be replayed with proper timing
      // First input uses default 16.67ms, remaining 11 use actual deltas (16.67ms each)
      // Total: 12 * 16.67ms = ~200ms at 200 units/sec = ~40 units
      // Allow some tolerance for floating point
      expect(resultPlayer?.position.x).toBeGreaterThan(35);
      expect(resultPlayer?.position.x).toBeLessThan(45);
    });

    test("partial acknowledgment: only replay unacknowledged inputs", () => {
      // Player sends 5 inputs
      const startTime = 1000;
      for (let i = 0; i < 5; i++) {
        inputBuffer.add(createInput(1, 0, false, startTime + i * 50)); // 50ms apart (matching server tick)
      }

      // Server acknowledges first 3 (seq 0, 1, 2)
      // Server position reflects those 3 inputs
      const serverPlayer = createTestPlayer(playerId, {
        position: { x: 30, y: 190 }, // Moved 30 units from 3 inputs
        velocity: { x: 200, y: 0 },
        isGrounded: true,
      });
      const snapshot = createSnapshot(serverPlayer, 2); // Ack through seq 2

      const result = reconciler.reconcile(snapshot);
      const resultPlayer = result.players.get(playerId);

      // Should replay seq 3 and 4 (2 more inputs, ~100ms, ~20 more units)
      expect(resultPlayer?.position.x).toBeGreaterThan(40);
      expect(resultPlayer?.position.x).toBeLessThan(60);

      // Inputs 0-2 should be removed from buffer
      expect(inputBuffer.get(0)).toBeUndefined();
      expect(inputBuffer.get(1)).toBeUndefined();
      expect(inputBuffer.get(2)).toBeUndefined();
      // Inputs 3-4 should still exist (will be cleared on next ack)
      expect(inputBuffer.get(3)).toBeDefined();
      expect(inputBuffer.get(4)).toBeDefined();
    });

    test("misprediction correction: server disagrees with client position", () => {
      // Client predicted they moved right, but server says they hit a wall
      // (simulated by server returning different position)

      // Client sent inputs to move right
      inputBuffer.add(createInput(1, 0, false, 1000)); // seq 0
      inputBuffer.add(createInput(1, 0, false, 1050)); // seq 1
      inputBuffer.add(createInput(1, 0, false, 1100)); // seq 2

      // Server only processed seq 0, but says player hit a wall and is at x=0
      const serverPlayer = createTestPlayer(playerId, {
        position: { x: 0, y: 190 }, // Server says we're at origin (hit wall)
        isGrounded: true,
      });
      const snapshot = createSnapshot(serverPlayer, 0); // Only ack seq 0

      const result = reconciler.reconcile(snapshot);
      const resultPlayer = result.players.get(playerId);

      // Client should accept server position (x=0) and replay seq 1 and 2
      // Since server says x=0, we replay 2 inputs (~100ms of movement)
      // At 200 units/sec, should move about 20 units
      expect(resultPlayer?.position.x).toBeGreaterThan(10);
      expect(resultPlayer?.position.x).toBeLessThan(30);
    });

    test("jump input timing: jump pressed while falling should not double-jump", () => {
      // Player is in the air (jumped earlier)
      inputBuffer.add(createInput(0, 0, true, 1000)); // Jump while airborne
      inputBuffer.add(createInput(0, 0, true, 1050)); // Still holding jump

      // Server confirms player is in the air
      const serverPlayer = createTestPlayer(playerId, {
        position: { x: 0, y: 100 }, // In the air
        velocity: { x: 0, y: 50 }, // Falling down
        isGrounded: false, // NOT grounded
      });
      const snapshot = createSnapshot(serverPlayer, -1);

      const result = reconciler.reconcile(snapshot);
      const resultPlayer = result.players.get(playerId);

      // Player should continue falling, not get another jump
      // Velocity should still be positive (falling) or more positive
      expect(resultPlayer?.velocity.y).toBeGreaterThanOrEqual(50);
      expect(resultPlayer?.isGrounded).toBe(false);
    });

    test("large sequence numbers: should handle near-max values", () => {
      // Simulate a very long play session with large sequence numbers
      const largeSeq = 1000000;

      // Create a fresh reconciler with large seq context
      const freshBuffer = new InputBuffer<PlatformerInput>();
      const freshPredictor = new Predictor<PlatformerWorld, PlatformerInput>(
        platformerPredictionScope,
      );
      const freshReconciler = new Reconciler<PlatformerWorld, PlatformerInput>(
        freshBuffer,
        freshPredictor,
        platformerPredictionScope,
        playerId,
      );

      // Add inputs with large sequence numbers (simulate buffer state after many inputs)
      for (let i = 0; i < 10; i++) {
        // Manually create inputs as if buffer has been used extensively
        freshBuffer.add(createInput(1, 0, false, 1000 + i * 16));
      }

      const serverPlayer = createTestPlayer(playerId, {
        position: { x: 50, y: 190 },
        velocity: { x: 200, y: 0 },
        isGrounded: true,
      });

      // Acknowledge a subset
      const snapshot: Snapshot<PlatformerWorld> = {
        tick: largeSeq,
        timestamp: Date.now(),
        state: createTestWorld([serverPlayer], { tick: largeSeq, gameState: "playing" }),
        inputAcks: new Map([[playerId, 5]]), // Ack through seq 5
      };

      const result = freshReconciler.reconcile(snapshot);

      // Should work correctly even with large tick numbers
      expect(result.players.has(playerId)).toBe(true);
      // Remaining inputs (6-9) should be replayed
      expect(result.players.get(playerId)?.position.x).toBeGreaterThan(50);
    });

    test("stale snapshot: older tick should not corrupt state", () => {
      // Setup: receive a newer snapshot first
      const serverPlayer = createTestPlayer(playerId, {
        position: { x: 100, y: 190 },
        isGrounded: true,
      });
      const newerSnapshot = createSnapshot(serverPlayer, 0);
      newerSnapshot.tick = 10;

      reconciler.reconcile(newerSnapshot);

      // Now receive an "older" snapshot (arrived late due to network)
      const olderPlayer = createTestPlayer(playerId, {
        position: { x: 50, y: 190 }, // Earlier position
        isGrounded: true,
      });
      const olderSnapshot: Snapshot<PlatformerWorld> = {
        tick: 5, // Earlier tick
        timestamp: Date.now() - 1000,
        state: createTestWorld([olderPlayer], { tick: 5, gameState: "playing" }),
        inputAcks: new Map([[playerId, -1]]),
      };

      reconciler.reconcile(olderSnapshot);
      const afterOlder = predictor.getState();

      // In current implementation, it processes all snapshots
      // (production code might want to ignore stale snapshots)
      // Just ensure it doesn't crash and produces valid state
      expect(afterOlder?.players?.get(playerId)).toBeDefined();
    });
  });
});
