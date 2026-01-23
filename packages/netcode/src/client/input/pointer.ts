/**
 * Pointer (mouse/touch) input helper for game controls.
 *
 * @module client/input/pointer
 */

/**
 * 2D position in world or screen coordinates.
 */
export interface Position {
  x: number;
  y: number;
}

/**
 * Mouse button constants.
 */
export const MouseButton = {
  Left: 0,
  Middle: 1,
  Right: 2,
  Back: 3,
  Forward: 4,
} as const;

export type MouseButtonType = (typeof MouseButton)[keyof typeof MouseButton];

/**
 * Configuration for pointer input.
 */
export interface PointerInputConfig {
  /** The canvas or element to track pointer events on */
  target: HTMLElement;
  /**
   * Transform function to convert screen coordinates to world coordinates.
   * If not provided, returns raw canvas-relative coordinates.
   *
   * @param screenX - X position relative to canvas (0 = left edge)
   * @param screenY - Y position relative to canvas (0 = top edge)
   * @param canvasWidth - Current canvas width
   * @param canvasHeight - Current canvas height
   * @returns World coordinates
   */
  toWorldCoords?: (
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number,
  ) => Position;
  /**
   * Whether to prevent context menu on right-click.
   * Default: true
   */
  preventContextMenu?: boolean;
}

/**
 * Current state of the pointer.
 */
export interface PointerState {
  /** Current position in screen coordinates (relative to canvas) */
  screen: Position;
  /** Current position in world coordinates (if transform provided) */
  world: Position;
  /** Which buttons are currently pressed */
  buttons: {
    left: boolean;
    middle: boolean;
    right: boolean;
  };
  /** Whether pointer is currently over the target element */
  isOver: boolean;
}

/**
 * Handle returned by createPointerInput.
 */
export interface PointerInputHandle {
  /** Get the current pointer state */
  getState(): PointerState;
  /** Get current position in world coordinates */
  getWorldPosition(): Position;
  /** Get current position in screen coordinates */
  getScreenPosition(): Position;
  /** Check if a specific button is pressed */
  isButtonDown(button: MouseButtonType): boolean;
  /** Check if left mouse button was just pressed this frame (for single-shot actions) */
  wasJustPressed(button: MouseButtonType): boolean;
  /** Clear the "just pressed" state (call at end of frame) */
  clearJustPressed(): void;
  /** Check if pointer is over the target element */
  isOverTarget(): boolean;
  /** Clean up event listeners */
  destroy(): void;
}

/**
 * Default transform: canvas center is world origin.
 */
const defaultToWorldCoords = (
  screenX: number,
  screenY: number,
  canvasWidth: number,
  canvasHeight: number,
): Position => ({
  x: screenX - canvasWidth / 2,
  y: screenY - canvasHeight / 2,
});

/**
 * Create a pointer input handler for mouse/touch events.
 *
 * @example
 * ```ts
 * import { createPointerInput, MouseButton } from "@game/netcode/client/input";
 *
 * const pointer = createPointerInput({
 *   target: canvas,
 *   // Optional: custom world coordinate transform
 *   toWorldCoords: (screenX, screenY, width, height) => ({
 *     x: screenX - width / 2,
 *     y: screenY - height / 2,
 *   }),
 * });
 *
 * // In your game loop:
 * function update() {
 *   const state = pointer.getState();
 *   console.log(state.world); // { x: 150, y: -50 }
 *
 *   // Check for shooting
 *   if (pointer.wasJustPressed(MouseButton.Left)) {
 *     shoot(state.world.x, state.world.y);
 *   }
 *
 *   // Clear at end of frame
 *   pointer.clearJustPressed();
 * }
 *
 * // Clean up when done:
 * pointer.destroy();
 * ```
 */
