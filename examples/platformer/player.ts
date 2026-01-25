/**
 * Re-export platformer movement system from @game/platformer.
 *
 * This file exists to maintain backwards compatibility with existing imports.
 * The actual implementation lives in packages/platformer/.
 */

export {
  // Types
  type PlayerConfig,
  type DerivedPhysics,
  type PlayerMovementState,
  type PreviousCollisions,
  type PlatformerMovementInput,
  // Functions
  DEFAULT_PLAYER_CONFIG,
  derivePhysics,
  createPlayerMovementState,
  updatePlayerMovement,
  isGrounded,
  isWallSliding,
  getFacingDirection,
} from "@game/platformer";
