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
    // Action types for lag compensation
    ActionMessage,
    ActionResult,
    ActionValidator, DeserializeFunction, GameDefinition, InputMerger, InputMessage, InterpolateFunction,
    SerializeFunction, SimulateFunction, Snapshot
} from "./core/types.js";

export { DefaultWorldManager } from "./core/world.js";
export type { WorldManager } from "./core/world.js";

export { SnapshotBuffer } from "./core/snapshot-buffer.js";

// =============================================================================
// Client Primitives
// =============================================================================
export { InputBuffer } from "./client/input-buffer.js";
export { NoPredictionScope } from "./client/prediction-scope.js";
export type { PredictionScope } from "./client/prediction-scope.js";
export { Predictor } from "./client/prediction.js";
export { Reconciler } from "./client/reconciliation.js";
export type { ReconciliationReplayCallback } from "./client/reconciliation.js";
export { AdaptiveInterpolationLevel, DEFAULT_TICK_SMOOTHER_CONFIG, TickSmoother } from "./client/tick-smoother.js";
export type { TickPosition, TickSmootherConfig } from "./client/tick-smoother.js";

// =============================================================================
// Server Primitives
// =============================================================================
export { ActionQueue } from "./server/action-queue.js";
export type { QueuedAction } from "./server/action-queue.js";
export { GameLoop } from "./server/game-loop.js";
export { InputQueue } from "./server/input-queue.js";
export { LagCompensator } from "./server/lag-compensator.js";
export type {
    ClientClockInfo,
    LagCompensationResult, LagCompensatorConfig
} from "./server/lag-compensator.js";

// =============================================================================
// Strategies
// =============================================================================
export {
    ServerAuthoritativeClient,
    ServerAuthoritativeServer
} from "./strategies/server-authoritative.js";
export type { ServerAuthoritativeServerConfig, SmoothingConfig } from "./strategies/server-authoritative.js";
export type { ClientStrategy, ServerStrategy, StrategyType } from "./strategies/types.js";

/**
 * GGPO-style rollback netcode.
 * @experimental Under active development - missing input prediction, desync detection, delay negotiation.
 */
export { RollbackClient } from "./strategies/rollback.js";

// =============================================================================
// Constants
// =============================================================================
export {
    DEFAULT_FLOOR_Y, DEFAULT_FRAME_DELTA_MS, DEFAULT_SNAPSHOT_HISTORY_SIZE, DEFAULT_SPECTATOR_INTERPOLATION_TICKS, DEFAULT_TICK_INTERVAL_MS, DEFAULT_TICK_RATE, MAX_DELTA_MS, MAX_INPUT_BUFFER_SIZE, MIN_DELTA_MS
} from "./constants.js";

