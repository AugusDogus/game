import type { Vector2 } from "@game/physics2d";

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
 * Previous frame's collision state.
 *
 * Since we create a new CharacterController each frame (for stateless netcode),
 * we need to pass the collision state from the previous frame explicitly.
 */
export interface PreviousCollisions {
  below: boolean;
  left: boolean;
  right: boolean;
}

/**
 * Input for platformer movement.
 * 
 * This is a minimal interface - games should extend this with their own
 * input types (shooting, abilities, etc.)
 */
export interface PlatformerMovementInput {
  /** Horizontal movement direction (-1 to 1) */
  moveX: number;
  /** Vertical movement direction (-1 to 1), used for dropping through platforms */
  moveY: number;
  /** Whether jump is pressed */
  jump: boolean;
}
