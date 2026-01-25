/**
 * CharacterController - Raycast-based 2D character controller.
 *
 * Implements Sebastian Lague's collision detection pattern:
 * - Cast multiple rays in the direction of movement
 * - Handle horizontal and vertical movement separately
 * - Support slope climbing and descending
 * - Support one-way platforms
 *
 * This controller does NOT handle gravity, jumping, or game-specific logic.
 * Those belong in the game layer (e.g., player.ts in the platformer example).
 */

import type { PhysicsWorld } from "./world.js";
import type { Vector2, CollisionInfo, ControllerConfig } from "./types.js";
import { DEFAULT_CONTROLLER_CONFIG } from "./types.js";
import { vec2, vec2Zero, vec2Up, angleBetweenVectors, degToRad } from "./math.js";

// =============================================================================
// Collision Info Helpers
// =============================================================================

/**
 * Create a fresh CollisionInfo with default values.
 */
export function createCollisionInfo(): CollisionInfo {
  return {
    above: false,
    below: false,
    left: false,
    right: false,
    climbingSlope: false,
    descendingSlope: false,
    slidingDownMaxSlope: false,
    slopeAngle: 0,
    slopeAngleOld: 0,
    slopeNormal: vec2Zero,
    faceDir: 1,
    fallingThroughPlatform: false,
    fallingThroughPlatformTimer: 0,
  };
}

/**
 * Reset collision info for a new frame.
 * Preserves faceDir and slope angle history.
 */
export function resetCollisionInfo(info: CollisionInfo): CollisionInfo {
  return {
    ...info,
    above: false,
    below: false,
    left: false,
    right: false,
    climbingSlope: false,
    descendingSlope: false,
    slidingDownMaxSlope: false,
    slopeAngleOld: info.slopeAngle,
    slopeAngle: 0,
    slopeNormal: vec2Zero,
  };
}

// =============================================================================
// Raycast Origins
// =============================================================================

interface RaycastOrigins {
  topLeft: Vector2;
  topRight: Vector2;
  bottomLeft: Vector2;
  bottomRight: Vector2;
}

/**
 * Calculate raycast origins from position and size, inset by skinWidth.
 */
function updateRaycastOrigins(
  position: Vector2,
  halfSize: Vector2,
  skinWidth: number,
): RaycastOrigins {
  // Calculate bounds inset by skinWidth
  const left = position.x - halfSize.x + skinWidth;
  const right = position.x + halfSize.x - skinWidth;
  const bottom = position.y - halfSize.y + skinWidth;
  const top = position.y + halfSize.y - skinWidth;

  return {
    bottomLeft: vec2(left, bottom),
    bottomRight: vec2(right, bottom),
    topLeft: vec2(left, top),
    topRight: vec2(right, top),
  };
}

// =============================================================================
// Character Controller
// =============================================================================

/**
 * Raycast-based character controller.
 *
 * Uses Rapier for raycasting but implements custom collision logic
 * following Sebastian Lague's pattern for tight, responsive controls.
 */
export class CharacterController {
  private world: PhysicsWorld;
  private config: ControllerConfig;

  /** Current position (center of character) */
  public position: Vector2;

  /** Half-width and half-height of character bounds */
  public halfSize: Vector2;

  /** Collision state from the last move */
  public collisions: CollisionInfo;

  /** Spacing between horizontal rays */
  private horizontalRaySpacing: number = 0;

  /** Spacing between vertical rays */
  private verticalRaySpacing: number = 0;

  constructor(
    world: PhysicsWorld,
    options: {
      position: Vector2;
      halfSize: Vector2;
      config?: Partial<ControllerConfig>;
    },
  ) {
    this.world = world;
    this.position = options.position;
    this.halfSize = options.halfSize;
    this.config = { ...DEFAULT_CONTROLLER_CONFIG, ...options.config };
    this.collisions = createCollisionInfo();

    this.calculateRaySpacing();
  }

