/**
 * Platformer game type definitions
 */

import type { Vector2 } from "@game/physics2d";

// Re-export Vector2 from physics2d to avoid duplication
export type { Vector2 };

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
  /** Whether shoot was pressed this frame */
  shoot: boolean;
  /** Target X position for shooting (in world coordinates) */
  shootTargetX: number;
  /** Target Y position for shooting (in world coordinates) */
  shootTargetY: number;
  /** Timestamp when input was captured */
  timestamp: number;
}

// =============================================================================
// Combat & Health Constants
// =============================================================================

/** Default maximum health for players */
export const DEFAULT_MAX_HEALTH = 100;

/** Duration of respawn invulnerability in ticks */
export const RESPAWN_TIMER_TICKS = 60; // 3 seconds at 20Hz

/** Knockback force applied when hit */
export const KNOCKBACK_FORCE = 300;

/** Player hitbox dimensions for collision detection */
export const PLAYER_WIDTH = 20;
export const PLAYER_HEIGHT = 20;

// =============================================================================
// Platform Types
// =============================================================================

/**
 * A platform in the game world
 *
 * Y-up coordinate system:
 * - position is the bottom-left corner
 * - The platform spans from position.y to position.y + height
 */
export interface Platform {
  /** Unique identifier for the platform */
  id: string;
  /** Position of the platform's bottom-left corner (Y-up coords) */
  position: Vector2;
  /** Width of the platform */
  width: number;
  /** Height of the platform */
  height: number;
}

/**
 * A spawn point in the level
 */
export interface SpawnPoint {
  /** Position of the spawn point */
  position: Vector2;
}

/**
 * A hazard in the level (e.g., spikes, pits)
 *
 * Y-up coordinate system:
 * - position is the bottom-left corner
 * - The hazard spans from position.y to position.y + height
 */
export interface Hazard {
  /** Unique identifier for the hazard */
  id: string;
  /** Position of the hazard's bottom-left corner (Y-up coords) */
  position: Vector2;
  /** Width of the hazard */
  width: number;
  /** Height of the hazard */
  height: number;
  /** Damage dealt per tick while in contact */
  damage: number;
}

/**
 * Level configuration loaded from JSON
 */
export interface LevelConfig {
  /** Unique identifier for the level */
  id: string;
  /** Display name for the level */
  name: string;
  /** Optional description */
  description?: string;
  /** Level bounds (for camera/rendering) */
  bounds?: {
    width: number;
    height: number;
  };
  /** Platforms in the level */
  platforms: Platform[];
  /** Spawn points for players */
  spawnPoints: SpawnPoint[];
  /** Hazards in the level */
  hazards: Hazard[];
}

// =============================================================================
// Match Configuration
// =============================================================================

/**
 * Win condition types
 */
export type WinConditionType = "last_standing" | "most_kills" | "first_to_x";

/**
 * Match configuration set on game start
 */
export interface MatchConfig {
  /** Type of win condition */
  winCondition: WinConditionType;
  /** Target kills for 'first_to_x' win condition */
  killTarget?: number;
  /** Time limit in milliseconds for 'most_kills' win condition */
  timeLimitMs?: number;
}

/**
 * Game state machine states
 */
export type GameState = "lobby" | "countdown" | "playing" | "gameover";

// =============================================================================
// Player State
// =============================================================================

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
  /** Current health, clamped to [0, maxHealth] */
  health: number;
  /** Maximum health (no overheal) */
  maxHealth: number;
  /** Number of deaths */
  deaths: number;
  /** Number of kills (incremented for final blow only, no assists) */
  kills: number;
  /** ID of the last player who damaged this player (for kill attribution) */
  lastHitBy: string | null;
  /** Respawn timer in ticks. When non-null, player is invulnerable and cannot act */
  respawnTimer: number | null;
  /** Sequence counter for deterministic projectile ID generation */
  projectileSeq: number;

  // --- Movement state (for smooth controls) ---
  /** Smoothing value for horizontal velocity (used by SmoothDamp) */
  velocityXSmoothing: number;
  /** Whether currently wall sliding */
  wallSliding: boolean;
  /** Which side the wall is on (-1 = left, 1 = right, 0 = none) */
  wallDirX: -1 | 0 | 1;
  /** Time remaining before player can leave wall (wall stick) */
  timeToWallUnstick: number;
  /** Whether jump was pressed last frame (for detecting press edge) */
  jumpWasPressedLastFrame: boolean;
}

// =============================================================================
// World State
// =============================================================================

/**
 * Complete platformer world state
 */
export interface PlatformerWorld {
  /** All players in the world */
  players: Map<string, PlatformerPlayer>;
  /** Active projectiles in the world */
  projectiles: Projectile[];
  /** Current tick number */
  tick: number;
  /** Current game state */
  gameState: GameState;
  /** Level ID for physics world caching */
  levelId: string;
  /** Platforms in the level */
  platforms: Platform[];
  /** Spawn points for players */
  spawnPoints: SpawnPoint[];
  /** Hazards in the level */
  hazards: Hazard[];
  /** Winner player ID (set when gameState is 'gameover') */
  winner: string | null;
  /** Match configuration */
  matchConfig: MatchConfig;
  /** Countdown timer (ticks remaining, used in 'countdown' state) */
  countdownTicks: number | null;
  /** Match start tick (for time-based win conditions) */
  matchStartTick: number | null;
}

/**
 * Default match configuration
 */
