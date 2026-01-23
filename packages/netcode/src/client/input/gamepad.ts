/**
 * Gamepad input helper for controller support.
 *
 * @module client/input/gamepad
 */

/**
 * Standard gamepad button indices (based on Standard Gamepad mapping).
 * @see https://w3c.github.io/gamepad/#remapping
 */
export const GamepadButton = {
  /** A (Xbox), X (PlayStation), B (Nintendo) */
  A: 0,
  /** B (Xbox), Circle (PlayStation), A (Nintendo) */
  B: 1,
  /** X (Xbox), Square (PlayStation), Y (Nintendo) */
  X: 2,
  /** Y (Xbox), Triangle (PlayStation), X (Nintendo) */
  Y: 3,
  /** Left bumper / L1 */
  LeftBumper: 4,
  /** Right bumper / R1 */
  RightBumper: 5,
  /** Left trigger / L2 */
  LeftTrigger: 6,
  /** Right trigger / R2 */
  RightTrigger: 7,
  /** Back / Select / Share */
  Back: 8,
  /** Start / Options */
  Start: 9,
  /** Left stick press / L3 */
  LeftStick: 10,
  /** Right stick press / R3 */
  RightStick: 11,
  /** D-pad up */
  DpadUp: 12,
  /** D-pad down */
  DpadDown: 13,
  /** D-pad left */
  DpadLeft: 14,
  /** D-pad right */
  DpadRight: 15,
  /** Home / Guide / PS button */
  Home: 16,
} as const;

export type GamepadButtonType = (typeof GamepadButton)[keyof typeof GamepadButton];

/**
 * Standard gamepad axis indices.
 */
export const GamepadAxis = {
  /** Left stick horizontal (-1 = left, 1 = right) */
  LeftStickX: 0,
  /** Left stick vertical (-1 = up, 1 = down) */
  LeftStickY: 1,
  /** Right stick horizontal (-1 = left, 1 = right) */
  RightStickX: 2,
  /** Right stick vertical (-1 = up, 1 = down) */
  RightStickY: 3,
} as const;

export type GamepadAxisType = (typeof GamepadAxis)[keyof typeof GamepadAxis];

/**
 * 2D stick position.
 */
export interface StickPosition {
  x: number;
  y: number;
}

/**
 * Configuration for gamepad input.
 */
export interface GamepadInputConfig {
  /**
   * Gamepad index to use (0-3).
   * Default: 0 (first connected gamepad)
   */
  gamepadIndex?: number;
  /**
   * Deadzone for analog sticks (0-1).
   * Values below this threshold are treated as 0.
   * Default: 0.15
   */
  deadzone?: number;
  /**
   * Threshold for button press detection (0-1).
   * Triggers and analog buttons use this to determine "pressed" state.
   * Default: 0.5
   */
  buttonThreshold?: number;
}

/**
 * Current state of the gamepad.
 */
export interface GamepadState {
  /** Whether a gamepad is connected at the configured index */
  connected: boolean;
  /** Left analog stick position (-1 to 1) */
  leftStick: StickPosition;
  /** Right analog stick position (-1 to 1) */
  rightStick: StickPosition;
  /** D-pad state as directional values */
  dpad: {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
  };
  /** Face buttons */
  buttons: {
    a: boolean;
    b: boolean;
    x: boolean;
    y: boolean;
  };
  /** Shoulder buttons */
  shoulders: {
    leftBumper: boolean;
    rightBumper: boolean;
    leftTrigger: number; // 0-1 analog value
    rightTrigger: number; // 0-1 analog value
  };
  /** Other buttons */
  meta: {
    start: boolean;
    back: boolean;
    leftStickPress: boolean;
    rightStickPress: boolean;
    home: boolean;
  };
}

/**
 * Handle returned by createGamepadInput.
 */
export interface GamepadInputHandle {
  /** Get the current gamepad state (must be called each frame) */
  getState(): GamepadState;
  /** Check if gamepad is connected */
  isConnected(): boolean;
  /** Check if a specific button is pressed */
  isButtonDown(button: GamepadButtonType): boolean;
  /** Get raw axis value (-1 to 1) */
  getAxis(axis: GamepadAxisType): number;
  /** Get left stick position with deadzone applied */
  getLeftStick(): StickPosition;
  /** Get right stick position with deadzone applied */
  getRightStick(): StickPosition;
  /** Trigger vibration (if supported) */
  vibrate(duration: number, weakMagnitude?: number, strongMagnitude?: number): void;
  /** Clean up (no-op for gamepad, but included for API consistency) */
  destroy(): void;
}

/**
 * Apply deadzone to a single axis value.
 */
function applyDeadzone(value: number, deadzone: number): number {
  if (Math.abs(value) < deadzone) {
    return 0;
  }
  // Rescale so deadzone edge maps to 0 and 1 maps to 1
  const sign = value > 0 ? 1 : -1;
  return sign * ((Math.abs(value) - deadzone) / (1 - deadzone));
}

/**
 * Apply deadzone to a 2D stick (radial deadzone).
 */
function applyRadialDeadzone(x: number, y: number, deadzone: number): StickPosition {
  const magnitude = Math.sqrt(x * x + y * y);

  if (magnitude < deadzone) {
    return { x: 0, y: 0 };
  }

  // Rescale
  const scale = (magnitude - deadzone) / ((1 - deadzone) * magnitude);
  return {
    x: x * scale,
    y: y * scale,
  };
}

