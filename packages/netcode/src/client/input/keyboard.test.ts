import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createKeyboardInput, type KeyBindings } from "./keyboard.js";

describe("createKeyboardInput", () => {
  // Mock event target for testing
  let mockTarget: EventTarget;
  let keydownHandler: ((e: Event) => void) | null = null;
  let keyupHandler: ((e: Event) => void) | null = null;

  beforeEach(() => {
    mockTarget = {
      addEventListener: mock((type: string, handler: (e: Event) => void) => {
        if (type === "keydown") keydownHandler = handler;
        if (type === "keyup") keyupHandler = handler;
      }),
      removeEventListener: mock(() => {}),
    } as unknown as EventTarget;
  });

  afterEach(() => {
    keydownHandler = null;
    keyupHandler = null;
  });

  const simulateKeyDown = (key: string) => {
    if (keydownHandler) {
      keydownHandler({ key, preventDefault: () => {} } as unknown as Event);
    }
  };

  const simulateKeyUp = (key: string) => {
    if (keyupHandler) {
      keyupHandler({ key, preventDefault: () => {} } as unknown as Event);
    }
  };

  test("should create keyboard input with bindings", () => {
    const bindings: KeyBindings<"left" | "right" | "jump"> = {
      left: ["a", "ArrowLeft"],
      right: ["d", "ArrowRight"],
      jump: [" "],
    };

    const keyboard = createKeyboardInput({ bindings, target: mockTarget });

    expect(keyboard).toBeDefined();
    expect(keyboard.getState).toBeDefined();
    expect(keyboard.isPressed).toBeDefined();
    expect(keyboard.destroy).toBeDefined();

    keyboard.destroy();
  });

  test("getState should return all false initially", () => {
    const bindings: KeyBindings<"left" | "right"> = {
      left: ["a"],
      right: ["d"],
    };

    const keyboard = createKeyboardInput({ bindings, target: mockTarget });
    const state = keyboard.getState();

    expect(state.left).toBe(false);
    expect(state.right).toBe(false);

    keyboard.destroy();
  });

  test("should detect key press", () => {
    const bindings: KeyBindings<"jump"> = {
      jump: [" "],
    };

    const keyboard = createKeyboardInput({ bindings, target: mockTarget });

    simulateKeyDown(" ");

    expect(keyboard.isPressed("jump")).toBe(true);
    expect(keyboard.getState().jump).toBe(true);

    keyboard.destroy();
  });

  test("should detect key release", () => {
    const bindings: KeyBindings<"jump"> = {
      jump: [" "],
    };

    const keyboard = createKeyboardInput({ bindings, target: mockTarget });

    simulateKeyDown(" ");
    expect(keyboard.isPressed("jump")).toBe(true);

    simulateKeyUp(" ");
    expect(keyboard.isPressed("jump")).toBe(false);

    keyboard.destroy();
  });

  test("should handle multiple keys for same action", () => {
    const bindings: KeyBindings<"left"> = {
      left: ["a", "ArrowLeft"],
    };

    const keyboard = createKeyboardInput({ bindings, target: mockTarget });

    // Press 'a'
    simulateKeyDown("a");
    expect(keyboard.isPressed("left")).toBe(true);

    // Release 'a', press 'ArrowLeft'
    simulateKeyUp("a");
    simulateKeyDown("ArrowLeft");
    expect(keyboard.isPressed("left")).toBe(true);

    // Release both
    simulateKeyUp("ArrowLeft");
    expect(keyboard.isPressed("left")).toBe(false);

    keyboard.destroy();
  });

  test("should handle case-insensitive keys", () => {
    const bindings: KeyBindings<"jump"> = {
      jump: ["w"],
    };

    const keyboard = createKeyboardInput({ bindings, target: mockTarget });

    // Press uppercase W (shift+w)
    simulateKeyDown("W");
    expect(keyboard.isPressed("jump")).toBe(true);

    keyboard.destroy();
  });

  test("isKeyDown should check raw key state", () => {
    const bindings: KeyBindings<"action"> = {
      action: ["f"],
    };

    const keyboard = createKeyboardInput({ bindings, target: mockTarget });

    simulateKeyDown("g"); // Not bound to action
    expect(keyboard.isPressed("action")).toBe(false);
    expect(keyboard.isKeyDown("g")).toBe(true);

    keyboard.destroy();
  });

  test("getPressedKeys should return all pressed keys", () => {
    const bindings: KeyBindings<"left" | "right"> = {
      left: ["a"],
      right: ["d"],
    };

    const keyboard = createKeyboardInput({ bindings, target: mockTarget });

    simulateKeyDown("a");
    simulateKeyDown("w");
    simulateKeyDown("d");

    const pressed = keyboard.getPressedKeys();
    expect(pressed.has("a")).toBe(true);
    expect(pressed.has("w")).toBe(true);
    expect(pressed.has("d")).toBe(true);
    expect(pressed.size).toBe(3);

    keyboard.destroy();
  });

  test("setBindings should update bindings at runtime", () => {
    const bindings: KeyBindings<"action"> = {
      action: ["f"],
    };

    const keyboard = createKeyboardInput({ bindings, target: mockTarget });

    simulateKeyDown("g");
    expect(keyboard.isPressed("action")).toBe(false);

    // Change binding to 'g'
    keyboard.setBindings({ action: ["g"] });
    expect(keyboard.isPressed("action")).toBe(true);

    keyboard.destroy();
  });

  test("should handle simultaneous key presses", () => {
    const bindings: KeyBindings<"left" | "right" | "jump"> = {
      left: ["a"],
      right: ["d"],
      jump: [" "],
    };

    const keyboard = createKeyboardInput({ bindings, target: mockTarget });

    simulateKeyDown("a");
    simulateKeyDown(" ");

    const state = keyboard.getState();
    expect(state.left).toBe(true);
    expect(state.right).toBe(false);
    expect(state.jump).toBe(true);

    keyboard.destroy();
  });
});
