/**
 * Stateless raycasting functions for 2D collision detection.
 *
 * All functions are pure - they take colliders as arguments and return results
 * without maintaining any internal state. This design is ideal for netcode
 * where deterministic, stateless simulation is required.
 *
 * Uses the slab method for ray-AABB intersection.
 * Reference: https://tavianator.com/2011/ray_box.html
 */

import type { Vector2, RaycastHit, Collider } from "./types.js";
import { vec2, add, scale } from "./math.js";

// =============================================================================
// Ray-AABB Intersection
// =============================================================================

/**
 * Internal result of ray-AABB intersection calculation.
 */
interface RayAABBResult {
  /** Distance along ray to hit point */
  distance: number;
  /** Surface normal at hit point */
  normal: Vector2;
}

/**
 * Calculate ray-AABB intersection using the slab method.
 *
 * The slab method works by treating the AABB as the intersection of three
 * pairs of parallel planes (slabs). For each axis, we calculate where the
 * ray enters and exits the slab. The ray hits the box if all entry points
 * come before all exit points.
 *
 * @param rayOrigin Starting point of the ray
 * @param rayDirection Direction of the ray (should be normalized)
 * @param boxCenter Center position of the AABB
 * @param boxHalfExtents Half-width and half-height of the AABB
 * @returns Hit info if ray intersects the box, null otherwise
 */
function rayAABBIntersection(
  rayOrigin: Vector2,
  rayDirection: Vector2,
  boxCenter: Vector2,
  boxHalfExtents: Vector2,
): RayAABBResult | null {
  // Calculate box min/max bounds
  const boxMin = {
    x: boxCenter.x - boxHalfExtents.x,
    y: boxCenter.y - boxHalfExtents.y,
  };
  const boxMax = {
    x: boxCenter.x + boxHalfExtents.x,
    y: boxCenter.y + boxHalfExtents.y,
  };

  // Calculate intersection distances for each axis
  // Using the slab method: for each axis, find where ray enters and exits

  let tMin = -Infinity;
  let tMax = Infinity;
  let normalAxis: "x" | "y" = "x";
  let normalSign = 1;

  // X-axis slab
  if (rayDirection.x !== 0) {
    const invDirX = 1 / rayDirection.x;
    let t1 = (boxMin.x - rayOrigin.x) * invDirX;
    let t2 = (boxMax.x - rayOrigin.x) * invDirX;

    // Ensure t1 is the near intersection
    let nearSign = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      nearSign = 1;
    }

    if (t1 > tMin) {
      tMin = t1;
      normalAxis = "x";
      normalSign = nearSign;
    }
    tMax = Math.min(tMax, t2);
  } else {
    // Ray is parallel to X slabs
    if (rayOrigin.x < boxMin.x || rayOrigin.x > boxMax.x) {
      return null;
    }
  }

  // Y-axis slab
  if (rayDirection.y !== 0) {
    const invDirY = 1 / rayDirection.y;
    let t1 = (boxMin.y - rayOrigin.y) * invDirY;
    let t2 = (boxMax.y - rayOrigin.y) * invDirY;

    // Ensure t1 is the near intersection
    let nearSign = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      nearSign = 1;
    }

    if (t1 > tMin) {
      tMin = t1;
      normalAxis = "y";
      normalSign = nearSign;
    }
    tMax = Math.min(tMax, t2);
  } else {
    // Ray is parallel to Y slabs
    if (rayOrigin.y < boxMin.y || rayOrigin.y > boxMax.y) {
      return null;
    }
  }

  // Check if ray misses (entry is after exit) or is behind origin
  if (tMin > tMax || tMax < 0) {
    return null;
  }

  // Use tMin if it's positive (entry point), otherwise tMax (we're inside the box)
  const t = tMin >= 0 ? tMin : tMax;

  // Build normal vector (points away from the surface that was hit)
  const normal: Vector2 =
    normalAxis === "x" ? vec2(normalSign, 0) : vec2(0, normalSign);

  return { distance: t, normal };
}

// =============================================================================
// Public Raycast API
// =============================================================================

