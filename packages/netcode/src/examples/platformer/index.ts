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
  PlatformerAttackAction,
  PlatformerAction,
  PlatformerAttackResult,
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

// Game definition for easy setup
import type { GameDefinition } from "../../core/types.js";
import type { PlatformerWorld, PlatformerInput } from "./types.js";
import { simulatePlatformer } from "./simulation.js";
import { interpolatePlatformer } from "./interpolation.js";

/**
 * Complete game definition for platformer.
 * Pass this to createNetcodeServer/createNetcodeClient.
 */
export const platformerGame: GameDefinition<PlatformerWorld, PlatformerInput> = {
  simulate: simulatePlatformer,
  interpolate: interpolatePlatformer,
};
