import { describe, test, expect } from "bun:test";
import { interpolatePlatformer } from "./interpolation.js";
import type { PlatformerWorld, PlatformerPlayer } from "./types.js";
import { createTestPlayer, createTestWorld } from "./test-utils.js";

// Create a player with the given ID and optional overrides
const createPlayer = (
  id: string,
  overrides: Partial<Omit<PlatformerPlayer, "id">> = {},
): PlatformerPlayer => createTestPlayer(id, overrides);

const createWorld = (players: PlatformerPlayer[], tick: number = 0): PlatformerWorld =>
  createTestWorld(players, { tick, gameState: "playing" });

describe("interpolatePlatformer", () => {
  describe("basic interpolation", () => {
    // Note: Tests use small movements (< 200 units) to avoid triggering teleport detection
    test("should interpolate position linearly at alpha=0.5", () => {
      const from = createWorld([createPlayer("p1", { position: { x: 0, y: 0 } })], 0);
      const to = createWorld([createPlayer("p1", { position: { x: 20, y: 40 } })], 1);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.players.get("p1")?.position.x).toBe(10);
      expect(result.players.get("p1")?.position.y).toBe(20);
    });

    test("should return 'from' position at alpha=0", () => {
      const from = createWorld([createPlayer("p1", { position: { x: 10, y: 20 } })], 0);
      const to = createWorld([createPlayer("p1", { position: { x: 30, y: 50 } })], 1);

      const result = interpolatePlatformer(from, to, 0);

      expect(result.players.get("p1")?.position.x).toBe(10);
      expect(result.players.get("p1")?.position.y).toBe(20);
    });

    test("should return 'to' position at alpha=1", () => {
      const from = createWorld([createPlayer("p1", { position: { x: 10, y: 20 } })], 0);
      const to = createWorld([createPlayer("p1", { position: { x: 30, y: 50 } })], 1);

      const result = interpolatePlatformer(from, to, 1);

      expect(result.players.get("p1")?.position.x).toBe(30);
      expect(result.players.get("p1")?.position.y).toBe(50);
    });

    test("should interpolate at alpha=0.25", () => {
      const from = createWorld([createPlayer("p1", { position: { x: 0, y: 0 } })], 0);
      const to = createWorld([createPlayer("p1", { position: { x: 40, y: 40 } })], 1);

      const result = interpolatePlatformer(from, to, 0.25);

      expect(result.players.get("p1")?.position.x).toBe(10);
      expect(result.players.get("p1")?.position.y).toBe(10);
    });
  });

  describe("velocity interpolation", () => {
    test("should interpolate velocity linearly", () => {
      const from = createWorld([createPlayer("p1", { velocity: { x: 0, y: 0 } })], 0);
      const to = createWorld([createPlayer("p1", { velocity: { x: 40, y: -80 } })], 1);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.players.get("p1")?.velocity.x).toBe(20);
      expect(result.players.get("p1")?.velocity.y).toBe(-40);
    });
  });

  describe("isGrounded handling", () => {
    test("should use target (to) isGrounded state, not interpolate", () => {
      const from = createWorld([createPlayer("p1", { isGrounded: true })], 0);
      const to = createWorld([createPlayer("p1", { isGrounded: false })], 1);

      const result = interpolatePlatformer(from, to, 0.1);

      // Even at alpha=0.1, should use 'to' state for boolean
      expect(result.players.get("p1")?.isGrounded).toBe(false);
    });

    test("should preserve isGrounded=true from target", () => {
      const from = createWorld([createPlayer("p1", { isGrounded: false })], 0);
      const to = createWorld([createPlayer("p1", { isGrounded: true })], 1);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.players.get("p1")?.isGrounded).toBe(true);
    });
  });

  describe("multiple players", () => {
    test("should interpolate all players independently", () => {
      const from = createWorld(
        [
          createPlayer("p1", { position: { x: 0, y: 0 } }),
          createPlayer("p2", { position: { x: 100, y: 100 } }),
        ],
        0,
      );
      const to = createWorld(
        [
          createPlayer("p1", { position: { x: 20, y: 20 } }),
          createPlayer("p2", { position: { x: 120, y: 120 } }),
        ],
        1,
      );

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.players.get("p1")?.position.x).toBe(10);
      expect(result.players.get("p2")?.position.x).toBe(110);
    });

    test("should handle many players", () => {
      const fromPlayers: PlatformerPlayer[] = [];
      const toPlayers: PlatformerPlayer[] = [];

      for (let i = 0; i < 50; i++) {
        fromPlayers.push(createPlayer(`p${i}`, { position: { x: i * 10, y: 0 } }));
        toPlayers.push(createPlayer(`p${i}`, { position: { x: i * 10 + 20, y: 20 } }));
      }

      const from = createWorld(fromPlayers, 0);
      const to = createWorld(toPlayers, 1);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.players.size).toBe(50);
      expect(result.players.get("p0")?.position.x).toBe(10); // 0 + 20 * 0.5
      expect(result.players.get("p49")?.position.y).toBe(10); // 0 + 20 * 0.5
    });
  });

  describe("player appearing (new player)", () => {
    test("should use current state for new player not in 'from'", () => {
      const from = createWorld([createPlayer("p1", { position: { x: 0, y: 0 } })], 0);
      const to = createWorld(
        [
          createPlayer("p1", { position: { x: 20, y: 20 } }),
          createPlayer("p2", { position: { x: 500, y: 500 } }), // New player
        ],
        1,
      );

      const result = interpolatePlatformer(from, to, 0.5);

      // p1 should be interpolated
      expect(result.players.get("p1")?.position.x).toBe(10);

      // p2 is new, should use target state directly
      expect(result.players.get("p2")?.position.x).toBe(500);
      expect(result.players.get("p2")?.position.y).toBe(500);
    });
  });

  describe("player disappearing", () => {
    test("should include player that was in 'from' but not in 'to'", () => {
      const from = createWorld(
        [
          createPlayer("p1", { position: { x: 100, y: 100 } }),
          createPlayer("p2", { position: { x: 200, y: 200 } }),
        ],
        0,
      );
      const to = createWorld(
        [
          createPlayer("p1", { position: { x: 120, y: 120 } }),
          // p2 is gone
        ],
        1,
      );

      const result = interpolatePlatformer(from, to, 0.5);

      // p1 should be interpolated
      expect(result.players.get("p1")?.position.x).toBe(110);

      // p2 should still exist (from 'from' state) - shows during transition
      expect(result.players.has("p2")).toBe(true);
      expect(result.players.get("p2")?.position.x).toBe(200);
    });

    test("should preserve disappearing player's last known state", () => {
      const from = createWorld(
        [
          createPlayer("leaving", {
            position: { x: 300, y: 150 },
            velocity: { x: 10, y: -5 },
            isGrounded: false,
          }),
        ],
        0,
      );
      const to = createWorld([], 1); // Player left

      const result = interpolatePlatformer(from, to, 0.5);

      const leavingPlayer = result.players.get("leaving");
      expect(leavingPlayer?.position.x).toBe(300);
      expect(leavingPlayer?.velocity.x).toBe(10);
      expect(leavingPlayer?.isGrounded).toBe(false);
    });
  });

  describe("tick handling", () => {
    test("should use target tick", () => {
      const from = createWorld([], 10);
      const to = createWorld([], 15);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.tick).toBe(15);
    });

    test("should use target tick even at alpha=0", () => {
      const from = createWorld([], 0);
      const to = createWorld([], 100);

      const result = interpolatePlatformer(from, to, 0);

      expect(result.tick).toBe(100);
    });
  });

  describe("edge cases", () => {
    test("should handle empty worlds", () => {
      const from = createWorld([], 0);
      const to = createWorld([], 1);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.players.size).toBe(0);
    });

    test("should handle negative positions", () => {
      const from = createWorld([createPlayer("p1", { position: { x: -20, y: -40 } })], 0);
      const to = createWorld([createPlayer("p1", { position: { x: 20, y: 40 } })], 1);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.players.get("p1")?.position.x).toBe(0);
      expect(result.players.get("p1")?.position.y).toBe(0);
    });

    test("should handle alpha slightly outside 0-1 range", () => {
      const from = createWorld([createPlayer("p1", { position: { x: 0, y: 0 } })], 0);
      const to = createWorld([createPlayer("p1", { position: { x: 40, y: 40 } })], 1);

      // Alpha slightly > 1 (extrapolation)
      const resultOver = interpolatePlatformer(from, to, 1.1);
      expect(resultOver.players.get("p1")?.position.x).toBeCloseTo(44, 5);

      // Alpha slightly < 0
      const resultUnder = interpolatePlatformer(from, to, -0.1);
      expect(resultUnder.players.get("p1")?.position.x).toBeCloseTo(-4, 5);
    });

    test("should handle same position (no movement)", () => {
      const from = createWorld([createPlayer("p1", { position: { x: 50, y: 50 } })], 0);
      const to = createWorld([createPlayer("p1", { position: { x: 50, y: 50 } })], 1);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.players.get("p1")?.position.x).toBe(50);
      expect(result.players.get("p1")?.position.y).toBe(50);
    });

    test("should produce new Map instance", () => {
      const from = createWorld([createPlayer("p1")], 0);
      const to = createWorld([createPlayer("p1")], 1);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.players).not.toBe(from.players);
      expect(result.players).not.toBe(to.players);
    });
  });

  describe("teleport detection", () => {
    test("should snap to target position when distance exceeds threshold (teleport/respawn)", () => {
      // Large position change (> 200 units) should snap, not interpolate
      const from = createWorld([createPlayer("p1", { position: { x: 0, y: 0 } })], 0);
      const to = createWorld([createPlayer("p1", { position: { x: 500, y: 500 } })], 1);

      const result = interpolatePlatformer(from, to, 0.5);

      // Should snap to target, not interpolate to (250, 250)
      expect(result.players.get("p1")?.position.x).toBe(500);
      expect(result.players.get("p1")?.position.y).toBe(500);
    });

    test("should interpolate normally when distance is under threshold", () => {
      // Small position change (< 200 units) should interpolate normally
      const from = createWorld([createPlayer("p1", { position: { x: 0, y: 0 } })], 0);
      const to = createWorld([createPlayer("p1", { position: { x: 50, y: 50 } })], 1);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.players.get("p1")?.position.x).toBe(25);
      expect(result.players.get("p1")?.position.y).toBe(25);
    });
  });
});
