import { describe, expect, it } from "bun:test";
import { CharacterController, createCollisionInfo, resetCollisionInfo } from "./controller.js";
import { vec2 } from "./math.js";
import type { Collider } from "./types.js";

describe("CollisionInfo helpers", () => {
  describe("createCollisionInfo", () => {
    it("creates default collision info", () => {
      const info = createCollisionInfo();
      expect(info.above).toBe(false);
      expect(info.below).toBe(false);
      expect(info.left).toBe(false);
      expect(info.right).toBe(false);
      expect(info.climbingSlope).toBe(false);
      expect(info.descendingSlope).toBe(false);
      expect(info.slidingDownMaxSlope).toBe(false);
      expect(info.slopeAngle).toBe(0);
      expect(info.faceDir).toBe(1);
    });
  });

  describe("resetCollisionInfo", () => {
    it("resets collision flags but preserves faceDir", () => {
      const info = createCollisionInfo();
      info.below = true;
      info.faceDir = -1;
      info.slopeAngle = 45;

      const reset = resetCollisionInfo(info);
      expect(reset.below).toBe(false);
      expect(reset.faceDir).toBe(-1); // Preserved
      expect(reset.slopeAngleOld).toBe(45); // Old angle preserved
      expect(reset.slopeAngle).toBe(0); // Current angle reset
    });
  });
});

