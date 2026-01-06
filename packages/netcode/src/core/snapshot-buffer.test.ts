import { describe, expect, test, beforeEach } from "bun:test";
import { SnapshotBuffer } from "./snapshot-buffer.js";
import type { Snapshot } from "./types.js";

interface TestWorld {
  value: number;
}

describe("SnapshotBuffer", () => {
  let buffer: SnapshotBuffer<TestWorld>;

  beforeEach(() => {
    buffer = new SnapshotBuffer<TestWorld>(5);
  });

  const createSnapshot = (tick: number, timestamp: number, value: number): Snapshot<TestWorld> => ({
    tick,
    timestamp,
    state: { value },
    inputAcks: new Map(),
  });

  describe("add", () => {
    test("should add snapshot to buffer", () => {
      buffer.add(createSnapshot(1, 1000, 10));
      expect(buffer.size()).toBe(1);
    });

    test("should maintain insertion order", () => {
      buffer.add(createSnapshot(3, 3000, 30));
      buffer.add(createSnapshot(1, 1000, 10));
      buffer.add(createSnapshot(2, 2000, 20));

      // Latest is the last one added, not the highest tick
      const latest = buffer.getLatest();
      expect(latest?.tick).toBe(2);
    });

    test("should limit buffer size", () => {
      for (let i = 0; i < 10; i++) {
        buffer.add(createSnapshot(i, i * 1000, i * 10));
      }
      expect(buffer.size()).toBe(5);
    });

    test("should remove oldest snapshots when full", () => {
      for (let i = 0; i < 10; i++) {
        buffer.add(createSnapshot(i, i * 1000, i * 10));
      }

      // Should only have ticks 5-9
      expect(buffer.getAtTick(4)).toBeUndefined();
      expect(buffer.getAtTick(5)).toBeDefined();
      expect(buffer.getAtTick(9)).toBeDefined();
    });
  });

  describe("getLatest", () => {
    test("should return undefined when empty", () => {
      expect(buffer.getLatest()).toBeUndefined();
    });

    test("should return most recently added snapshot", () => {
      buffer.add(createSnapshot(1, 1000, 10));
      buffer.add(createSnapshot(3, 3000, 30));
      buffer.add(createSnapshot(2, 2000, 20));

      // Latest is the last one added
      const latest = buffer.getLatest();
      expect(latest?.tick).toBe(2);
      expect(latest?.state.value).toBe(20);
    });
  });

  describe("getAtTick", () => {
    test("should return undefined for non-existent tick", () => {
      buffer.add(createSnapshot(1, 1000, 10));
      expect(buffer.getAtTick(2)).toBeUndefined();
    });

    test("should return snapshot at specific tick", () => {
      buffer.add(createSnapshot(1, 1000, 10));
      buffer.add(createSnapshot(2, 2000, 20));
      buffer.add(createSnapshot(3, 3000, 30));

      const snapshot = buffer.getAtTick(2);
      expect(snapshot?.tick).toBe(2);
      expect(snapshot?.state.value).toBe(20);
    });
  });

  describe("getAtTimestamp", () => {
    test("should return undefined when empty", () => {
      expect(buffer.getAtTimestamp(1000)).toBeUndefined();
    });

    test("should return exact match", () => {
      buffer.add(createSnapshot(1, 1000, 10));
      buffer.add(createSnapshot(2, 2000, 20));

      const snapshot = buffer.getAtTimestamp(1000);
      expect(snapshot?.tick).toBe(1);
    });

    test("should return closest snapshot before timestamp", () => {
      buffer.add(createSnapshot(1, 1000, 10));
      buffer.add(createSnapshot(2, 2000, 20));
      buffer.add(createSnapshot(3, 3000, 30));

      const snapshot = buffer.getAtTimestamp(2500);
      expect(snapshot?.tick).toBe(2);
    });

    test("should return earliest if timestamp is before all", () => {
      buffer.add(createSnapshot(1, 1000, 10));
      buffer.add(createSnapshot(2, 2000, 20));

      const snapshot = buffer.getAtTimestamp(500);
      expect(snapshot?.tick).toBe(1);
    });
  });

  describe("clear", () => {
    test("should remove all snapshots", () => {
      buffer.add(createSnapshot(1, 1000, 10));
      buffer.add(createSnapshot(2, 2000, 20));

      buffer.clear();

      expect(buffer.size()).toBe(0);
      expect(buffer.getLatest()).toBeUndefined();
    });
  });

  describe("real-world scenarios", () => {
    test("lag compensation: find snapshot at client timestamp for hit detection", () => {
      // Server stores snapshots at 20Hz (50ms intervals)
      buffer.add(createSnapshot(1, 1000, 10));
      buffer.add(createSnapshot(2, 1050, 15));
      buffer.add(createSnapshot(3, 1100, 20));
      buffer.add(createSnapshot(4, 1150, 25));
      buffer.add(createSnapshot(5, 1200, 30));

      // Client sends a shot with timestamp 1075 (between ticks 2 and 3)
      const hitSnapshot = buffer.getAtTimestamp(1075);

      // Should return tick 2 (the last snapshot before the client's timestamp)
      expect(hitSnapshot?.tick).toBe(2);
    });

    test("reconciliation: find snapshot by server tick", () => {
      buffer.add(createSnapshot(100, 5000, 100));
      buffer.add(createSnapshot(101, 5050, 101));
      buffer.add(createSnapshot(102, 5100, 102));

      // Client receives ack for tick 101
      const snapshot = buffer.getAtTick(101);
      expect(snapshot?.state.value).toBe(101);
    });
  });
});
