/**
 * ROUNDS-inspired 1v1 platformer game type definitions
 *
 * Core game loop:
 * 1. Two players fight in rounds
 * 2. First to kill the other wins the round
 * 3. Loser picks a card that modifies their character
 * 4. First to win X rounds wins the match
 */

import type { Vector2 } from "@game/physics2d";

export type { Vector2 };

// =============================================================================
// Game Configuration
// =============================================================================

/** Number of rounds needed to win a match */
export const ROUNDS_TO_WIN = 3;

/** Duration of round start countdown in ticks (at 20Hz) */
export const ROUND_COUNTDOWN_TICKS = 60; // 3 seconds

/** Duration of card pick phase in ticks (at 20Hz) */
export const CARD_PICK_TIME_TICKS = 200; // 10 seconds

/** Time after round ends before transitioning in ticks */
export const ROUND_END_DELAY_TICKS = 40; // 2 seconds

// =============================================================================
// Player Constants
// =============================================================================

/** Player hitbox dimensions */
export const PLAYER_WIDTH = 24;
export const PLAYER_HEIGHT = 32;

/** Default player stats (before cards) */
export const DEFAULT_PLAYER_STATS = {
  maxHealth: 100,
  moveSpeed: 1.0,
  jumpForce: 1.0,
  damage: 1.0,
  fireRate: 1.0,
  bulletSpeed: 1.0,
  bulletCount: 1,
  bulletSpread: 0,
  bulletBounces: 0,
  bulletSize: 1.0,
  reloadTime: 1.0,
  ammoCapacity: 6,
  extraJumps: 0,
  dashCount: 0,
  shieldHealth: 0,
  lifeSteal: 0,
  explosionRadius: 0,
  knockbackForce: 1.0,
  gravity: 1.0,
};

export type PlayerStats = typeof DEFAULT_PLAYER_STATS;

// =============================================================================
// Card System
// =============================================================================

/** Card rarity affects how often it appears in picks */
export type CardRarity = "common" | "uncommon" | "rare";

/** Card categories for organization */
export type CardCategory = "offense" | "defense" | "mobility" | "special";

/** Stat modifiers a card can apply */
export interface CardStatModifiers {
  // Multipliers (1.0 = no change)
  maxHealthMult?: number;
  moveSpeedMult?: number;
  jumpForceMult?: number;
  damageMult?: number;
  fireRateMult?: number;
  bulletSpeedMult?: number;
  bulletSizeMult?: number;
  reloadTimeMult?: number;
  knockbackForceMult?: number;
  gravityMult?: number;

  // Flat additions
  bulletCountAdd?: number;
  bulletSpreadAdd?: number;
  bulletBouncesAdd?: number;
  ammoCapacityAdd?: number;
  extraJumpsAdd?: number;
  dashCountAdd?: number;
  shieldHealthAdd?: number;
  lifeStealAdd?: number;
  explosionRadiusAdd?: number;
}

/** A card definition */
export interface Card {
  /** Unique card identifier */
  id: string;
  /** Display name */
  name: string;
  /** Description of what the card does */
  description: string;
  /** Card rarity */
  rarity: CardRarity;
  /** Card category */
  category: CardCategory;
  /** Stat modifiers this card applies */
  modifiers: CardStatModifiers;
  /** Cards that cannot be picked if this card is held */
  incompatibleWith?: string[];
}

// =============================================================================
// Weapon & Projectile Types
// =============================================================================

/** Projectile state */
export interface Projectile {
  /** Unique identifier */
  id: string;
  /** Owner player ID */
  ownerId: string;
  /** Current position */
  position: Vector2;
  /** Current velocity */
  velocity: Vector2;
  /** Base damage */
  damage: number;
  /** Remaining bounces */
  bouncesRemaining: number;
  /** Size multiplier */
  size: number;
  /** Explosion radius (0 = no explosion) */
  explosionRadius: number;
  /** Remaining lifetime in ticks */
  lifetime: number;
  /** Knockback force multiplier */
  knockbackForce: number;
}

/** Projectile constants */
export const PROJECTILE_BASE_SPEED = 600;
export const PROJECTILE_BASE_DAMAGE = 25;
export const PROJECTILE_BASE_SIZE = 6;
export const PROJECTILE_LIFETIME_TICKS = 100; // 5 seconds at 20Hz

// =============================================================================
// Player Input
// =============================================================================

/** Player input for one frame */
export interface RoundsInput {
  /** Horizontal movement (-1 to 1) */
  moveX: number;
  /** Jump pressed this frame */
  jump: boolean;
  /** Shoot pressed this frame */
  shoot: boolean;
  /** Aim direction X (world coords) */
  aimX: number;
  /** Aim direction Y (world coords) */
  aimY: number;
  /** Dash pressed this frame */
  dash: boolean;
  /** Card selection (1-3, or 0 for none) */
  cardSelect: 0 | 1 | 2 | 3;
  /** Input timestamp */
  timestamp: number;
}

/** Create an idle input */
export function createIdleInput(timestamp?: number): RoundsInput {
  return {
    moveX: 0,
    jump: false,
    shoot: false,
    aimX: 0,
    aimY: 0,
    dash: false,
    cardSelect: 0,
    timestamp: timestamp ?? Date.now(),
  };
}

// =============================================================================
// Player State
// =============================================================================

/** Player state in a ROUNDS match */
export interface RoundsPlayer {
  /** Unique player identifier */
  id: string;
  /** Current position (center of hitbox) */
  position: Vector2;
  /** Current velocity */
  velocity: Vector2;
  /** Whether player is on the ground */
  isGrounded: boolean;

