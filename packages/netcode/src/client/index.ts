/**
 * @game/netcode/client - Client-side netcode
 *
 * High-level API for creating multiplayer game clients with:
 * - Client-side prediction for responsive gameplay
 * - Server reconciliation to correct mispredictions
 * - Entity interpolation for smooth remote player rendering
 */

// High-level client factory
export { createClient } from "../create-client.js";
export type { ClientConfig, ClientHandle } from "../create-client.js";

// Game loop helper
export { createGameLoop } from "./game-loop.js";
export type { GameLoopConfig, GameLoopHandle } from "./game-loop.js";

// Client primitives (for advanced use)
export { InputBuffer } from "./input-buffer.js";
export { Predictor } from "./prediction.js";
export { Reconciler } from "./reconciliation.js";
export { Interpolator } from "./interpolation.js";
export type { PredictionScope } from "./prediction-scope.js";
export { NoPredictionScope } from "./prediction-scope.js";
