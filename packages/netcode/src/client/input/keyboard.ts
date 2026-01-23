/**
 * Keyboard input helper for game controls.
 *
 * @module client/input/keyboard
 */

/**
 * Key binding configuration.
 * Maps action names to arrays of key codes that trigger them.
 *
 * @example
 * ```ts
 * const bindings: KeyBindings = {
 *   left: ["a", "ArrowLeft"],
 *   right: ["d", "ArrowRight"],
 *   jump: [" ", "w", "ArrowUp"],
 *   shoot: ["f", "Enter"],
 * };
 * ```
 */
export type KeyBindings<TActions extends string = string> = Record<TActions, string[]>;

/**
 * State of all bound actions (which are currently pressed).
 */
export type KeyboardState<TActions extends string = string> = Record<TActions, boolean>;

/**
 * Configuration for keyboard input.
 */
export interface KeyboardInputConfig<TActions extends string = string> {
  /** Key bindings mapping action names to key codes */
  bindings: KeyBindings<TActions>;
  /**
   * Keys to prevent default browser behavior for (e.g., arrow keys, space).
   * Default: [" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]
   */
  preventDefault?: string[];
  /**
   * Target element to attach listeners to.
   * Default: window
   */
  target?: EventTarget;
}

/**
 * Handle returned by createKeyboardInput.
 */
export interface KeyboardInputHandle<TActions extends string = string> {
  /** Get the current state of all actions */
  getState(): KeyboardState<TActions>;
  /** Check if a specific action is currently pressed */
  isPressed(action: TActions): boolean;
  /** Check if a specific raw key is currently pressed */
  isKeyDown(key: string): boolean;
  /** Get all currently pressed raw keys */
  getPressedKeys(): Set<string>;
  /** Update key bindings at runtime */
  setBindings(bindings: KeyBindings<TActions>): void;
  /** Clean up event listeners */
  destroy(): void;
}

/** Default keys to prevent default behavior for */
const DEFAULT_PREVENT_DEFAULT = [" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

/**
 * Create a keyboard input handler with configurable key bindings.
 *
 * @example
 * ```ts
 * import { createKeyboardInput } from "@game/netcode/client/input";
 *
 * // Define your actions and their key bindings
 * const keyboard = createKeyboardInput({
 *   bindings: {
 *     left: ["a", "ArrowLeft"],
 *     right: ["d", "ArrowRight"],
 *     jump: [" ", "w", "ArrowUp"],
 *     shoot: ["f"],
 *   },
 * });
 *
 * // In your game loop:
 * function update() {
 *   const state = keyboard.getState();
 *   // state = { left: false, right: true, jump: false, shoot: false }
 *
 *   // Or check individual actions:
 *   if (keyboard.isPressed("jump")) {
 *     player.jump();
 *   }
 * }
 *
 * // Clean up when done:
 * keyboard.destroy();
 * ```
 */
export function createKeyboardInput<TActions extends string>(
  config: KeyboardInputConfig<TActions>,
): KeyboardInputHandle<TActions> {
  const pressedKeys = new Set<string>();
  let bindings = { ...config.bindings };
  const preventDefault = new Set(config.preventDefault ?? DEFAULT_PREVENT_DEFAULT);
  const target = config.target ?? (typeof window !== "undefined" ? window : null);

  if (!target) {
    throw new Error("[KeyboardInput] No event target available (window not defined)");
  }

  const handleKeyDown = (e: Event) => {
    const event = e as KeyboardEvent;
    const key = event.key.toLowerCase();

    if (preventDefault.has(event.key)) {
      event.preventDefault();
    }

    pressedKeys.add(key);
  };

  const handleKeyUp = (e: Event) => {
    const event = e as KeyboardEvent;
    const key = event.key.toLowerCase();
    pressedKeys.delete(key);
  };

  // Handle window blur - release all keys when window loses focus
  const handleBlur = () => {
    pressedKeys.clear();
  };

  // Attach listeners
  target.addEventListener("keydown", handleKeyDown);
  target.addEventListener("keyup", handleKeyUp);
  if (typeof window !== "undefined") {
    window.addEventListener("blur", handleBlur);
  }

  return {
    getState(): KeyboardState<TActions> {
      const state = {} as KeyboardState<TActions>;
      for (const action of Object.keys(bindings) as TActions[]) {
        const keys = bindings[action];
        state[action] = keys.some((key) => pressedKeys.has(key.toLowerCase()));
      }
      return state;
    },

    isPressed(action: TActions): boolean {
      const keys = bindings[action];
      if (!keys) return false;
      return keys.some((key) => pressedKeys.has(key.toLowerCase()));
    },

    isKeyDown(key: string): boolean {
      return pressedKeys.has(key.toLowerCase());
    },

    getPressedKeys(): Set<string> {
      return new Set(pressedKeys);
    },

    setBindings(newBindings: KeyBindings<TActions>): void {
      bindings = { ...newBindings };
    },

    destroy(): void {
      target.removeEventListener("keydown", handleKeyDown);
      target.removeEventListener("keyup", handleKeyUp);
      if (typeof window !== "undefined") {
        window.removeEventListener("blur", handleBlur);
      }
      pressedKeys.clear();
    },
  };
}
