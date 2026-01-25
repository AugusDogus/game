/**
 * Vector math utilities for 2D physics.
 *
 * All functions are pure - they return new values without mutating inputs.
 * Uses Y-up coordinate system.
 */

import type { Vector2 } from "./types.js";

// =============================================================================
// Vector Construction
// =============================================================================

/**
 * Create a new Vector2.
 */
export const vec2 = (x: number, y: number): Vector2 => ({ x, y });

/** Zero vector (0, 0) */
export const vec2Zero: Vector2 = { x: 0, y: 0 };

/** Up vector (0, 1) - Y-up coordinate system */
export const vec2Up: Vector2 = { x: 0, y: 1 };

/** Down vector (0, -1) */
export const vec2Down: Vector2 = { x: 0, y: -1 };

/** Left vector (-1, 0) */
export const vec2Left: Vector2 = { x: -1, y: 0 };

/** Right vector (1, 0) */
export const vec2Right: Vector2 = { x: 1, y: 0 };

// =============================================================================
// Vector Operations
// =============================================================================

/**
 * Add two vectors.
 */
export const add = (a: Vector2, b: Vector2): Vector2 => ({
  x: a.x + b.x,
  y: a.y + b.y,
});

/**
 * Subtract vector b from vector a.
 */
export const sub = (a: Vector2, b: Vector2): Vector2 => ({
  x: a.x - b.x,
  y: a.y - b.y,
});

/**
 * Scale a vector by a scalar.
 */
export const scale = (v: Vector2, s: number): Vector2 => ({
  x: v.x * s,
  y: v.y * s,
});

/**
 * Dot product of two vectors.
 */
export const dot = (a: Vector2, b: Vector2): number => a.x * b.x + a.y * b.y;

/**
 * Magnitude (length) of a vector.
 */
export const magnitude = (v: Vector2): number => Math.sqrt(v.x * v.x + v.y * v.y);

/**
 * Normalize a vector to unit length.
 * Returns zero vector if input has zero length.
 */
export const normalize = (v: Vector2): Vector2 => {
  const mag = magnitude(v);
  return mag > 0 ? scale(v, 1 / mag) : vec2Zero;
};

// =============================================================================
// Angle Calculations
// =============================================================================

/**
 * Calculate angle between two vectors in degrees.
 * Returns value in [0, 180].
 */
export const angleBetweenVectors = (a: Vector2, b: Vector2): number => {
  const normA = normalize(a);
  const normB = normalize(b);
  // dot(a, b) = |a| * |b| * cos(angle), but we normalized so |a| = |b| = 1
  const cosAngle = dot(normA, normB);
  // Clamp to handle floating point errors
  const clampedCos = Math.max(-1, Math.min(1, cosAngle));
  return Math.acos(clampedCos) * (180 / Math.PI);
};

/**
 * Convert degrees to radians.
 */
export const degToRad = (degrees: number): number => degrees * (Math.PI / 180);

/**
 * Convert radians to degrees.
 */
export const radToDeg = (radians: number): number => radians * (180 / Math.PI);

// =============================================================================
// Interpolation
// =============================================================================

/**
 * Linear interpolation between two values.
 * @param a Start value
 * @param b End value
 * @param t Interpolation factor (0 = a, 1 = b)
 */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Attempt to replicate Unity's Mathf.SmoothDamp for velocity smoothing.
 *
 * This provides smooth, critically-damped interpolation towards a target value.
 * Useful for smooth character movement acceleration/deceleration.
 *
 * Based on Game Programming Gems 4, Chapter 1.10
 *
 * @param current Current value
 * @param target Target value
 * @param currentVelocity Current velocity (will be modified)
 * @param smoothTime Approximate time to reach target
 * @param deltaTime Time since last frame
 * @returns Tuple of [newValue, newVelocity]
 */
export const smoothDamp = (
  current: number,
  target: number,
  currentVelocity: number,
  smoothTime: number,
  deltaTime: number,
): [number, number] => {
  // Prevent division by zero
  const time = Math.max(0.0001, smoothTime);
  const omega = 2 / time;
  const x = omega * deltaTime;
  // Approximation of exp(-omega * deltaTime)
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

  const change = current - target;
  const temp = (currentVelocity + omega * change) * deltaTime;
  const newVelocity = (currentVelocity - omega * temp) * exp;
  const newValue = target + (change + temp) * exp;

  return [newValue, newVelocity];
};
