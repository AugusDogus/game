/**
 * FishNet-style tick smoothing for client-side rendering.
 *
 * The core concept is simple: physics state can "snap" during reconciliation,
 * but the graphical representation smoothly catches up using move rates.
 *
 * FishNet's approach:
 * - OnPostTick: Add physics position to queue with tick number
 * - OnUpdate: Move graphical toward queue target using calculated move rates
 * - Adaptive interpolation: Dynamically adjust buffer size based on RTT
 *
 * This creates smooth visual movement even when physics state changes abruptly.
 *
 * @module client/tick-smoother
 */

import { DEFAULT_TICK_INTERVAL_MS } from "../constants.js";

/**
 * Adaptive interpolation level (matching FishNet).
 * Higher levels add more buffer ticks to absorb network jitter.
 */
export enum AdaptiveInterpolationLevel {
  /** Disable adaptive interpolation, use fixed interpolation ticks */
  Off = 0,
  /** +1 tick buffer - minimal jitter tolerance */
  VeryLow = 1,
  /** +2 ticks buffer - low jitter tolerance */
  Low = 2,
  /** +3 ticks buffer - moderate jitter tolerance */
  Moderate = 3,
  /** +4 ticks buffer - high jitter tolerance */
  High = 4,
  /** +5 ticks buffer - very high jitter tolerance */
  VeryHigh = 5,
}

/**
 * Adaptive smoothing behavior (FishNet-style).
 */
export enum AdaptiveSmoothingType {
  /** Default: set interpolation directly from tick lag */
  Default = 0,
  /** Custom: adjust interpolation by increase/decrease steps */
  Custom = 1,
}

/**
 * A transform stored by tick number for smoothing.
 * Position is required; rotation and scale are optional.
 */
export interface TickTransform {
  /** Tick number (client-local for owner, server tick for spectators) */
  tick: number;
  /** X position */
  x: number;
  /** Y position */
  y: number;
  /** Rotation in radians (optional, for 2D rotation smoothing) */
  rotation?: number;
  /** Scale X (optional, for scale smoothing) */
  scaleX?: number;
  /** Scale Y (optional, for scale smoothing) */
  scaleY?: number;
}

/**
 * @deprecated Use TickTransform instead
 */
export type TickPosition = TickTransform;

/**
 * Configuration for tick-based smoothing.
 */
export interface TickSmootherConfig {
  /**
   * Server tick interval in milliseconds.
   * Must match the server's tick rate for correct timing.
   * @default 16.67 (60 TPS)
   */
  tickIntervalMs: number;

  /**
   * Fixed interpolation ticks for owner (local player).
   * FishNet uses 1 tick for owners - very responsive.
   * @default 1
   */
  ownerInterpolation: number;

  /**
   * Fixed interpolation ticks for spectators when adaptive is off.
   * @default 2
   */
  spectatorInterpolation: number;

  /**
   * Adaptive interpolation level for spectators (remote players).
   * FishNet only applies adaptive interpolation to spectators, NOT owners.
   * When Off, uses fixed spectatorInterpolation.
   * @default AdaptiveInterpolationLevel.Low
   */
  adaptiveInterpolation: AdaptiveInterpolationLevel;

  /**
   * Adaptive smoothing type (FishNet-style).
   * @default AdaptiveSmoothingType.Default
   */
  adaptiveSmoothingType: AdaptiveSmoothingType;

  /**
   * Interpolation percent applied to tick lag (0-1).
   * @default 1
   */
  interpolationPercent: number;

  /**
   * Collision interpolation percent applied to reconciliation corrections (0-1).
   * @default 1
   */
  collisionInterpolationPercent: number;

  /**
   * Interpolation decrease step when using Custom adaptive smoothing.
   * @default 1
   */
  interpolationDecreaseStep: number;

  /**
   * Interpolation increase step when using Custom adaptive smoothing.
   * @default 1
   */
  interpolationIncreaseStep: number;

  /**
   * Maximum entries allowed over the interpolation target before discarding.
   * Prevents unbounded buffer growth during network bursts.
   * @default 3
   */
  maxOverBuffer: number;

  /**
   * Distance threshold for teleporting instead of smoothing.
   * If the position change exceeds this, snap instantly.
   * @default 100
   */
  teleportThreshold: number;

