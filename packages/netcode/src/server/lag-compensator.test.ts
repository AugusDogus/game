import { describe, it, expect, beforeEach } from "bun:test";
import { LagCompensator } from "./lag-compensator.js";
import { SnapshotBuffer } from "../core/snapshot-buffer.js";
import type { Snapshot } from "../core/types.js";

interface TestWorld {
  players: Map<string, { x: number; y: number }>;
}

describe("LagCompensator", () => {
  let snapshotBuffer: SnapshotBuffer<TestWorld>;
  let compensator: LagCompensator<TestWorld>;

  beforeEach(() => {
    snapshotBuffer = new SnapshotBuffer<TestWorld>(10);
    compensator = new LagCompensator(snapshotBuffer, {
      maxRewindMs: 200,
      interpolationDelayMs: 100,
    });
  });

  describe("constructor", () => {
    it("should use default values when config not provided", () => {
      const defaultCompensator = new LagCompensator(snapshotBuffer);
      expect(defaultCompensator.getMaxRewindMs()).toBe(200);
      expect(defaultCompensator.getInterpolationDelayMs()).toBe(50);
    });

    it("should use provided config values", () => {
      const customCompensator = new LagCompensator(snapshotBuffer, {
        maxRewindMs: 300,
        interpolationDelayMs: 150,
      });
      expect(customCompensator.getMaxRewindMs()).toBe(300);
      expect(customCompensator.getInterpolationDelayMs()).toBe(150);
    });
  });

  describe("updateClientClock", () => {
    it("should store clock info for a client", () => {
      compensator.updateClientClock("client1", { clockOffset: 50, rtt: 100 });

      const info = compensator.getClientClockInfo("client1");
      expect(info).toBeDefined();
      expect(info?.clockOffset).toBe(50);
      expect(info?.rtt).toBe(100);
    });

    it("should update existing clock info", () => {
      compensator.updateClientClock("client1", { clockOffset: 50, rtt: 100 });
      compensator.updateClientClock("client1", { clockOffset: 60 });

      const info = compensator.getClientClockInfo("client1");
      expect(info?.clockOffset).toBe(60);
      expect(info?.rtt).toBe(100); // Preserved from previous
    });
  });

  describe("removeClient", () => {
    it("should remove clock info for a client", () => {
      compensator.updateClientClock("client1", { clockOffset: 50, rtt: 100 });
      compensator.removeClient("client1");

      expect(compensator.getClientClockInfo("client1")).toBeUndefined();
    });
  });

  describe("calculateRewindTimestamp", () => {
    it("should use clock offset when available", () => {
      compensator.updateClientClock("client1", { clockOffset: 50, rtt: 100 });

      // Use a recent timestamp to avoid clamping
      const now = Date.now();
      const clientTimestamp = now - 50; // 50ms ago from client perspective
      const result = compensator.calculateRewindTimestamp("client1", clientTimestamp);

      // serverTime = clientTime + clockOffset - interpolationDelay
      // = (now - 50) + 50 - 100 = now - 100
      // But clamped to now - maxRewindMs (200), so result should be now - 100
      expect(result).toBeGreaterThanOrEqual(now - 200);
      expect(result).toBeLessThanOrEqual(now);
      // More specifically, it should be approximately now - 100
      expect(Math.abs(result - (now - 100))).toBeLessThan(10);
    });

    it("should treat clockOffset=0 as valid synchronized offset", () => {
      // clockOffset of 0 means clocks are perfectly synchronized
      compensator.updateClientClock("client1", { clockOffset: 0, rtt: 100 });

      const now = Date.now();
      const clientTimestamp = now - 50;
      const result = compensator.calculateRewindTimestamp("client1", clientTimestamp);

      // serverTime = clientTime + clockOffset - interpolationDelay
      // = (now - 50) + 0 - 100 = now - 150
      expect(result).toBeGreaterThanOrEqual(now - 200);
      expect(result).toBeLessThanOrEqual(now);
      // Should be approximately now - 150
      expect(Math.abs(result - (now - 150))).toBeLessThan(10);
    });

    it("should fall back to now - interpolationDelay when no clock info", () => {
      // No updateClientClock called - no clock info exists
      const now = Date.now();
      const result = compensator.calculateRewindTimestamp("unknown-client", now);

      // Should be approximately now - interpolationDelay = now - 100
      expect(result).toBeGreaterThanOrEqual(now - 200);
      expect(result).toBeLessThanOrEqual(now);
      expect(Math.abs(result - (now - 100))).toBeLessThan(10);
    });

    it("should clamp to maxRewindMs", () => {
      compensator.updateClientClock("client1", { clockOffset: -1000, rtt: 100 });

      const clientTimestamp = 0; // Very old timestamp
      const now = Date.now();
      const result = compensator.calculateRewindTimestamp("client1", clientTimestamp);

      // Should be clamped to now - maxRewindMs
      expect(result).toBeGreaterThanOrEqual(now - 200);
    });
  });

  describe("getHistoricalSnapshot", () => {
    it("should return closest snapshot to timestamp", () => {
      const snapshot1: Snapshot<TestWorld> = {
        tick: 1,
        timestamp: 1000,
        state: { players: new Map([["p1", { x: 0, y: 0 }]]) },
        inputAcks: new Map(),
      };
      const snapshot2: Snapshot<TestWorld> = {
        tick: 2,
        timestamp: 1050,
        state: { players: new Map([["p1", { x: 10, y: 0 }]]) },
        inputAcks: new Map(),
      };

      snapshotBuffer.add(snapshot1);
      snapshotBuffer.add(snapshot2);

      // Closer to snapshot1
      expect(compensator.getHistoricalSnapshot(1010)?.tick).toBe(1);
      // Closer to snapshot2
      expect(compensator.getHistoricalSnapshot(1040)?.tick).toBe(2);
    });

    it("should return undefined when buffer is empty", () => {
      expect(compensator.getHistoricalSnapshot(1000)).toBeUndefined();
    });
  });

  describe("validateAction", () => {
    it("should validate action against historical state", () => {
      // Add a snapshot
      const snapshot: Snapshot<TestWorld> = {
        tick: 1,
        timestamp: Date.now() - 50,
        state: { players: new Map([["target", { x: 100, y: 100 }]]) },
        inputAcks: new Map(),
      };
      snapshotBuffer.add(snapshot);

      // Set up clock for attacker
      compensator.updateClientClock("attacker", { clockOffset: 0, rtt: 50 });

      // Validator that checks if target is at position
      const validator = (
        world: TestWorld,
        clientId: string,
        action: { targetX: number; targetY: number },
      ) => {
        const target = world.players.get("target");
        if (!target) return { success: false };

        const dx = target.x - action.targetX;
        const dy = target.y - action.targetY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 50) {
          return { success: true, result: { hit: true } };
        }
        return { success: false };
      };

      // Action targeting where the player was
      const result = compensator.validateAction(
        "attacker",
        { targetX: 100, targetY: 100 },
        Date.now(),
        validator,
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ hit: true });
      expect(result.rewoundTick).toBe(1);
    });

    it("should return failure when no snapshot available", () => {
      const validator = () => ({ success: true });

      const result = compensator.validateAction("attacker", {}, Date.now(), validator);

      expect(result.success).toBe(false);
      expect(result.rewoundTick).toBe(-1);
    });

    it("should pass correct clientId to validator", () => {
      const snapshot: Snapshot<TestWorld> = {
        tick: 1,
        timestamp: Date.now(),
        state: { players: new Map() },
        inputAcks: new Map(),
      };
      snapshotBuffer.add(snapshot);

      let receivedClientId = "";
      const validator = (_world: TestWorld, clientId: string) => {
        receivedClientId = clientId;
        return { success: true };
      };

      compensator.validateAction("test-client", {}, Date.now(), validator);

      expect(receivedClientId).toBe("test-client");
    });
  });
});