export function createPointerInput(config: PointerInputConfig): PointerInputHandle {
  const target = config.target;
  const toWorldCoords = config.toWorldCoords ?? defaultToWorldCoords;
  const preventContextMenu = config.preventContextMenu ?? true;

  // State
  let screenX = 0;
  let screenY = 0;
  let isOver = false;
  const buttonsDown = new Set<MouseButtonType>();
  const justPressed = new Set<MouseButtonType>();

  // Get canvas dimensions (works for canvas or other elements)
  const getDimensions = (): { width: number; height: number } => {
    // Check for canvas-specific width/height properties
    const targetWithSize = target as { width?: number; height?: number };
    if (typeof targetWithSize.width === "number" && typeof targetWithSize.height === "number") {
      return { width: targetWithSize.width, height: targetWithSize.height };
    }
    return { width: target.clientWidth, height: target.clientHeight };
  };

  // Update screen position from event
  const updatePosition = (e: MouseEvent | Touch) => {
    const rect = target.getBoundingClientRect();
    const dims = getDimensions();

    // Scale for canvas resolution vs display size
    const scaleX = dims.width / rect.width;
    const scaleY = dims.height / rect.height;

    screenX = (e.clientX - rect.left) * scaleX;
    screenY = (e.clientY - rect.top) * scaleY;
  };

  // Event handlers
  const handleMouseMove = (e: MouseEvent) => {
    updatePosition(e);
  };

  const handleMouseDown = (e: MouseEvent) => {
    updatePosition(e);
    const button = e.button as MouseButtonType;
    if (!buttonsDown.has(button)) {
      justPressed.add(button);
    }
    buttonsDown.add(button);
  };

  const handleMouseUp = (e: MouseEvent) => {
    buttonsDown.delete(e.button as MouseButtonType);
  };

  const handleMouseEnter = () => {
    isOver = true;
  };

  const handleMouseLeave = () => {
    isOver = false;
    // Optionally release buttons when leaving - uncomment if desired:
    // buttonsDown.clear();
  };

  const handleContextMenu = (e: MouseEvent) => {
    if (preventContextMenu) {
      e.preventDefault();
    }
  };

  // Touch handlers (treat first touch as left mouse button)
  const handleTouchStart = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      updatePosition(touch);
      if (!buttonsDown.has(MouseButton.Left)) {
        justPressed.add(MouseButton.Left);
      }
      buttonsDown.add(MouseButton.Left);
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      updatePosition(touch);
    }
  };

  const handleTouchEnd = () => {
    buttonsDown.delete(MouseButton.Left);
  };

  // Handle window blur - release all buttons
  const handleBlur = () => {
    buttonsDown.clear();
  };

  // Attach listeners
  target.addEventListener("mousemove", handleMouseMove);
  target.addEventListener("mousedown", handleMouseDown);
  target.addEventListener("mouseup", handleMouseUp);
  target.addEventListener("mouseenter", handleMouseEnter);
  target.addEventListener("mouseleave", handleMouseLeave);
  target.addEventListener("contextmenu", handleContextMenu);
  target.addEventListener("touchstart", handleTouchStart);
  target.addEventListener("touchmove", handleTouchMove);
  target.addEventListener("touchend", handleTouchEnd);
  target.addEventListener("touchcancel", handleTouchEnd);

  if (typeof window !== "undefined") {
    // Listen for mouseup on window to catch releases outside target
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("blur", handleBlur);
  }

  return {
    getState(): PointerState {
      const dims = getDimensions();
      const world = toWorldCoords(screenX, screenY, dims.width, dims.height);

      return {
        screen: { x: screenX, y: screenY },
        world,
        buttons: {
          left: buttonsDown.has(MouseButton.Left),
          middle: buttonsDown.has(MouseButton.Middle),
          right: buttonsDown.has(MouseButton.Right),
        },
        isOver,
      };
    },

    getWorldPosition(): Position {
      const dims = getDimensions();
      return toWorldCoords(screenX, screenY, dims.width, dims.height);
    },

    getScreenPosition(): Position {
      return { x: screenX, y: screenY };
    },

    isButtonDown(button: MouseButtonType): boolean {
      return buttonsDown.has(button);
    },

    wasJustPressed(button: MouseButtonType): boolean {
      return justPressed.has(button);
    },

    clearJustPressed(): void {
      justPressed.clear();
    },

    isOverTarget(): boolean {
      return isOver;
    },

    destroy(): void {
      target.removeEventListener("mousemove", handleMouseMove);
      target.removeEventListener("mousedown", handleMouseDown);
      target.removeEventListener("mouseup", handleMouseUp);
      target.removeEventListener("mouseenter", handleMouseEnter);
      target.removeEventListener("mouseleave", handleMouseLeave);
      target.removeEventListener("contextmenu", handleContextMenu);
      target.removeEventListener("touchstart", handleTouchStart);
      target.removeEventListener("touchmove", handleTouchMove);
      target.removeEventListener("touchend", handleTouchEnd);
      target.removeEventListener("touchcancel", handleTouchEnd);

      if (typeof window !== "undefined") {
        window.removeEventListener("mouseup", handleMouseUp);
        window.removeEventListener("blur", handleBlur);
      }

      buttonsDown.clear();
      justPressed.clear();
    },
  };
}
