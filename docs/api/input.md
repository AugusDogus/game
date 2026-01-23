# Input Helpers Reference

Game-agnostic input helpers for keyboard, mouse/touch, and gamepad input.

## Import

```typescript
// From client/input submodule
import {
  createKeyboardInput,
  createPointerInput,
  createGamepadInput,
  MouseButton,
  GamepadButton,
  GamepadAxis,
} from "@game/netcode/client/input";

// Or from client module
import { createKeyboardInput, MouseButton } from "@game/netcode/client";
```

---

## createKeyboardInput

Creates a keyboard input handler with configurable key bindings.

### Signature

```typescript
function createKeyboardInput<TActions extends string>(
  config: KeyboardInputConfig<TActions>
): KeyboardInputHandle<TActions>;
```

### Config

```typescript
interface KeyboardInputConfig<TActions extends string> {
  /** Key bindings: action name → array of key codes */
  bindings: KeyBindings<TActions>;

  /** Keys to prevent default behavior for (default: arrows, space) */
  preventDefault?: string[];

  /** Target element for listeners (default: window) */
  target?: EventTarget;
}

type KeyBindings<TActions extends string> = Record<TActions, string[]>;
```

### Handle

```typescript
interface KeyboardInputHandle<TActions extends string> {
  /** Get state of all actions */
  getState(): KeyboardState<TActions>;

  /** Check if specific action is pressed */
  isPressed(action: TActions): boolean;

  /** Check if specific raw key is down */
  isKeyDown(key: string): boolean;

  /** Get all currently pressed keys */
  getPressedKeys(): Set<string>;

  /** Update bindings at runtime */
  setBindings(bindings: KeyBindings<TActions>): void;

  /** Clean up listeners */
  destroy(): void;
}

type KeyboardState<TActions extends string> = Record<TActions, boolean>;
```

### Example

```typescript
// Top-down game
const keyboard = createKeyboardInput({
  bindings: {
    up: ["w", "ArrowUp"],
    down: ["s", "ArrowDown"],
    left: ["a", "ArrowLeft"],
    right: ["d", "ArrowRight"],
    interact: ["e", "Enter"],
    inventory: ["i", "Tab"],
  },
});

// In game loop
function update() {
  const state = keyboard.getState();
  // state = { up: false, down: false, left: true, right: false, ... }

  let moveX = 0, moveY = 0;
  if (state.left) moveX -= 1;
  if (state.right) moveX += 1;
  if (state.up) moveY -= 1;
  if (state.down) moveY += 1;

  client.sendInput({ moveX, moveY, timestamp: Date.now() });
}

// Cleanup
keyboard.destroy();
```

### Key Codes

Use standard `KeyboardEvent.key` values:
- Letters: `"a"`, `"b"`, ... (case-insensitive)
- Arrows: `"ArrowUp"`, `"ArrowDown"`, `"ArrowLeft"`, `"ArrowRight"`
- Space: `" "`
- Modifiers: `"Shift"`, `"Control"`, `"Alt"`
- Others: `"Enter"`, `"Escape"`, `"Tab"`, `"Backspace"`

---

## createPointerInput

Creates a pointer input handler for mouse and touch events with coordinate conversion.

### Signature

```typescript
function createPointerInput(config: PointerInputConfig): PointerInputHandle;
```

### Config

```typescript
interface PointerInputConfig {
  /** Target element (usually canvas) */
  target: HTMLElement;

  /** Convert screen coords to world coords (default: center origin) */
  toWorldCoords?: (
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number
  ) => Position;

  /** Prevent right-click context menu (default: true) */
  preventContextMenu?: boolean;
}

interface Position {
  x: number;
  y: number;
}
```

### Handle

```typescript
interface PointerInputHandle {
  /** Get full pointer state */
  getState(): PointerState;

  /** Get position in world coordinates */
  getWorldPosition(): Position;

  /** Get position in screen coordinates */
  getScreenPosition(): Position;

  /** Check if button is currently down */
  isButtonDown(button: MouseButtonType): boolean;

  /** Check if button was just pressed this frame */
  wasJustPressed(button: MouseButtonType): boolean;

  /** Clear just-pressed state (call at end of frame) */
  clearJustPressed(): void;

  /** Check if pointer is over target element */
  isOverTarget(): boolean;

  /** Clean up listeners */
  destroy(): void;
}

interface PointerState {
  screen: Position;
  world: Position;
  buttons: { left: boolean; middle: boolean; right: boolean };
  isOver: boolean;
}
```

### MouseButton Constants

```typescript
const MouseButton = {
  Left: 0,
  Middle: 1,
  Right: 2,
  Back: 3,
  Forward: 4,
} as const;
```

### Example

```typescript
const pointer = createPointerInput({
  target: canvas,
  // Default: canvas center = world origin
  toWorldCoords: (x, y, w, h) => ({
    x: x - w / 2,
    y: y - h / 2,
  }),
});

function update() {
  const { world, buttons } = pointer.getState();

  // Aiming
  const aimX = world.x;
  const aimY = world.y;

  // Single-shot detection (fires once per click)
  if (pointer.wasJustPressed(MouseButton.Left)) {
    client.sendAction({ type: "shoot", targetX: aimX, targetY: aimY });
  }

  // Continuous fire (while held)
  if (buttons.left) {
    // Automatic weapon logic
  }

  // IMPORTANT: Clear at end of frame
  pointer.clearJustPressed();
}
```

### Touch Support

Touch events are automatically mapped to left mouse button:
- `touchstart` → `mousedown` (left)
- `touchmove` → `mousemove`
- `touchend` → `mouseup` (left)

---

## createGamepadInput

Creates a gamepad input handler with deadzone support.