export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  winCondition: "first_to_x",
  killTarget: 3,
};

/**
 * Create an empty platformer world
 */
export function createPlatformerWorld(
  matchConfig: MatchConfig = DEFAULT_MATCH_CONFIG,
  levelId: string = "default",
): PlatformerWorld {
  return {
    players: new Map(),
    projectiles: [],
    tick: 0,
    gameState: "lobby",
    levelId,
    platforms: [],
    spawnPoints: [],
    hazards: [],
    winner: null,
    matchConfig,
    countdownTicks: null,
    matchStartTick: null,
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
    health: DEFAULT_MAX_HEALTH,
    maxHealth: DEFAULT_MAX_HEALTH,
    deaths: 0,
    kills: 0,
    lastHitBy: null,
    respawnTimer: null,
    projectileSeq: 0,
    // Movement state (initialized to defaults)
    velocityXSmoothing: 0,
    wallSliding: false,
    wallDirX: 0,
    timeToWallUnstick: 0,
    jumpWasPressedLastFrame: false,
  };
}

/**
 * Create an idle input (no movement, no jump, no shoot)
 * @param timestamp - Optional timestamp (defaults to current time)
 */
export function createIdleInput(timestamp?: number): PlatformerInput {
  return {
    moveX: 0,
    moveY: 0,
    jump: false,
    shoot: false,
    shootTargetX: 0,
    shootTargetY: 0,
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
 * Shoot action in the platformer game.
 * Spawns a projectile traveling toward the target position.
 */
export interface PlatformerShootAction {
  /** Type discriminator for action handling */
  type: "shoot";
  /** Target X position to shoot toward */
  targetX: number;
  /** Target Y position to shoot toward */
  targetY: number;
}

/**
 * Union type for all platformer actions
 */
export type PlatformerAction = PlatformerAttackAction | PlatformerShootAction;

/**
 * Result of a successful attack action
 */
export interface PlatformerAttackResult {
  type: "attack";
  /** ID of the player that was hit */
  targetId: string;
  /** Damage dealt */
  damage: number;
}

/**
 * Result of a shoot action (projectile spawned)
 */
export interface PlatformerShootResult {
  type: "shoot";
  /** ID of the spawned projectile */
  projectileId: string;
}

/**
 * Union type for all platformer action results
 */
export type PlatformerActionResult = PlatformerAttackResult | PlatformerShootResult;

/**
 * Attack configuration constants
 */
export const ATTACK_RADIUS = 50; // pixels
export const ATTACK_DAMAGE = 10;

// =============================================================================
// Projectile Types
// =============================================================================

/** Projectile speed in pixels per second */
export const PROJECTILE_SPEED = 500;

/** Projectile damage */
export const PROJECTILE_DAMAGE = 25;

/** Projectile radius for collision */
export const PROJECTILE_RADIUS = 5;

/** Maximum projectile lifetime in ticks (at 20Hz = 5 seconds) */
export const PROJECTILE_LIFETIME_TICKS = 100;

/**
 * A projectile in the game world
 */
export interface Projectile {
  /** Unique identifier for the projectile */
  id: string;
  /** ID of the player who fired this projectile */
  ownerId: string;
  /** Current position */
  position: Vector2;
  /** Velocity (direction * speed) */
  velocity: Vector2;
  /** Damage dealt on hit */
  damage: number;
  /** Remaining lifetime in ticks */
  lifetime: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Clamp health to valid range [0, maxHealth]
 */
export const clampHealth = (health: number, maxHealth: number): number =>
  Math.max(0, Math.min(maxHealth, health));

/**
 * Check if a player is alive (health > 0 and not respawning)
 */
export const isPlayerAlive = (player: PlatformerPlayer): boolean =>
  player.health > 0 && player.respawnTimer === null;

/**
 * Check if a player is invulnerable (respawning)
 */
export const isPlayerInvulnerable = (player: PlatformerPlayer): boolean =>
  player.respawnTimer !== null;

/**
 * Check if a player can take damage
 */
export const canPlayerTakeDamage = (player: PlatformerPlayer): boolean =>
  player.health > 0 && player.respawnTimer === null;

/**
 * Create a damaged player with proper clamping and attribution
 */
export const applyDamageToPlayer = (
  player: PlatformerPlayer,
  damage: number,
  attackerId: string,
): PlatformerPlayer => {
  if (!canPlayerTakeDamage(player)) {
    return player;
  }
  const newHealth = clampHealth(player.health - damage, player.maxHealth);
  return {
    ...player,
    health: newHealth,
    lastHitBy: attackerId,
  };
};

/**
 * Get count of alive players in the world
 */
export const getAlivePlayerCount = (world: PlatformerWorld): number =>
  Array.from(world.players.values()).filter(isPlayerAlive).length;

/**
 * Get the player with the most kills
 */
export const getPlayerWithMostKills = (
  world: PlatformerWorld,
): PlatformerPlayer | null => {
  const players = Array.from(world.players.values());
  if (players.length === 0) return null;

  return players.reduce((best, current) =>
    current.kills > best.kills ? current : best,
  );
};

/**
 * Check if any player has reached the kill target
 */
export const hasPlayerReachedKillTarget = (
  world: PlatformerWorld,
  killTarget: number,
): PlatformerPlayer | null => {
  for (const player of world.players.values()) {
    if (player.kills >= killTarget) {
      return player;
    }
  }
  return null;
};
