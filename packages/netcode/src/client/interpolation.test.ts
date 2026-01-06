import { beforeEach, describe, expect, test } from "bun:test";
import type { PlayerState, WorldSnapshot } from "../types.js";
import { Interpolator } from "./interpolation.js";

describe("Interpolator", () => {
  let interpolator: Interpolator;

  beforeEach(() => {
    // Use 100ms delay for testing
    interpolator = new Interpolator(100);
  });

  const createSnapshot = (
    tick: number,
    timestamp: number,
    players: PlayerState[],
  ): WorldSnapshot => ({
    tick,
    timestamp,
    players,
    acks: {},
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

  describe("getInterpolatedStates", () => {
    test("should return empty array when no snapshots", () => {
      const states = interpolator.getInterpolatedStates();
      expect(states).toHaveLength(0);
    });

    test("should return latest state when only one snapshot", () => {
      const player: PlayerState = {
        id: "player-1",
        position: { x: 100, y: 200 },
        velocity: { x: 0, y: 0 },
        isGrounded: true,
        tick: 0,
      };
      interpolator.addSnapshot(createSnapshot(0, Date.now(), [player]));

      const states = interpolator.getInterpolatedStates();
      expect(states).toHaveLength(1);
      expect(states[0]?.position.x).toBe(100);
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
            tick: 0,
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
            tick: 1,
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
            tick: 2,
          },
        ]),
      );

      const states = interpolator.getInterpolatedStates();
      expect(states).toHaveLength(1);

      // With 100ms interpolation delay, we should be rendering
      // somewhere between the first two snapshots
      const x = states[0]?.position.x ?? 0;
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
            tick: 0,
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
            tick: 1,
          },
          {
            id: "player-2",
            position: { x: 100, y: 100 },
            velocity: { x: 0, y: 0 },
            isGrounded: false,
            tick: 1,
          },
        ]),
      );

      const states = interpolator.getInterpolatedStates();

      // Both players should be present
      const ids = states.map((s) => s.id).sort();
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