  /**
   * Calculate spacing between rays based on character size.
   */
  private calculateRaySpacing(): void {
    const boundsWidth = (this.halfSize.x - this.config.skinWidth) * 2;
    const boundsHeight = (this.halfSize.y - this.config.skinWidth) * 2;

    this.horizontalRaySpacing = boundsHeight / (this.config.horizontalRayCount - 1);
    this.verticalRaySpacing = boundsWidth / (this.config.verticalRayCount - 1);
  }

  /**
   * Move the character by the given velocity.
   *
   * This handles collision detection and resolution, including:
   * - Horizontal collisions (walls)
   * - Vertical collisions (ground, ceiling)
   * - Slope climbing and descending
   * - One-way platform handling
   *
   * @param velocity Desired movement velocity
   * @param deltaTime Time step (velocity is multiplied by this)
   * @param input Player input for one-way platform drop-through (y < 0 to drop)
   * @returns The actual movement that was applied
   */
  move(velocity: Vector2, deltaTime: number, input: Vector2 = vec2Zero): Vector2 {
    // Reset collision info for this frame
    this.collisions = resetCollisionInfo(this.collisions);

    // Calculate desired movement
    const moveAmount = {
      x: velocity.x * deltaTime,
      y: velocity.y * deltaTime,
    };

    // Update falling through platform timer
    if (this.collisions.fallingThroughPlatformTimer > 0) {
      this.collisions.fallingThroughPlatformTimer -= deltaTime;
      if (this.collisions.fallingThroughPlatformTimer <= 0) {
        this.collisions.fallingThroughPlatform = false;
      }
    }

    // Descend slope check (only when moving down)
    if (moveAmount.y < 0) {
      this.descendSlope(moveAmount);
    }

    // Update face direction
    if (moveAmount.x !== 0) {
      this.collisions.faceDir = moveAmount.x > 0 ? 1 : -1;
    }

    // Horizontal collisions (walls and slope climbing)
    if (moveAmount.x !== 0) {
      this.horizontalCollisions(moveAmount);
    }

    // Vertical collisions (ground and ceiling)
    if (moveAmount.y !== 0) {
      this.verticalCollisions(moveAmount, input);
    }

    // Apply the final movement
    this.position = vec2(this.position.x + moveAmount.x, this.position.y + moveAmount.y);

    return vec2(moveAmount.x, moveAmount.y);
  }

  /**
   * Handle horizontal collisions (walls and slope climbing).
   */
  private horizontalCollisions(moveAmount: { x: number; y: number }): void {
    const directionX = this.collisions.faceDir;
    let rayLength = Math.abs(moveAmount.x) + this.config.skinWidth;

    // If barely moving, still cast a minimum ray length to detect walls
    if (Math.abs(moveAmount.x) < this.config.skinWidth) {
      rayLength = 2 * this.config.skinWidth;
    }

    const origins = updateRaycastOrigins(this.position, this.halfSize, this.config.skinWidth);

    for (let i = 0; i < this.config.horizontalRayCount; i++) {
      // Start from bottom if moving right, from bottom if moving left
      const rayOrigin =
        directionX === -1
          ? vec2(origins.bottomLeft.x, origins.bottomLeft.y + i * this.horizontalRaySpacing)
          : vec2(origins.bottomRight.x, origins.bottomRight.y + i * this.horizontalRaySpacing);

      const hit = this.world.raycast(rayOrigin, vec2(directionX, 0), rayLength);

      if (hit) {
        // Skip if we're inside a collider (distance is 0)
        if (hit.distance === 0) {
          continue;
        }

        // Calculate slope angle from hit normal
        const slopeAngle = angleBetweenVectors(hit.normal, vec2Up);

        // First ray (bottom) checks for slope climbing
        if (i === 0 && slopeAngle <= this.config.maxSlopeAngle) {
          // If we were descending a slope, cancel it
          if (this.collisions.descendingSlope) {
            this.collisions.descendingSlope = false;
            // Reset moveAmount - we'll recalculate for climbing
          }

          // Distance to start of slope
          let distanceToSlopeStart = 0;
          if (slopeAngle !== this.collisions.slopeAngleOld) {
            distanceToSlopeStart = hit.distance - this.config.skinWidth;
            moveAmount.x -= distanceToSlopeStart * directionX;
          }

          this.climbSlope(moveAmount, slopeAngle, hit.normal);
          moveAmount.x += distanceToSlopeStart * directionX;
        }

        // If not climbing a slope, or slope is too steep (wall)
        if (!this.collisions.climbingSlope || slopeAngle > this.config.maxSlopeAngle) {
          moveAmount.x = (hit.distance - this.config.skinWidth) * directionX;
          rayLength = hit.distance;

          // If climbing a slope and hit a wall, adjust Y to stay on slope
          if (this.collisions.climbingSlope) {
            moveAmount.y =
              Math.tan(degToRad(this.collisions.slopeAngle)) * Math.abs(moveAmount.x);
          }

          this.collisions.left = directionX === -1;
          this.collisions.right = directionX === 1;
        }
      }
    }
  }

