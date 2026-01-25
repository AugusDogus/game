/**
 * @game/physics2d
 *
 * 2D physics layer built on Rapier for deterministic, cross-platform physics.
 * Implements raycast-based character controller with slope handling.
 */

// Core types
export type {
  Vector2,
  RaycastHit,
  CollisionInfo,
  ControllerConfig,
  ColliderOptions,
} from "./types.js";

export { DEFAULT_CONTROLLER_CONFIG } from "./types.js";

// Math utilities
export {
  vec2,
  vec2Zero,
  vec2Up,
  vec2Down,
  vec2Left,
  vec2Right,
  add,
  sub,
  scale,
  dot,
  magnitude,
  normalize,
  angleBetweenVectors,
  degToRad,
  radToDeg,
  lerp,
  smoothDamp,
} from "./math.js";

// Physics world
export { PhysicsWorld, initPhysics } from "./world.js";

// Character controller
export { CharacterController, createCollisionInfo, resetCollisionInfo } from "./controller.js";