  /**
   * Axis-specific teleport threshold for X position (optional).
   * If provided, overrides distance check for the X axis.
   */
  teleportThresholdX?: number;

  /**
   * Axis-specific teleport threshold for Y position (optional).
   * If provided, overrides distance check for the Y axis.
   */
  teleportThresholdY?: number;

  /**
   * Whether to smooth X position (otherwise snap to target).
   * @default true
   */
  smoothPositionX: boolean;

  /**
   * Whether to smooth Y position (otherwise snap to target).
   * @default true
   */
  smoothPositionY: boolean;

  /**
   * Whether to smooth rotation (2D angle in radians).
   * @default false
   */
  smoothRotation: boolean;

  /**
   * Whether to smooth scale (scaleX/scaleY).
   * @default false
   */
  smoothScale: boolean;

  /**
   * Whether to smooth scale X (otherwise snap to target).
   * @default true
   */
  smoothScaleX: boolean;

  /**
   * Whether to smooth scale Y (otherwise snap to target).
   * @default true
   */
  smoothScaleY: boolean;

  /**
   * Rotation threshold for teleporting instead of smoothing (in radians).
   * If rotation change exceeds this, snap instantly.
   * @default Math.PI (180 degrees)
   */
  rotationTeleportThreshold: number;

  /**
   * Axis-specific teleport threshold for scale X (optional).
   */
  scaleTeleportThresholdX?: number;

  /**
   * Axis-specific teleport threshold for scale Y (optional).
   */
  scaleTeleportThresholdY?: number;

  /**
   * Whether to enable extrapolation when queue runs out (spectators only).
   * Uses last known velocity to predict forward motion for a short time.
   * Owners should never use extrapolation - they use prediction.
   * @default true
   */
  enableExtrapolation: boolean;

  /**
   * Maximum time to extrapolate in milliseconds (when queue is empty).
   * Extrapolation is clamped to prevent runaway drift.
   * @default 2 ticks worth of time
   */
  maxExtrapolationMs: number;
}

/**
 * Default configuration for tick-based smoothing.
 */
export const DEFAULT_TICK_SMOOTHER_CONFIG: TickSmootherConfig = {
  tickIntervalMs: DEFAULT_TICK_INTERVAL_MS,
  ownerInterpolation: 1,
  spectatorInterpolation: 2,
  adaptiveInterpolation: AdaptiveInterpolationLevel.Low,
  adaptiveSmoothingType: AdaptiveSmoothingType.Default,
  interpolationPercent: 1,
  collisionInterpolationPercent: 1,
  interpolationDecreaseStep: 1,
  interpolationIncreaseStep: 1,
  maxOverBuffer: 3,
  teleportThreshold: 100,
  smoothPositionX: true,
  smoothPositionY: true,
  smoothRotation: false,
  smoothScale: false,
  smoothScaleX: true,
  smoothScaleY: true,
  rotationTeleportThreshold: Math.PI, // 180 degrees
  enableExtrapolation: true,
  maxExtrapolationMs: DEFAULT_TICK_INTERVAL_MS * 2, // 2 ticks
};

/**
 * FishNet-style tick smoother for graphical position smoothing.
 *
 * This smoother maintains a queue of target positions and moves the graphical
 * position toward them using calculated move rates. The key insight from FishNet
 * is to calculate the SPEED needed to reach the target in one tick, then apply
 * that speed each frame.
 *
 * FishNet's key insight for owners vs spectators:
 * - Owners (local player): Use fixed 1-tick interpolation for responsiveness
 * - Spectators (remote players): Use adaptive interpolation based on network conditions
 */
export class TickSmoother {
  private config: TickSmootherConfig;

  /** Queue of target transforms to move toward */
  private queue: TickTransform[] = [];

  /** Current graphical position (smoothed) */
  private currentX: number = 0;
  private currentY: number = 0;

  /** Current graphical rotation (smoothed, radians) */
  private currentRotation: number = 0;

  /** Current graphical scale (smoothed) */
  private currentScaleX: number = 1;
  private currentScaleY: number = 1;

