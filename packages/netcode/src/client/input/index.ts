/**
 * @game/netcode/client/input - Input helpers for game controls
 *
 * Provides easy-to-use input abstractions for:
 * - Keyboard input with configurable key bindings
 * - Mouse/touch input with world coordinate conversion
 * - Gamepad/controller support with deadzone handling
 *
 * @example
 * ```ts
 * import {
 *   createKeyboardInput,
 *   createPointerInput,
 *   createGamepadInput,
 *   MouseButton,
 * } from "@game/netcode/client/input";
 *
 * // Keyboard
 * const keyboard = createKeyboardInput({
 *   bindings: {
 *     left: ["a", "ArrowLeft"],
 *     right: ["d", "ArrowRight"],
 *     jump: [" "],
 *   },
 * });
 *
 * // Mouse/Touch
 * const pointer = createPointerInput({ target: canvas });
 *
 * // Gamepad
 * const gamepad = createGamepadInput({ deadzone: 0.15 });
 *
 * // In game loop:
 * function update() {
 *   const keys = keyboard.getState();
 *   const mouse = pointer.getState();
 *   const pad = gamepad.getState();
 *
 *   // Combine inputs
 *   const moveX = keys.right ? 1 : keys.left ? -1 : pad.leftStick.x;
 *   const jump = keys.jump || pad.buttons.a;
 *   const shoot = pointer.wasJustPressed(MouseButton.Left) || pad.shoulders.rightTrigger > 0.5;
 *
 *   // Clear single-frame states
 *   pointer.clearJustPressed();
 * }
 *
 * // Cleanup
 * keyboard.destroy();
 * pointer.destroy();
 * gamepad.destroy();
 * ```
 */

// Keyboard
export { createKeyboardInput } from "./keyboard.js";
export type {
  KeyBindings,
  KeyboardState,
  KeyboardInputConfig,
  KeyboardInputHandle,
} from "./keyboard.js";

// Pointer (mouse/touch)
export { createPointerInput, MouseButton } from "./pointer.js";
export type {
  Position,
  MouseButtonType,
  PointerInputConfig,
  PointerState,
  PointerInputHandle,
} from "./pointer.js";

// Gamepad
export { createGamepadInput, GamepadButton, GamepadAxis } from "./gamepad.js";
export type {
  GamepadButtonType,
  GamepadAxisType,
  StickPosition,
  GamepadInputConfig,
  GamepadState,
  GamepadInputHandle,
} from "./gamepad.js";
