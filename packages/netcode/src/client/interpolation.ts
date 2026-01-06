import type { PlayerState, WorldSnapshot } from "../types.js";
import { DEFAULT_INTERPOLATION_DELAY_MS } from "../constants.js";

/**
 * Handles entity interpolation by buffering snapshots and interpolating between past states
 */
export class Interpolator {
  private snapshots: WorldSnapshot[] = [];
  private interpolationDelay: number;

  constructor(interpolationDelayMs: number = DEFAULT_INTERPOLATION_DELAY_MS) {
    this.interpolationDelay = interpolationDelayMs;
  }

  /**
   * Add a new snapshot to the buffer
   */
  addSnapshot(snapshot: WorldSnapshot): void {
    this.snapshots.push(snapshot);

    // Keep only recent snapshots (last 10 should be enough)
    if (this.snapshots.length > 10) {
      this.snapshots.shift();
    }
  }

  /**
   * Get interpolated player states for rendering
   * Returns states interpolated to a time in the past (by interpolationDelay)
   */
  getInterpolatedStates(): PlayerState[] {
    const now = Date.now();
    const renderTime = now - this.interpolationDelay;

    if (this.snapshots.length < 2) {
      // Not enough data, return latest snapshot or empty
      const latest = this.snapshots[this.snapshots.length - 1];
      return latest?.players ?? [];
    }

    // Find two snapshots to interpolate between
    let older: WorldSnapshot | undefined;
    let newer: WorldSnapshot | undefined;

    for (let i = 0; i < this.snapshots.length - 1; i++) {
      const s1 = this.snapshots[i]!;
      const s2 = this.snapshots[i + 1]!;

      if (s1.timestamp <= renderTime && renderTime <= s2.timestamp) {
        older = s1;
        newer = s2;
        break;
      }
    }

    // If we couldn't find a range, use the two most recent snapshots
    if (!older || !newer) {
      older = this.snapshots[this.snapshots.length - 2];
      newer = this.snapshots[this.snapshots.length - 1];
    }

    if (!older || !newer) {
      return [];
    }

    // Interpolate between the two snapshots
    const timeDiff = newer.timestamp - older.timestamp;
    if (timeDiff === 0) {
      return newer.players;
    }

    const alpha = (renderTime - older.timestamp) / timeDiff;
    const clampedAlpha = Math.max(0, Math.min(1, alpha));

    // Create interpolated states for each player
    const interpolated: PlayerState[] = [];
    const playerMap = new Map(older.players.map((p) => [p.id, p]));

    for (const newPlayer of newer.players) {
      const oldPlayer = playerMap.get(newPlayer.id);
      if (!oldPlayer) {
        // Player didn't exist in older snapshot, use newer state
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
        // Use newer velocity (or could interpolate this too)
        velocity: newPlayer.velocity,
      };

      interpolated.push(interpolatedPlayer);
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
