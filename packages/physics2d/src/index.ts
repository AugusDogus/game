/**
 * @game/physics2d
 *
 * Stateless 2D physics for deterministic, cross-platform collision detection.
 * Implements raycast-based character controller with slope handling.
 *
 * Key design: All collision detection is stateless. Colliders are passed
 * as function arguments, not stored in a world object. This is ideal for
 * netcode where deterministic simulation is required.
 */

// Core types
export type {
  Vector2,
  Collider,
  RaycastHit,
  CollisionInfo,
  ControllerConfig,
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

// Stateless raycasting
export {
  raycast,
  raycastAll,
  isColliderOneWay,
  getColliderTag,
} from "./world.js";

// Character controller
export { CharacterController, createCollisionInfo, resetCollisionInfo } from "./controller.js";
