/**
 * FishNet-style tick smoothing for client-side rendering.
 *
 * The core concept is simple: physics state can "snap" during reconciliation,
 * but the graphical representation smoothly catches up using move rates.
 *
 * FishNet's approach:
 * - OnPreTick: Save graphical position (pre-simulation)
 * - Simulation: Physics moves to new position
 * - OnPostTick: Reset graphical to pre-tick position, add physics position to queue
 * - OnUpdate: Move graphical toward queue target using calculated move rates
 *
 * This creates smooth visual movement even when physics state changes abruptly.
 *
 * @module client/tick-smoother
 */

import { DEFAULT_TICK_INTERVAL_MS } from "../constants.js";

/**
 * A position stored by tick number for smoothing.
 */
export interface TickPosition {
  /** Server tick number */
  tick: number;
  /** X position */
  x: number;
  /** Y position */
  y: number;
}

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
   * Interpolation ticks for the local player (owner).
   * Lower value = less latency, more responsive.
   * @default 1
   */
  ownerInterpolationTicks: number;

  /**
   * Interpolation ticks for remote players (spectators).
   * Higher value = more buffer, smoother with network jitter.
   * @default 2
   */
  spectatorInterpolationTicks: number;

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
}

/**
 * Default configuration for tick-based smoothing.
 */
export const DEFAULT_TICK_SMOOTHER_CONFIG: TickSmootherConfig = {
  tickIntervalMs: DEFAULT_TICK_INTERVAL_MS,
  ownerInterpolationTicks: 1,
  spectatorInterpolationTicks: 2,
  maxOverBuffer: 3,
  teleportThreshold: 100,
};

/**
 * FishNet-style tick smoother for graphical position smoothing.
 *
 * This smoother maintains a queue of target positions and moves the graphical
 * position toward them using calculated move rates. The key insight from FishNet
 * is to calculate the SPEED needed to reach the target in one tick, then apply
 * that speed each frame.
 */
export class TickSmoother {
  private config: TickSmootherConfig;

  /** Queue of target positions to move toward */
  private queue: TickPosition[] = [];

  /** Current graphical position (smoothed) */
  private currentX: number = 0;
  private currentY: number = 0;

  /** Pre-tick graphical position (before simulation) */
  private preTickX: number = 0;
  private preTickY: number = 0;
  private hasPreTickPosition: boolean = false;

  /** Current move rates (units per millisecond) */
  private moveRateX: number = 0;
  private moveRateY: number = 0;
  private timeRemainingMs: number = 0;

  /** Movement multiplier for buffer management */
  private movementMultiplier: number = 1.0;

  /** Current interpolation ticks (owner or spectator) */
  private interpolationTicks: number;

  /** Whether we're the local player (owner) */
  private isOwner: boolean = true;

  /** Whether we've received initial position */
  private hasInitialPosition: boolean = false;

  constructor(config: Partial<TickSmootherConfig> = {}) {
    this.config = { ...DEFAULT_TICK_SMOOTHER_CONFIG, ...config };
    this.interpolationTicks = this.config.ownerInterpolationTicks;
  }

  /**
   * Called before each physics tick to save the current graphical position.
   */
  onPreTick(): void {
    this.preTickX = this.currentX;
    this.preTickY = this.currentY;
    this.hasPreTickPosition = true;
  }