  /** Current move rates (units per millisecond) */
  private moveRateX: number = 0;
  private moveRateY: number = 0;
  private moveRateRotation: number = 0;
  private moveRateScaleX: number = 0;
  private moveRateScaleY: number = 0;
  private timeRemainingMs: number = 0;

  /** Movement multiplier for buffer management */
  private movementMultiplier: number = 1.0;

  /** 
   * Current interpolation ticks - the target buffer size.
   * For owners: fixed ownerInterpolation (typically 1)
   * For spectators: adaptive based on network conditions
   */
  private interpolation: number;

  /** Whether this smoother is for the local player (owner) */
  private isOwner: boolean = true;

  // --- Extrapolation state ---
  /** Last known velocity for extrapolation (units per millisecond) */
  private lastVelocityX: number = 0;
  private lastVelocityY: number = 0;
  private lastVelocityRotation: number = 0;
  private lastVelocityScaleX: number = 0;
  private lastVelocityScaleY: number = 0;

  /** Whether currently extrapolating (queue empty, using last velocity) */
  private isExtrapolating: boolean = false;

  /** Time spent extrapolating in milliseconds */
  private extrapolationTimeMs: number = 0;

  /** Whether we've received initial transform */
  private hasInitialPosition: boolean = false;

  /** Tick number when teleport was triggered - skip smoothing for ticks before this */
  private teleportedTick: number = -1;

  /** Whether movement has started (prevents restart-stutter when buffer oscillates) */
  private isMoving: boolean = false;
  /** Last tick that was applied to the current transform (prevents stale updates) */
  private lastProcessedTick: number = Number.NEGATIVE_INFINITY;

  constructor(config: Partial<TickSmootherConfig> = {}) {
    this.config = { ...DEFAULT_TICK_SMOOTHER_CONFIG, ...config };
    // Default to owner interpolation (most responsive)
    this.interpolation = this.config.ownerInterpolation;
  }

  /**
   * Set whether this smoother is for the local player (owner) or remote player (spectator).
   * FishNet only applies adaptive interpolation to spectators, NOT owners.
   * Owners always use the fixed ownerInterpolation for responsiveness.
   */
  setIsOwner(isOwner: boolean): void {
    this.isOwner = isOwner;
    if (isOwner) {
      // Owners always use fixed interpolation for responsiveness
      this.interpolation = this.config.ownerInterpolation;
    } else if (this.config.adaptiveInterpolation === AdaptiveInterpolationLevel.Off) {
      // Spectators with adaptive off use fixed spectator interpolation
      this.interpolation = this.config.spectatorInterpolation;
    }
    // If spectator with adaptive on, interpolation will be set by updateAdaptiveInterpolation
  }

  /**
   * Update adaptive interpolation based on network conditions.
   * Only applies to spectators (remote players) - owners ignore this.
   *
   * FishNet formula: interpolation = tickLag * multiplier
   * where multiplier varies by AdaptiveInterpolationType (0.2 to 1.5)
   *
   * @param tickLag - How many ticks behind the server state we are
   */
  updateAdaptiveInterpolation(tickLag: number): void {
    // Owners never use adaptive interpolation - they need to be responsive
    if (this.isOwner) {
      return;
    }
    
    if (this.config.adaptiveInterpolation === AdaptiveInterpolationLevel.Off) {
      return;
    }

    // FishNet's multipliers based on adaptive level
    const multiplier = this.getAdaptiveMultiplier();
    const interpolationPercent = this.clamp01(this.config.interpolationPercent);

    // Apply multiplier and clamp
    let interpolation = tickLag * multiplier * interpolationPercent;
    interpolation = Math.max(2, Math.min(255, interpolation));

    const desired = Math.ceil(interpolation);

    if (this.config.adaptiveSmoothingType === AdaptiveSmoothingType.Custom) {
      if (desired > this.interpolation) {
        this.interpolation = Math.min(255, this.interpolation + this.config.interpolationIncreaseStep);
      } else if (desired < this.interpolation) {
        this.interpolation = Math.max(2, this.interpolation - this.config.interpolationDecreaseStep);
      }
    } else {
      this.interpolation = desired;
    }
  }

