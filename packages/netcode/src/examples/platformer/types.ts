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
