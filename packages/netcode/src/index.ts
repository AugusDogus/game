/**
 * @game/netcode - Fast-paced multiplayer networking library
 *
 * Provides both high-level classes and composable primitives for implementing
 * authoritative server architecture with client-side prediction, server reconciliation,
 * entity interpolation, and lag compensation.
 */

// Types
export type {
  Vector2,
  PlayerInput,
  PlayerState,
  WorldSnapshot,
  InputMessage,
  NetcodeServerConfig,
  NetcodeClientConfig,
} from "./types.js";

// Constants
export {
  DEFAULT_TICK_RATE,
  DEFAULT_TICK_INTERVAL_MS,
  DEFAULT_INTERPOLATION_DELAY_MS,
  DEFAULT_SNAPSHOT_HISTORY_SIZE,
  DEFAULT_PLAYER_SPEED,
  MAX_INPUT_BUFFER_SIZE,
} from "./constants.js";

// Physics
export { applyInput, createPlayerState } from "./physics.js";

// Server exports
export {
  NetcodeServer,
  WorldState,
  InputQueue,
  GameLoop,
  SnapshotHistory,
} from "./server/index.js";

// Client exports
export {
  NetcodeClient,
  InputBuffer,
  Predictor,
  Reconciler,
  Interpolator,
} from "./client/index.js";

// Debug types
export type { PositionHistoryEntry, DebugData } from "./client/netcode-client.js";