/**
 * Create a gamepad input handler for controller support.
 *
 * Note: Gamepad API requires polling - call getState() each frame.
 *
 * @example
 * ```ts
 * import { createGamepadInput, GamepadButton } from "@game/netcode/client/input";
 *
 * const gamepad = createGamepadInput({
 *   gamepadIndex: 0,
 *   deadzone: 0.15,
 * });
 *
 * // In your game loop:
 * function update() {
 *   const state = gamepad.getState();
 *
 *   if (state.connected) {
 *     // Use left stick for movement
 *     player.move(state.leftStick.x, state.leftStick.y);
 *
 *     // Check buttons
 *     if (state.buttons.a) {
 *       player.jump();
 *     }
 *
 *     // Or use raw button check
 *     if (gamepad.isButtonDown(GamepadButton.RightTrigger)) {
 *       player.shoot();
 *     }
 *   }
 * }
 * ```
 */
export function createGamepadInput(config: GamepadInputConfig = {}): GamepadInputHandle {
  const gamepadIndex = config.gamepadIndex ?? 0;
  const deadzone = config.deadzone ?? 0.15;
  const buttonThreshold = config.buttonThreshold ?? 0.5;

  // Get the current gamepad (must be polled each frame)
  const getGamepad = (): Gamepad | null => {
    if (typeof navigator === "undefined" || !navigator.getGamepads) {
      return null;
    }
    const gamepads = navigator.getGamepads();
    return gamepads[gamepadIndex] ?? null;
  };

  // Get button state (handles both digital and analog buttons)
  const getButton = (gp: Gamepad, index: number): { pressed: boolean; value: number } => {
    const button = gp.buttons[index];
    if (!button) {
      return { pressed: false, value: 0 };
    }
    return {
      pressed: button.pressed || button.value > buttonThreshold,
      value: button.value,
    };
  };

  return {
    getState(): GamepadState {
      const gp = getGamepad();

      if (!gp) {
        return {
          connected: false,
          leftStick: { x: 0, y: 0 },
          rightStick: { x: 0, y: 0 },
          dpad: { up: false, down: false, left: false, right: false },
          buttons: { a: false, b: false, x: false, y: false },
          shoulders: {
            leftBumper: false,
            rightBumper: false,
            leftTrigger: 0,
            rightTrigger: 0,
          },
          meta: {
            start: false,
            back: false,
            leftStickPress: false,
            rightStickPress: false,
            home: false,
          },
        };
      }

      // Get stick positions with radial deadzone
      const leftStick = applyRadialDeadzone(
        gp.axes[GamepadAxis.LeftStickX] ?? 0,
        gp.axes[GamepadAxis.LeftStickY] ?? 0,
        deadzone,
      );
      const rightStick = applyRadialDeadzone(
        gp.axes[GamepadAxis.RightStickX] ?? 0,
        gp.axes[GamepadAxis.RightStickY] ?? 0,
        deadzone,
      );

      return {
        connected: true,
        leftStick,
        rightStick,
        dpad: {
          up: getButton(gp, GamepadButton.DpadUp).pressed,
          down: getButton(gp, GamepadButton.DpadDown).pressed,
          left: getButton(gp, GamepadButton.DpadLeft).pressed,
          right: getButton(gp, GamepadButton.DpadRight).pressed,
        },
        buttons: {
          a: getButton(gp, GamepadButton.A).pressed,
          b: getButton(gp, GamepadButton.B).pressed,
          x: getButton(gp, GamepadButton.X).pressed,
          y: getButton(gp, GamepadButton.Y).pressed,
        },
        shoulders: {
          leftBumper: getButton(gp, GamepadButton.LeftBumper).pressed,
          rightBumper: getButton(gp, GamepadButton.RightBumper).pressed,
          leftTrigger: getButton(gp, GamepadButton.LeftTrigger).value,
          rightTrigger: getButton(gp, GamepadButton.RightTrigger).value,
        },
        meta: {
          start: getButton(gp, GamepadButton.Start).pressed,
          back: getButton(gp, GamepadButton.Back).pressed,
          leftStickPress: getButton(gp, GamepadButton.LeftStick).pressed,
          rightStickPress: getButton(gp, GamepadButton.RightStick).pressed,
          home: getButton(gp, GamepadButton.Home).pressed,
        },
      };
    },

    isConnected(): boolean {
      return getGamepad() !== null;
    },

    isButtonDown(button: GamepadButtonType): boolean {
      const gp = getGamepad();
      if (!gp) return false;
      return getButton(gp, button).pressed;
    },

    getAxis(axis: GamepadAxisType): number {
      const gp = getGamepad();
      if (!gp) return 0;
      const value = gp.axes[axis] ?? 0;
      return applyDeadzone(value, deadzone);
    },

    getLeftStick(): StickPosition {
      const gp = getGamepad();
      if (!gp) return { x: 0, y: 0 };
      return applyRadialDeadzone(
        gp.axes[GamepadAxis.LeftStickX] ?? 0,
        gp.axes[GamepadAxis.LeftStickY] ?? 0,
        deadzone,
      );
    },

    getRightStick(): StickPosition {
      const gp = getGamepad();
      if (!gp) return { x: 0, y: 0 };
      return applyRadialDeadzone(
        gp.axes[GamepadAxis.RightStickX] ?? 0,
        gp.axes[GamepadAxis.RightStickY] ?? 0,
        deadzone,
      );
    },

    vibrate(duration: number, weakMagnitude = 0.5, strongMagnitude = 0.5): void {
      const gp = getGamepad();
      if (!gp || !gp.vibrationActuator) return;

      // Use the Gamepad Haptics API
      gp.vibrationActuator.playEffect("dual-rumble", {
        duration,
        weakMagnitude,
        strongMagnitude,
      }).catch(() => {
        // Vibration not supported or failed - ignore
      });
    },

    destroy(): void {
      // No cleanup needed for Gamepad API (polling-based)
    },
  };
}
