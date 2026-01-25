/**
 * Physics Bridge - Connects platformer simulation to @game/physics2d
 *
 * This module provides a bridge between the stateless simulation pattern
 * required by netcode and the stateful physics2d package.
 *
 * Architecture:
 * - PhysicsWorld is created once per level (static geometry)
 * - CharacterControllers are created on-demand each frame (stateless simulation)
 * - No physics state is stored in PlatformerWorld
 * - Player-player collision is handled separately (AABB in simulation.ts)
 *
 * IMPORTANT: Call initPlatformerPhysics() once at app startup before
 * any simulation runs. This initializes the Rapier WASM module.
 *
 * Benefits over pure AABB:
 * - Raycast-based collision prevents tunneling at high speeds
 * - Slope handling (climbing, descending)
 * - One-way platform support
 * - More accurate collision normals
 */

import {
  PhysicsWorld,
  initPhysics,
  CharacterController,
  vec2,
} from "@game/physics2d";
import type { Platform, LevelConfig, PlatformerPlayer, Vector2 } from "./types.js";
import { PLAYER_WIDTH, PLAYER_HEIGHT } from "./types.js";
import { DEFAULT_FLOOR_Y } from "@game/netcode";

// =============================================================================
// Module State
// =============================================================================

/** Cached PhysicsWorld instances by level ID */
const worldCache = new Map<string, PhysicsWorld>();

/** Whether Rapier WASM has been initialized */
let physicsInitialized = false;

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize the physics engine.
 *
 * MUST be called once at app startup before any simulation runs.
 * Safe to call multiple times (subsequent calls are no-ops).
 *
 * @example
 * ```typescript
 * // In your app's main entry point:
 * async function main() {
 *   await initPlatformerPhysics();
 *   // Now start your game/server
 * }
 * ```
 */
export async function initPlatformerPhysics(): Promise<void> {
  if (!physicsInitialized) {
    await initPhysics();
    physicsInitialized = true;
  }
}

/**
 * Check if physics has been initialized.
 * Useful for debugging - simulation will throw if this returns false.
 */
export function isPhysicsInitialized(): boolean {
  return physicsInitialized;
}

/**
 * Assert that physics is initialized, throwing a clear error if not.
 */
function assertPhysicsInitialized(): void {
  if (!physicsInitialized) {
    throw new Error(
      "Physics not initialized. Call initPlatformerPhysics() at app startup before any simulation.",
    );
  }
}

// =============================================================================
// World Management
// =============================================================================

/**
 * Get or create a PhysicsWorld for a level.
 *
 * The world is cached by level ID for efficiency. Static geometry
 * (platforms, floor) is added as colliders.
 *
 * @param level The level configuration
 * @returns The PhysicsWorld for this level
 * @throws Error if physics not initialized
 */
export function getPhysicsWorldForLevel(level: LevelConfig): PhysicsWorld {
  assertPhysicsInitialized();

  // Check cache
  const cached = worldCache.get(level.id);
  if (cached) {
    return cached;
  }

  // Create new world (no gravity - we handle gravity in game logic for determinism)
  const world = PhysicsWorld.create(vec2(0, 0));

  // Add platforms as static colliders
  for (const platform of level.platforms) {
    // Platform position is bottom-left corner, Rapier wants center
    const centerX = platform.position.x + platform.width / 2;
    const centerY = platform.position.y + platform.height / 2;
    const halfWidth = platform.width / 2;
    const halfHeight = platform.height / 2;

    world.addStaticCollider(
      vec2(centerX, centerY),
      vec2(halfWidth, halfHeight),
      { tag: platform.id },
    );
  }

  // Add floor as a large static collider at y=DEFAULT_FLOOR_Y
  // Floor spans a large width and extends below the floor level
  const floorThickness = 100;
  world.addStaticCollider(
    vec2(0, DEFAULT_FLOOR_Y - floorThickness / 2), // Center below floor surface
    vec2(10000, floorThickness / 2), // Very wide, half-thickness
    { tag: "floor" },
  );

  // Update broadphase so raycasts work
  world.updateBroadphase();

  // Cache the world
  worldCache.set(level.id, world);

  return world;
}

/**
 * Clear the physics world cache.
 *
 * Call when levels are unloaded or for testing.
 */
export function clearPhysicsWorldCache(): void {
  worldCache.clear();
}

// =============================================================================
// Movement with Physics
// =============================================================================

/**
 * Result of physics-based movement.
 */
export interface PhysicsMoveResult {
  /** New position after movement */
  position: Vector2;
  /** Adjusted velocity (zeroed on collision) */
  velocity: Vector2;
  /** Whether the player is on the ground */
  isGrounded: boolean;
  /** Whether the player hit a ceiling */
  hitCeiling: boolean;
  /** Whether the player hit a wall on the left */
  hitLeft: boolean;
  /** Whether the player hit a wall on the right */
  hitRight: boolean;
}

/**
 * Move a player using the physics engine for collision detection.
 *
 * This performs raycast-based collision detection against static geometry
 * (platforms, floor). It does NOT handle player-player collision - that
 * should be handled separately in the simulation.
 *
 * The CharacterController is created on-demand and discarded after use,
 * keeping the simulation stateless for netcode compatibility.
 *
 * @param world The physics world
 * @param player The current player state
 * @param velocity The desired velocity (units/second)
 * @param deltaTime Time step in seconds
 * @returns Movement result with new position and collision info
 */
export function movePlayerWithPhysics(
  world: PhysicsWorld,
  player: PlatformerPlayer,
  velocity: Vector2,
  deltaTime: number,
): PhysicsMoveResult {
  // Create a temporary controller for this movement
  const controller = new CharacterController(world, {
    position: vec2(player.position.x, player.position.y),
    halfSize: vec2(PLAYER_WIDTH / 2, PLAYER_HEIGHT / 2),
  });

  // Move using the character controller (handles raycasting internally)
  const inputVec = vec2(0, 0); // No drop-through input for now
  controller.move(vec2(velocity.x, velocity.y), deltaTime, inputVec);

  // Extract collision info
  const collisions = controller.collisions;

  // Adjust velocity based on collisions
  let newVelocityX = velocity.x;
  let newVelocityY = velocity.y;

  if (collisions.below || collisions.above) {
    newVelocityY = 0;
  }
  if (collisions.left || collisions.right) {
    newVelocityX = 0;
  }

  return {
    position: { x: controller.position.x, y: controller.position.y },
    velocity: { x: newVelocityX, y: newVelocityY },
    isGrounded: collisions.below,
    hitCeiling: collisions.above,
    hitLeft: collisions.left,
    hitRight: collisions.right,
  };
}