  /**
   * Called after each physics tick with the new target position.
   *
   * @param tick - Server tick number
   * @param x - Physics X position
   * @param y - Physics Y position
   */
  onPostTick(tick: number, x: number, y: number): void {
    // Initialize current position on first tick only
    if (!this.hasInitialPosition) {
      this.currentX = x;
      this.currentY = y;
      this.hasInitialPosition = true;
      // Don't add to queue - we're already at this position
      return;
    }

    // Check for duplicate tick
    if (this.queue.some((entry) => entry.tick === tick)) {
      return;
    }

    // Add to queue (most arrive in order, so check end first)
    if (this.queue.length === 0 || tick > this.queue[this.queue.length - 1]!.tick) {
      this.queue.push({ tick, x, y });
    } else {
      // Find insertion point for out-of-order entry
      const insertIndex = this.queue.findIndex((entry) => entry.tick > tick);
      if (insertIndex >= 0) {
        this.queue.splice(insertIndex, 0, { tick, x, y });
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
   * Called during reconciliation replay to update queue entries with corrected positions.
   *
   * @param tick - Tick being corrected
   * @param x - Corrected X position
   * @param y - Corrected Y position
   */
  onReconciliationReplay(tick: number, x: number, y: number): void {
    const index = this.queue.findIndex((entry) => entry.tick === tick);
    if (index < 0) {
      return; // Tick not in buffer
    }

    // Replace with corrected position
    this.queue[index] = { tick, x, y };

    // If this is the first entry, recalculate move rates
    if (index === 0) {
      this.calculateMoveRates();
    }
  }

  /**
   * Get the smoothed position for rendering.
   *
   * @param deltaMs - Time since last render frame in milliseconds
   * @returns Smoothed position for rendering
   */
  getSmoothedPosition(deltaMs: number): { x: number; y: number } {
    // No data yet, return current position
    if (this.queue.length === 0) {
      return { x: this.currentX, y: this.currentY };
    }

    // If buffer is critically low, pause movement to let it grow
    if (this.queue.length - this.interpolationTicks < -4) {
      return { x: this.currentX, y: this.currentY };
    }

    // Apply movement multiplier to delta
    const adjustedDelta = deltaMs * this.movementMultiplier;

    // Move toward target
    this.moveToTarget(adjustedDelta);

    return { x: this.currentX, y: this.currentY };
  }

  /**
   * Move graphical position toward current target.
   */
  private moveToTarget(deltaMs: number): void {
    if (this.queue.length === 0) {
      return;
    }

    const target = this.queue[0]!;

    // Check for teleport threshold
    const dx = target.x - this.currentX;
    const dy = target.y - this.currentY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > this.config.teleportThreshold) {
      // Teleport instantly
      this.currentX = target.x;
      this.currentY = target.y;
      this.queue.shift();
      this.timeRemainingMs = 0;
      if (this.queue.length > 0) {
        this.calculateMoveRates();
      }
      return;
    }

    // Apply move rates
    this.currentX += this.moveRateX * deltaMs;
    this.currentY += this.moveRateY * deltaMs;
    this.timeRemainingMs -= deltaMs;

    // Check if we've reached (or passed) the target
    if (this.timeRemainingMs <= 0) {
      // Snap to target
      this.currentX = target.x;
      this.currentY = target.y;

      // Dequeue and setup next target
      this.queue.shift();

      if (this.queue.length > 0) {
        // Calculate rates for next target
        this.calculateMoveRates();

        // If we have time remaining (overshot), continue moving
        if (this.timeRemainingMs < 0) {
          this.moveToTarget(Math.abs(this.timeRemainingMs));
        }
      } else {
        // No more targets, reset move rates
        this.moveRateX = 0;
        this.moveRateY = 0;
        this.timeRemainingMs = 0;
      }
    }
  }

  /**
   * Calculate move rates to reach the next target in one tick duration.
   */
  private calculateMoveRates(): void {
    if (this.queue.length === 0) {
      this.moveRateX = 0;
      this.moveRateY = 0;
      this.timeRemainingMs = 0;
      return;
    }

    const target = this.queue[0]!;
    const dx = target.x - this.currentX;
    const dy = target.y - this.currentY;

    // Duration to reach target (one tick)
    const duration = this.config.tickIntervalMs;

    // For interpolation of 1, add a small buffer to prevent jitter
    const adjustedDuration = this.interpolationTicks === 1 ? duration + Math.max(16.67, 20) : duration;

    // Calculate rates (units per millisecond)
    this.moveRateX = dx / adjustedDuration;
    this.moveRateY = dy / adjustedDuration;
    this.timeRemainingMs = adjustedDuration;
  }

  /**
   * Update movement multiplier based on buffer fullness.
   */
  private updateMovementMultiplier(): void {
    const overInterpolation = this.queue.length - this.interpolationTicks;

    if (overInterpolation !== 0) {
      this.movementMultiplier += 0.015 * overInterpolation;
    } else if (this.interpolationTicks === 1) {
      this.movementMultiplier = 1.0;
    }

    this.movementMultiplier = Math.max(0.95, Math.min(1.05, this.movementMultiplier));
  }

  /**
   * Discard entries if buffer exceeds target + maxOverBuffer.
   */
  private discardExcessiveEntries(): void {
    const maxEntries = this.interpolationTicks + this.config.maxOverBuffer;

    while (this.queue.length > maxEntries) {
      const discarded = this.queue.shift()!;
      this.currentX = discarded.x;
      this.currentY = discarded.y;
    }

    if (this.queue.length > 0 && this.timeRemainingMs <= 0) {
      this.calculateMoveRates();
    }
  }

  /**
   * Set whether this smoother is for the local player (owner) or remote player (spectator).
   */
  setIsOwner(isOwner: boolean): void {
    this.isOwner = isOwner;
    this.interpolationTicks = isOwner
      ? this.config.ownerInterpolationTicks
      : this.config.spectatorInterpolationTicks;
  }

  getIsOwner(): boolean {
    return this.isOwner;
  }

  getInterpolationTicks(): number {
    return this.interpolationTicks;
  }

  getMovementMultiplier(): number {
    return this.movementMultiplier;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Clear all buffered positions and reset smoothing state.
   */
  clear(): void {
    this.queue = [];
    this.moveRateX = 0;
    this.moveRateY = 0;
    this.timeRemainingMs = 0;
    this.movementMultiplier = 1.0;
    this.hasPreTickPosition = false;
    // Keep currentX/currentY to avoid jumps
  }

  /**
   * Fully reset the smoother including current position.
   */
  reset(): void {
    this.clear();
    this.currentX = 0;
    this.currentY = 0;
    this.hasInitialPosition = false;
  }
}