  /**
   * Handle vertical collisions (ground, ceiling, one-way platforms).
   */
  private verticalCollisions(moveAmount: { x: number; y: number }, input: Vector2): void {
    const directionY = Math.sign(moveAmount.y);
    let rayLength = Math.abs(moveAmount.y) + this.config.skinWidth;

    const origins = updateRaycastOrigins(this.position, this.halfSize, this.config.skinWidth);

    for (let i = 0; i < this.config.verticalRayCount; i++) {
      // Cast from the side we're moving towards
      const baseOrigin = directionY === -1 ? origins.bottomLeft : origins.topLeft;
      const rayOrigin = vec2(
        baseOrigin.x + i * this.verticalRaySpacing + moveAmount.x,
        baseOrigin.y,
      );

      const hit = this.world.raycast(rayOrigin, vec2(0, directionY), rayLength);

      if (hit) {
        // One-way platform handling
        if (this.world.isOneWay(hit.colliderHandle)) {
          // Skip if moving up through platform
          if (directionY === 1) {
            continue;
          }
          // Skip if we're inside the platform (distance is 0)
          if (hit.distance === 0) {
            continue;
          }
          // Skip if currently falling through
          if (this.collisions.fallingThroughPlatform) {
            continue;
          }
          // Drop through if pressing down
          if (input.y < 0) {
            this.collisions.fallingThroughPlatform = true;
            this.collisions.fallingThroughPlatformTimer = 0.5; // 0.5s cooldown
            continue;
          }
        }

        // Adjust movement to stop at collision
        moveAmount.y = (hit.distance - this.config.skinWidth) * directionY;
        rayLength = hit.distance;

        // If climbing a slope, adjust X based on new Y
        if (this.collisions.climbingSlope) {
          moveAmount.x =
            (moveAmount.y / Math.tan(degToRad(this.collisions.slopeAngle))) *
            Math.sign(moveAmount.x);
        }

        this.collisions.below = directionY === -1;
        this.collisions.above = directionY === 1;
      }
    }

    // Additional check when climbing slopes: detect slope angle changes
    if (this.collisions.climbingSlope) {
      const directionX = Math.sign(moveAmount.x);
      rayLength = Math.abs(moveAmount.x) + this.config.skinWidth;

      const rayOrigin =
        directionX === -1
          ? vec2(origins.bottomLeft.x, origins.bottomLeft.y + moveAmount.y)
          : vec2(origins.bottomRight.x, origins.bottomRight.y + moveAmount.y);

      const hit = this.world.raycast(rayOrigin, vec2(directionX, 0), rayLength);

      if (hit) {
        const slopeAngle = angleBetweenVectors(hit.normal, vec2Up);
        if (slopeAngle !== this.collisions.slopeAngle) {
          moveAmount.x = (hit.distance - this.config.skinWidth) * directionX;
          this.collisions.slopeAngle = slopeAngle;
          this.collisions.slopeNormal = hit.normal;
        }
      }
    }
  }

