/**
 * PhysicsWorld - Wrapper around Rapier physics world.
 *
 * Handles WASM initialization and provides a clean TypeScript API
 * for creating colliders and performing raycasts.
 */

import RAPIER from "@dimforge/rapier2d-compat";
import type { Vector2, RaycastHit, ColliderOptions, ColliderData } from "./types.js";
import { vec2 } from "./math.js";

/** Whether Rapier WASM has been initialized */
let rapierInitialized = false;

/**
 * Initialize Rapier WASM module.
 * Must be called once before creating any PhysicsWorld.
 * Safe to call multiple times.
 */
export async function initPhysics(): Promise<void> {
  if (!rapierInitialized) {
    await RAPIER.init();
    rapierInitialized = true;
  }
}

/**
 * Physics world that wraps Rapier.
 *
 * Must call `initPhysics()` once before creating any PhysicsWorld.
 */
export class PhysicsWorld {
  private world: RAPIER.World;
  private colliderData: Map<number, ColliderData>;

  private constructor(world: RAPIER.World) {
    this.world = world;
    this.colliderData = new Map();
  }

  /**
   * Create a physics world.
   *
   * IMPORTANT: You must call `initPhysics()` once before calling this method.
   *
   * @param gravity Gravity vector (Y-up, so typically { x: 0, y: -20 })
   * @returns The physics world
   * @throws Error if initPhysics() was not called first
   *
   * @example
   * ```typescript
   * await initPhysics(); // Call once at app startup
   * const world = PhysicsWorld.create({ x: 0, y: -20 });
   * ```
   */
  static create(gravity: Vector2 = { x: 0, y: -20 }): PhysicsWorld {
    if (!rapierInitialized) {
      throw new Error("Rapier not initialized. Call initPhysics() first.");
    }
    const world = new RAPIER.World({ x: gravity.x, y: gravity.y });
    return new PhysicsWorld(world);
  }

  /**
   * Add a static (non-moving) collider to the world.
   *
   * Static colliders are used for platforms, walls, and ground.
   * They don't move or respond to physics, but other objects can collide with them.
   *
   * @param position Center position of the collider (Y-up coordinates)
   * @param halfExtents Half-width and half-height of the collider
   * @param options Optional collider settings (oneWay, tag)
   * @returns Handle that can be used to reference this collider
   *
   * @example
   * ```typescript
   * // Add multiple colliders, then update broadphase once
   * for (const platform of level.platforms) {
   *   world.addStaticCollider(platform.position, platform.halfSize);
   * }
   * world.updateBroadphase(); // Call once after adding all colliders
   *
   * // Or add a single collider with immediate broadphase update
   * world.addStaticCollider(position, halfSize);
   * world.updateBroadphase();
   * ```
   */
  addStaticCollider(
    position: Vector2,
    halfExtents: Vector2,
    options: ColliderOptions = {},
  ): number {
    // Create a fixed (static) rigid body
    const rigidBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y);
    const rigidBody = this.world.createRigidBody(rigidBodyDesc);

