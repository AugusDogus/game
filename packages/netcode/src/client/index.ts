/**
 * @game/netcode/client - Client-side netcode
 *
 * High-level API for creating multiplayer game clients with:
 * - Client-side prediction for responsive gameplay
 * - Server reconciliation to correct mispredictions
 * - Entity interpolation for smooth remote player rendering
 * - Input helpers for keyboard, mouse/touch, and gamepad
 */

// High-level client factory
export { createClient } from "../create-client.js";
export type { ClientConfig, ClientHandle } from "../create-client.js";

// Game loop helper
export { createGameLoop } from "./game-loop.js";
export type { GameLoopConfig, GameLoopHandle } from "./game-loop.js";

// Input helpers (also available via @game/netcode/client/input)
export {
  createKeyboardInput,
  createPointerInput,
  createGamepadInput,
  MouseButton,
  GamepadButton,
  GamepadAxis,
} from "./input/index.js";
export type {
  KeyBindings,
  KeyboardState,
  KeyboardInputConfig,
  KeyboardInputHandle,
  Position,
  MouseButtonType,
  PointerInputConfig,
  PointerState,
  PointerInputHandle,
  GamepadButtonType,
  GamepadAxisType,
  StickPosition,
  GamepadInputConfig,
  GamepadState,
  GamepadInputHandle,
} from "./input/index.js";

// Client primitives (for advanced use)
export { InputBuffer } from "./input-buffer.js";
export { Predictor } from "./prediction.js";
export { Reconciler } from "./reconciliation.js";
export { Interpolator } from "./interpolation.js";
export type { PredictionScope } from "./prediction-scope.js";
export { NoPredictionScope } from "./prediction-scope.js";