  /**
   * Handle climbing up a slope.
   *
   * Converts horizontal velocity into diagonal movement up the slope.
   * Uses trigonometry: if moving distance D along ground at angle θ,
   * then horizontal = D * cos(θ), vertical = D * sin(θ).
   */
  private climbSlope(moveAmount: { x: number; y: number }, slopeAngle: number, slopeNormal: Vector2): void {
    const moveDistance = Math.abs(moveAmount.x);
    const climbVelocityY = Math.sin(degToRad(slopeAngle)) * moveDistance;

    // Only climb if we're not already moving up faster (e.g., jumping)
    if (moveAmount.y <= climbVelocityY) {
      moveAmount.y = climbVelocityY;
      moveAmount.x = Math.cos(degToRad(slopeAngle)) * moveDistance * Math.sign(moveAmount.x);
      this.collisions.below = true;
      this.collisions.climbingSlope = true;
      this.collisions.slopeAngle = slopeAngle;
      this.collisions.slopeNormal = slopeNormal;
    }
  }

  /**
   * Handle descending a slope.
   *
   * When walking down a slope, we want to stick to the ground
   * rather than "bouncing" due to the downward velocity.
   */
  private descendSlope(moveAmount: { x: number; y: number }): void {
    // Cast rays from both bottom corners to detect slopes
    const origins = updateRaycastOrigins(this.position, this.halfSize, this.config.skinWidth);
    const rayLength = Math.abs(moveAmount.y) + this.config.skinWidth;

    const hitLeft = this.world.raycast(origins.bottomLeft, vec2(0, -1), rayLength);
    const hitRight = this.world.raycast(origins.bottomRight, vec2(0, -1), rayLength);

    // Check for sliding down max slope (only one side hit = steep slope)
    if (hitLeft && !hitRight) {
      this.slideDownMaxSlope(hitLeft, moveAmount);
    } else if (hitRight && !hitLeft) {
      this.slideDownMaxSlope(hitRight, moveAmount);
    }

    if (this.collisions.slidingDownMaxSlope) {
      return;
    }

    // Normal slope descent
    const directionX = Math.sign(moveAmount.x);
    // When moving right and descending, check left corner; when moving left, check right
    const rayOrigin = directionX === -1 ? origins.bottomRight : origins.bottomLeft;
    const hit = this.world.raycast(rayOrigin, vec2(0, -1), Infinity);

    if (hit) {
      const slopeAngle = angleBetweenVectors(hit.normal, vec2Up);

      if (slopeAngle !== 0 && slopeAngle <= this.config.maxSlopeAngle) {
        // Check if slope is in the direction we're moving
        if (Math.sign(hit.normal.x) === directionX) {
          // Check if we're close enough to the slope to descend it
          const distanceToSlope =
            hit.distance - this.config.skinWidth;
          const descendDistance =
            Math.tan(degToRad(slopeAngle)) * Math.abs(moveAmount.x);

          if (distanceToSlope <= descendDistance) {
            const moveDistance = Math.abs(moveAmount.x);
            const descendVelocityY = Math.sin(degToRad(slopeAngle)) * moveDistance;

            moveAmount.x =
              Math.cos(degToRad(slopeAngle)) * moveDistance * Math.sign(moveAmount.x);
            moveAmount.y -= descendVelocityY;

            this.collisions.slopeAngle = slopeAngle;
            this.collisions.descendingSlope = true;
            this.collisions.below = true;
            this.collisions.slopeNormal = hit.normal;
          }
        }
      }
    }
  }

  /**
   * Handle sliding down a slope that's too steep.
   */
  private slideDownMaxSlope(
    hit: { normal: Vector2; distance: number },
    moveAmount: { x: number; y: number },
  ): void {
    const slopeAngle = angleBetweenVectors(hit.normal, vec2Up);

    if (slopeAngle > this.config.maxSlopeAngle) {
      // Slide down the slope
      moveAmount.x =
        Math.sign(hit.normal.x) *
        (Math.abs(moveAmount.y) - hit.distance) /
        Math.tan(degToRad(slopeAngle));

      this.collisions.slopeAngle = slopeAngle;
      this.collisions.slidingDownMaxSlope = true;
      this.collisions.slopeNormal = hit.normal;
    }
  }

  /**
   * Set the position directly (e.g., for teleportation or respawning).
   */
  setPosition(position: Vector2): void {
    this.position = position;
  }

  /**
   * Update the character's half-size (e.g., for crouching).
   */
  setHalfSize(halfSize: Vector2): void {
    this.halfSize = halfSize;
    this.calculateRaySpacing();
  }
}
