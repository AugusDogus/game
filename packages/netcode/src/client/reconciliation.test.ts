import { describe, test, expect, beforeEach } from "bun:test";
import { Reconciler } from "./reconciliation.js";
import { InputBuffer } from "./input-buffer.js";
import { Predictor } from "./prediction.js";
import type { WorldSnapshot, PlayerState } from "../types.js";
import { platformerPhysics } from "../physics.js";

describe("Reconciler", () => {
  let inputBuffer: InputBuffer;
  let predictor: Predictor;
  let reconciler: Reconciler;
  const playerId = "player-1";

  beforeEach(() => {
    inputBuffer = new InputBuffer();
    predictor = new Predictor(platformerPhysics);
    reconciler = new Reconciler(inputBuffer, predictor, playerId);
  });

  const createSnapshot = (
    playerState: PlayerState,
    lastAck: number,
  ): WorldSnapshot => ({
    tick: playerState.tick,
    timestamp: Date.now(),
    players: [playerState],
    acks: { [playerId]: lastAck },
  });

  describe("reconcile", () => {
    test("should update state from server snapshot", () => {
      const serverState: PlayerState = {
        id: playerId,
        position: { x: 100, y: 200 },
        velocity: { x: 0, y: 0 },
        isGrounded: true,
        tick: 5,
      };
      const snapshot = createSnapshot(serverState, -1);

      const result = reconciler.reconcile(snapshot);

      expect(result.position.x).toBe(100);
      expect(result.position.y).toBe(200);
    });

    test("should replay unacknowledged inputs", () => {
      // Add inputs to buffer
      inputBuffer.add({ moveX: 1, moveY: 0, jump: false, timestamp: 1000 }); // seq 0
      inputBuffer.add({ moveX: 1, moveY: 0, jump: false, timestamp: 1001 }); // seq 1
      inputBuffer.add({ moveX: 1, moveY: 0, jump: false, timestamp: 1002 }); // seq 2

      // Server acknowledges seq 0, position reflects that
      const serverState: PlayerState = {
        id: playerId,
        position: { x: 10, y: 190 }, // Position after seq 0 (on floor)
        velocity: { x: 200, y: 0 },
        isGrounded: true,
        tick: 1,
      };
      const snapshot = createSnapshot(serverState, 0);

      const result = reconciler.reconcile(snapshot);

      // Should have replayed seq 1 and 2, so position should be > 10
      expect(result.position.x).toBeGreaterThan(10);
    });

    test("should acknowledge processed inputs", () => {
      inputBuffer.add({ moveX: 1, moveY: 0, jump: false, timestamp: 1000 }); // seq 0
      inputBuffer.add({ moveX: 1, moveY: 0, jump: false, timestamp: 1001 }); // seq 1

      const serverState: PlayerState = {
        id: playerId,
        position: { x: 10, y: 0 },
        velocity: { x: 0, y: 0 },
        isGrounded: false,
        tick: 1,
      };
      const snapshot = createSnapshot(serverState, 0);

      reconciler.reconcile(snapshot);

      // seq 0 should be removed
      expect(inputBuffer.get(0)).toBeUndefined();
      // seq 1 should still exist
      expect(inputBuffer.get(1)).toBeDefined();
    });

    test("should handle player not in snapshot", () => {
      const snapshot: WorldSnapshot = {
        tick: 1,
        timestamp: Date.now(),
        players: [
          {
            id: "other-player",
            position: { x: 0, y: 0 },
            velocity: { x: 0, y: 0 },
            isGrounded: true,
            tick: 1,
          },
        ],
        acks: {},
      };

      const result = reconciler.reconcile(snapshot);

      // Should return default state
      expect(result.id).toBe(playerId);
    });

    test("should handle empty acks", () => {
      const serverState: PlayerState = {
        id: playerId,
        position: { x: 50, y: 50 },
        velocity: { x: 0, y: 0 },
        isGrounded: false,
        tick: 1,
      };
      const snapshot: WorldSnapshot = {
        tick: 1,
        timestamp: Date.now(),
        players: [serverState],
        acks: {}, // No acks
      };

      const result = reconciler.reconcile(snapshot);

      expect(result.position.x).toBe(50);
    });
  });

  describe("real-world scenarios", () => {
    test("network lag spike: many queued inputs should replay with correct timing", () => {
      // Player sends inputs at 60fps during a 200ms lag spike
      // Server doesn't see any of them, then they all arrive at once
      const startTime = 1000;
      const inputCount = 12; // ~200ms of inputs at 60fps
      
      for (let i = 0; i < inputCount; i++) {
        inputBuffer.add({ 
          moveX: 1, moveY: 0, jump: false, 
          timestamp: startTime + i * 16.67 
        });
      }

      // Server snapshot arrives with position before any of these inputs
      const serverState: PlayerState = {
        id: playerId,
        position: { x: 0, y: 190 },
        velocity: { x: 0, y: 0 },
        isGrounded: true,
        tick: 1,
      };
      const snapshot = createSnapshot(serverState, -1); // No inputs acknowledged

      const result = reconciler.reconcile(snapshot);

      // All 12 inputs should be replayed with proper timing (~200ms total)
      // At 200 units/sec, should move about 40 units
      expect(result.position.x).toBeGreaterThan(30);
      expect(result.position.x).toBeLessThan(50);
    });

    test("partial acknowledgment: only replay unacknowledged inputs", () => {
      // Player sends 5 inputs
      const startTime = 1000;
      for (let i = 0; i < 5; i++) {
        inputBuffer.add({ 
          moveX: 1, moveY: 0, jump: false, 
          timestamp: startTime + i * 50 // 50ms apart (matching server tick)
        });
      }

      // Server acknowledges first 3 (seq 0, 1, 2)
      // Server position reflects those 3 inputs
      const serverState: PlayerState = {
        id: playerId,
        position: { x: 30, y: 190 }, // Moved 30 units from 3 inputs
        velocity: { x: 200, y: 0 },
        isGrounded: true,
        tick: 3,
      };
      const snapshot = createSnapshot(serverState, 2); // Ack through seq 2

      const result = reconciler.reconcile(snapshot);

      // Should replay seq 3 and 4 (2 more inputs, ~100ms, ~20 more units)
      expect(result.position.x).toBeGreaterThan(40);
      expect(result.position.x).toBeLessThan(60);
      
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
      inputBuffer.add({ moveX: 1, moveY: 0, jump: false, timestamp: 1000 }); // seq 0
      inputBuffer.add({ moveX: 1, moveY: 0, jump: false, timestamp: 1050 }); // seq 1
      inputBuffer.add({ moveX: 1, moveY: 0, jump: false, timestamp: 1100 }); // seq 2
      
      // Server only processed seq 0, but says player hit a wall and is at x=0
      const serverState: PlayerState = {
        id: playerId,
        position: { x: 0, y: 190 }, // Server says we're at origin (hit wall)
        velocity: { x: 0, y: 0 },   // And stopped
        isGrounded: true,
        tick: 1,
      };
      const snapshot = createSnapshot(serverState, 0); // Only ack seq 0

      const result = reconciler.reconcile(snapshot);

      // Client should accept server position (x=0) and replay seq 1 and 2
      // Since server says x=0, we replay 2 inputs (~100ms of movement)
      // At 200 units/sec, should move about 20 units
      expect(result.position.x).toBeGreaterThan(10);
      expect(result.position.x).toBeLessThan(30);
    });

    test("jump input timing: jump pressed while falling should not double-jump", () => {
      // Player is in the air (jumped earlier)
      inputBuffer.add({ moveX: 0, moveY: 0, jump: true, timestamp: 1000 }); // Jump while airborne
      inputBuffer.add({ moveX: 0, moveY: 0, jump: true, timestamp: 1050 }); // Still holding jump

      // Server confirms player is in the air
      const serverState: PlayerState = {
        id: playerId,
        position: { x: 0, y: 100 }, // In the air
        velocity: { x: 0, y: 50 },  // Falling down
        isGrounded: false,          // NOT grounded
        tick: 1,
      };
      const snapshot = createSnapshot(serverState, -1);

      const result = reconciler.reconcile(snapshot);

      // Player should continue falling, not get another jump
      // Velocity should still be positive (falling) or more positive
      expect(result.velocity.y).toBeGreaterThanOrEqual(50);
      expect(result.isGrounded).toBe(false);
    });
  });
});
