/**
 * Netcode strategies
 */

// Types
export type { ClientStrategy, ServerStrategy, StrategyType } from "./types.js";

// Server-authoritative strategy
export { ServerAuthoritativeClient, ServerAuthoritativeServer } from "./server-authoritative.js";
export type { ServerAuthoritativeServerConfig, VisualSmoothingConfig } from "./server-authoritative.js";

// Rollback strategy
export { RollbackClient } from "./rollback.js";
