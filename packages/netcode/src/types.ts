/**
 * @game/netcode/types - Core type definitions
 *
 * Type definitions for implementing game logic that integrates with the netcode system.
 */

export type {
  // Core game logic types
  GameDefinition,
  SimulateFunction,
  InterpolateFunction,
  SerializeFunction,
  DeserializeFunction,
  // Snapshot and input types
  Snapshot,
  InputMessage,
  InputMerger,
  // Action types for lag compensation
  ActionMessage,
  ActionResult,
  ActionValidator,
} from "./core/types.js";

// Re-export PredictionScope type for convenience
export type { PredictionScope } from "./client/prediction-scope.js";

// World management types
export type { WorldManager } from "./core/world.js";

// Strategy types
export type { ClientStrategy, ServerStrategy, StrategyType } from "./strategies/types.js";
