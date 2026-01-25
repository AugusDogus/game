/**
 * @game/netcode - Fast-paced multiplayer networking library
 *
 * Provides a game-agnostic netcode engine supporting:
 * - Server-authoritative architecture with client-side prediction
 * - FishNet-style tick smoothing for smooth graphical rendering
 * - Lag compensation for action validation
 * - GGPO-style rollback netcode (experimental, under active development)
 */

// =============================================================================
// High-Level API (Recommended)
// =============================================================================
export { createServer } from "./create-server.js";
export type { ServerConfig, ServerHandle } from "./create-server.js";

export { createClient } from "./create-client.js";
export type { ClientConfig, ClientHandle } from "./create-client.js";

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
export type { ReconciliationReplayCallback } from "./client/reconciliation.js";
export { TickSmoother, DEFAULT_TICK_SMOOTHER_CONFIG } from "./client/tick-smoother.js";
export type { TickSmootherConfig, TickPosition } from "./client/tick-smoother.js";
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
export type { ServerAuthoritativeServerConfig, SmoothingConfig } from "./strategies/server-authoritative.js";

/**
 * GGPO-style rollback netcode.
 * @experimental Under active development - missing input prediction, desync detection, delay negotiation.
 */
export { RollbackClient } from "./strategies/rollback.js";

// =============================================================================
// Constants
// =============================================================================
export {
  DEFAULT_TICK_RATE,
  DEFAULT_TICK_INTERVAL_MS,
  DEFAULT_INTERPOLATION_TICKS,
  DEFAULT_SNAPSHOT_HISTORY_SIZE,
  DEFAULT_FLOOR_Y,
  MAX_INPUT_BUFFER_SIZE,
  DEFAULT_FRAME_DELTA_MS,
  MIN_DELTA_MS,
  MAX_DELTA_MS,
} from "./constants.js";
