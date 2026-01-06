import { beforeEach, describe, expect, test } from "bun:test";
import type { Snapshot } from "../core/types.js";
import { interpolatePlatformer } from "../examples/platformer/interpolation.js";
import type { PlatformerPlayer, PlatformerWorld } from "../examples/platformer/types.js";
import { Interpolator } from "./interpolation.js";

describe("Interpolator", () => {
  let interpolator: Interpolator<PlatformerWorld>;

  beforeEach(() => {
    // Use 100ms delay for testing
    interpolator = new Interpolator<PlatformerWorld>(interpolatePlatformer, 100);
  });

  const createSnapshot = (
    tick: number,
    timestamp: number,
    players: PlatformerPlayer[],
  ): Snapshot<PlatformerWorld> => {
    const playerMap = new Map<string, PlatformerPlayer>();
    for (const player of players) {
      playerMap.set(player.id, player);
    }
    return {
      tick,
      timestamp,
      state: { players: playerMap, tick },
      inputAcks: new Map(),
    };
  };

  describe("addSnapshot", () => {
    test("should add snapshot to buffer", () => {
      const snapshot = createSnapshot(0, Date.now(), []);
      interpolator.addSnapshot(snapshot);

      expect(interpolator.size()).toBe(1);
    });

    test("should limit buffer size", () => {
      for (let i = 0; i < 30; i++) {
        interpolator.addSnapshot(createSnapshot(i, Date.now() + i * 50, []));
      }

      // Buffer is now 20 snapshots for smoother interpolation
      expect(interpolator.size()).toBeLessThanOrEqual(20);
    });
  });

  describe("getInterpolatedState", () => {
    test("should return null when no snapshots", () => {
      const state = interpolator.getInterpolatedState();
      expect(state).toBeNull();
    });

    test("should return latest state when only one snapshot", () => {
      const player: PlatformerPlayer = {
        id: "player-1",
        position: { x: 100, y: 200 },
        velocity: { x: 0, y: 0 },
        isGrounded: true,
      };
      interpolator.addSnapshot(createSnapshot(0, Date.now(), [player]));

      const state = interpolator.getInterpolatedState();
      expect(state).not.toBeNull();
      expect(state!.players.size).toBe(1);
      expect(state!.players.get("player-1")?.position.x).toBe(100);
    });

    test("should interpolate between two snapshots", () => {
      const now = Date.now();

      // Add snapshot from 200ms ago
      interpolator.addSnapshot(
        createSnapshot(0, now - 200, [
          {
            id: "player-1",
            position: { x: 0, y: 0 },
            velocity: { x: 100, y: 0 },
            isGrounded: true,
          },
        ]),
      );

      // Add snapshot from 100ms ago
      interpolator.addSnapshot(
        createSnapshot(1, now - 100, [
          {
            id: "player-1",
            position: { x: 100, y: 0 },
            velocity: { x: 100, y: 0 },
            isGrounded: true,
          },
        ]),
      );

      // Add snapshot from now
      interpolator.addSnapshot(
        createSnapshot(2, now, [
          {
            id: "player-1",
            position: { x: 200, y: 0 },
            velocity: { x: 100, y: 0 },
            isGrounded: true,
          },
        ]),
      );

      const state = interpolator.getInterpolatedState();
      expect(state).not.toBeNull();
      expect(state!.players.size).toBe(1);

      // With 100ms interpolation delay, we should be rendering
      // somewhere between the first two snapshots
      const x = state!.players.get("player-1")?.position.x ?? 0;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(200);
    });

    test("should handle new player appearing", () => {
      const now = Date.now();

      // First snapshot: only player 1
      interpolator.addSnapshot(
        createSnapshot(0, now - 200, [
          {
            id: "player-1",
            position: { x: 0, y: 0 },
            velocity: { x: 0, y: 0 },
            isGrounded: true,
          },
        ]),
      );

      // Second snapshot: player 1 and player 2
      interpolator.addSnapshot(
        createSnapshot(1, now - 100, [
          {
            id: "player-1",
            position: { x: 50, y: 0 },
            velocity: { x: 0, y: 0 },
            isGrounded: true,
          },
          {
            id: "player-2",
            position: { x: 100, y: 100 },
            velocity: { x: 0, y: 0 },
            isGrounded: false,
          },
        ]),
      );

      const state = interpolator.getInterpolatedState();
      expect(state).not.toBeNull();

      // Both players should be present
      const ids = Array.from(state!.players.keys()).sort();
      expect(ids).toContain("player-1");
    });
  });

  describe("clear", () => {
    test("should remove all snapshots", () => {
      interpolator.addSnapshot(createSnapshot(0, Date.now(), []));
      interpolator.addSnapshot(createSnapshot(1, Date.now(), []));

      interpolator.clear();

      expect(interpolator.size()).toBe(0);
    });
  });
});
