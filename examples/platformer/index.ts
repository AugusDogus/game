/**
 * Platformer game example implementation
 */

// Types
export type {
  Vector2,
  PlatformerInput,
  PlatformerPlayer,
  PlatformerWorld,
  Platform,
  SpawnPoint,
  Hazard,
  LevelConfig,
  MatchConfig,
  WinConditionType,
  GameState,
  Projectile,
  PlatformerAttackAction,
  PlatformerShootAction,
  PlatformerAction,
  PlatformerAttackResult,
  PlatformerShootResult,
  PlatformerActionResult,
} from "./types.js";

export {
  createPlatformerWorld,
  createPlatformerPlayer,
  createIdleInput,
  // Constants
  DEFAULT_MAX_HEALTH,
  RESPAWN_TIMER_TICKS,
  KNOCKBACK_FORCE,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  ATTACK_RADIUS,
  ATTACK_DAMAGE,
  DEFAULT_MATCH_CONFIG,
  PROJECTILE_SPEED,
  PROJECTILE_DAMAGE,
  PROJECTILE_RADIUS,
  PROJECTILE_LIFETIME_TICKS,
  // Helper functions
  clampHealth,
  isPlayerAlive,
  isPlayerInvulnerable,
  canPlayerTakeDamage,
  applyDamageToPlayer,
  getAlivePlayerCount,
  getPlayerWithMostKills,
  hasPlayerReachedKillTarget,
} from "./types.js";

// Simulation
export {
  simulatePlatformer,
  addPlayerToWorld,
  removePlayerFromWorld,
  mergePlatformerInputs,
  // Game state management
  startGame,
  forceStartGame,
  resetGame,
  // Combat functions
  applyDamage,
  applyKnockback,
  // Level configuration
  setLevelConfig,
} from "./simulation.js";

// Interpolation
export { interpolatePlatformer } from "./interpolation.js";

// Prediction
export { platformerPredictionScope } from "./prediction.js";

// Action validation
export { validatePlatformerAction, isInAttackRange } from "./action-validator.js";

// Test utilities (also useful for game implementations)
export { getPlayer, createTestPlayer, createTestWorld, createPlayingWorld, createLobbyWorld } from "./test-utils.js";

// Levels
export type { LevelValidationResult } from "./levels.js";
export {
  LEVEL_BASIC_ARENA,
  LEVEL_PLATFORMS,
  LEVEL_DANGER_ZONE,
  LEVEL_TOWER,
  DEFAULT_LEVEL,
  LEVELS,
  getLevel,
  getLevelIds,
  getAllLevels,
  validateLevel,
  parseLevelFromJson,
} from "./levels.js";

// Physics bridge - raycast-based collision detection
export type { PhysicsMoveResult } from "./physics-bridge.js";
export {
  initPlatformerPhysics,
  isPhysicsInitialized,
  getPhysicsWorldForLevel,
  clearPhysicsWorldCache,
  movePlayerWithPhysics,
} from "./physics-bridge.js";
