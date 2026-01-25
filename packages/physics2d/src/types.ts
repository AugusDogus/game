/**
 * Core types for @game/physics2d
 *
 * Uses Y-up coordinate system (0,0 at bottom-left, positive Y is up).
 * This matches physics conventions and common game engine defaults.
 */

/**
 * 2D vector for positions, velocities, directions.
 * Immutable by convention - all operations return new vectors.
 */
export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

/**
 * A static collider (AABB) for collision detection.
 * Represents platforms, walls, floors, etc.
 */
export interface Collider {
  /** Center position of the collider */
  readonly position: Vector2;
  /** Half-width and half-height of the collider */
  readonly halfExtents: Vector2;
  /** If true, this is a one-way platform (can pass through from below) */
  readonly oneWay?: boolean;
  /** User-defined tag for game-specific logic */
  readonly tag?: string;
}

/**
 * Result of a successful raycast hit.
 */
export interface RaycastHit {
  /** World position of the hit */
  readonly point: Vector2;
  /** Surface normal at hit point (points away from surface) */
  readonly normal: Vector2;
  /** Distance from ray origin to hit point */
  readonly distance: number;
  /** Index of the collider that was hit in the colliders array */
  readonly colliderIndex: number;
}

/**
 * Collision state after a character controller move.
 * Tracks what surfaces the controller is touching and slope information.
 */
export interface CollisionInfo {
  /** Touching ceiling */
  above: boolean;
  /** Touching ground */
  below: boolean;
  /** Touching wall on left */
  left: boolean;
  /** Touching wall on right */
  right: boolean;

  /** Currently climbing a slope */
  climbingSlope: boolean;
  /** Currently descending a slope */
  descendingSlope: boolean;
  /** Sliding down a slope that's too steep */
  slidingDownMaxSlope: boolean;

  /** Current slope angle in degrees (0 = flat ground) */
  slopeAngle: number;
  /** Previous frame's slope angle (for detecting slope transitions) */
  slopeAngleOld: number;
  /** Normal vector of the current slope surface */
  slopeNormal: Vector2;

  /** Direction the controller is facing (1 = right, -1 = left) */
  faceDir: 1 | -1;

  /** Currently falling through a one-way platform */
  fallingThroughPlatform: boolean;
  /** Timer for falling through platform cooldown */
  fallingThroughPlatformTimer: number;
}

/**
 * Configuration for the character controller.
 */
export interface ControllerConfig {
  /**
   * Small inset from collider edges to prevent getting stuck.
   * Rays are cast from slightly inside the collider bounds.
   * Default: 0.015
   */
  readonly skinWidth: number;

  /**
   * Maximum angle (in degrees) that can be climbed as a slope.
   * Surfaces steeper than this are treated as walls.
   * Default: 80
   */
  readonly maxSlopeAngle: number;

  /**
   * Number of rays to cast horizontally (for wall detection).
   * More rays = more accurate but slower.
   * Default: 4
   */
  readonly horizontalRayCount: number;

  /**
   * Number of rays to cast vertically (for ground/ceiling detection).
   * More rays = more accurate but slower.
   * Default: 4
   */
  readonly verticalRayCount: number;
}

/**
 * Default configuration for the character controller.
 */
export const DEFAULT_CONTROLLER_CONFIG: ControllerConfig = {
  skinWidth: 0.015,
  maxSlopeAngle: 80,
  horizontalRayCount: 4,
  verticalRayCount: 4,
};

