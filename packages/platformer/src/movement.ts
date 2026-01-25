/**
 * Platformer player movement logic.
 *
 * This module implements platformer movement behavior on top of the
 * @game/physics2d CharacterController:
 * - Variable jump height (tap vs hold)
 * - Wall sliding and wall jumping
 * - Movement smoothing (acceleration/deceleration)
 *
 * The CharacterController handles collision detection and slope handling.
 * This module handles the "game feel" - how inputs translate to movement.
 */

import type { CharacterController, CollisionInfo } from "@game/physics2d";
import { smoothDamp, vec2 } from "@game/physics2d";
import type {
  DerivedPhysics,
  PlatformerMovementInput,
  PlayerConfig,
  PlayerMovementState,
  PreviousCollisions,
} from "./types.js";

/**
 * Default player configuration.
 *
 * These values are tuned for a typical platformer scale (~200 units/sec movement).
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
  wallJumpClimb: { x: 200, y: 320 },
  wallJumpOff: { x: 250, y: 300 },
  wallLeap: { x: 300, y: 300 },

  // Jump forgiveness - makes platforming feel more responsive
  coyoteTime: 0.1, // 100ms grace period after leaving ground
  jumpBufferTime: 0.1, // 100ms buffer window before landing
};

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
    coyoteTimeCounter: 0,
    jumpBufferCounter: 0,
  };
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
  input: PlatformerMovementInput,
  config: PlayerConfig,
  physics: DerivedPhysics,
  deltaTime: number,
  prevCollisions: PreviousCollisions,
): PlayerMovementState {
  // Copy state to modify
  let velocity = { ...state.velocity };
  let velocityXSmoothing = state.velocityXSmoothing;
  let timeToWallUnstick = state.timeToWallUnstick;
  let coyoteTimeCounter = state.coyoteTimeCounter;
  let jumpBufferCounter = state.jumpBufferCounter;

  // Detect jump press edge (simulates Unity's OnJumpInputDown callback)
  const jumpPressed = input.jump && !state.jumpWasPressedLastFrame;
  const jumpReleased = !input.jump && state.jumpWasPressedLastFrame;
  const jumpHeld = input.jump;

  // --- Coyote Time: Track time since grounded ---
  // Reset counter when grounded, count down when airborne
  if (prevCollisions.below) {
    coyoteTimeCounter = config.coyoteTime;
  } else {
    coyoteTimeCounter = Math.max(0, coyoteTimeCounter - deltaTime);
  }

  // --- Jump Buffer: Track time since jump pressed ---
  // Reset counter on jump press, count down otherwise
  if (jumpPressed) {
    jumpBufferCounter = config.jumpBufferTime;
  } else {
    jumpBufferCounter = Math.max(0, jumpBufferCounter - deltaTime);
  }

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

  // Wall sliding requires: touching wall + not grounded + falling
  // Matches: if ((controller.collisions.left || controller.collisions.right) && !controller.collisions.below && velocity.y < 0)
  if ((prevCollisions.left || prevCollisions.right) && !prevCollisions.below && velocity.y < 0) {

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
  // Extended with coyote time and jump buffering for better game feel

  // Wall jump check (highest priority - walls don't use coyote time)
  const touchingWall = prevCollisions.left || prevCollisions.right;

  // Determine if we should attempt a jump this frame:
  // - Jump was just pressed, OR
  // - Jump buffer is active AND we just landed (buffer executes on landing)
  const shouldAttemptJump = jumpPressed || (jumpBufferCounter > 0 && prevCollisions.below);

  // Can we do a ground/coyote jump?
  // - Must be grounded OR within coyote time
  // - Must NOT be touching a wall (wall jump takes priority)
  const canGroundJump = (prevCollisions.below || coyoteTimeCounter > 0) && !touchingWall;

  if (shouldAttemptJump) {
    if (touchingWall && wallDirX !== 0) {
      // Wall jump - MODIFIED from Sebastian's original to allow wall jump when touching wall
      // Sebastian required wallSliding (airborne + falling + touching wall)
      // We now allow wall jump anytime touching wall, which feels more responsive
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
      // Consume buffers on successful wall jump
      jumpBufferCounter = 0;
      coyoteTimeCounter = 0;
    } else if (canGroundJump) {
      // Ground jump (includes coyote time)
      // Note: We can't check slidingDownMaxSlope here since that's only known after move()
      // For now, just do a normal jump. Slope jumping could be added as a future enhancement.
      velocity.y = physics.maxJumpVelocity;
      // Consume buffers on successful ground jump
      jumpBufferCounter = 0;
      coyoteTimeCounter = 0; // Prevent double-jump via coyote time
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

  // Update wallDirX from NEW collision results
  // This represents ACTUAL current wall contact AFTER the move
  const newWallDirX: -1 | 0 | 1 = newCollisions.left ? -1 : newCollisions.right ? 1 : 0;
  
  // Compute NEW wall sliding state based on CURRENT collisions (after move)
  // This matches Sebastian's logic: wall sliding when touching wall, not grounded, and falling
  const newWallSliding = (newCollisions.left || newCollisions.right) && 
                         !newCollisions.below && 
                         velocity.y < 0;

  return {
    velocity,
    velocityXSmoothing,
    wallSliding: newWallSliding,
    wallDirX: newWallDirX,
    timeToWallUnstick,
    jumpWasPressedLastFrame: input.jump,
    jumpHeld,
    coyoteTimeCounter,
    jumpBufferCounter,
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