  // --- Combat state ---
  /** Current health */
  health: number;
  /** Current ammo */
  ammo: number;
  /** Reload timer (ticks remaining, null if not reloading) */
  reloadTimer: number | null;
  /** Fire cooldown (ticks remaining) */
  fireCooldown: number;
  /** Shield health remaining */
  shieldHealth: number;

  // --- Movement state ---
  /** Remaining extra jumps (air jumps) */
  extraJumpsRemaining: number;
  /** Remaining dashes */
  dashesRemaining: number;
  /** Dash cooldown ticks */
  dashCooldown: number;

  // --- Match state ---
  /** Rounds won this match */
  roundsWon: number;
  /** Cards this player has collected */
  cards: string[];
  /** Computed stats after applying cards */
  stats: PlayerStats;

  // --- Movement smoothing state (from platformer) ---
  velocityXSmoothing: number;
  wallSliding: boolean;
  wallDirX: -1 | 0 | 1;
  timeToWallUnstick: number;
  jumpWasPressedLastFrame: boolean;
  coyoteTimeCounter: number;
  jumpBufferCounter: number;

  // --- Projectile sequencing ---
  projectileSeq: number;

  // --- Respawn/invulnerability ---
  /** Ticks of invulnerability remaining */
  invulnerabilityTicks: number;
}

// =============================================================================
// Game State Machine
// =============================================================================

/** Game phases */
export type GamePhase =
  | "waiting" // Waiting for 2nd player
  | "countdown" // Round about to start
  | "fighting" // Active combat
  | "round_end" // Someone died, brief pause
  | "card_pick" // Loser picks a card
  | "match_over"; // Match complete

/** Card pick state */
export interface CardPickState {
  /** Player who gets to pick (round loser) */
  pickingPlayerId: string;
  /** Available cards to choose from */
  options: [Card, Card, Card];
  /** Ticks remaining to pick */
  ticksRemaining: number;
  /** Selected card index (null if not yet selected) */
  selectedIndex: number | null;
}

// =============================================================================
// World State
// =============================================================================

/** Level platform */
export interface Platform {
  id: string;
  position: Vector2;
  width: number;
  height: number;
}

/** Spawn point */
export interface SpawnPoint {
  position: Vector2;
  /** Which player this spawn is for (0 = left, 1 = right) */
  side: 0 | 1;
}

/** Level configuration */
export interface LevelConfig {
  id: string;
  name: string;
  platforms: Platform[];
  spawnPoints: SpawnPoint[];
  bounds: { width: number; height: number };
}

/** Complete game world state */
export interface RoundsWorld {
  /** Both players (keyed by ID) */
  players: Map<string, RoundsPlayer>;
  /** Active projectiles */
  projectiles: Projectile[];
  /** Current tick number */
  tick: number;
  /** Current game phase */
  phase: GamePhase;
  /** Current level */
  level: LevelConfig;
  /** Card pick state (only set during card_pick phase) */
  cardPick: CardPickState | null;
  /** Countdown ticks remaining (for countdown/round_end phases) */
  countdownTicks: number | null;
  /** Match winner ID (set when phase is match_over) */
  matchWinner: string | null;
  /** Round winner ID (set briefly during round_end) */
  roundWinner: string | null;
  /** Current round number (1-indexed) */
  roundNumber: number;
}

// =============================================================================
// Factory Functions
// =============================================================================

/** Create a new player with default stats */
export function createRoundsPlayer(
  id: string,
  position: Vector2 = { x: 0, y: 0 },
): RoundsPlayer {
  return {
    id,
    position,
    velocity: { x: 0, y: 0 },
    isGrounded: false,
    health: DEFAULT_PLAYER_STATS.maxHealth,
    ammo: DEFAULT_PLAYER_STATS.ammoCapacity,
    reloadTimer: null,
    fireCooldown: 0,
    shieldHealth: 0,
    extraJumpsRemaining: 0,
    dashesRemaining: 0,
    dashCooldown: 0,
    roundsWon: 0,
    cards: [],
    stats: { ...DEFAULT_PLAYER_STATS },
    velocityXSmoothing: 0,
    wallSliding: false,
    wallDirX: 0,
    timeToWallUnstick: 0,
    jumpWasPressedLastFrame: false,
    coyoteTimeCounter: 0,
    jumpBufferCounter: 0,
    projectileSeq: 0,
    invulnerabilityTicks: 0,
  };
}

/** Create an empty world */
export function createRoundsWorld(level: LevelConfig): RoundsWorld {
  return {
    players: new Map(),
    projectiles: [],
    tick: 0,
    phase: "waiting",
    level,
    cardPick: null,
    countdownTicks: null,
    matchWinner: null,
    roundWinner: null,
    roundNumber: 0,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/** Check if a player is alive */
export const isPlayerAlive = (player: RoundsPlayer): boolean =>
  player.health > 0;

/** Check if a player can take damage */
export const canPlayerTakeDamage = (player: RoundsPlayer): boolean =>
  player.health > 0 && player.invulnerabilityTicks <= 0;

/** Clamp health to valid range */
export const clampHealth = (health: number, maxHealth: number): number =>
  Math.max(0, Math.min(maxHealth, health));

/** Get the other player (in a 2-player game) */
export function getOtherPlayer(
  world: RoundsWorld,
  playerId: string,
): RoundsPlayer | null {
  for (const [id, player] of world.players) {
    if (id !== playerId) return player;
  }
  return null;
}

/** Get alive players */
export function getAlivePlayers(world: RoundsWorld): RoundsPlayer[] {
  return Array.from(world.players.values()).filter(isPlayerAlive);
}
