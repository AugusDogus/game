import { describe, test, expect } from "bun:test";
import { createGamepadInput, GamepadButton, GamepadAxis } from "./gamepad.js";

describe("createGamepadInput", () => {
  // Note: Gamepad API is polling-based, so we can't easily mock it
  // These tests verify the API structure and behavior when no gamepad is connected

  test("should create gamepad input", () => {
    const gamepad = createGamepadInput();

    expect(gamepad).toBeDefined();
    expect(gamepad.getState).toBeDefined();
    expect(gamepad.isConnected).toBeDefined();
    expect(gamepad.isButtonDown).toBeDefined();
    expect(gamepad.getAxis).toBeDefined();
    expect(gamepad.getLeftStick).toBeDefined();
    expect(gamepad.getRightStick).toBeDefined();
    expect(gamepad.vibrate).toBeDefined();
    expect(gamepad.destroy).toBeDefined();

    gamepad.destroy();
  });

  test("should return disconnected state when no gamepad", () => {
    const gamepad = createGamepadInput();
    const state = gamepad.getState();

    expect(state.connected).toBe(false);
    expect(state.leftStick.x).toBe(0);
    expect(state.leftStick.y).toBe(0);
    expect(state.rightStick.x).toBe(0);
    expect(state.rightStick.y).toBe(0);
    expect(state.buttons.a).toBe(false);
    expect(state.dpad.up).toBe(false);

    gamepad.destroy();
  });

  test("isConnected should return false when no gamepad", () => {
    const gamepad = createGamepadInput();
    expect(gamepad.isConnected()).toBe(false);
    gamepad.destroy();
  });

  test("isButtonDown should return false when no gamepad", () => {
    const gamepad = createGamepadInput();
    expect(gamepad.isButtonDown(GamepadButton.A)).toBe(false);
    expect(gamepad.isButtonDown(GamepadButton.B)).toBe(false);
    gamepad.destroy();
  });

  test("getAxis should return 0 when no gamepad", () => {
    const gamepad = createGamepadInput();
    expect(gamepad.getAxis(GamepadAxis.LeftStickX)).toBe(0);
    expect(gamepad.getAxis(GamepadAxis.LeftStickY)).toBe(0);
    gamepad.destroy();
  });

  test("getLeftStick should return zero position when no gamepad", () => {
    const gamepad = createGamepadInput();
    const stick = gamepad.getLeftStick();
    expect(stick.x).toBe(0);
    expect(stick.y).toBe(0);
    gamepad.destroy();
  });

  test("getRightStick should return zero position when no gamepad", () => {
    const gamepad = createGamepadInput();
    const stick = gamepad.getRightStick();
    expect(stick.x).toBe(0);
    expect(stick.y).toBe(0);
    gamepad.destroy();
  });

  test("vibrate should not throw when no gamepad", () => {
    const gamepad = createGamepadInput();
    // Should not throw
    expect(() => gamepad.vibrate(100, 0.5, 0.5)).not.toThrow();
    gamepad.destroy();
  });

  test("should accept custom config", () => {
    const gamepad = createGamepadInput({
      gamepadIndex: 1,
      deadzone: 0.2,
      buttonThreshold: 0.6,
    });

    expect(gamepad).toBeDefined();
    gamepad.destroy();
  });

  test("GamepadButton constants should have correct values", () => {
    expect(GamepadButton.A).toBe(0);
    expect(GamepadButton.B).toBe(1);
    expect(GamepadButton.X).toBe(2);
    expect(GamepadButton.Y).toBe(3);
    expect(GamepadButton.LeftBumper).toBe(4);
    expect(GamepadButton.RightBumper).toBe(5);
    expect(GamepadButton.LeftTrigger).toBe(6);
    expect(GamepadButton.RightTrigger).toBe(7);
    expect(GamepadButton.DpadUp).toBe(12);
    expect(GamepadButton.DpadDown).toBe(13);
    expect(GamepadButton.DpadLeft).toBe(14);
    expect(GamepadButton.DpadRight).toBe(15);
  });

  test("GamepadAxis constants should have correct values", () => {
    expect(GamepadAxis.LeftStickX).toBe(0);
    expect(GamepadAxis.LeftStickY).toBe(1);
    expect(GamepadAxis.RightStickX).toBe(2);
    expect(GamepadAxis.RightStickY).toBe(3);
  });
});
