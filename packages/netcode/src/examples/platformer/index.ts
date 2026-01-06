/**
 * Platformer game example implementation
 */

// Types
export type { Vector2, PlatformerInput, PlatformerPlayer, PlatformerWorld } from "./types.js";

export { createPlatformerWorld, createPlatformerPlayer, createIdleInput } from "./types.js";

// Simulation
export {
  simulatePlatformer,
  addPlayerToWorld,
  removePlayerFromWorld,
  mergePlatformerInputs,
} from "./simulation.js";

// Interpolation
export { interpolatePlatformer } from "./interpolation.js";

// Prediction
export { platformerPredictionScope } from "./prediction.js";

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
