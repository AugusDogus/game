// Types
export type {
  PositionHistoryEntry,
  DebugData,
  BaseRenderOptions,
} from "./types.js";

export { DEBUG_COLORS } from "./types.js";

// PixiJS helpers
export {
  initPixiApp,
  resizePixiApp,
  destroyPixiApp,
  type PixiInitOptions,
  type PixiInitResult,
} from "./pixi/index.js";
