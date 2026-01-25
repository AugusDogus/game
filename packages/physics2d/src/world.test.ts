import { describe, expect, it } from "bun:test";
import { raycast, raycastAll, isColliderOneWay, getColliderTag } from "./world.js";
import { vec2 } from "./math.js";
import type { Collider } from "./types.js";

describe("raycast", () => {
  it("returns null when no colliders", () => {
    const hit = raycast({ x: 0, y: 10 }, { x: 0, y: -1 }, 5, []);
    expect(hit).toBeNull();
  });

  it("returns null when nothing is hit", () => {
    const colliders: Collider[] = [
      { position: vec2(100, 100), halfExtents: vec2(5, 0.5) },
    ];
    const hit = raycast({ x: 0, y: 10 }, { x: 0, y: -1 }, 5, colliders);
    expect(hit).toBeNull();
  });

  it("hits a collider and returns hit info", () => {
    // Platform at y=0, 10 units wide, 1 unit tall
    const colliders: Collider[] = [
      { position: vec2(0, 0), halfExtents: vec2(5, 0.5) },
    ];

    // Cast ray downward from y=10
    const hit = raycast({ x: 0, y: 10 }, { x: 0, y: -1 }, 20, colliders);

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
      // Collider index
      expect(hit.colliderIndex).toBe(0);
    }
  });

  it("respects max distance", () => {
    const colliders: Collider[] = [
      { position: vec2(0, 0), halfExtents: vec2(5, 0.5) },
    ];

    // Cast ray with max distance less than distance to platform
    const hit = raycast({ x: 0, y: 10 }, { x: 0, y: -1 }, 5, colliders);
    expect(hit).toBeNull();
  });

  it("hits horizontal walls correctly", () => {
    // Wall at x=5
    const colliders: Collider[] = [
      { position: vec2(5, 0), halfExtents: vec2(0.5, 5) },
    ];

    // Cast ray rightward
    const hit = raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 10, colliders);

    expect(hit).not.toBeNull();
    if (hit) {
      // Should hit the left side of the wall (x = 4.5)
      expect(hit.point.x).toBeCloseTo(4.5, 5);
      // Normal should point left
      expect(hit.normal.x).toBeCloseTo(-1, 5);
      expect(hit.normal.y).toBeCloseTo(0, 5);
    }
  });

  it("returns the closest hit when multiple colliders", () => {
    const colliders: Collider[] = [
      { position: vec2(0, 0), halfExtents: vec2(5, 0.5) }, // Bottom platform
      { position: vec2(0, 5), halfExtents: vec2(5, 0.5) }, // Top platform
    ];

    // Cast ray downward from y=10
    const hit = raycast({ x: 0, y: 10 }, { x: 0, y: -1 }, 20, colliders);

    expect(hit).not.toBeNull();
    if (hit) {
      // Should hit the top platform first (y = 5.5)
      expect(hit.point.y).toBeCloseTo(5.5, 5);
      expect(hit.colliderIndex).toBe(1); // Second collider (index 1)
    }
  });

  it("filters one-way platforms when ray points up", () => {
    const colliders: Collider[] = [
      { position: vec2(0, 5), halfExtents: vec2(5, 0.5), oneWay: true },
    ];

    // Cast ray upward - should pass through one-way platform
    const hit = raycast({ x: 0, y: 0 }, { x: 0, y: 1 }, 10, colliders, true);
    expect(hit).toBeNull();

    // Cast ray downward - should hit one-way platform
    const hitDown = raycast({ x: 0, y: 10 }, { x: 0, y: -1 }, 10, colliders, false);
    expect(hitDown).not.toBeNull();
  });
});

describe("raycastAll", () => {
  it("returns empty array when no colliders", () => {
    const hits = raycastAll({ x: 0, y: 10 }, { x: 0, y: -1 }, 5, []);
    expect(hits).toEqual([]);
  });

  it("returns empty array when nothing is hit", () => {
    const colliders: Collider[] = [
      { position: vec2(100, 100), halfExtents: vec2(5, 0.5) },
    ];
    const hits = raycastAll({ x: 0, y: 10 }, { x: 0, y: -1 }, 5, colliders);
    expect(hits).toEqual([]);
  });

  it("returns multiple hits sorted by distance", () => {
    // Two platforms at different heights
    const colliders: Collider[] = [
      { position: vec2(0, 5), halfExtents: vec2(5, 0.5) }, // Top platform
      { position: vec2(0, 0), halfExtents: vec2(5, 0.5) }, // Bottom platform
    ];

    // Cast ray downward from y=10
    const hits = raycastAll({ x: 0, y: 10 }, { x: 0, y: -1 }, 20, colliders);

    expect(hits.length).toBe(2);
    // First hit should be closer (top platform)
    expect(hits[0]?.point.y).toBeCloseTo(5.5, 5);
    expect(hits[0]?.colliderIndex).toBe(0);
    // Second hit should be farther (bottom platform)
    expect(hits[1]?.point.y).toBeCloseTo(0.5, 5);
    expect(hits[1]?.colliderIndex).toBe(1);
  });
});

describe("isColliderOneWay", () => {
  it("returns false for non-one-way colliders", () => {
    const colliders: Collider[] = [
      { position: vec2(0, 0), halfExtents: vec2(5, 0.5) },
    ];
    expect(isColliderOneWay(colliders, 0)).toBe(false);
  });

  it("returns true for one-way colliders", () => {
    const colliders: Collider[] = [
      { position: vec2(0, 0), halfExtents: vec2(5, 0.5), oneWay: true },
    ];
    expect(isColliderOneWay(colliders, 0)).toBe(true);
  });

  it("returns false for out-of-bounds index", () => {
    const colliders: Collider[] = [];
    expect(isColliderOneWay(colliders, 0)).toBe(false);
  });
});

describe("getColliderTag", () => {
  it("returns undefined for colliders without tags", () => {
    const colliders: Collider[] = [
      { position: vec2(0, 0), halfExtents: vec2(5, 0.5) },
    ];
    expect(getColliderTag(colliders, 0)).toBeUndefined();
  });

  it("returns the tag for colliders with tags", () => {
    const colliders: Collider[] = [
      { position: vec2(0, 0), halfExtents: vec2(5, 0.5), tag: "ground" },
    ];
    expect(getColliderTag(colliders, 0)).toBe("ground");
  });

  it("returns undefined for out-of-bounds index", () => {
    const colliders: Collider[] = [];
    expect(getColliderTag(colliders, 0)).toBeUndefined();
  });
});
