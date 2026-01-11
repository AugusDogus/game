/**
 * @game/netcode - Fast-paced multiplayer networking library
 *
 * Provides a game-agnostic netcode engine supporting:
 * - Server-authoritative architecture with client-side prediction
 * - Rollback netcode (GGPO-style)
 * - Entity interpolation and lag compensation
 * - Custom world states and simulation logic
 */

// =============================================================================
// High-Level API (Recommended)
// =============================================================================
export { createNetcodeServer } from "./create-server.js";
export type { CreateServerConfig, NetcodeServerHandle } from "./create-server.js";

export { createNetcodeClient } from "./create-client.js";
export type { CreateClientConfig, NetcodeClientHandle } from "./create-client.js";

// Socket.IO parser for proper Map/Set/Date serialization
export { superjsonParser } from "./parser.js";

// =============================================================================
// Core Types
// =============================================================================
export type {
  GameDefinition,
  SimulateFunction,
  InterpolateFunction,
  SerializeFunction,
  DeserializeFunction,
  Snapshot,
  InputMessage,
  InputMerger,
  // Action types for lag compensation
  ActionMessage,
  ActionResult,
  ActionValidator,
} from "./core/types.js";

export type { WorldManager } from "./core/world.js";
export { DefaultWorldManager } from "./core/world.js";

export { SnapshotBuffer } from "./core/snapshot-buffer.js";

// =============================================================================
// Client Primitives
// =============================================================================
export { InputBuffer } from "./client/input-buffer.js";
export { Predictor } from "./client/prediction.js";
export { Reconciler } from "./client/reconciliation.js";
export { Interpolator } from "./client/interpolation.js";
export type { PredictionScope } from "./client/prediction-scope.js";
export { NoPredictionScope } from "./client/prediction-scope.js";

// =============================================================================
// Server Primitives
// =============================================================================
export { InputQueue } from "./server/input-queue.js";
export { GameLoop } from "./server/game-loop.js";
export { LagCompensator } from "./server/lag-compensator.js";
export type {
  LagCompensatorConfig,
  ClientClockInfo,
  LagCompensationResult,
} from "./server/lag-compensator.js";
export { ActionQueue } from "./server/action-queue.js";
export type { QueuedAction } from "./server/action-queue.js";

// =============================================================================
// Strategies
// =============================================================================
export type { ClientStrategy, ServerStrategy, StrategyType } from "./strategies/types.js";
export {
  ServerAuthoritativeClient,
  ServerAuthoritativeServer,
} from "./strategies/server-authoritative.js";
export type { ServerAuthoritativeServerConfig } from "./strategies/server-authoritative.js";
export { RollbackClient } from "./strategies/rollback.js";

// =============================================================================
// Platformer Example Game
// =============================================================================
export type {
  Vector2,
  PlatformerInput,
  PlatformerPlayer,
  PlatformerWorld,
  // Level types
  Platform,
  SpawnPoint,
  Hazard,
  LevelConfig,
  // Match types
  MatchConfig,
  WinConditionType,
  GameState,
  // Action types
  PlatformerAttackAction,
  PlatformerAction,
  PlatformerAttackResult,
  PlatformerActionResult,
} from "./examples/platformer/types.js";

export {
  createPlatformerWorld,
  createPlatformerPlayer,
  createIdleInput,
  // Combat constants
  ATTACK_RADIUS,
  ATTACK_DAMAGE,
  DEFAULT_MAX_HEALTH,
  RESPAWN_TIMER_TICKS,
  KNOCKBACK_FORCE,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
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
} from "./examples/platformer/types.js";

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
} from "./examples/platformer/simulation.js";

export { interpolatePlatformer } from "./examples/platformer/interpolation.js";

export { platformerPredictionScope } from "./examples/platformer/prediction.js";

export { validatePlatformerAction, isInAttackRange } from "./examples/platformer/action-validator.js";

export { platformerGame } from "./examples/platformer/index.js";

// =============================================================================
// Constants
// =============================================================================
export {
  DEFAULT_TICK_RATE,
  DEFAULT_TICK_INTERVAL_MS,
  DEFAULT_INTERPOLATION_DELAY_MS,
  DEFAULT_SNAPSHOT_HISTORY_SIZE,
  DEFAULT_PLAYER_SPEED,
  DEFAULT_GRAVITY,
  DEFAULT_JUMP_VELOCITY,
  DEFAULT_FLOOR_Y,
  MAX_INPUT_BUFFER_SIZE,
  DEFAULT_FRAME_DELTA_MS,
  MIN_DELTA_MS,
  MAX_DELTA_MS,
} from "./constants.js";