  /**
   * Get the FishNet-style multiplier for adaptive interpolation.
   */
  private getAdaptiveMultiplier(): number {
    switch (this.config.adaptiveInterpolation) {
      case AdaptiveInterpolationLevel.VeryLow:
        return 0.45;
      case AdaptiveInterpolationLevel.Low:
        return 0.8;
      case AdaptiveInterpolationLevel.Moderate:
        return 1.05;
      case AdaptiveInterpolationLevel.High:
        return 1.25;
      case AdaptiveInterpolationLevel.VeryHigh:
        return 1.5;
      default:
        return 1.0;
    }
  }

  private clamp01(value: number): number {
    if (!Number.isFinite(value)) return 1;
    return Math.max(0, Math.min(1, value));
  }

  /**
   * Called after each physics tick with the new target transform.
   *
   * @param tick - Tick number (client-local for owner, server tick for spectators)
   * @param x - Physics X position
   * @param y - Physics Y position
   * @param rotation - Physics rotation in radians (optional)
   * @param scaleX - Physics scale X (optional)
   * @param scaleY - Physics scale Y (optional)
   */
  onPostTick(tick: number, x: number, y: number, rotation?: number, scaleX?: number, scaleY?: number): void {
    // Skip ticks before teleport
    if (tick <= this.teleportedTick) {
      return;
    }

    // Skip stale ticks that are older than the last processed tick
    if (tick <= this.lastProcessedTick) {
      return;
    }

    // Initialize current transform on first tick only
    if (!this.hasInitialPosition) {
      this.currentX = x;
      this.currentY = y;
      if (rotation !== undefined) this.currentRotation = rotation;
      if (scaleX !== undefined) this.currentScaleX = scaleX;
      if (scaleY !== undefined) this.currentScaleY = scaleY;
      this.hasInitialPosition = true;
      this.lastProcessedTick = tick;
      // Don't add to queue - we're already at this position
      return;
    }

    // Check for duplicate tick
    if (this.queue.some((entry) => entry.tick === tick)) {
      return;
    }

    // Build transform entry
    const entry: TickTransform = { tick, x, y };
    if (rotation !== undefined) entry.rotation = rotation;
    if (scaleX !== undefined) entry.scaleX = scaleX;
    if (scaleY !== undefined) entry.scaleY = scaleY;

    // Add to queue (most arrive in order, so check end first)
    if (this.queue.length === 0 || tick > this.queue[this.queue.length - 1]!.tick) {
      this.queue.push(entry);
    } else {
      // Find insertion point for out-of-order entry
      const insertIndex = this.queue.findIndex((e) => e.tick > tick);
      if (insertIndex >= 0) {
        this.queue.splice(insertIndex, 0, entry);
      }
    }

    // Discard excessive entries after adding
    this.discardExcessiveEntries();

    // Calculate move rates for first entry (or recalculate if queue changed)
    if (this.queue.length >= 1 && this.timeRemainingMs <= 0) {
      this.calculateMoveRates();
    }

    // Update movement multiplier based on buffer state
    this.updateMovementMultiplier();
  }

  /**
   * Smoothed transform result for rendering.
   */
  private getSmoothedTransformResult(): {
    x: number;
    y: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
  } {
    return {
      x: this.currentX,
      y: this.currentY,
      rotation: this.currentRotation,
      scaleX: this.currentScaleX,
      scaleY: this.currentScaleY,
    };
  }

  /**
   * Get the smoothed position for rendering.
   *
   * @param deltaMs - Time since last render frame in milliseconds
   * @returns Smoothed position for rendering
   */
  getSmoothedPosition(deltaMs: number): { x: number; y: number } {
    const transform = this.getSmoothedTransform(deltaMs);
    return { x: transform.x, y: transform.y };
  }

