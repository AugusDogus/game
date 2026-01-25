/**
 * Platformer player movement logic.
 *
 * This module implements game-specific player behavior on top of the
 * @game/physics2d CharacterController:
 * - Variable jump height (tap vs hold)
 * - Wall sliding and wall jumping
 * - Movement smoothing (acceleration/deceleration)
 *
 * The CharacterController handles collision detection and slope handling.
 * This module handles the "game feel" - how inputs translate to movement.
 */

import type { CharacterController, CollisionInfo, Vector2 } from "@game/physics2d";
import { smoothDamp, vec2 } from "@game/physics2d";
import type { PlatformerInput } from "./types.js";

// =============================================================================
// Player Configuration
// =============================================================================

/**
 * Player physics configuration.
 *
 * These values define the "game feel" - how the character moves and responds.
 * They are derived from desired behavior, not arbitrary constants.
 */
export interface PlayerConfig {
  // --- Jump ---
  /** Maximum jump height when holding jump (units) */
  maxJumpHeight: number;
  /** Minimum jump height when tapping jump (units) */
  minJumpHeight: number;
  /** Time to reach jump apex (seconds) */
  timeToJumpApex: number;

  // --- Movement ---
  /** Horizontal movement speed (units/second) */
  moveSpeed: number;
  /** Time to reach full speed on ground (seconds) */
  accelerationTimeGrounded: number;
  /** Time to reach full speed in air (seconds) */
  accelerationTimeAirborne: number;

  // --- Wall Mechanics ---
  /** Maximum fall speed when sliding on wall (units/second) */
  wallSlideSpeedMax: number;
  /** Time before player can leave wall after touching it (seconds) */
  wallStickTime: number;
  /** Velocity when wall jumping toward the wall */
  wallJumpClimb: Vector2;
  /** Velocity when wall jumping with neutral input */
  wallJumpOff: Vector2;
  /** Velocity when wall jumping away from wall */
  wallLeap: Vector2;
}

/**
 * Default player configuration.
 *
 * These values are tuned to match the current game scale (~200 units/sec movement).
 * Physics (gravity, jump velocity) are derived from maxJumpHeight and timeToJumpApex
 * using derivePhysics() - this ensures the jump arc is physically correct.
 *
 * With maxJumpHeight=64 and timeToJumpApex=0.4:
 *   gravity = -(2 * 64) / (0.4)^2 = -800 units/sec^2
 *   maxJumpVelocity = 800 * 0.4 = 320 units/sec
 */
export const DEFAULT_PLAYER_CONFIG: PlayerConfig = {
  // Jump - 64 units height, 0.4s to apex (derives gravity=-800, jumpVel=320)
  maxJumpHeight: 64,
  minJumpHeight: 16,
  timeToJumpApex: 0.4,

  // Movement - 200 units/sec, smooth acceleration
  moveSpeed: 200,
  accelerationTimeGrounded: 0.1,
  accelerationTimeAirborne: 0.2,

  // Wall mechanics (scaled to current game)
  // Wall jump velocities should be >= moveSpeed to overcome smoothDamp pull
  wallSlideSpeedMax: 100,
  wallStickTime: 0.25,
  wallJumpClimb: { x: 200, y: 320 },  // Was 100,300 - increased to match moveSpeed
  wallJumpOff: { x: 250, y: 300 },     // Was 150,280 - increased for better push
  wallLeap: { x: 300, y: 300 },        // Was 200,280 - increased for strong leap
};

// =============================================================================
// Derived Physics Values
// =============================================================================

/**
 * Physics values derived from player config.
 *
 * These are calculated once from the config using physics formulas.
 * This ensures the jump arc is physically correct - the player will
 * reach exactly maxJumpHeight in exactly timeToJumpApex seconds.
 */
export interface DerivedPhysics {
  /** Gravity acceleration (negative in Y-up) */
  gravity: number;
  /** Initial velocity for max height jump */
  maxJumpVelocity: number;
  /** Initial velocity for min height jump (tap) */
  minJumpVelocity: number;
}

/**
 * Calculate gravity and jump velocities from player config.
 *
 * The math:
 *   From kinematic equations for projectile motion:
 *   - v = v0 + a*t  (velocity at time t)
 *   - d = v0*t + 0.5*a*t²  (distance at time t)
 *
 *   At the apex, v = 0, so:
 *   - 0 = v0 + gravity * timeToJumpApex
 *   - v0 = -gravity * timeToJumpApex
 *
 *   And the height at apex is maxJumpHeight:
 *   - maxJumpHeight = v0 * timeToJumpApex + 0.5 * gravity * timeToJumpApex²
 *   - maxJumpHeight = (-gravity * timeToJumpApex) * timeToJumpApex + 0.5 * gravity * timeToJumpApex²
 *   - maxJumpHeight = -gravity * timeToJumpApex² + 0.5 * gravity * timeToJumpApex²
 *   - maxJumpHeight = -0.5 * gravity * timeToJumpApex²
 *   - gravity = -2 * maxJumpHeight / timeToJumpApex²
 */
