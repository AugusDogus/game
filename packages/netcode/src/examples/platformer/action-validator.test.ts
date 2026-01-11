import { describe, it, expect } from "bun:test";
import { validatePlatformerAction, isInAttackRange } from "./action-validator.js";
import type { PlatformerWorld, PlatformerAction } from "./types.js";
import { ATTACK_RADIUS } from "./types.js";

describe("validatePlatformerAction", () => {
  const createWorld = (
    players: Array<{ id: string; x: number; y: number }>,
  ): PlatformerWorld => ({
    players: new Map(
      players.map((p) => [
        p.id,
        {
          id: p.id,
          position: { x: p.x, y: p.y },
          velocity: { x: 0, y: 0 },
          isGrounded: true,
        },
      ]),
    ),
    tick: 1,
  });

  describe("attack action", () => {
    it("should hit a player within attack radius", () => {
      const world = createWorld([
        { id: "attacker", x: 0, y: 0 },
        { id: "target", x: 30, y: 0 }, // Within ATTACK_RADIUS (50)
      ]);

      const action: PlatformerAction = {
        type: "attack",
        targetX: 30,
        targetY: 0,
      };

      const result = validatePlatformerAction(world, "attacker", action);

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result?.targetId).toBe("target");
      expect(result.result?.damage).toBe(10);
    });

    it("should miss when no player is in range", () => {
      const world = createWorld([
        { id: "attacker", x: 0, y: 0 },
        { id: "target", x: 200, y: 0 }, // Far outside ATTACK_RADIUS
      ]);

      const action: PlatformerAction = {
        type: "attack",
        targetX: 50, // Attacking empty space (target is at 200, far from 50)
        targetY: 0,
      };

      const result = validatePlatformerAction(world, "attacker", action);

      expect(result.success).toBe(false);
      expect(result.result).toBeUndefined();
    });

    it("should not hit the attacker themselves", () => {
      const world = createWorld([{ id: "attacker", x: 0, y: 0 }]);

      const action: PlatformerAction = {
        type: "attack",
        targetX: 0,
        targetY: 0,
      };

      const result = validatePlatformerAction(world, "attacker", action);

      expect(result.success).toBe(false);
    });

    it("should hit the closest player when multiple are in range", () => {
      const world = createWorld([
        { id: "attacker", x: 0, y: 0 },
        { id: "target1", x: 30, y: 0 },
        { id: "target2", x: 40, y: 0 },
      ]);

      // Target position closer to target1
      const action: PlatformerAction = {
        type: "attack",
        targetX: 30,
        targetY: 0,
      };

      const result = validatePlatformerAction(world, "attacker", action);

      expect(result.success).toBe(true);
      // Should hit target1 (exact position match)
      expect(result.result?.targetId).toBe("target1");
    });

    it("should hit player exactly at attack radius boundary", () => {
      const world = createWorld([
        { id: "attacker", x: 0, y: 0 },
        { id: "target", x: ATTACK_RADIUS, y: 0 }, // Exactly at boundary
      ]);

      const action: PlatformerAction = {
        type: "attack",
        targetX: 0,
        targetY: 0,
      };

      const result = validatePlatformerAction(world, "attacker", action);

      expect(result.success).toBe(true);
    });

    it("should miss player just outside attack radius", () => {
      const world = createWorld([
        { id: "attacker", x: 0, y: 0 },
        { id: "target", x: ATTACK_RADIUS + 1, y: 0 }, // Just outside
      ]);

      const action: PlatformerAction = {
        type: "attack",
        targetX: 0,
        targetY: 0,
      };

      const result = validatePlatformerAction(world, "attacker", action);

      expect(result.success).toBe(false);
    });
  });
});

describe("isInAttackRange", () => {
  it("should return true when target is in range", () => {
    expect(isInAttackRange(0, 0, 30, 0)).toBe(true);
    expect(isInAttackRange(0, 0, 0, 30)).toBe(true);
    expect(isInAttackRange(0, 0, 35, 35)).toBe(true); // ~49.5 distance
  });

  it("should return false when target is out of range", () => {
    expect(isInAttackRange(0, 0, 100, 0)).toBe(false);
    expect(isInAttackRange(0, 0, 0, 100)).toBe(false);
  });

  it("should return true at exactly attack radius", () => {
    expect(isInAttackRange(0, 0, ATTACK_RADIUS, 0)).toBe(true);
  });

  it("should return false just outside attack radius", () => {
    expect(isInAttackRange(0, 0, ATTACK_RADIUS + 0.1, 0)).toBe(false);
  });
});
