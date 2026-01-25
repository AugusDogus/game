/**
 * ROUNDS-inspired 1v1 platformer game
 *
 * A multiplayer shooter with rounds and card-based power-ups.
 */

// Types
export type {
  Vector2,
  PlayerStats,
  CardRarity,
  CardCategory,
  CardStatModifiers,
  Card,
  Projectile,
  RoundsInput,
  RoundsPlayer,
  GamePhase,
  CardPickState,
  Platform,
  SpawnPoint,
  LevelConfig,
  RoundsWorld,
} from "./types.js";

export {
  // Constants
  ROUNDS_TO_WIN,
  ROUND_COUNTDOWN_TICKS,
  CARD_PICK_TIME_TICKS,
  ROUND_END_DELAY_TICKS,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  DEFAULT_PLAYER_STATS,
  PROJECTILE_BASE_SPEED,
  PROJECTILE_BASE_DAMAGE,
  PROJECTILE_BASE_SIZE,
  PROJECTILE_LIFETIME_TICKS,
  // Factory functions
  createIdleInput,
  createRoundsPlayer,
  createRoundsWorld,
  // Helper functions
  isPlayerAlive,
  canPlayerTakeDamage,
  clampHealth,
  getOtherPlayer,
  getAlivePlayers,
} from "./types.js";

// Cards
export {
  CARDS,
  getCard,
  getCardsByRarity,
  getCompatibleCards,
  generateCardOptions,
  applyCardModifiers,
  computePlayerStats,
} from "./cards.js";

// Simulation
export {
  simulateRounds,
  mergeRoundsInputs,
  addPlayerToWorld,
  removePlayerFromWorld,
  resetMatch,
  forceStartGame,
} from "./simulation.js";

// Interpolation
export { interpolateRounds } from "./interpolation.js";

// Prediction
export { roundsPredictionScope } from "./prediction.js";

// Levels
export {
  LEVELS,
  DEFAULT_LEVEL,
  LEVEL_CLASSIC_ARENA,
  LEVEL_TOWER,
  LEVEL_PIT,
  LEVEL_PILLARS,
  LEVEL_BRIDGES,
  getLevel,
  getLevelIds,
  getAllLevels,
} from "./levels.js";
