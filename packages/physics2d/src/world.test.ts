import { describe, expect, it, beforeAll } from "bun:test";
import { PhysicsWorld, initPhysics } from "./world.js";
import { vec2 } from "./math.js";
import type { Vector2, ColliderOptions } from "./types.js";

// Initialize Rapier WASM once before all tests
beforeAll(async () => {
  await initPhysics();
});

/**
 * Helper to create a world with colliders already added and broadphase updated.
 * This is the typical pattern for level setup.
 */
function createWorldWithColliders(
  colliders: Array<{ position: Vector2; halfExtents: Vector2; options?: ColliderOptions }>,
): PhysicsWorld {
  const world = PhysicsWorld.create();
  for (const c of colliders) {
    world.addStaticCollider(c.position, c.halfExtents, c.options);
  }
  world.updateBroadphase();
  return world;
}

describe("PhysicsWorld", () => {
  describe("create", () => {
    it("creates a physics world with default gravity", () => {
      const world = PhysicsWorld.create();
      expect(world).toBeDefined();
    });

    it("creates a physics world with custom gravity", () => {
      const world = PhysicsWorld.create({ x: 0, y: -10 });
      expect(world).toBeDefined();
    });
  });

  describe("addStaticCollider", () => {
    it("adds a static collider and returns a handle", () => {
      const world = PhysicsWorld.create();
      const handle = world.addStaticCollider({ x: 0, y: 0 }, { x: 5, y: 0.5 });
      expect(typeof handle).toBe("number");
    });

    it("adds a one-way platform", () => {
      const world = PhysicsWorld.create();
      const handle = world.addStaticCollider({ x: 0, y: 0 }, { x: 5, y: 0.5 }, { oneWay: true });
      expect(world.isOneWay(handle)).toBe(true);
    });

    it("adds a collider with a tag", () => {
      const world = PhysicsWorld.create();
      const handle = world.addStaticCollider({ x: 0, y: 0 }, { x: 5, y: 0.5 }, { tag: "ground" });
      expect(world.getTag(handle)).toBe("ground");
    });
  });

  describe("removeCollider", () => {
    it("removes a collider", () => {
      const world = PhysicsWorld.create();
      const handle = world.addStaticCollider({ x: 0, y: 0 }, { x: 5, y: 0.5 });
      world.updateBroadphase();
      
      // Verify collider exists by raycasting
      const hitBefore = world.raycast({ x: 0, y: 10 }, { x: 0, y: -1 }, 20);
      expect(hitBefore).not.toBeNull();
      
      // Remove the collider
      world.removeCollider(handle);
      world.updateBroadphase();
      
      // Verify collider is gone
      const hitAfter = world.raycast({ x: 0, y: 10 }, { x: 0, y: -1 }, 20);
      expect(hitAfter).toBeNull();
    });
  });

  describe("raycast", () => {
    it("returns null when nothing is hit", () => {
      const world = PhysicsWorld.create();
      const hit = world.raycast({ x: 0, y: 10 }, { x: 0, y: -1 }, 5);
      expect(hit).toBeNull();
    });

    it("hits a collider and returns hit info", () => {
      // Platform at y=0, 10 units wide, 1 unit tall
      const world = createWorldWithColliders([
        { position: vec2(0, 0), halfExtents: vec2(5, 0.5) },
      ]);
      
      // Cast ray downward from y=10
      const hit = world.raycast({ x: 0, y: 10 }, { x: 0, y: -1 }, 20);
      
      expect(hit).not.toBeNull();
      if (hit) {
        // Should hit the top of the platform (y = 0.5)
        expect(hit.point.y).toBeCloseTo(0.5, 5);
        expect(hit.point.x).toBeCloseTo(0, 5);
        // Normal should point up
        expect(hit.normal.x).toBeCloseTo(0, 5);
        expect(hit.normal.y).toBeCloseTo(1, 5);
        // Distance from y=10 to y=0.5 is 9.5
        expect(hit.distance).toBeCloseTo(9.5, 5);
      }
    });

    it("respects max distance", () => {
      const world = createWorldWithColliders([
        { position: vec2(0, 0), halfExtents: vec2(5, 0.5) },
      ]);
      
      // Cast ray with max distance less than distance to platform
      const hit = world.raycast({ x: 0, y: 10 }, { x: 0, y: -1 }, 5);
      expect(hit).toBeNull();
    });

    it("hits horizontal walls correctly", () => {
      // Wall at x=5
      const world = createWorldWithColliders([
        { position: vec2(5, 0), halfExtents: vec2(0.5, 5) },
      ]);
      
      // Cast ray rightward
      const hit = world.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 10);
      
      expect(hit).not.toBeNull();
      if (hit) {
        // Should hit the left side of the wall (x = 4.5)
        expect(hit.point.x).toBeCloseTo(4.5, 5);
        // Normal should point left
        expect(hit.normal.x).toBeCloseTo(-1, 5);
        expect(hit.normal.y).toBeCloseTo(0, 5);
      }
    });
  });

  describe("raycastAll", () => {
    it("returns empty array when nothing is hit", () => {
      const world = PhysicsWorld.create();
      const hits = world.raycastAll({ x: 0, y: 10 }, { x: 0, y: -1 }, 5);
      expect(hits).toEqual([]);
    });

    it("returns multiple hits sorted by distance", () => {
      // Two platforms at different heights
      const world = createWorldWithColliders([
        { position: vec2(0, 5), halfExtents: vec2(5, 0.5) }, // Top platform
        { position: vec2(0, 0), halfExtents: vec2(5, 0.5) }, // Bottom platform
      ]);
      
      // Cast ray downward from y=10
      const hits = world.raycastAll({ x: 0, y: 10 }, { x: 0, y: -1 }, 20);
      
      expect(hits.length).toBe(2);
      // First hit should be closer (top platform)
      expect(hits[0]?.point.y).toBeCloseTo(5.5, 5);
      // Second hit should be farther (bottom platform)
      expect(hits[1]?.point.y).toBeCloseTo(0.5, 5);
    });
  });

  describe("isOneWay and getTag", () => {
    it("returns false for non-one-way colliders", () => {
      const world = PhysicsWorld.create();
      const handle = world.addStaticCollider({ x: 0, y: 0 }, { x: 5, y: 0.5 });
      expect(world.isOneWay(handle)).toBe(false);
    });

    it("returns undefined for colliders without tags", () => {
      const world = PhysicsWorld.create();
      const handle = world.addStaticCollider({ x: 0, y: 0 }, { x: 5, y: 0.5 });
      expect(world.getTag(handle)).toBeUndefined();
    });
  });
});
