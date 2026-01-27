import { DEFAULT_SNAPSHOT_HISTORY_SIZE } from "../constants.js";
import type { Snapshot } from "./types.js";

/**
 * Maintains a history of world snapshots for lag compensation and rollback.
 * Generic version that works with any world state type.
 */
export class SnapshotBuffer<TWorld> {
  private snapshots: Snapshot<TWorld>[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = DEFAULT_SNAPSHOT_HISTORY_SIZE) {
    this.maxSize = maxSize;
  }

  /**
   * Add a new snapshot to the history
   */
  add(snapshot: Snapshot<TWorld>): void {
    this.snapshots.push(snapshot);

    // Keep only the most recent snapshots
    if (this.snapshots.length > this.maxSize) {
      this.snapshots.shift();
    }
  }

  /**
   * Get a snapshot at a specific tick
   */
  getAtTick(tick: number): Snapshot<TWorld> | undefined {
    return this.snapshots.find((s) => s.tick === tick);
  }

  /**
   * Get the most recent snapshot
   */
  getLatest(): Snapshot<TWorld> | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  /**
   * Get a snapshot closest to a specific timestamp (for lag compensation)
   */
  getAtTimestamp(timestamp: number): Snapshot<TWorld> | undefined {
    if (this.snapshots.length === 0) {
      return undefined;
    }

    // Find the snapshot closest to the requested timestamp
    // We know snapshots[0] exists since we checked length > 0
    let closest: Snapshot<TWorld> | undefined = this.snapshots[0];
    let minDiff = closest ? Math.abs(closest.timestamp - timestamp) : Infinity;

    for (const snapshot of this.snapshots) {
      const diff = Math.abs(snapshot.timestamp - timestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closest = snapshot;
      }
    }

    return closest;
  }

  /**
   * Get all snapshots between two ticks (inclusive)
   */
  getRange(startTick: number, endTick: number): Snapshot<TWorld>[] {
    return this.snapshots.filter((s) => s.tick >= startTick && s.tick <= endTick);
  }

  /**
   * Clear all snapshots
   */
  clear(): void {
    this.snapshots = [];
  }

  /**
   * Get the number of stored snapshots
   */
  size(): number {
    return this.snapshots.length;
  }

  /**
   * Get all stored snapshots (ordered by tick, oldest first)
   */
  getAll(): Snapshot<TWorld>[] {
    return [...this.snapshots];
  }

  /**
   * Get the two snapshots that bracket a target timestamp (for interpolation).
   * Returns { from, to, alpha } where alpha is the interpolation factor (0..1).
   * If exact match or only one snapshot available, from === to and alpha = 0.
   */
  getBracketingSnapshots(targetTimestamp: number): {
    from: Snapshot<TWorld>;
    to: Snapshot<TWorld>;
    alpha: number;
  } | null {
    if (this.snapshots.length === 0) {
      return null;
    }
    if (this.snapshots.length === 1) {
      return { from: this.snapshots[0]!, to: this.snapshots[0]!, alpha: 0 };
    }

    // Find the first snapshot with timestamp > targetTimestamp (the "to" snapshot)
    let toIndex = this.snapshots.findIndex((s) => s.timestamp > targetTimestamp);

    if (toIndex === -1) {
      // All snapshots are <= target, use the last two
      toIndex = this.snapshots.length - 1;
    }
    if (toIndex === 0) {
      // All snapshots are > target, use the first one
      return { from: this.snapshots[0]!, to: this.snapshots[0]!, alpha: 0 };
    }

    const from = this.snapshots[toIndex - 1]!;
    const to = this.snapshots[toIndex]!;

    const timeDiff = to.timestamp - from.timestamp;
    if (timeDiff <= 0) {
      return { from, to, alpha: 0 };
    }

    const alpha = Math.max(0, Math.min(1, (targetTimestamp - from.timestamp) / timeDiff));
    return { from, to, alpha };
  }
}
