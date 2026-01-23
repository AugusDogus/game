/**
 * @game/netcode/server - Server-side netcode
 *
 * High-level API for creating authoritative game servers with:
 * - Fixed-timestep game loop
 * - Input queuing and processing
 * - Snapshot broadcasting
 * - Lag compensation for hit validation
 */

// High-level server factory
export { createServer } from "../create-server.js";
export type { ServerConfig, ServerHandle } from "../create-server.js";

// Server primitives (for advanced use)
export { InputQueue } from "./input-queue.js";
export { GameLoop } from "./game-loop.js";
export { LagCompensator } from "./lag-compensator.js";
export type {
  LagCompensatorConfig,
  ClientClockInfo,
  LagCompensationResult,
} from "./lag-compensator.js";
export { ActionQueue } from "./action-queue.js";
export type { QueuedAction } from "./action-queue.js";