  /**
   * Get the smoothed transform (position, rotation, scale) for rendering.
   *
   * @param deltaMs - Time since last render frame in milliseconds
   * @returns Smoothed transform for rendering
   */
  getSmoothedTransform(deltaMs: number): {
    x: number;
    y: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
  } {
    const queueLength = this.queue.length;

    // No data yet - try extrapolation for spectators
    if (queueLength === 0) {
      // Extrapolation: continue moving using last known velocity (spectators only)
      if (this.canExtrapolate()) {
        this.extrapolate(deltaMs);
      }
      return this.getSmoothedTransformResult();
    }

    // We have data - stop extrapolating
    if (this.isExtrapolating) {
      this.isExtrapolating = false;
      this.extrapolationTimeMs = 0;
    }

    // FishNet _isMoving state tracking to prevent restart-stutter
    if (queueLength >= this.interpolation) {
      this.isMoving = true;
    } else if (!this.isMoving) {
      // Haven't started moving yet and buffer isn't full enough
      return this.getSmoothedTransformResult();
    } else if (queueLength - this.interpolation < -4) {
      // Buffer is critically low, pause movement to let it grow
      this.isMoving = false;
      return this.getSmoothedTransformResult();
    }

    // Apply movement multiplier to delta
    const adjustedDelta = deltaMs * this.movementMultiplier;

    // Move toward target
    this.moveToTarget(adjustedDelta);

    return this.getSmoothedTransformResult();
  }

  /**
   * Check if we can extrapolate (spectators only, enabled, has velocity data).
   */
  private canExtrapolate(): boolean {
    // Owners never extrapolate - they use prediction
    if (this.isOwner) return false;

    // Extrapolation disabled
    if (!this.config.enableExtrapolation) return false;

    // No velocity data yet
    if (this.lastVelocityX === 0 && this.lastVelocityY === 0) return false;

    // Haven't started moving yet (no initial data received)
    if (!this.hasInitialPosition) return false;

    return true;
  }

  /**
   * Extrapolate position using last known velocity.
   * Only called for spectators when queue is empty.
   */
  private extrapolate(deltaMs: number): void {
    // Check if we've exceeded max extrapolation time
    if (this.extrapolationTimeMs >= this.config.maxExtrapolationMs) {
      return; // Stop extrapolating, hold position
    }

    this.isExtrapolating = true;

    // Clamp delta to not exceed remaining extrapolation budget
    const remainingBudget = this.config.maxExtrapolationMs - this.extrapolationTimeMs;
    const clampedDelta = Math.min(deltaMs, remainingBudget);

    // Apply last known velocity
    this.currentX += this.lastVelocityX * clampedDelta;
    this.currentY += this.lastVelocityY * clampedDelta;

    if (this.config.smoothRotation) {
      this.currentRotation += this.lastVelocityRotation * clampedDelta;
    }

    if (this.config.smoothScale) {
      if (this.config.smoothScaleX) {
        this.currentScaleX += this.lastVelocityScaleX * clampedDelta;
      }
      if (this.config.smoothScaleY) {
        this.currentScaleY += this.lastVelocityScaleY * clampedDelta;
      }
    }

    this.extrapolationTimeMs += clampedDelta;
  }

