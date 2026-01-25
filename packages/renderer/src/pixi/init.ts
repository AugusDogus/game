import { Application, Container } from "pixi.js";
import { Viewport } from "pixi-viewport";

/** Options for initializing a PixiJS application */
export interface PixiInitOptions {
  /** The canvas element to render to */
  canvas: HTMLCanvasElement;
  /** Background color (hex number) */
  backgroundColor?: number;
  /** Whether to enable antialiasing */
  antialias?: boolean;
  /** Initial width */
  width?: number;
  /** Initial height */
  height?: number;
}

/** Result of PixiJS initialization */
export interface PixiInitResult {
  /** The PixiJS Application instance */
  app: Application;
  /** The viewport for camera control */
  viewport: Viewport;
  /** Container with Y-axis flipped for Y-up coordinate system */
  worldFlipContainer: Container;
}

/** Default background color (slate-950) */
const DEFAULT_BACKGROUND_COLOR = 0x0f172a;

/**
 * Initialize a PixiJS application with a viewport configured for Y-up coordinates.
 * 
 * The returned worldFlipContainer has scale.y = -1, so all children use Y-up
 * coordinates naturally. Add your game world objects to this container.
 * 
 * @example
 * ```typescript
 * const { app, viewport, worldFlipContainer } = await initPixiApp({
 *   canvas: myCanvas,
 *   backgroundColor: 0x1a1a2e,
 * });
 * 
 * // Add game objects to worldFlipContainer
 * worldFlipContainer.addChild(myGameWorld);
 * ```
 */
export async function initPixiApp(options: PixiInitOptions): Promise<PixiInitResult> {
  const {
    canvas,
    backgroundColor = DEFAULT_BACKGROUND_COLOR,
    antialias = true,
    width = canvas.width || 800,
    height = canvas.height || 600,
  } = options;

  // Create and initialize the application
  const app = new Application();
  await app.init({
    canvas,
    antialias,
    backgroundColor,
    width,
    height,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });

  // Create viewport for camera control
  const viewport = new Viewport({
    screenWidth: width,
    screenHeight: height,
    worldWidth: width * 2,
    worldHeight: height * 2,
    events: app.renderer.events,
  });

  app.stage.addChild(viewport);

  // Create a container that flips Y axis for world-space rendering
  // This makes the entire game world use Y-up coordinates
  const worldFlipContainer = new Container();
  worldFlipContainer.scale.y = -1;
  viewport.addChild(worldFlipContainer);

  // Center the viewport on world origin
  viewport.moveCenter(0, 0);

  return { app, viewport, worldFlipContainer };
}

/**
 * Resize a PixiJS application and its viewport.
 */
export function resizePixiApp(
  app: Application,
  viewport: Viewport,
  width: number,
  height: number,
): void {
  app.renderer.resize(width, height);
  viewport.resize(width, height);
  viewport.moveCenter(0, 0);
}

/**
 * Destroy a PixiJS application and clean up all resources.
 */
export function destroyPixiApp(app: Application): void {
  app.destroy(true, { children: true, texture: true });
}
