import { describe, test, expect } from "bun:test";
import { interpolatePlatformer } from "./interpolation.js";
import type { PlatformerWorld, PlatformerPlayer } from "./types.js";

function createPlayer(overrides: Partial<PlatformerPlayer> = {}): PlatformerPlayer {
  return {
    id: "test-player",
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    isGrounded: true,
    ...overrides,
  };
}

function createWorld(players: Map<string, PlatformerPlayer>, tick: number = 0): PlatformerWorld {
  return { players, tick };
}

describe("interpolatePlatformer", () => {
  describe("basic interpolation", () => {
    test("should interpolate position linearly at alpha=0.5", () => {
      const from = createWorld(new Map([
        ["p1", createPlayer({ position: { x: 0, y: 0 } })],
      ]), 0);
      const to = createWorld(new Map([
        ["p1", createPlayer({ position: { x: 100, y: 200 } })],
      ]), 1);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.players.get("p1")?.position.x).toBe(50);
      expect(result.players.get("p1")?.position.y).toBe(100);
    });

    test("should return 'from' position at alpha=0", () => {
      const from = createWorld(new Map([
        ["p1", createPlayer({ position: { x: 10, y: 20 } })],
      ]), 0);
      const to = createWorld(new Map([
        ["p1", createPlayer({ position: { x: 100, y: 200 } })],
      ]), 1);

      const result = interpolatePlatformer(from, to, 0);

      expect(result.players.get("p1")?.position.x).toBe(10);
      expect(result.players.get("p1")?.position.y).toBe(20);
    });

    test("should return 'to' position at alpha=1", () => {
      const from = createWorld(new Map([
        ["p1", createPlayer({ position: { x: 10, y: 20 } })],
      ]), 0);
      const to = createWorld(new Map([
        ["p1", createPlayer({ position: { x: 100, y: 200 } })],
      ]), 1);

      const result = interpolatePlatformer(from, to, 1);

      expect(result.players.get("p1")?.position.x).toBe(100);
      expect(result.players.get("p1")?.position.y).toBe(200);
    });

    test("should interpolate at alpha=0.25", () => {
      const from = createWorld(new Map([
        ["p1", createPlayer({ position: { x: 0, y: 0 } })],
      ]), 0);
      const to = createWorld(new Map([
        ["p1", createPlayer({ position: { x: 100, y: 100 } })],
      ]), 1);

      const result = interpolatePlatformer(from, to, 0.25);

      expect(result.players.get("p1")?.position.x).toBe(25);
      expect(result.players.get("p1")?.position.y).toBe(25);
    });
  });

  describe("velocity interpolation", () => {
    test("should interpolate velocity linearly", () => {
      const from = createWorld(new Map([
        ["p1", createPlayer({ velocity: { x: 0, y: 0 } })],
      ]), 0);
      const to = createWorld(new Map([
        ["p1", createPlayer({ velocity: { x: 100, y: -200 } })],
      ]), 1);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.players.get("p1")?.velocity.x).toBe(50);
      expect(result.players.get("p1")?.velocity.y).toBe(-100);
    });
  });

  describe("isGrounded handling", () => {
    test("should use target (to) isGrounded state, not interpolate", () => {
      const from = createWorld(new Map([
        ["p1", createPlayer({ isGrounded: true })],
      ]), 0);
      const to = createWorld(new Map([
        ["p1", createPlayer({ isGrounded: false })],
      ]), 1);

      const result = interpolatePlatformer(from, to, 0.1);

      // Even at alpha=0.1, should use 'to' state for boolean
      expect(result.players.get("p1")?.isGrounded).toBe(false);
    });

    test("should preserve isGrounded=true from target", () => {
      const from = createWorld(new Map([
        ["p1", createPlayer({ isGrounded: false })],
      ]), 0);
      const to = createWorld(new Map([
        ["p1", createPlayer({ isGrounded: true })],
      ]), 1);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.players.get("p1")?.isGrounded).toBe(true);
    });
  });

  describe("multiple players", () => {
    test("should interpolate all players independently", () => {
      const from = createWorld(new Map([
        ["p1", createPlayer({ position: { x: 0, y: 0 } })],
        ["p2", createPlayer({ position: { x: 100, y: 100 } })],
      ]), 0);
      const to = createWorld(new Map([
        ["p1", createPlayer({ position: { x: 100, y: 100 } })],
        ["p2", createPlayer({ position: { x: 200, y: 200 } })],
      ]), 1);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.players.get("p1")?.position.x).toBe(50);
      expect(result.players.get("p2")?.position.x).toBe(150);
    });

    test("should handle many players", () => {
      const fromPlayers = new Map<string, PlatformerPlayer>();
      const toPlayers = new Map<string, PlatformerPlayer>();
      
      for (let i = 0; i < 50; i++) {
        fromPlayers.set(`p${i}`, createPlayer({ position: { x: i * 10, y: 0 } }));
        toPlayers.set(`p${i}`, createPlayer({ position: { x: i * 10 + 100, y: 100 } }));
      }

      const from = createWorld(fromPlayers, 0);
      const to = createWorld(toPlayers, 1);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.players.size).toBe(50);
      expect(result.players.get("p0")?.position.x).toBe(50); // 0 + 100 * 0.5
      expect(result.players.get("p49")?.position.y).toBe(50); // 0 + 100 * 0.5
    });
  });

  describe("player appearing (new player)", () => {
    test("should use current state for new player not in 'from'", () => {
      const from = createWorld(new Map([
        ["p1", createPlayer({ position: { x: 0, y: 0 } })],
      ]), 0);
      const to = createWorld(new Map([
        ["p1", createPlayer({ position: { x: 100, y: 100 } })],
        ["p2", createPlayer({ position: { x: 500, y: 500 } })], // New player
      ]), 1);

      const result = interpolatePlatformer(from, to, 0.5);

      // p1 should be interpolated
      expect(result.players.get("p1")?.position.x).toBe(50);
      
      // p2 is new, should use target state directly
      expect(result.players.get("p2")?.position.x).toBe(500);
      expect(result.players.get("p2")?.position.y).toBe(500);
    });
  });

  describe("player disappearing", () => {
    test("should include player that was in 'from' but not in 'to'", () => {
      const from = createWorld(new Map([
        ["p1", createPlayer({ position: { x: 100, y: 100 } })],
        ["p2", createPlayer({ position: { x: 200, y: 200 } })],
      ]), 0);
      const to = createWorld(new Map([
        ["p1", createPlayer({ position: { x: 150, y: 150 } })],
        // p2 is gone
      ]), 1);

      const result = interpolatePlatformer(from, to, 0.5);

      // p1 should be interpolated
      expect(result.players.get("p1")?.position.x).toBe(125);
      
      // p2 should still exist (from 'from' state) - shows during transition
      expect(result.players.has("p2")).toBe(true);
      expect(result.players.get("p2")?.position.x).toBe(200);
    });

    test("should preserve disappearing player's last known state", () => {
      const from = createWorld(new Map([
        ["leaving", createPlayer({ 
          position: { x: 300, y: 150 }, 
          velocity: { x: 10, y: -5 },
          isGrounded: false 
        })],
      ]), 0);
      const to = createWorld(new Map(), 1); // Player left

      const result = interpolatePlatformer(from, to, 0.5);

      const leavingPlayer = result.players.get("leaving");
      expect(leavingPlayer?.position.x).toBe(300);
      expect(leavingPlayer?.velocity.x).toBe(10);
      expect(leavingPlayer?.isGrounded).toBe(false);
    });
  });

  describe("tick handling", () => {
    test("should use target tick", () => {
      const from = createWorld(new Map(), 10);
      const to = createWorld(new Map(), 15);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.tick).toBe(15);
    });

    test("should use target tick even at alpha=0", () => {
      const from = createWorld(new Map(), 0);
      const to = createWorld(new Map(), 100);

      const result = interpolatePlatformer(from, to, 0);

      expect(result.tick).toBe(100);
    });
  });

  describe("edge cases", () => {
    test("should handle empty worlds", () => {
      const from = createWorld(new Map(), 0);
      const to = createWorld(new Map(), 1);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.players.size).toBe(0);
    });

    test("should handle negative positions", () => {
      const from = createWorld(new Map([
        ["p1", createPlayer({ position: { x: -100, y: -200 } })],
      ]), 0);
      const to = createWorld(new Map([
        ["p1", createPlayer({ position: { x: 100, y: 200 } })],
      ]), 1);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.players.get("p1")?.position.x).toBe(0);
      expect(result.players.get("p1")?.position.y).toBe(0);
    });

    test("should handle alpha slightly outside 0-1 range", () => {
      const from = createWorld(new Map([
        ["p1", createPlayer({ position: { x: 0, y: 0 } })],
      ]), 0);
      const to = createWorld(new Map([
        ["p1", createPlayer({ position: { x: 100, y: 100 } })],
      ]), 1);

      // Alpha slightly > 1 (extrapolation)
      const resultOver = interpolatePlatformer(from, to, 1.1);
      expect(resultOver.players.get("p1")?.position.x).toBeCloseTo(110, 5);

      // Alpha slightly < 0
      const resultUnder = interpolatePlatformer(from, to, -0.1);
      expect(resultUnder.players.get("p1")?.position.x).toBeCloseTo(-10, 5);
    });

    test("should handle same position (no movement)", () => {
      const from = createWorld(new Map([
        ["p1", createPlayer({ position: { x: 50, y: 50 } })],
      ]), 0);
      const to = createWorld(new Map([
        ["p1", createPlayer({ position: { x: 50, y: 50 } })],
      ]), 1);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.players.get("p1")?.position.x).toBe(50);
      expect(result.players.get("p1")?.position.y).toBe(50);
    });

    test("should produce new Map instance", () => {
      const from = createWorld(new Map([
        ["p1", createPlayer()],
      ]), 0);
      const to = createWorld(new Map([
        ["p1", createPlayer()],
      ]), 1);

      const result = interpolatePlatformer(from, to, 0.5);

      expect(result.players).not.toBe(from.players);
      expect(result.players).not.toBe(to.players);
    });
  });
});