### Signature

```typescript
function createGamepadInput(config?: GamepadInputConfig): GamepadInputHandle;
```

### Config

```typescript
interface GamepadInputConfig {
  /** Gamepad index 0-3 (default: 0) */
  gamepadIndex?: number;

  /** Analog stick deadzone 0-1 (default: 0.15) */
  deadzone?: number;

  /** Button press threshold 0-1 (default: 0.5) */
  buttonThreshold?: number;
}
```

### Handle

```typescript
interface GamepadInputHandle {
  /** Get full gamepad state (must poll each frame) */
  getState(): GamepadState;

  /** Check if gamepad is connected */
  isConnected(): boolean;

  /** Check if button is pressed */
  isButtonDown(button: GamepadButtonType): boolean;

  /** Get raw axis value (-1 to 1) */
  getAxis(axis: GamepadAxisType): number;

  /** Get left stick with deadzone */
  getLeftStick(): StickPosition;

  /** Get right stick with deadzone */
  getRightStick(): StickPosition;

  /** Trigger vibration (if supported) */
  vibrate(duration: number, weakMagnitude?: number, strongMagnitude?: number): void;

  /** Clean up (no-op, included for consistency) */
  destroy(): void;
}

interface GamepadState {
  connected: boolean;
  leftStick: StickPosition;
  rightStick: StickPosition;
  dpad: { up: boolean; down: boolean; left: boolean; right: boolean };
  buttons: { a: boolean; b: boolean; x: boolean; y: boolean };
  shoulders: {
    leftBumper: boolean;
    rightBumper: boolean;
    leftTrigger: number;  // 0-1
    rightTrigger: number; // 0-1
  };
  meta: {
    start: boolean;
    back: boolean;
    leftStickPress: boolean;
    rightStickPress: boolean;
    home: boolean;
  };
}

interface StickPosition {
  x: number; // -1 to 1
  y: number; // -1 to 1
}
```

### GamepadButton Constants

```typescript
const GamepadButton = {
  A: 0,              // Xbox A, PS X, Nintendo B
  B: 1,              // Xbox B, PS Circle, Nintendo A
  X: 2,              // Xbox X, PS Square, Nintendo Y
  Y: 3,              // Xbox Y, PS Triangle, Nintendo X
  LeftBumper: 4,     // L1
  RightBumper: 5,    // R1
  LeftTrigger: 6,    // L2
  RightTrigger: 7,   // R2
  Back: 8,           // Select/Share
  Start: 9,          // Start/Options
  LeftStick: 10,     // L3
  RightStick: 11,    // R3
  DpadUp: 12,
  DpadDown: 13,
  DpadLeft: 14,
  DpadRight: 15,
  Home: 16,          // Guide/PS button
} as const;

const GamepadAxis = {
  LeftStickX: 0,     // -1 = left, 1 = right
  LeftStickY: 1,     // -1 = up, 1 = down
  RightStickX: 2,
  RightStickY: 3,
} as const;
```

### Example

```typescript
const gamepad = createGamepadInput({
  deadzone: 0.15,
  buttonThreshold: 0.5,
});

function update() {
  const pad = gamepad.getState();

  if (!pad.connected) {
    // Fall back to keyboard
    return;
  }

  // Movement from left stick
  const moveX = pad.leftStick.x;
  const moveY = pad.leftStick.y;

  // Aiming from right stick
  const aimX = pad.rightStick.x;
  const aimY = pad.rightStick.y;

  // Jump with A button
  const jump = pad.buttons.a;

  // Shoot with right trigger (analog)
  const shooting = pad.shoulders.rightTrigger > 0.5;

  // Vibration feedback on hit
  if (tookDamage) {
    gamepad.vibrate(200, 0.3, 0.7);
  }

  client.sendInput({ moveX, moveY, jump, shooting, timestamp: Date.now() });
}
```

---

## Combining Inputs

The input helpers are designed to be combined for multi-input support:

```typescript
const keyboard = createKeyboardInput({
  bindings: {
    left: ["a", "ArrowLeft"],
    right: ["d", "ArrowRight"],
    up: ["w", "ArrowUp"],
    down: ["s", "ArrowDown"],
    jump: [" "],
    shoot: ["f"],
  },
});

const pointer = createPointerInput({ target: canvas });
const gamepad = createGamepadInput();

function gatherInput(): MyInput {
  const keys = keyboard.getState();
  const mouse = pointer.getState();
  const pad = gamepad.getState();

  // Combine movement: keyboard OR gamepad
  let moveX = 0, moveY = 0;

  if (pad.connected) {
    moveX = pad.leftStick.x;
    moveY = pad.leftStick.y;
  } else {
    if (keys.left) moveX -= 1;
    if (keys.right) moveX += 1;
    if (keys.up) moveY -= 1;
    if (keys.down) moveY += 1;
  }

  // Jump: keyboard OR gamepad A
  const jump = keys.jump || (pad.connected && pad.buttons.a);

  // Aim: mouse OR right stick
  const aimX = pad.connected && Math.abs(pad.rightStick.x) > 0.1
    ? pad.rightStick.x * 400  // Convert to world units
    : mouse.world.x;
  const aimY = pad.connected && Math.abs(pad.rightStick.y) > 0.1
    ? pad.rightStick.y * 400
    : mouse.world.y;

  // Shoot: left click OR right trigger OR keyboard
  const shoot = pointer.wasJustPressed(MouseButton.Left)
    || (pad.connected && pad.shoulders.rightTrigger > 0.5)
    || keys.shoot;

  return { moveX, moveY, jump, shoot, aimX, aimY, timestamp: Date.now() };
}

// At end of frame
pointer.clearJustPressed();
```
