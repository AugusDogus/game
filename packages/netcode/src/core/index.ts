/**
 * Core netcode primitives and types
 */

// Types
export type {
  DeserializeFunction,
  GameDefinition,
  InputMessage,
  InterpolateFunction,
  SerializeFunction,
  SimulateFunction,
  Snapshot,
} from "./types.js";

// World management
export { DefaultWorldManager } from "./world.js";
export type { WorldManager } from "./world.js";

// Snapshot buffer
export { SnapshotBuffer } from "./snapshot-buffer.js";