  /**
   * Normalize angle to [-PI, PI] range.
   */
  private normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }

  /**
   * Move graphical transform toward current target.
   */
  private moveToTarget(deltaMs: number): void {
    if (this.queue.length === 0) {
      return;
    }

    const target = this.queue[0]!;

    // Snap axes that are not smoothed
    if (!this.config.smoothPositionX) {
      this.currentX = target.x;
    }
    if (!this.config.smoothPositionY) {
      this.currentY = target.y;
    }
    if (!this.config.smoothScale || !this.config.smoothScaleX) {
      if (target.scaleX !== undefined) {
        this.currentScaleX = target.scaleX;
      }
    }
    if (!this.config.smoothScale || !this.config.smoothScaleY) {
      if (target.scaleY !== undefined) {
        this.currentScaleY = target.scaleY;
      }
    }

    // Check for position teleport threshold
    const dx = this.config.smoothPositionX ? target.x - this.currentX : 0;
    const dy = this.config.smoothPositionY ? target.y - this.currentY : 0;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const teleportX = this.config.teleportThresholdX !== undefined
      ? Math.abs(dx) > this.config.teleportThresholdX
      : false;
    const teleportY = this.config.teleportThresholdY !== undefined
      ? Math.abs(dy) > this.config.teleportThresholdY
      : false;

    // Check for rotation teleport threshold
    let rotationDelta = 0;
    if (this.config.smoothRotation && target.rotation !== undefined) {
      rotationDelta = this.normalizeAngle(target.rotation - this.currentRotation);
    }
    const shouldTeleportRotation = Math.abs(rotationDelta) > this.config.rotationTeleportThreshold;

    // Check for scale teleport thresholds
    let scaleTeleportX = false;
    let scaleTeleportY = false;
    if (this.config.smoothScale && target.scaleX !== undefined && this.config.scaleTeleportThresholdX !== undefined) {
      scaleTeleportX = Math.abs(target.scaleX - this.currentScaleX) > this.config.scaleTeleportThresholdX;
    }
    if (this.config.smoothScale && target.scaleY !== undefined && this.config.scaleTeleportThresholdY !== undefined) {
      scaleTeleportY = Math.abs(target.scaleY - this.currentScaleY) > this.config.scaleTeleportThresholdY;
    }

    const shouldTeleportPosition = (distance > this.config.teleportThreshold) || teleportX || teleportY;

    if (shouldTeleportPosition || shouldTeleportRotation || scaleTeleportX || scaleTeleportY) {
      // Teleport instantly
      this.currentX = target.x;
      this.currentY = target.y;
      if (target.rotation !== undefined) this.currentRotation = target.rotation;
      if (target.scaleX !== undefined) this.currentScaleX = target.scaleX;
      if (target.scaleY !== undefined) this.currentScaleY = target.scaleY;
      this.queue.shift();
      this.lastProcessedTick = target.tick;
      this.timeRemainingMs = 0;
      if (this.queue.length > 0) {
        this.calculateMoveRates();
      }
      return;
    }

    // Apply move rates
    this.currentX += this.moveRateX * deltaMs;
    this.currentY += this.moveRateY * deltaMs;
    if (this.config.smoothRotation) {
      this.currentRotation += this.moveRateRotation * deltaMs;
    }
    if (this.config.smoothScale) {
      this.currentScaleX += this.moveRateScaleX * deltaMs;
      this.currentScaleY += this.moveRateScaleY * deltaMs;
    }
    this.timeRemainingMs -= deltaMs;

    // Check if we've reached (or passed) the target
    if (this.timeRemainingMs <= 0) {
      // Store last velocity for potential extrapolation (before snapping)
      this.lastVelocityX = this.moveRateX;
      this.lastVelocityY = this.moveRateY;
      this.lastVelocityRotation = this.moveRateRotation;
      this.lastVelocityScaleX = this.moveRateScaleX;
      this.lastVelocityScaleY = this.moveRateScaleY;

      // Snap to target
      this.currentX = target.x;
      this.currentY = target.y;
      if (target.rotation !== undefined) this.currentRotation = target.rotation;
      if (target.scaleX !== undefined) this.currentScaleX = target.scaleX;
      if (target.scaleY !== undefined) this.currentScaleY = target.scaleY;

      // Dequeue and setup next target
      this.queue.shift();
      this.lastProcessedTick = target.tick;

      if (this.queue.length > 0) {
        // Calculate rates for next target
        this.calculateMoveRates();

        // If we have time remaining (overshot), continue moving
        if (this.timeRemainingMs < 0) {
          this.moveToTarget(Math.abs(this.timeRemainingMs));
        }
      } else {
        // No more targets, reset move rates (but keep lastVelocity for extrapolation)
        this.moveRateX = 0;
        this.moveRateY = 0;
        this.moveRateRotation = 0;
        this.moveRateScaleX = 0;
        this.moveRateScaleY = 0;
        this.timeRemainingMs = 0;
      }
    }
  }

  /**
   * Calculate move rates to reach the next target in one tick duration.
   * Uses pure tick interval - movement multiplier handles timing variance.
   */
  private calculateMoveRates(): void {
    if (this.queue.length === 0) {
      this.moveRateX = 0;
      this.moveRateY = 0;
      this.moveRateRotation = 0;
      this.moveRateScaleX = 0;
      this.moveRateScaleY = 0;
      this.timeRemainingMs = 0;
      return;
    }

    const target = this.queue[0]!;
    const dx = target.x - this.currentX;
    const dy = target.y - this.currentY;

    // Duration to reach target (one tick) - no hacks, movement multiplier handles variance
    const duration = this.config.tickIntervalMs;

    // Calculate position rates (units per millisecond)
    this.moveRateX = this.config.smoothPositionX ? dx / duration : 0;
    this.moveRateY = this.config.smoothPositionY ? dy / duration : 0;

    // Calculate rotation rate (radians per millisecond)
    if (this.config.smoothRotation && target.rotation !== undefined) {
      const dRotation = this.normalizeAngle(target.rotation - this.currentRotation);
      this.moveRateRotation = dRotation / duration;
    } else {
      this.moveRateRotation = 0;
    }

    // Calculate scale rates (units per millisecond)
    if (this.config.smoothScale) {
      const dScaleX = (target.scaleX ?? this.currentScaleX) - this.currentScaleX;
      const dScaleY = (target.scaleY ?? this.currentScaleY) - this.currentScaleY;
      this.moveRateScaleX = this.config.smoothScaleX ? dScaleX / duration : 0;
      this.moveRateScaleY = this.config.smoothScaleY ? dScaleY / duration : 0;
    } else {
      this.moveRateScaleX = 0;
      this.moveRateScaleY = 0;
    }

    this.timeRemainingMs = duration;
  }

  /**
   * Update movement multiplier based on buffer fullness.
   * FishNet behavior: reset to 1.0 when buffer is exactly at target.
   */
  private updateMovementMultiplier(): void {
    const overInterpolation = this.queue.length - this.interpolation;

    if (overInterpolation !== 0) {
      // Adjust multiplier based on buffer fullness (1.5% per tick over/under)
      this.movementMultiplier += 0.015 * overInterpolation;
    } else {
      // FishNet behavior: reset to 1.0 when buffer is exactly at target
      this.movementMultiplier = 1.0;
    }

    this.movementMultiplier = Math.max(0.95, Math.min(1.05, this.movementMultiplier));
  }

  /**
   * Discard entries if buffer exceeds target + maxOverBuffer.
   */
  private discardExcessiveEntries(): void {
    const maxEntries = this.interpolation + this.config.maxOverBuffer;

    while (this.queue.length > maxEntries) {
      const discarded = this.queue.shift()!;
      this.currentX = discarded.x;
      this.currentY = discarded.y;
      if (discarded.rotation !== undefined) this.currentRotation = discarded.rotation;
      if (discarded.scaleX !== undefined) this.currentScaleX = discarded.scaleX;
      if (discarded.scaleY !== undefined) this.currentScaleY = discarded.scaleY;
      this.lastProcessedTick = discarded.tick;
    }

    if (this.queue.length > 0 && this.timeRemainingMs <= 0) {
      this.calculateMoveRates();
    }
  }

  /**
   * Ease a correction into an existing queue entry.
   * FishNet's ModifyTransformProperties algorithm - applies exponential easing
   * so corrections are gradually applied across the buffer.
   *
   * @param tick - The tick number to modify
   * @param newX - The corrected X position
   * @param newY - The corrected Y position
   * @param newRotation - The corrected rotation (optional)
   * @param newScaleX - The corrected scale X (optional)
   * @param newScaleY - The corrected scale Y (optional)
   * @returns true if the correction was applied (tick existed in queue), false otherwise
   */
  easeCorrection(tick: number, newX: number, newY: number, newRotation?: number, newScaleX?: number, newScaleY?: number): boolean {
    const index = this.queue.findIndex(entry => entry.tick === tick);
    if (index < 0) return false;

    const queueCount = this.queue.length;
    const adjustedQueueCount = Math.max(1, queueCount - 2);
    
    // Calculate ease percentage - more correction toward end of queue
    let easePercent = index / adjustedQueueCount;
    
    // Apply exponential easing (FishNet's power curve)
    if (easePercent < 1) {
      easePercent = Math.pow(easePercent, adjustedQueueCount - index);
    }

    const collisionPercent = this.clamp01(this.config.collisionInterpolationPercent);
    easePercent *= collisionPercent;

    // Lerp between old and new transforms
    const old = this.queue[index]!;
    const updated: TickTransform = {
      tick,
      x: old.x + (newX - old.x) * easePercent,
      y: old.y + (newY - old.y) * easePercent,
    };

    // Ease rotation if provided
    if (newRotation !== undefined && old.rotation !== undefined) {
      const rotationDelta = this.normalizeAngle(newRotation - old.rotation);
      updated.rotation = old.rotation + rotationDelta * easePercent;
    } else if (newRotation !== undefined) {
      updated.rotation = newRotation;
    } else if (old.rotation !== undefined) {
      updated.rotation = old.rotation;
    }

    // Ease scale if provided
    if (newScaleX !== undefined) {
      const oldScaleX = old.scaleX ?? 1;
      updated.scaleX = oldScaleX + (newScaleX - oldScaleX) * easePercent;
    } else if (old.scaleX !== undefined) {
      updated.scaleX = old.scaleX;
    }

    if (newScaleY !== undefined) {
      const oldScaleY = old.scaleY ?? 1;
      updated.scaleY = oldScaleY + (newScaleY - oldScaleY) * easePercent;
    } else if (old.scaleY !== undefined) {
      updated.scaleY = old.scaleY;
    }

    this.queue[index] = updated;
    return true;
  }

  /**
   * Check if a tick exists in the queue (for invariant testing).
   * @param tick - The tick number to check
   * @returns true if the tick exists in the queue
   */
  hasTickInQueue(tick: number): boolean {
    return this.queue.some(entry => entry.tick === tick);
  }

  /**
   * Get the current interpolation (buffer size in ticks).
   * For owners: fixed ownerInterpolation
   * For spectators: adaptive based on network conditions
   */
  getInterpolation(): number {
    return this.interpolation;
  }

  /**
   * Get whether this smoother is for the local player (owner).
   */
  getIsOwner(): boolean {
    return this.isOwner;
  }

  getMovementMultiplier(): number {
    return this.movementMultiplier;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Clear all buffered transforms and reset smoothing state.
   */
  clear(): void {
    this.queue = [];
    this.moveRateX = 0;
    this.moveRateY = 0;
    this.moveRateRotation = 0;
    this.moveRateScaleX = 0;
    this.moveRateScaleY = 0;
    this.timeRemainingMs = 0;
    this.movementMultiplier = 1.0;
    this.isMoving = false;
    this.isExtrapolating = false;
    this.extrapolationTimeMs = 0;
    // Keep current transform and lastVelocity to avoid jumps
  }

  /**
   * Fully reset the smoother including current transform.
   */
  reset(): void {
    this.clear();
    this.currentX = 0;
    this.currentY = 0;
    this.currentRotation = 0;
    this.currentScaleX = 1;
    this.currentScaleY = 1;
    this.hasInitialPosition = false;
    this.teleportedTick = -1;
    this.lastProcessedTick = Number.NEGATIVE_INFINITY;
    // Reset extrapolation velocity
    this.lastVelocityX = 0;
    this.lastVelocityY = 0;
    this.lastVelocityRotation = 0;
    this.lastVelocityScaleX = 0;
    this.lastVelocityScaleY = 0;
  }

  /**
   * Trigger a teleport - clears the queue and skips smoothing for past ticks.
   * Call this when the entity teleports/respawns to prevent sliding.
   *
   * @param snapToTransform - If provided, snap current transform to these values
   */
  teleport(snapToTransform?: { x: number; y: number; rotation?: number; scaleX?: number; scaleY?: number }): void {
    // Record the latest tick so we skip smoothing for any queued entries
    this.teleportedTick = this.queue.length > 0 ? this.queue[this.queue.length - 1]!.tick : this.teleportedTick;

    // Clear the queue
    this.clear();

    // Optionally snap to a specific transform
    if (snapToTransform) {
      this.currentX = snapToTransform.x;
      this.currentY = snapToTransform.y;
      if (snapToTransform.rotation !== undefined) this.currentRotation = snapToTransform.rotation;
      if (snapToTransform.scaleX !== undefined) this.currentScaleX = snapToTransform.scaleX;
      if (snapToTransform.scaleY !== undefined) this.currentScaleY = snapToTransform.scaleY;
    }
  }

  /**
   * Get the teleported tick (for debugging/testing).
   */
  getTeleportedTick(): number {
    return this.teleportedTick;
  }

  /**
   * Get whether currently extrapolating (for debugging/testing).
   */
  getIsExtrapolating(): boolean {
    return this.isExtrapolating;
  }

  /**
   * Get the current extrapolation time in milliseconds (for debugging/testing).
   */
  getExtrapolationTimeMs(): number {
    return this.extrapolationTimeMs;
  }
}