export function derivePhysics(config: PlayerConfig): DerivedPhysics {
  // gravity = -(2 * maxJumpHeight) / (timeToJumpApex²)
  const gravity = -(2 * config.maxJumpHeight) / (config.timeToJumpApex ** 2);

  // maxJumpVelocity = |gravity| * timeToJumpApex
  const maxJumpVelocity = Math.abs(gravity) * config.timeToJumpApex;

  // For variable jump height:
  // minJumpVelocity = sqrt(2 * |gravity| * minJumpHeight)
  // This is derived from: v² = v0² + 2*a*d (when v=0 at apex)
  const minJumpVelocity = Math.sqrt(2 * Math.abs(gravity) * config.minJumpHeight);

  return { gravity, maxJumpVelocity, minJumpVelocity };
}

// =============================================================================
// Player State
// =============================================================================

/**
 * Player movement state.
 *
 * This state is separate from the CharacterController's collision state.
 * It tracks movement-specific values that persist across frames.
 */
export interface PlayerMovementState {
  /** Current velocity */
  velocity: Vector2;
  /** Smoothing value for horizontal velocity (for SmoothDamp) */
  velocityXSmoothing: number;
  /** Whether currently wall sliding */
  wallSliding: boolean;
  /** Which side the wall is on (-1 = left, 1 = right, 0 = none) */
  wallDirX: -1 | 0 | 1;
  /** Time remaining before player can leave wall */
  timeToWallUnstick: number;
  /** Whether jump was pressed last frame (for detecting press edge) */
  jumpWasPressedLastFrame: boolean;
  /** Whether jump is currently being held */
  jumpHeld: boolean;
}

/**
 * Create initial player movement state.
 */
export function createPlayerMovementState(): PlayerMovementState {
  return {
    velocity: vec2(0, 0),
    velocityXSmoothing: 0,
    wallSliding: false,
    wallDirX: 0,
    timeToWallUnstick: 0,
    jumpWasPressedLastFrame: false,
    jumpHeld: false,
  };
}

// =============================================================================
// Player Update
// =============================================================================

/**
 * Previous frame's collision state.
 *
 * Since we create a new CharacterController each frame (for stateless netcode),
 * we need to pass the collision state from the previous frame explicitly.
 * In Sebastian's code, the controller persists and collisions carry over.
 */
export interface PreviousCollisions {
  below: boolean;
  left: boolean;
  right: boolean;
}

/**
 * Update player movement for one frame.
 *
 * This follows Sebastian Lague's Player.cs structure:
 * 1. CalculateVelocity - gravity + smoothDamp horizontal
 * 2. HandleWallSliding - uses collisions from PREVIOUS frame
 * 3. Move the controller
 * 4. Zero velocity on collision (unconditionally, like Sebastian's code)
 *
 * Jump is handled separately via jumpPressed edge detection, which simulates
 * Sebastian's OnJumpInputDown() callback from Unity's input system.
 *
 * @param controller The CharacterController to move
 * @param state Current player movement state
 * @param input Current frame's input
 * @param config Player configuration
 * @param physics Derived physics values
 * @param deltaTime Time since last frame (seconds)
 * @param prevCollisions Collision state from previous frame
 * @returns Updated player movement state
 */
