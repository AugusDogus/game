import {
  createTestPlayer,
  createTestWorld,
  platformerPredictionScope,
  type PlatformerInput,
  type PlatformerPlayer,
  type PlatformerWorld,
} from "@game/example-platformer";
import { beforeEach, describe, expect, test } from "bun:test";
import type { Snapshot } from "../core/types.js";
import { InputBuffer } from "./input-buffer.js";
import { Predictor } from "./prediction.js";
import { Reconciler } from "./reconciliation.js";

/** Helper to create test input with all required fields */
const createInput = (
  moveX: number,
  moveY: number,
  jump: boolean,
  timestamp: number,
  jumpPressed: boolean = false,
  jumpReleased: boolean = false,
): PlatformerInput => ({
  moveX,
  moveY,
  jump,
  jumpPressed,
  jumpReleased,
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

      reconciler.reconcile(snapshot);
      const state = predictor.getState();
      const resultPlayer = state?.players?.get(playerId);

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

      reconciler.reconcile(snapshot);
      const state = predictor.getState();
      const resultPlayer = state?.players?.get(playerId);

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

      reconciler.reconcile(snapshot);
      const state = predictor.getState();

      // Should have the other player in state
      expect(state?.players?.has("other-player")).toBe(true);
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

      reconciler.reconcile(snapshot);
      const state = predictor.getState();
      const resultPlayer = state?.players?.get(playerId);

      expect(resultPlayer?.position.x).toBe(50);
    });
  });

  describe("replay callback", () => {
    test("should call replay callback for each replayed input", () => {
      const replayedTicks: number[] = [];
      reconciler.setReplayCallback((tick, _state) => {
        replayedTicks.push(tick);
      });

      // Add 3 inputs
      inputBuffer.add(createInput(1, 0, false, 1000)); // seq 0
      inputBuffer.add(createInput(1, 0, false, 1016)); // seq 1
      inputBuffer.add(createInput(1, 0, false, 1032)); // seq 2

      const serverPlayer = createTestPlayer(playerId, {
        position: { x: 0, y: 190 },
        isGrounded: true,
      });
      const snapshot = createSnapshot(serverPlayer, -1); // No acks, replay all 3
      snapshot.tick = 10;

      reconciler.reconcile(snapshot);

      // Should have called callback 3 times (for input seq 0, 1, 2)
      expect(replayedTicks).toEqual([0, 1, 2]);
    });

    test("should provide corrected state in replay callback", () => {
      const replayedPositions: { x: number; y: number }[] = [];
      reconciler.setReplayCallback((tick, state) => {
        const player = state.players?.get(playerId);
        if (player) {
          replayedPositions.push({ x: player.position.x, y: player.position.y });
        }
      });

      // Add inputs that move right
      inputBuffer.add(createInput(1, 0, false, 1000));
      inputBuffer.add(createInput(1, 0, false, 1016));

      const serverPlayer = createTestPlayer(playerId, {
        position: { x: 0, y: 190 },
        velocity: { x: 0, y: 0 },
        isGrounded: true,
      });
      const snapshot = createSnapshot(serverPlayer, -1);

      reconciler.reconcile(snapshot);

      // Each replayed position should be further right
      expect(replayedPositions.length).toBe(2);
      expect(replayedPositions[1]!.x).toBeGreaterThan(replayedPositions[0]!.x);
    });
  });

  describe("tick alignment invariants", () => {
    test("replay callback ticks should match input buffer seq numbers", () => {
      // This is the critical invariant: reconcile uses input seq (not server tick)
      // for the replay callback, which must match how owner smoother indexes entries
      
      const replayedSeqs: number[] = [];
      const inputSeqs: number[] = [];
      
      reconciler.setReplayCallback((seq, _state) => {
        replayedSeqs.push(seq);
      });

      // Add inputs and track their seq numbers
      inputSeqs.push(inputBuffer.add(createInput(1, 0, false, 1000))); // seq 0
      inputSeqs.push(inputBuffer.add(createInput(1, 0, false, 1016))); // seq 1
      inputSeqs.push(inputBuffer.add(createInput(1, 0, false, 1032))); // seq 2

      const serverPlayer = createTestPlayer(playerId, {
        position: { x: 0, y: 190 },
        isGrounded: true,
      });
      const snapshot = createSnapshot(serverPlayer, -1); // No acks, replay all

      reconciler.reconcile(snapshot);

      // Replay callback ticks must be the INPUT SEQ numbers
      expect(replayedSeqs).toEqual(inputSeqs);
    });

    test("replay callback should NOT use server tick + offset", () => {
      // This ensures we don't regress to the old bug where we used
      // snapshot.tick + replayStep as the tick key
      
      const replayedTicks: number[] = [];
      
      reconciler.setReplayCallback((tick, _state) => {
        replayedTicks.push(tick);
      });

      // Add inputs
      inputBuffer.add(createInput(1, 0, false, 1000)); // seq 0
      inputBuffer.add(createInput(1, 0, false, 1016)); // seq 1

      const serverPlayer = createTestPlayer(playerId, {
        position: { x: 0, y: 190 },
        isGrounded: true,
      });
      const snapshot = createSnapshot(serverPlayer, -1);
      snapshot.tick = 500; // High server tick

      reconciler.reconcile(snapshot);

      // Ticks should be input seqs (0, 1), NOT server tick offsets (501, 502)
      expect(replayedTicks).toEqual([0, 1]);
      expect(replayedTicks).not.toContain(501);
      expect(replayedTicks).not.toContain(502);
    });

    test("partial ack should replay only unacked input seqs", () => {
      const replayedSeqs: number[] = [];
      
      reconciler.setReplayCallback((seq, _state) => {
        replayedSeqs.push(seq);
      });

      // Add inputs
      inputBuffer.add(createInput(1, 0, false, 1000)); // seq 0
      inputBuffer.add(createInput(1, 0, false, 1016)); // seq 1
      inputBuffer.add(createInput(1, 0, false, 1032)); // seq 2
      inputBuffer.add(createInput(1, 0, false, 1048)); // seq 3

      const serverPlayer = createTestPlayer(playerId, {
        position: { x: 10, y: 190 },
        isGrounded: true,
      });
      const snapshot = createSnapshot(serverPlayer, 1); // Ack through seq 1

      reconciler.reconcile(snapshot);

      // Should only replay seq 2 and 3 (unacked)
      expect(replayedSeqs).toEqual([2, 3]);
    });
  });

  describe("real-world scenarios", () => {
    test("network lag spike: many queued inputs should replay with fixed tick delta", () => {
      const inputCount = 12; // ~200ms of inputs at 60fps

      for (let i = 0; i < inputCount; i++) {
        inputBuffer.add(createInput(1, 0, false, 1000 + i * 16.67));
      }

      const serverPlayer = createTestPlayer(playerId, {
        position: { x: 0, y: 190 },
        isGrounded: true,
      });
      const snapshot = createSnapshot(serverPlayer, -1);

      reconciler.reconcile(snapshot);
      const state = predictor.getState();
      const resultPlayer = state?.players?.get(playerId);

      // All 12 inputs should be replayed with fixed tick delta (~16.67ms each)
      expect(resultPlayer?.position.x).toBeGreaterThan(5);
      expect(resultPlayer?.position.x).toBeLessThan(50);
    });

    test("partial acknowledgment: only replay unacknowledged inputs", () => {
      for (let i = 0; i < 5; i++) {
        inputBuffer.add(createInput(1, 0, false, 1000 + i * 50));
      }

      const serverPlayer = createTestPlayer(playerId, {
        position: { x: 10, y: 190 },
        velocity: { x: 200, y: 0 },
        isGrounded: true,
      });
      const snapshot = createSnapshot(serverPlayer, 2); // Ack through seq 2

      reconciler.reconcile(snapshot);
      const state = predictor.getState();
      const resultPlayer = state?.players?.get(playerId);

      // Should replay seq 3 and 4 (2 more inputs)
      expect(resultPlayer?.position.x).toBeGreaterThan(15);
      expect(resultPlayer?.position.x).toBeLessThan(20);

      // Inputs 0-2 should be removed from buffer
      expect(inputBuffer.get(0)).toBeUndefined();
      expect(inputBuffer.get(1)).toBeUndefined();
      expect(inputBuffer.get(2)).toBeUndefined();
      expect(inputBuffer.get(3)).toBeDefined();
      expect(inputBuffer.get(4)).toBeDefined();
    });

    test("misprediction correction: server disagrees with client position", () => {
      inputBuffer.add(createInput(1, 0, false, 1000));
      inputBuffer.add(createInput(1, 0, false, 1050));
      inputBuffer.add(createInput(1, 0, false, 1100));

      const serverPlayer = createTestPlayer(playerId, {
        position: { x: 0, y: 190 },
        isGrounded: true,
      });
      const snapshot = createSnapshot(serverPlayer, 0);

      reconciler.reconcile(snapshot);
      const state = predictor.getState();
      const resultPlayer = state?.players?.get(playerId);

      // Client should accept server position (x=0) and replay seq 1 and 2
      expect(resultPlayer?.position.x).toBeGreaterThan(0.5);
      expect(resultPlayer?.position.x).toBeLessThan(15);
    });

    test("jump input timing: jump pressed while falling should not double-jump", () => {
      inputBuffer.add(createInput(0, 0, true, 1000));
      inputBuffer.add(createInput(0, 0, true, 1050));

      const serverPlayer = createTestPlayer(playerId, {
        position: { x: 0, y: 100 },
        velocity: { x: 0, y: -50 },
        isGrounded: false,
      });
      const snapshot = createSnapshot(serverPlayer, -1);

      reconciler.reconcile(snapshot);
      const state = predictor.getState();
      const resultPlayer = state?.players?.get(playerId);

      expect(resultPlayer?.velocity.y).toBeLessThanOrEqual(-50);
      expect(resultPlayer?.isGrounded).toBe(false);
    });
  });
});
