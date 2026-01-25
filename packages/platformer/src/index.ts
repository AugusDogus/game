// Types
export type {
  PlayerConfig,
  DerivedPhysics,
  PlayerMovementState,
  PreviousCollisions,
  PlatformerMovementInput,
} from "./types.js";

// Movement system
export {
  DEFAULT_PLAYER_CONFIG,
  derivePhysics,
  createPlayerMovementState,
  updatePlayerMovement,
  isGrounded,
  isWallSliding,
  getFacingDirection,
} from "./movement.js";