export function updatePlayerMovement(
  controller: CharacterController,
  state: PlayerMovementState,
  input: PlatformerInput,
  config: PlayerConfig,
  physics: DerivedPhysics,
  deltaTime: number,
  prevCollisions: PreviousCollisions,
): PlayerMovementState {
  // Copy state to modify
  let velocity = { ...state.velocity };
  let velocityXSmoothing = state.velocityXSmoothing;
  let timeToWallUnstick = state.timeToWallUnstick;

  // Detect jump press edge (simulates Unity's OnJumpInputDown callback)
  const jumpPressed = input.jump && !state.jumpWasPressedLastFrame;
  const jumpReleased = !input.jump && state.jumpWasPressedLastFrame;
  const jumpHeld = input.jump;

  // --- CalculateVelocity (matches Sebastian's CalculateVelocity method) ---

  // Horizontal: smooth toward target
  const targetVelocityX = input.moveX * config.moveSpeed;
  // Use previous frame's grounded state for acceleration time
  const smoothTime = prevCollisions.below
    ? config.accelerationTimeGrounded
    : config.accelerationTimeAirborne;
  const [newVelocityX, newSmoothing] = smoothDamp(
    velocity.x,
    targetVelocityX,
    velocityXSmoothing,
    smoothTime,
    deltaTime,
  );
  velocity.x = newVelocityX;
  velocityXSmoothing = newSmoothing;

  // Vertical: apply gravity
  velocity.y += physics.gravity * deltaTime;

  // --- HandleWallSliding (matches Sebastian's HandleWallSliding method) ---

  // wallDirX from previous frame's collisions
  // This matches Sebastian's: wallDirX = (controller.collisions.left) ? -1 : 1;
  const wallDirX: -1 | 0 | 1 = prevCollisions.left ? -1 : prevCollisions.right ? 1 : 0;
  let wallSliding = false;

  // Wall sliding requires: touching wall + not grounded + falling
  // Matches: if ((controller.collisions.left || controller.collisions.right) && !controller.collisions.below && velocity.y < 0)
  if ((prevCollisions.left || prevCollisions.right) && !prevCollisions.below && velocity.y < 0) {
    wallSliding = true;

    // Cap fall speed while wall sliding
    if (velocity.y < -config.wallSlideSpeedMax) {
      velocity.y = -config.wallSlideSpeedMax;
    }

    // Wall stick logic - delay before player can leave wall
    if (timeToWallUnstick > 0) {
      velocityXSmoothing = 0;
      velocity.x = 0;

      // Countdown if trying to move away from wall
      if (input.moveX !== wallDirX && input.moveX !== 0) {
        timeToWallUnstick -= deltaTime;
      } else {
        timeToWallUnstick = config.wallStickTime;
      }
    } else {
      timeToWallUnstick = config.wallStickTime;
    }
  }

  // --- OnJumpInputDown (matches Sebastian's OnJumpInputDown method) ---

  if (jumpPressed) {
    // Wall jump - MODIFIED from Sebastian's original to allow wall jump when touching wall
    // Sebastian required wallSliding (airborne + falling + touching wall)
    // We now allow wall jump anytime touching wall, which feels more responsive
    const touchingWall = prevCollisions.left || prevCollisions.right;
    
    if (touchingWall && wallDirX !== 0) {
      if (wallDirX === input.moveX) {
        // Climbing: jumping toward the wall
        velocity.x = -wallDirX * config.wallJumpClimb.x;
        velocity.y = config.wallJumpClimb.y;
      } else if (input.moveX === 0) {
        // Hopping off: neutral input
        velocity.x = -wallDirX * config.wallJumpOff.x;
        velocity.y = config.wallJumpOff.y;
      } else {
        // Leaping: jumping away from wall
        velocity.x = -wallDirX * config.wallLeap.x;
        velocity.y = config.wallLeap.y;
      }
    } else if (prevCollisions.below) {
      // Ground jump (only if NOT touching a wall - wall jump takes priority)
      // Note: We can't check slidingDownMaxSlope here since that's only known after move()
      // For now, just do a normal jump. Slope jumping could be added as a future enhancement.
      velocity.y = physics.maxJumpVelocity;
    }
  }

  // --- OnJumpInputUp (variable jump - matches Sebastian's OnJumpInputUp) ---

  if (jumpReleased && velocity.y > physics.minJumpVelocity) {
    velocity.y = physics.minJumpVelocity;
  }

  // --- Move the controller ---
  const inputVec = vec2(input.moveX, input.moveY);
  controller.move(velocity, deltaTime, inputVec);

  // --- Post-move: Zero velocity on collision (matches Sebastian's Update lines 48-54) ---
  // IMPORTANT: Use controller.collisions which is NOW updated by the move() call above
  // Sebastian's code: if (controller.collisions.above || controller.collisions.below)
  // He zeros velocity unconditionally on collision.
  const newCollisions = controller.collisions;

  if (newCollisions.above || newCollisions.below) {
    if (newCollisions.slidingDownMaxSlope) {
      // Special case: add slope normal force when sliding
      velocity.y += newCollisions.slopeNormal.y * -physics.gravity * deltaTime;
    } else {
      velocity.y = 0;
    }
  }

  // Update wallDirX from NEW collision results (for next frame's wall sliding check)
  // IMPORTANT: Use newCollisions for the RETURNED wallDirX so next frame knows which wall we're touching
  const newWallDirX: -1 | 0 | 1 = newCollisions.left ? -1 : newCollisions.right ? 1 : 0;
  
  // However, if we're wall sliding this frame (based on prevCollisions), we need to preserve
  // the wall direction so the next frame can correctly handle wall jumps.
  // This fixes a bug where wallDirX becomes 0 during wall slide even though wallSliding is true.
  const returnedWallDirX: -1 | 0 | 1 = wallSliding ? wallDirX : newWallDirX;

  return {
    velocity,
    velocityXSmoothing,
    wallSliding,
    wallDirX: returnedWallDirX,
    timeToWallUnstick,
    jumpWasPressedLastFrame: input.jump,
    jumpHeld,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if the player is grounded.
 */
export function isGrounded(collisions: CollisionInfo): boolean {
  return collisions.below;
}

/**
 * Check if the player is wall sliding.
 */
export function isWallSliding(state: PlayerMovementState): boolean {
  return state.wallSliding;
}

/**
 * Get the direction the player is facing based on collision info.
 */
export function getFacingDirection(collisions: CollisionInfo): 1 | -1 {
  return collisions.faceDir;
}