describe("CharacterController", () => {
  describe("creation", () => {
    it("creates a controller with position and size", () => {
      const colliders: Collider[] = [];
      const controller = new CharacterController(colliders, {
        position: vec2(0, 5),
        halfSize: vec2(0.5, 1),
      });

      expect(controller.position.x).toBe(0);
      expect(controller.position.y).toBe(5);
      expect(controller.halfSize.x).toBe(0.5);
      expect(controller.halfSize.y).toBe(1);
    });

    it("uses default config if not provided", () => {
      const colliders: Collider[] = [];
      const controller = new CharacterController(colliders, {
        position: vec2(0, 5),
        halfSize: vec2(0.5, 1),
      });

      expect(controller.collisions).toBeDefined();
    });

    it("accepts custom config", () => {
      const colliders: Collider[] = [];
      const controller = new CharacterController(colliders, {
        position: vec2(0, 5),
        halfSize: vec2(0.5, 1),
        config: {
          skinWidth: 0.02,
          maxSlopeAngle: 60,
          horizontalRayCount: 8,
          verticalRayCount: 8,
        },
      });

      expect(controller).toBeDefined();
    });
  });

  describe("move on flat ground", () => {
    it("falls and lands on ground", () => {
      // Ground platform at y=0
      const colliders: Collider[] = [
        { position: vec2(0, 0), halfExtents: vec2(10, 0.5) },
      ];

      const controller = new CharacterController(colliders, {
        position: vec2(0, 5),
        halfSize: vec2(0.5, 1),
      });

      // Apply downward velocity (gravity simulation)
      const velocity = vec2(0, -10);
      controller.move(velocity, 1.0); // 1 second - should fall and land

      // Should be on the ground
      expect(controller.collisions.below).toBe(true);
      // Character center should be at ground height (0.5) + character halfHeight (1) = 1.5
      expect(controller.position.y).toBeCloseTo(1.5, 1);
    });

    it("walks horizontally on ground", () => {
      // Ground platform
      const colliders: Collider[] = [
        { position: vec2(0, 0), halfExtents: vec2(10, 0.5) },
      ];

      const controller = new CharacterController(colliders, {
        position: vec2(0, 1.5), // On ground
        halfSize: vec2(0.5, 1),
      });

      // Move right
      const velocity = vec2(5, 0);
      controller.move(velocity, 0.5); // 0.5 seconds

      expect(controller.position.x).toBeCloseTo(2.5, 1);
      expect(controller.position.y).toBeCloseTo(1.5, 1);
    });
  });

  describe("wall collision", () => {
    it("stops at a wall", () => {
      // Wall on the right
      const colliders: Collider[] = [
        { position: vec2(5, 5), halfExtents: vec2(0.5, 5) },
      ];

      const controller = new CharacterController(colliders, {
        position: vec2(0, 5),
        halfSize: vec2(0.5, 1),
      });

      // Move right toward wall
      const velocity = vec2(10, 0);
      controller.move(velocity, 1.0);

      // Should be stopped at wall (wall left edge at 4.5, minus character halfWidth 0.5)
      expect(controller.position.x).toBeLessThanOrEqual(4.0);
      expect(controller.collisions.right).toBe(true);
    });

    it("stops at a wall on the left", () => {
      // Wall on the left
      const colliders: Collider[] = [
        { position: vec2(-5, 5), halfExtents: vec2(0.5, 5) },
      ];

      const controller = new CharacterController(colliders, {
        position: vec2(0, 5),
        halfSize: vec2(0.5, 1),
      });

      // Move left toward wall
      const velocity = vec2(-10, 0);
      controller.move(velocity, 1.0);

      // Should be stopped at wall (wall right edge at -4.5, plus character halfWidth 0.5)
      expect(controller.position.x).toBeGreaterThanOrEqual(-4.0);
      expect(controller.collisions.left).toBe(true);
    });
  });

  describe("ceiling collision", () => {
    it("stops at ceiling when moving up", () => {
      // Ceiling above
      const colliders: Collider[] = [
        { position: vec2(0, 10), halfExtents: vec2(10, 0.5) },
      ];

      const controller = new CharacterController(colliders, {
        position: vec2(0, 5),
        halfSize: vec2(0.5, 1),
      });

      // Move up toward ceiling
      const velocity = vec2(0, 20);
      controller.move(velocity, 1.0);

      // Should hit ceiling (ceiling bottom at 9.5, minus character halfHeight 1)
      expect(controller.position.y).toBeLessThanOrEqual(8.5);
      expect(controller.collisions.above).toBe(true);
    });
  });

  describe("one-way platforms", () => {
    it("lands on one-way platform from above", () => {
      // One-way platform
      const colliders: Collider[] = [
        { position: vec2(0, 5), halfExtents: vec2(5, 0.25), oneWay: true },
      ];

      const controller = new CharacterController(colliders, {
        position: vec2(0, 10),
        halfSize: vec2(0.5, 1),
      });

      // Fall down onto platform
      const velocity = vec2(0, -10);
      controller.move(velocity, 1.0);

      // Should land on platform
      expect(controller.collisions.below).toBe(true);
    });

    it("passes through one-way platform from below", () => {
      // One-way platform
      const colliders: Collider[] = [
        { position: vec2(0, 5), halfExtents: vec2(5, 0.25), oneWay: true },
      ];

      const controller = new CharacterController(colliders, {
        position: vec2(0, 2),
        halfSize: vec2(0.5, 1),
      });

      // Jump up through platform
      const velocity = vec2(0, 10);
      controller.move(velocity, 1.0);

      // Should pass through
      expect(controller.collisions.above).toBe(false);
      expect(controller.position.y).toBeGreaterThan(5);
    });

    it("drops through one-way platform when pressing down", () => {
      // One-way platform
      const colliders: Collider[] = [
        { position: vec2(0, 5), halfExtents: vec2(5, 0.25), oneWay: true },
      ];

      const controller = new CharacterController(colliders, {
        position: vec2(0, 6.25), // Standing on platform
        halfSize: vec2(0.5, 1),
      });

      // Move down while pressing down input
      const velocity = vec2(0, -1);
      controller.move(velocity, 0.1, vec2(0, -1)); // Input y < 0 means pressing down

      // Should start falling through
      expect(controller.collisions.fallingThroughPlatform).toBe(true);
    });
  });

  describe("face direction", () => {
    it("faces right when moving right", () => {
      const colliders: Collider[] = [];
      const controller = new CharacterController(colliders, {
        position: vec2(0, 5),
        halfSize: vec2(0.5, 1),
      });

      controller.move(vec2(5, 0), 0.1);
      expect(controller.collisions.faceDir).toBe(1);
    });

    it("faces left when moving left", () => {
      const colliders: Collider[] = [];
      const controller = new CharacterController(colliders, {
        position: vec2(0, 5),
        halfSize: vec2(0.5, 1),
      });

      controller.move(vec2(-5, 0), 0.1);
      expect(controller.collisions.faceDir).toBe(-1);
    });

    it("preserves face direction when not moving horizontally", () => {
      const colliders: Collider[] = [];
      const controller = new CharacterController(colliders, {
        position: vec2(0, 5),
        halfSize: vec2(0.5, 1),
      });

      controller.move(vec2(-5, 0), 0.1); // Face left
      controller.move(vec2(0, -5), 0.1); // Move down only

      expect(controller.collisions.faceDir).toBe(-1); // Still facing left
    });
  });

  describe("setPosition", () => {
    it("teleports the character", () => {
      const colliders: Collider[] = [];
      const controller = new CharacterController(colliders, {
        position: vec2(0, 5),
        halfSize: vec2(0.5, 1),
      });

      controller.setPosition(vec2(100, 200));

      expect(controller.position.x).toBe(100);
      expect(controller.position.y).toBe(200);
    });
  });

  describe("setHalfSize", () => {
    it("changes the character size", () => {
      const colliders: Collider[] = [];
      const controller = new CharacterController(colliders, {
        position: vec2(0, 5),
        halfSize: vec2(0.5, 1),
      });

      controller.setHalfSize(vec2(0.5, 0.5)); // Crouching

      expect(controller.halfSize.x).toBe(0.5);
      expect(controller.halfSize.y).toBe(0.5);
    });
  });
});