/**
 * Cast a ray against a list of colliders and return the first hit.
 *
 * This is a pure function - no state is maintained between calls.
 * Pass the same colliders array each frame to get consistent results.
 *
 * @param origin Starting point of the ray
 * @param direction Direction of the ray (should be normalized)
 * @param maxDistance Maximum distance to check
 * @param colliders Array of colliders to test against
 * @param filterOneWay If true, one-way platforms are ignored when ray points up
 * @returns RaycastHit if something was hit, null otherwise
 *
 * @example
 * ```typescript
 * const colliders = [
 *   { position: { x: 0, y: 0 }, halfExtents: { x: 5, y: 0.5 } },
 *   { position: { x: 0, y: 5 }, halfExtents: { x: 5, y: 0.5 }, oneWay: true },
 * ];
 *
 * // Cast a ray downward to check for ground
 * const hit = raycast(
 *   { x: 0, y: 10 },
 *   { x: 0, y: -1 },
 *   20,
 *   colliders
 * );
 * if (hit) {
 *   console.log(`Ground at distance ${hit.distance}`);
 * }
 * ```
 */
export function raycast(
  origin: Vector2,
  direction: Vector2,
  maxDistance: number,
  colliders: readonly Collider[],
  filterOneWay = false,
): RaycastHit | null {
  let closestHit: RaycastHit | null = null;
  let closestDistance = maxDistance;

  for (let i = 0; i < colliders.length; i++) {
    const collider = colliders[i];
    if (!collider) continue;

    // Filter one-way platforms when ray is going up
    if (filterOneWay && direction.y > 0 && collider.oneWay) {
      continue;
    }

    const result = rayAABBIntersection(
      origin,
      direction,
      collider.position,
      collider.halfExtents,
    );

    if (result && result.distance >= 0 && result.distance < closestDistance) {
      closestDistance = result.distance;

      // Calculate hit point
      const hitPoint = add(origin, scale(direction, result.distance));

      closestHit = {
        point: hitPoint,
        normal: result.normal,
        distance: result.distance,
        colliderIndex: i,
      };
    }
  }

  return closestHit;
}

/**
 * Cast a ray against a list of colliders and return all hits.
 *
 * @param origin Starting point of the ray
 * @param direction Direction of the ray (should be normalized)
 * @param maxDistance Maximum distance to check
 * @param colliders Array of colliders to test against
 * @returns Array of RaycastHit sorted by distance (closest first)
 *
 * @example
 * ```typescript
 * const hits = raycastAll(origin, direction, 100, colliders);
 * for (const hit of hits) {
 *   console.log(`Hit collider ${hit.colliderIndex} at distance ${hit.distance}`);
 * }
 * ```
 */
export function raycastAll(
  origin: Vector2,
  direction: Vector2,
  maxDistance: number,
  colliders: readonly Collider[],
): RaycastHit[] {
  const hits: RaycastHit[] = [];

  for (let i = 0; i < colliders.length; i++) {
    const collider = colliders[i];
    if (!collider) continue;

    const result = rayAABBIntersection(
      origin,
      direction,
      collider.position,
      collider.halfExtents,
    );

    if (result && result.distance >= 0 && result.distance <= maxDistance) {
      const hitPoint = add(origin, scale(direction, result.distance));

      hits.push({
        point: hitPoint,
        normal: result.normal,
        distance: result.distance,
        colliderIndex: i,
      });
    }
  }

  // Sort by distance (closest first)
  hits.sort((a, b) => a.distance - b.distance);

  return hits;
}

/**
 * Check if a collider at the given index is one-way.
 *
 * This is a convenience function that matches the old PhysicsWorld.isOneWay API.
 *
 * @param colliders Array of colliders
 * @param index Index of the collider to check
 * @returns True if the collider is one-way
 */
export function isColliderOneWay(
  colliders: readonly Collider[],
  index: number,
): boolean {
  return colliders[index]?.oneWay ?? false;
}

/**
 * Get the tag of a collider at the given index.
 *
 * @param colliders Array of colliders
 * @param index Index of the collider to check
 * @returns The tag string, or undefined if not set
 */
export function getColliderTag(
  colliders: readonly Collider[],
  index: number,
): string | undefined {
  return colliders[index]?.tag;
}
