/**
 * Platformer game type definitions
 */

/**
 * 2D vector representing position or velocity
 */
export interface Vector2 {
  x: number;
  y: number;
}

/**
 * Player input for platformer game
 */
export interface PlatformerInput {
  /** Horizontal movement (-1 to 1) */
  moveX: number;
  /**
   * Vertical movement (-1 to 1)
   * Currently unused in platformer game logic (jump is handled separately),
   * but kept for API compatibility and potential future use (e.g., vertical movement in 3D platformers)
   */
  moveY: number;
  /** Whether jump was pressed */
  jump: boolean;
  /** Timestamp when input was captured */
  timestamp: number;
}

/**
 * Player state in the platformer world
 */
export interface PlatformerPlayer {
  /** Unique player identifier */
  id: string;
  /** Current position */
  position: Vector2;
  /** Current velocity */
  velocity: Vector2;
  /** Whether player is on the ground */
  isGrounded: boolean;
}

/**
 * Complete platformer world state
 */
export interface PlatformerWorld {
  /** All players in the world */
  players: Map<string, PlatformerPlayer>;
  /** Current tick number */
  tick: number;
}

/**
 * Create an empty platformer world
 */
export function createPlatformerWorld(): PlatformerWorld {
  return {
    players: new Map(),
    tick: 0,
  };
}

/**
 * Create a new player at a given position
 */
export function createPlatformerPlayer(
  id: string,
  position: Vector2 = { x: 0, y: 0 },
): PlatformerPlayer {
  return {
    id,
    position,
    velocity: { x: 0, y: 0 },
    isGrounded: false,
  };
}

/**
 * Create an idle input (no movement, no jump)
 * @param timestamp - Optional timestamp (defaults to current time)
 */
export function createIdleInput(timestamp?: number): PlatformerInput {
  return {
    moveX: 0,
    moveY: 0,
    jump: false,
    timestamp: timestamp ?? Date.now(),
  };
}

// =============================================================================
// Action Types (for Lag Compensation)
// =============================================================================

/**
 * Attack action in the platformer game.
 * Represents a melee attack at a target position.
 */
export interface PlatformerAttackAction {
  /** Type discriminator for action handling */
  type: "attack";
  /** Target X position of the attack */
  targetX: number;
  /** Target Y position of the attack */
  targetY: number;
}

/**
 * Union type for all platformer actions
 */
export type PlatformerAction = PlatformerAttackAction;

/**
 * Result of a successful attack action
 */
export interface PlatformerAttackResult {
  /** ID of the player that was hit */
  targetId: string;
  /** Damage dealt */
  damage: number;
}

/**
 * Union type for all platformer action results
 */
export type PlatformerActionResult = PlatformerAttackResult;

/**
 * Attack configuration constants
 */
export const ATTACK_RADIUS = 50; // pixels
export const ATTACK_DAMAGE = 10;