    // Create a cuboid collider attached to the body
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y);
    const collider = this.world.createCollider(colliderDesc, rigidBody);

    // Store metadata
    const handle = collider.handle;
    this.colliderData.set(handle, {
      oneWay: options.oneWay ?? false,
      tag: options.tag,
    });

    return handle;
  }

  /**
   * Update the broadphase acceleration structure.
   *
   * IMPORTANT: This must be called after adding or removing colliders,
   * otherwise raycasts won't detect them. This is a quirk of Rapier's
   * architecture - the broadphase (BVH) is only updated during step().
   *
   * For character controllers that don't use physics simulation,
   * call this once after setting up all static geometry.
   */
  updateBroadphase(): void {
    // Step with zero gravity doesn't move anything, but updates the broadphase
    this.world.step();
  }

  /**
   * Remove a collider from the world.
   *
   * @param handle The collider handle returned from addStaticCollider
   */
  removeCollider(handle: number): void {
    const collider = this.world.getCollider(handle);
    if (collider) {
      // Remove the parent rigid body (which also removes the collider)
      const rigidBody = collider.parent();
      if (rigidBody) {
        this.world.removeRigidBody(rigidBody);
      }
      this.colliderData.delete(handle);
    }
  }

  /**
   * Cast a ray and return the first hit.
   *
   * @param origin Starting point of the ray
   * @param direction Direction of the ray (should be normalized)
   * @param maxDistance Maximum distance to check
   * @param filterOneWay If true, one-way platforms are ignored when ray points up
   * @returns RaycastHit if something was hit, null otherwise
   *
   * @example
   * ```typescript
   * // Cast a ray downward to check for ground
   * const hit = world.raycast(
   *   { x: playerX, y: playerY },
   *   { x: 0, y: -1 },
   *   2.0
   * );
   * if (hit) {
   *   console.log(`Ground at distance ${hit.distance}`);
   * }
   * ```
   */
  raycast(
    origin: Vector2,
    direction: Vector2,
    maxDistance: number,
    filterOneWay = false,
  ): RaycastHit | null {
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y }, { x: direction.x, y: direction.y });

    // Use castRayAndGetNormal to get the normal vector
    const hit = this.world.castRayAndGetNormal(ray, maxDistance, true);

    if (!hit) {
      return null;
    }

    const collider = hit.collider;
    const handle = collider.handle;

    // Filter one-way platforms if requested (when ray is going up)
    if (filterOneWay && direction.y > 0) {
      const data = this.colliderData.get(handle);
      if (data?.oneWay) {
        return null;
      }
    }

    // Calculate hit point
    const hitPoint = ray.pointAt(hit.timeOfImpact);

    return {
      point: vec2(hitPoint.x, hitPoint.y),
      normal: vec2(hit.normal.x, hit.normal.y),
      distance: hit.timeOfImpact,
      colliderHandle: handle,
    };
  }

  /**
   * Cast a ray and return all hits (not just the first).
   *
   * @param origin Starting point of the ray
   * @param direction Direction of the ray (should be normalized)
   * @param maxDistance Maximum distance to check
   * @returns Array of RaycastHit sorted by distance (closest first)
   */
  raycastAll(origin: Vector2, direction: Vector2, maxDistance: number): RaycastHit[] {
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y }, { x: direction.x, y: direction.y });
    const hits: RaycastHit[] = [];

    this.world.intersectionsWithRay(ray, maxDistance, true, (intersection) => {
      const hitPoint = ray.pointAt(intersection.timeOfImpact);

      hits.push({
        point: vec2(hitPoint.x, hitPoint.y),
        normal: vec2(intersection.normal.x, intersection.normal.y),
        distance: intersection.timeOfImpact,
        colliderHandle: intersection.collider.handle,
      });

      return true; // Continue searching
    });

    // Sort by distance
    hits.sort((a, b) => a.distance - b.distance);

    return hits;
  }

  /**
   * Check if a collider is marked as one-way.
   *
   * @param handle The collider handle
   * @returns True if the collider is one-way
   */
  isOneWay(handle: number): boolean {
    return this.colliderData.get(handle)?.oneWay ?? false;
  }

  /**
   * Get the tag of a collider.
   *
   * @param handle The collider handle
   * @returns The tag string, or undefined if not set
   */
  getTag(handle: number): string | undefined {
    return this.colliderData.get(handle)?.tag;
  }

  /**
   * Step the physics simulation forward.
   *
   * Note: For a character controller, you typically don't need to step
   * the simulation - we use raycasts for collision detection instead.
   * This is provided for future use with dynamic rigid bodies.
   */
  step(): void {
    this.world.step();
  }

  /**
   * Get the underlying Rapier world.
   * Use with caution - prefer the wrapper methods when possible.
   */
  getRapierWorld(): RAPIER.World {
    return this.world;
  }
}
