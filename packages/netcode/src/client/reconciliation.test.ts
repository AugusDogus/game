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
});
