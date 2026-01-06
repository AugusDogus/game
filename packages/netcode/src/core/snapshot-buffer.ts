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
    let closest = this.snapshots[0]!;
    let minDiff = Math.abs(closest.timestamp - timestamp);

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
}
