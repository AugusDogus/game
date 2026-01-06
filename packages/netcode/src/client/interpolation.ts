import type { PlayerState, WorldSnapshot } from "../types.js";
import { DEFAULT_INTERPOLATION_DELAY_MS } from "../constants.js";

/**
 * Snapshot with client-side receive timestamp for interpolation
 */
interface TimestampedSnapshot {
  snapshot: WorldSnapshot;
  /** Client-local time when this snapshot was received */
  receivedAt: number;
}

/**
 * Handles entity interpolation by buffering snapshots and interpolating between past states.
 * 
 * Key concept: We render other entities "in the past" so we always have two snapshots
 * to interpolate between, ensuring smooth movement even with network jitter.
 * 
 * IMPORTANT: We use client-local receive timestamps, NOT server timestamps, because
 * client and server clocks may differ significantly.
 */
export class Interpolator {
  private snapshots: TimestampedSnapshot[] = [];
  private interpolationDelay: number;

  constructor(interpolationDelayMs: number = DEFAULT_INTERPOLATION_DELAY_MS) {
    this.interpolationDelay = interpolationDelayMs;
  }

  /**
   * Add a new snapshot to the buffer
   */
  addSnapshot(snapshot: WorldSnapshot): void {
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
   * Get interpolated player states for rendering.
   * Returns states interpolated to a time in the past (by interpolationDelay).
   */
  getInterpolatedStates(): PlayerState[] {
    if (this.snapshots.length === 0) {
      return [];
    }

    // Use client-local time for everything
    const now = Date.now();
    const renderTime = now - this.interpolationDelay;

    // If we only have one snapshot, just return it
    if (this.snapshots.length === 1) {
      return this.snapshots[0]!.snapshot.players;
    }

    // Find two snapshots to interpolate between based on CLIENT receive time
    let older: TimestampedSnapshot | undefined;
    let newer: TimestampedSnapshot | undefined;

    for (let i = 0; i < this.snapshots.length - 1; i++) {
      const s1 = this.snapshots[i]!;
      const s2 = this.snapshots[i + 1]!;

      if (s1.receivedAt <= renderTime && renderTime <= s2.receivedAt) {
        older = s1;
        newer = s2;
        break;
      }
    }

    // If renderTime is before all snapshots (shouldn't happen normally)
    if (!older && !newer && renderTime < this.snapshots[0]!.receivedAt) {
      // We're trying to render before we have data - use oldest available
      return this.snapshots[0]!.snapshot.players;
    }

    // If renderTime is after all snapshots (normal case when interpolation delay
    // is less than time since last snapshot), use the two newest
    if (!older && !newer) {
      older = this.snapshots[this.snapshots.length - 2];
      newer = this.snapshots[this.snapshots.length - 1];
    }

    if (!older || !newer) {
      // Fallback: return latest snapshot
      return this.snapshots[this.snapshots.length - 1]?.snapshot.players ?? [];
    }

    // Calculate interpolation factor based on client receive times
    const timeDiff = newer.receivedAt - older.receivedAt;
    if (timeDiff === 0) {
      return newer.snapshot.players;
    }

    const alpha = (renderTime - older.receivedAt) / timeDiff;
    // Clamp between 0 and 1 - no extrapolation, just interpolation
    const clampedAlpha = Math.max(0, Math.min(1, alpha));

    // Create interpolated states for each player
    const interpolated: PlayerState[] = [];
    const olderPlayerMap = new Map(older.snapshot.players.map((p) => [p.id, p]));
    const newerPlayerMap = new Map(newer.snapshot.players.map((p) => [p.id, p]));

    // Process all players from the newer snapshot
    for (const newPlayer of newer.snapshot.players) {
      const oldPlayer = olderPlayerMap.get(newPlayer.id);
      if (!oldPlayer) {
        // Player is new, just use their current state
        interpolated.push(newPlayer);
        continue;
      }

      // Linear interpolation of position
      const interpolatedPlayer: PlayerState = {
        ...newPlayer,
        position: {
          x: oldPlayer.position.x + (newPlayer.position.x - oldPlayer.position.x) * clampedAlpha,
          y: oldPlayer.position.y + (newPlayer.position.y - oldPlayer.position.y) * clampedAlpha,
        },
        velocity: {
          x: oldPlayer.velocity.x + (newPlayer.velocity.x - oldPlayer.velocity.x) * clampedAlpha,
          y: oldPlayer.velocity.y + (newPlayer.velocity.y - oldPlayer.velocity.y) * clampedAlpha,
        },
      };

      interpolated.push(interpolatedPlayer);
    }

    // Include players that were in older but not in newer (recently left)
    for (const oldPlayer of older.snapshot.players) {
      if (!newerPlayerMap.has(oldPlayer.id)) {
        interpolated.push(oldPlayer);
      }
    }

    return interpolated;
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
