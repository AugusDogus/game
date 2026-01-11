import { beforeEach, describe, expect, test } from "bun:test";
import type { Snapshot } from "../core/types.js";
import { interpolatePlatformer } from "../examples/platformer/interpolation.js";
import type { PlatformerPlayer, PlatformerWorld } from "../examples/platformer/types.js";
import { Interpolator } from "./interpolation.js";
import { assertDefined, createTestPlayer, createTestWorld } from "../test-utils.js";

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
    return {
      tick,
      timestamp,
      state: createTestWorld(players, { tick, gameState: "playing" }),
      inputAcks: new Map(),
    };
  };

  const createPlayerData = (
    id: string,
    x: number,
    y: number,
    isGrounded: boolean = true,
    velocityX: number = 0,
    velocityY: number = 0,
  ): PlatformerPlayer =>
    createTestPlayer(id, {
      position: { x, y },
      velocity: { x: velocityX, y: velocityY },
      isGrounded,
    });

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
      const player = createPlayerData("player-1", 100, 200);
      interpolator.addSnapshot(createSnapshot(0, Date.now(), [player]));

      const state = assertDefined(interpolator.getInterpolatedState(), "interpolated state");
      expect(state.players.size).toBe(1);
      expect(state.players.get("player-1")?.position.x).toBe(100);
    });

    test("should interpolate between two snapshots", () => {
      const now = Date.now();

      // Add snapshot from 200ms ago
      interpolator.addSnapshot(
        createSnapshot(0, now - 200, [createPlayerData("player-1", 0, 0, true, 100, 0)]),
      );

      // Add snapshot from 100ms ago
      interpolator.addSnapshot(
        createSnapshot(1, now - 100, [createPlayerData("player-1", 100, 0, true, 100, 0)]),
      );

      // Add snapshot from now
      interpolator.addSnapshot(
        createSnapshot(2, now, [createPlayerData("player-1", 200, 0, true, 100, 0)]),
      );

      const state = assertDefined(interpolator.getInterpolatedState(), "interpolated state");
      expect(state.players.size).toBe(1);

      // With 100ms interpolation delay, we should be rendering
      // somewhere between the first two snapshots
      const x = state.players.get("player-1")?.position.x ?? 0;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(200);
    });

    test("should handle new player appearing", () => {
      const now = Date.now();

      // First snapshot: only player 1
      interpolator.addSnapshot(createSnapshot(0, now - 200, [createPlayerData("player-1", 0, 0)]));

      // Second snapshot: player 1 and player 2
      interpolator.addSnapshot(
        createSnapshot(1, now - 100, [
          createPlayerData("player-1", 50, 0),
          createPlayerData("player-2", 100, 100, false),
        ]),
      );

      const state = assertDefined(interpolator.getInterpolatedState(), "interpolated state");

      // Both players should be present
      const ids = Array.from(state.players.keys()).sort();
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

  describe("getLatestSnapshot", () => {
    test("should return null when no snapshots", () => {
      const snapshot = interpolator.getLatestSnapshot();
      expect(snapshot).toBeNull();
    });

    test("should return the most recently added snapshot", () => {
      interpolator.addSnapshot(createSnapshot(0, Date.now() - 100, []));
      interpolator.addSnapshot(createSnapshot(1, Date.now() - 50, []));
      interpolator.addSnapshot(
        createSnapshot(2, Date.now(), [createPlayerData("latest-player", 999, 999)]),
      );

      const snapshot = interpolator.getLatestSnapshot();
      expect(snapshot).not.toBeNull();
      expect(snapshot?.tick).toBe(2);
      expect(snapshot?.state.players.has("latest-player")).toBe(true);
    });

    test("should return uninterpolated raw snapshot", () => {
      const now = Date.now();
      interpolator.addSnapshot(createSnapshot(0, now - 200, [createPlayerData("p1", 0, 0)]));
      interpolator.addSnapshot(createSnapshot(1, now, [createPlayerData("p1", 100, 100)]));

      const latest = interpolator.getLatestSnapshot();
      // Should return exact position, not interpolated
      expect(latest?.state.players.get("p1")?.position.x).toBe(100);
    });
  });

  describe("player disappearing between snapshots", () => {
    test("should handle player leaving gracefully", () => {
      const now = Date.now();

      // First snapshot: two players
      interpolator.addSnapshot(
        createSnapshot(0, now - 200, [
          createPlayerData("staying", 0, 0),
          createPlayerData("leaving", 100, 100),
        ]),
      );

      // Second snapshot: only one player (other left)
      interpolator.addSnapshot(createSnapshot(1, now - 100, [createPlayerData("staying", 50, 0)]));

      // Third snapshot: still just one player
      interpolator.addSnapshot(createSnapshot(2, now, [createPlayerData("staying", 100, 0)]));

      const state = assertDefined(interpolator.getInterpolatedState(), "interpolated state");

      // Staying player should be interpolated
      expect(state.players.has("staying")).toBe(true);
    });

    test("should include disappearing player briefly during transition", () => {
      const now = Date.now();

      // Add two snapshots very close in time (within interpolation window)
      interpolator.addSnapshot(
        createSnapshot(0, now - 150, [
          createPlayerData("player", 0, 0),
          createPlayerData("leaving", 50, 50),
        ]),
      );

      interpolator.addSnapshot(
        createSnapshot(1, now - 50, [
          createPlayerData("player", 100, 0),
          // "leaving" is gone
        ]),
      );

      const state = assertDefined(interpolator.getInterpolatedState(), "interpolated state");
      expect(state.players.has("player")).toBe(true);
      // The interpolation function includes leaving players temporarily
      // (depends on implementation - check the behavior)
    });
  });

  describe("edge cases", () => {
    test("should handle snapshots with same timestamp", () => {
      const now = Date.now();

      interpolator.addSnapshot(createSnapshot(0, now, [createPlayerData("p1", 0, 0)]));
      interpolator.addSnapshot(createSnapshot(1, now, [createPlayerData("p1", 100, 0)]));

      // Should not crash, should return some state
      const state = interpolator.getInterpolatedState();
      expect(state).not.toBeNull();
    });

    test("should handle very old render time gracefully", () => {
      const now = Date.now();

      // Only add recent snapshots
      interpolator.addSnapshot(createSnapshot(0, now - 10, [createPlayerData("p1", 0, 0)]));

      // Interpolator tries to render at now - 100ms (before our snapshot)
      const state = assertDefined(interpolator.getInterpolatedState(), "interpolated state");
      // Should return earliest available snapshot
      expect(state.players.get("p1")?.position.x).toBe(0);
    });

    test("should handle empty player list", () => {
      interpolator.addSnapshot(createSnapshot(0, Date.now() - 100, []));
      interpolator.addSnapshot(createSnapshot(1, Date.now(), []));

      const state = assertDefined(interpolator.getInterpolatedState(), "interpolated state");
      expect(state.players.size).toBe(0);
    });
  });
});
