/**
 * Visual smoothing for client-side prediction corrections.
 *
 * When reconciliation occurs, the physics state may jump to the server's authoritative
 * position. Rather than showing this jump directly (which causes visible jitter),
 * VisualSmoother maintains a "visual offset" that decays over time, providing smooth
 * visual transitions while keeping physics state correct.
 *
 * This is the equivalent of entity interpolation, but for the local player's
 * small reconciliation corrections.
 *
 * @module client/visual-smoother
 */

/**
 * Configuration for visual smoothing behavior.
 */
export interface VisualSmootherConfig {
  /**
   * How quickly to blend toward the physics position.
   * Value between 0 and 1:
   * - 0 = instant snap (no smoothing)
   * - 0.9 = smooth blending (recommended)
   * - 1 = never blend (offset stays forever)
   *
   * Higher values = smoother but more visual lag.
   * @default 0.9
   */
  smoothFactor: number;

  /**
   * Distance threshold above which to snap immediately instead of smoothing.
   * Used for teleports, respawns, or large corrections that shouldn't be smoothed.
   * @default 50 units
   */
  snapThreshold: number;
}

/**
 * Default visual smoothing configuration.
 */
export const DEFAULT_VISUAL_SMOOTHER_CONFIG: VisualSmootherConfig = {
  smoothFactor: 0.9,
  snapThreshold: 50,
};

/**
 * 2D offset for visual smoothing.
 */
export interface VisualOffset {
  x: number;
  y: number;
}

/**
 * Smooths visual corrections from reconciliation over multiple frames.
 *
 * When the physics state snaps to a new position (due to reconciliation),
 * instead of showing the player jumping, we:
 * 1. Record the position delta as a "visual offset"
 * 2. Render the player at (physics position + offset)
 * 3. Decay the offset toward zero over time
 *
 * This creates smooth visual transitions while maintaining correct physics state.
 *
 * @example
 * ```ts
 * const smoother = new VisualSmoother();
 *
 * // On reconciliation (physics snapped from 50 to 52)
 * smoother.onReconciliationSnap(-2, 0); // offset = oldPos - newPos
 *
 * // Each render frame
 * smoother.update(16.67); // ~60fps
 * const offset = smoother.getOffset();
 * const visualPos = { x: physicsPos.x + offset.x, y: physicsPos.y + offset.y };
 * ```
 */
export class VisualSmoother {
  private offsetX: number = 0;
  private offsetY: number = 0;
  private config: VisualSmootherConfig;

  /**
   * Create a new VisualSmoother.
   *
   * @param config - Optional configuration overrides
   */
  constructor(config: Partial<VisualSmootherConfig> = {}) {
    this.config = { ...DEFAULT_VISUAL_SMOOTHER_CONFIG, ...config };
  }

  /**
   * Called when reconciliation causes a position snap.
   *
   * The delta should be (oldPosition - newPosition), i.e., the vector from
   * the new physics position back to where the visual was before.
   *
   * If the delta magnitude exceeds snapThreshold, the offset is cleared
   * instead of accumulated (for teleports/respawns).
   *
   * @param deltaX - X component of position change (oldX - newX)
   * @param deltaY - Y component of position change (oldY - newY)
   */
  onReconciliationSnap(deltaX: number, deltaY: number): void {
    const magnitude = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Large snaps (teleports, respawns) should not be smoothed
    if (magnitude > this.config.snapThreshold) {
      this.offsetX = 0;
      this.offsetY = 0;
      return;
    }

    // Accumulate the offset
    this.offsetX += deltaX;
    this.offsetY += deltaY;
  }

  /**
   * Update the visual offset, decaying it toward zero.
   *
   * Call this every render frame. The decay is frame-rate independent,
   * so clients at 60fps, 120fps, or 240fps will all see similar smoothing.
   *
   * @param deltaTimeMs - Time since last frame in milliseconds
   */
  update(deltaTimeMs: number): void {
    // Frame-rate independent exponential decay
    // decay = smoothFactor^(dt/16.67) for 60fps reference
    const referenceFrameMs = 1000 / 60; // ~16.67ms
    const decay = Math.pow(this.config.smoothFactor, deltaTimeMs / referenceFrameMs);

    this.offsetX *= decay;
    this.offsetY *= decay;

    // Clear very small offsets to avoid floating point drift
    const epsilon = 0.01;
    if (Math.abs(this.offsetX) < epsilon) this.offsetX = 0;
    if (Math.abs(this.offsetY) < epsilon) this.offsetY = 0;
  }

  /**
   * Get the current visual offset to apply to the physics position.
   *
   * Add this offset to the physics position when rendering:
   * `visualPos = physicsPos + offset`
   *
   * @returns Current visual offset
   */
  getOffset(): VisualOffset {
    return { x: this.offsetX, y: this.offsetY };
  }

  /**
   * Check if there's any significant visual offset remaining.
   *
   * @returns True if offset magnitude > 0.01
   */
  hasOffset(): boolean {
    return Math.abs(this.offsetX) > 0.01 || Math.abs(this.offsetY) > 0.01;
  }

  /**
   * Reset the visual offset to zero.
   *
   * Call this when the game state is reset (level change, respawn, etc.)
   */
  reset(): void {
    this.offsetX = 0;
    this.offsetY = 0;
  }

  /**
   * Update the configuration.
   *
   * @param config - New configuration values
   */
  setConfig(config: Partial<VisualSmootherConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the current configuration.
   *
   * @returns Current configuration
   */
  getConfig(): VisualSmootherConfig {
    return { ...this.config };
  }
}
