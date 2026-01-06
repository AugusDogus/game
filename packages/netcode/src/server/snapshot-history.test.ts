import { describe, test, expect, beforeEach } from "bun:test";
import { SnapshotHistory } from "./snapshot-history.js";
import type { WorldSnapshot } from "../types.js";

describe("SnapshotHistory", () => {
  let history: SnapshotHistory;

  beforeEach(() => {
    history = new SnapshotHistory(5); // Small size for testing
  });

  const createSnapshot = (tick: number, timestamp: number): WorldSnapshot => ({
    tick,
    timestamp,
    players: [],
    acks: {},
  });

  describe("add", () => {
    test("should add snapshot to history", () => {
      const snapshot = createSnapshot(0, 1000);
      history.add(snapshot);

      expect(history.size()).toBe(1);
    });

    test("should respect max size", () => {
      for (let i = 0; i < 10; i++) {
        history.add(createSnapshot(i, 1000 + i * 100));
      }

      expect(history.size()).toBe(5);
    });

    test("should keep most recent snapshots", () => {
      for (let i = 0; i < 10; i++) {
        history.add(createSnapshot(i, 1000 + i * 100));
      }

      // Should have ticks 5-9
      expect(history.getAtTick(4)).toBeUndefined();
      expect(history.getAtTick(5)).toBeDefined();
      expect(history.getAtTick(9)).toBeDefined();
    });
  });

  describe("getAtTick", () => {
    test("should return snapshot at specific tick", () => {
      history.add(createSnapshot(0, 1000));
      history.add(createSnapshot(1, 1100));
      history.add(createSnapshot(2, 1200));

      const snapshot = history.getAtTick(1);
      expect(snapshot?.tick).toBe(1);
      expect(snapshot?.timestamp).toBe(1100);
    });

    test("should return undefined for non-existent tick", () => {
      history.add(createSnapshot(0, 1000));

      expect(history.getAtTick(99)).toBeUndefined();
    });
  });

  describe("getLatest", () => {
    test("should return most recent snapshot", () => {
      history.add(createSnapshot(0, 1000));
      history.add(createSnapshot(1, 1100));
      history.add(createSnapshot(2, 1200));

      const latest = history.getLatest();
      expect(latest?.tick).toBe(2);
    });

    test("should return undefined when empty", () => {
      expect(history.getLatest()).toBeUndefined();
    });
  });

  describe("getAtTimestamp", () => {
    test("should return snapshot closest to timestamp", () => {
      history.add(createSnapshot(0, 1000));
      history.add(createSnapshot(1, 1100));
      history.add(createSnapshot(2, 1200));

      // Closest to 1150 should be tick 1 (1100) or tick 2 (1200)
      const snapshot = history.getAtTimestamp(1150);
      expect(snapshot?.tick).toBe(1); // 1100 is closer to 1150 than 1200
    });

    test("should return exact match", () => {
      history.add(createSnapshot(0, 1000));
      history.add(createSnapshot(1, 1100));

      const snapshot = history.getAtTimestamp(1100);
      expect(snapshot?.tick).toBe(1);
    });

    test("should return undefined when empty", () => {
      expect(history.getAtTimestamp(1000)).toBeUndefined();
    });
  });

  describe("getRange", () => {
    test("should return snapshots in tick range", () => {
      for (let i = 0; i < 5; i++) {
        history.add(createSnapshot(i, 1000 + i * 100));
      }

      const range = history.getRange(1, 3);
      expect(range).toHaveLength(3);
      expect(range.map((s) => s.tick)).toEqual([1, 2, 3]);
    });

    test("should return empty array for out-of-range", () => {
      history.add(createSnapshot(0, 1000));

      const range = history.getRange(10, 20);
      expect(range).toHaveLength(0);
    });
  });

  describe("clear", () => {
    test("should remove all snapshots", () => {
      history.add(createSnapshot(0, 1000));
      history.add(createSnapshot(1, 1100));

      history.clear();

      expect(history.size()).toBe(0);
      expect(history.getLatest()).toBeUndefined();
    });
  });
});
