import { DEFAULT_INTERPOLATION_DELAY_MS } from "../constants.js";
import type { Snapshot, InterpolateFunction } from "../core/types.js";
import { getFirst, getLast, getAt } from "../core/utils.js";

/**
 * Snapshot with client-side receive timestamp for interpolation
 */
interface TimestampedSnapshot<TWorld> {
  snapshot: Snapshot<TWorld>;
  /** Client-local time when this snapshot was received */
  receivedAt: number;
}

/**
 * Handles entity interpolation by buffering snapshots and interpolating between past states.
 * Generic version that works with any world state type.
 *
 * Key concept: We render other entities "in the past" so we always have two snapshots
 * to interpolate between, ensuring smooth movement even with network jitter.
 *
 * IMPORTANT: We use client-local receive timestamps, NOT server timestamps, because
 * client and server clocks may differ significantly.
 */
export class Interpolator<TWorld> {
  private snapshots: TimestampedSnapshot<TWorld>[] = [];
  private interpolationDelay: number;
  private interpolate: InterpolateFunction<TWorld>;

  constructor(
    interpolate: InterpolateFunction<TWorld>,
    interpolationDelayMs: number = DEFAULT_INTERPOLATION_DELAY_MS,
  ) {
    this.interpolate = interpolate;
    this.interpolationDelay = interpolationDelayMs;
  }

  /**
   * Add a new snapshot to the buffer
   */
  addSnapshot(snapshot: Snapshot<TWorld>): void {
    const receivedAt = Date.now();

    // Simply append - snapshots should arrive roughly in order
    // and we use receivedAt for interpolation anyway
    this.snapshots.push({ snapshot, receivedAt });

    // Keep enough snapshots for smooth interpolation
    // At 20Hz with 100ms delay, we need at least 2-3 snapshots
    // Keep extra for jitter tolerance
    const maxSnapshots = 20;
    while (this.snapshots.length > maxSnapshots) {
      this.snapshots.shift();
    }
  }

  /**
   * Get interpolated world state for rendering.
   * Returns state interpolated to a time in the past (by interpolationDelay).
   */
  getInterpolatedState(): TWorld | null {
    if (this.snapshots.length === 0) {
      return null;
    }

    // Use client-local time for everything
    const now = Date.now();
    const renderTime = now - this.interpolationDelay;

    // If we only have one snapshot, just return it
    if (this.snapshots.length === 1) {
      return getFirst(this.snapshots, "snapshots").snapshot.state;
    }

    // Find two snapshots to interpolate between based on CLIENT receive time
    let older: TimestampedSnapshot<TWorld> | undefined;
    let newer: TimestampedSnapshot<TWorld> | undefined;

    for (let i = 0; i < this.snapshots.length - 1; i++) {
      const s1 = getAt(this.snapshots, i, "snapshots");
      const s2 = getAt(this.snapshots, i + 1, "snapshots");

      if (s1.receivedAt <= renderTime && renderTime <= s2.receivedAt) {
        older = s1;
        newer = s2;
        break;
      }
    }

    // If renderTime is before all snapshots (shouldn't happen normally)
    const firstSnapshot = getFirst(this.snapshots, "snapshots");
    if (!older && !newer && renderTime < firstSnapshot.receivedAt) {
      // We're trying to render before we have data - use oldest available
      return firstSnapshot.snapshot.state;
    }

    // If renderTime is after all snapshots (normal case when interpolation delay
    // is less than time since last snapshot), use the two newest
    if (!older && !newer) {
      older = this.snapshots[this.snapshots.length - 2];
      newer = this.snapshots[this.snapshots.length - 1];
    }

    if (!older || !newer) {
      // Fallback: return latest snapshot
      return getLast(this.snapshots, "snapshots").snapshot.state;
    }

    // Calculate interpolation factor based on client receive times
    const timeDiff = newer.receivedAt - older.receivedAt;
    if (timeDiff === 0) {
      return newer.snapshot.state;
    }

    const alpha = (renderTime - older.receivedAt) / timeDiff;
    // Clamp between 0 and 1 - no extrapolation, just interpolation
    const clampedAlpha = Math.max(0, Math.min(1, alpha));

    // Use game-provided interpolation function
    return this.interpolate(older.snapshot.state, newer.snapshot.state, clampedAlpha);
  }

  /**
   * Get the latest snapshot (uninterpolated)
   */
  getLatestSnapshot(): Snapshot<TWorld> | null {
    if (this.snapshots.length === 0) {
      return null;
    }
    return getLast(this.snapshots, "snapshots").snapshot;
  }

  /**
   * Clear all buffered snapshots
   */
  clear(): void {
    this.snapshots = [];
  }

  /**
   * Get the number of buffered snapshots
   */
  size(): number {
    return this.snapshots.length;
  }
}
