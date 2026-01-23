import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createPointerInput, MouseButton } from "./pointer.js";

describe("createPointerInput", () => {
  // Mock canvas element
  let mockCanvas: HTMLCanvasElement;
  let mousemoveHandler: ((e: MouseEvent) => void) | null = null;
  let mousedownHandler: ((e: MouseEvent) => void) | null = null;
  let mouseupHandler: ((e: MouseEvent) => void) | null = null;

  beforeEach(() => {
    mockCanvas = {
      width: 800,
      height: 600,
      clientWidth: 800,
      clientHeight: 600,
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
      }),
      addEventListener: mock((type: string, handler: (e: MouseEvent) => void) => {
        if (type === "mousemove") mousemoveHandler = handler;
        if (type === "mousedown") mousedownHandler = handler;
        if (type === "mouseup") mouseupHandler = handler;
      }),
      removeEventListener: mock(() => {}),
    } as unknown as HTMLCanvasElement;
  });

  afterEach(() => {
    mousemoveHandler = null;
    mousedownHandler = null;
    mouseupHandler = null;
  });

  const createMouseEvent = (
    clientX: number,
    clientY: number,
    button = 0,
  ): MouseEvent => {
    return { clientX, clientY, button } as MouseEvent;
  };

  test("should create pointer input", () => {
    const pointer = createPointerInput({ target: mockCanvas });

    expect(pointer).toBeDefined();
    expect(pointer.getState).toBeDefined();
    expect(pointer.getWorldPosition).toBeDefined();
    expect(pointer.isButtonDown).toBeDefined();
    expect(pointer.destroy).toBeDefined();

    pointer.destroy();
  });

  test("getState should return initial state", () => {
    const pointer = createPointerInput({ target: mockCanvas });
    const state = pointer.getState();

    expect(state.screen.x).toBe(0);
    expect(state.screen.y).toBe(0);
    expect(state.buttons.left).toBe(false);
    expect(state.buttons.middle).toBe(false);
    expect(state.buttons.right).toBe(false);

    pointer.destroy();
  });

  test("should track mouse position", () => {
    const pointer = createPointerInput({ target: mockCanvas });

    // Simulate mouse move to center
    if (mousemoveHandler) {
      mousemoveHandler(createMouseEvent(400, 300));
    }

    const state = pointer.getState();
    expect(state.screen.x).toBe(400);
    expect(state.screen.y).toBe(300);

    pointer.destroy();
  });

  test("should convert to world coordinates (default: center origin)", () => {
    const pointer = createPointerInput({ target: mockCanvas });

    // Move to canvas center
    if (mousemoveHandler) {
      mousemoveHandler(createMouseEvent(400, 300));
    }

    const world = pointer.getWorldPosition();
    // Center of 800x600 canvas = (400, 300)
    // World coords with center origin = (0, 0)
    expect(world.x).toBe(0);
    expect(world.y).toBe(0);

    // Move to top-left
    if (mousemoveHandler) {
      mousemoveHandler(createMouseEvent(0, 0));
    }

    const topLeft = pointer.getWorldPosition();
    expect(topLeft.x).toBe(-400);
    expect(topLeft.y).toBe(-300);

    pointer.destroy();
  });

  test("should use custom world coordinate transform", () => {
    const pointer = createPointerInput({
      target: mockCanvas,
      // Custom transform: no offset (screen coords = world coords)
      toWorldCoords: (x, y) => ({ x, y }),
    });

    if (mousemoveHandler) {
      mousemoveHandler(createMouseEvent(100, 200));
    }

    const world = pointer.getWorldPosition();
    expect(world.x).toBe(100);
    expect(world.y).toBe(200);

    pointer.destroy();
  });

  test("should track mouse button state", () => {
    const pointer = createPointerInput({ target: mockCanvas });

    // Press left button
    if (mousedownHandler) {
      mousedownHandler(createMouseEvent(400, 300, MouseButton.Left));
    }

    expect(pointer.isButtonDown(MouseButton.Left)).toBe(true);
    expect(pointer.isButtonDown(MouseButton.Right)).toBe(false);

    // Release left button
    if (mouseupHandler) {
      mouseupHandler(createMouseEvent(400, 300, MouseButton.Left));
    }

    expect(pointer.isButtonDown(MouseButton.Left)).toBe(false);

    pointer.destroy();
  });

  test("should track just pressed state", () => {
    const pointer = createPointerInput({ target: mockCanvas });

    // Initially not just pressed
    expect(pointer.wasJustPressed(MouseButton.Left)).toBe(false);

    // Press
    if (mousedownHandler) {
      mousedownHandler(createMouseEvent(400, 300, MouseButton.Left));
    }

    expect(pointer.wasJustPressed(MouseButton.Left)).toBe(true);

    // Clear just pressed
    pointer.clearJustPressed();
    expect(pointer.wasJustPressed(MouseButton.Left)).toBe(false);

    // Button is still down though
    expect(pointer.isButtonDown(MouseButton.Left)).toBe(true);

    pointer.destroy();
  });

  test("getState should return complete state object", () => {
    const pointer = createPointerInput({ target: mockCanvas });

    if (mousemoveHandler) {
      mousemoveHandler(createMouseEvent(200, 150));
    }
    if (mousedownHandler) {
      mousedownHandler(createMouseEvent(200, 150, MouseButton.Left));
    }

    const state = pointer.getState();

    expect(state.screen.x).toBe(200);
    expect(state.screen.y).toBe(150);
    expect(state.world.x).toBe(-200); // 200 - 400
    expect(state.world.y).toBe(-150); // 150 - 300
    expect(state.buttons.left).toBe(true);
    expect(state.buttons.middle).toBe(false);
    expect(state.buttons.right).toBe(false);

    pointer.destroy();
  });

  test("MouseButton constants should have correct values", () => {
    expect(MouseButton.Left).toBe(0);
    expect(MouseButton.Middle).toBe(1);
    expect(MouseButton.Right).toBe(2);
  });
});
