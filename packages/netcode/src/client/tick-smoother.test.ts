import { describe, expect, test, beforeEach } from "bun:test";
import { TickSmoother, DEFAULT_TICK_SMOOTHER_CONFIG } from "./tick-smoother.js";

describe("TickSmoother", () => {
  let smoother: TickSmoother;

  beforeEach(() => {
    smoother = new TickSmoother();
  });

  describe("onPostTick", () => {
    test("first tick initializes position without queueing", () => {
      smoother.onPostTick(1, 100, 50);
      // First tick initializes current position but doesn't queue
      expect(smoother.getQueueLength()).toBe(0);
      
      // Position should be set
      const pos = smoother.getSmoothedPosition(0);
      expect(pos.x).toBe(100);
      expect(pos.y).toBe(50);
    });

    test("subsequent ticks add to queue", () => {
      smoother.onPostTick(1, 0, 0);    // Initialize
      smoother.onPostTick(2, 100, 50); // Queue
      expect(smoother.getQueueLength()).toBe(1);
    });

    test("should ignore duplicate ticks", () => {
      smoother.onPostTick(1, 0, 0);
      smoother.onPostTick(2, 100, 50);
      smoother.onPostTick(2, 200, 100); // Same tick, different position
      expect(smoother.getQueueLength()).toBe(1);
    });

    test("should maintain tick order for out-of-order entries", () => {
      smoother.onPostTick(1, 0, 0);     // Initialize
      smoother.onPostTick(3, 300, 150); // Queue
      smoother.onPostTick(2, 200, 100); // Queue (out of order)
      smoother.onPostTick(4, 400, 200); // Queue
      expect(smoother.getQueueLength()).toBe(3);
    });

    test("should discard excess entries when buffer exceeds max", () => {
      // Default: interpolation 1 + maxOverBuffer 3 = 4 max entries
      smoother.onPostTick(1, 0, 0);     // Initialize
      smoother.onPostTick(2, 100, 50);  // Queue
      smoother.onPostTick(3, 200, 100);
      smoother.onPostTick(4, 300, 150);
      smoother.onPostTick(5, 400, 200);
      smoother.onPostTick(6, 500, 250); // Should trigger discard

      // Should have 4 entries max
      expect(smoother.getQueueLength()).toBeLessThanOrEqual(4);
    });
  });

  describe("getSmoothedPosition", () => {
    test("should return zero position when uninitialized", () => {
      const pos = smoother.getSmoothedPosition(16.67);
      expect(pos.x).toBe(0);
      expect(pos.y).toBe(0);
    });

    test("should return initialized position after first tick", () => {
      smoother.onPostTick(1, 100, 50);
      const pos = smoother.getSmoothedPosition(16.67);
      expect(pos.x).toBe(100);
      expect(pos.y).toBe(50);
    });

    test("should move toward target position over time", () => {
      smoother.onPostTick(1, 0, 0);    // Initialize at 0,0
      smoother.onPostTick(2, 100, 0);  // Queue target at 100,0
      
      // After some time, should be between 0 and 100
      const pos = smoother.getSmoothedPosition(8); // Half a tick
      expect(pos.x).toBeGreaterThan(0);
      expect(pos.x).toBeLessThan(100);
    });

    test("should reach target position after full tick duration", () => {
      smoother.onPostTick(1, 0, 0);
      smoother.onPostTick(2, 100, 0);
      
      // After enough time, should reach target
      const pos = smoother.getSmoothedPosition(50);
      expect(pos.x).toBeCloseTo(100, 0);
    });

    test("should continue to next target after reaching first", () => {
      smoother.onPostTick(1, 0, 0);    // Initialize
      smoother.onPostTick(2, 100, 0);  // First target
      smoother.onPostTick(3, 200, 0);  // Second target
      
      // Consume first target
      smoother.getSmoothedPosition(50);
      
      // Continue toward second
      const pos = smoother.getSmoothedPosition(50);
      expect(pos.x).toBeGreaterThanOrEqual(100);
    });
  });

  describe("movement multiplier", () => {
    test("should speed up when buffer is too full", () => {
      smoother.onPostTick(1, 0, 0);  // Initialize
      smoother.onPostTick(2, 100, 0);
      smoother.onPostTick(3, 200, 0);
      smoother.onPostTick(4, 300, 0);
      
      // Movement multiplier should be > 1 (buffer over target)
      expect(smoother.getMovementMultiplier()).toBeGreaterThan(1.0);
    });

    test("should clamp multiplier to valid range", () => {
      smoother.onPostTick(0, 0, 0);  // Initialize
      for (let i = 1; i <= 20; i++) {
        smoother.onPostTick(i, i * 100, 0);
      }
      
      expect(smoother.getMovementMultiplier()).toBeLessThanOrEqual(1.05);
      expect(smoother.getMovementMultiplier()).toBeGreaterThanOrEqual(0.95);
    });
  });

  describe("onReconciliationReplay", () => {
    test("should update queued position", () => {
      smoother.onPostTick(1, 0, 0);    // Initialize
      smoother.onPostTick(2, 200, 100); // Queue
      
      // Correct tick 2's position
      smoother.onReconciliationReplay(2, 250, 125);
      
      // Queue should still have 1 entry
      expect(smoother.getQueueLength()).toBe(1);
    });

    test("should ignore corrections for ticks not in buffer", () => {
      smoother.onPostTick(1, 0, 0);    // Initialize
      smoother.onPostTick(2, 100, 50); // Queue
      
      // Try to correct tick that doesn't exist
      smoother.onReconciliationReplay(999, 999, 999);
      
      // Should not affect queue
      expect(smoother.getQueueLength()).toBe(1);
    });
  });

  describe("clear and reset", () => {
    test("should clear queue but keep current position", () => {
      smoother.onPostTick(1, 100, 50);  // Initialize
      smoother.onPostTick(2, 200, 100); // Queue
      
      // Consume some
      smoother.getSmoothedPosition(50);
      
      smoother.clear();
      
      expect(smoother.getQueueLength()).toBe(0);
      // Current position should be preserved
      const pos = smoother.getSmoothedPosition(0);
      expect(pos.x).not.toBe(0);
    });

    test("should fully reset including current position", () => {
      smoother.onPostTick(1, 100, 50);
      smoother.getSmoothedPosition(50);
      
      smoother.reset();
      
      expect(smoother.getQueueLength()).toBe(0);
      const pos = smoother.getSmoothedPosition(0);
      expect(pos.x).toBe(0);
      expect(pos.y).toBe(0);
    });

    test("should reset movement multiplier on clear", () => {
      smoother.onPostTick(0, 0, 0);  // Initialize
      for (let i = 1; i <= 10; i++) {
        smoother.onPostTick(i, i * 100, 0);
      }
      
      smoother.clear();
      
      expect(smoother.getMovementMultiplier()).toBe(1.0);
    });
  });

  describe("owner vs spectator mode", () => {
    test("should use owner interpolation ticks by default", () => {
      expect(smoother.getIsOwner()).toBe(true);
      expect(smoother.getInterpolationTicks()).toBe(DEFAULT_TICK_SMOOTHER_CONFIG.ownerInterpolationTicks);
    });

    test("should switch to spectator interpolation when setIsOwner(false)", () => {
      smoother.setIsOwner(false);
      expect(smoother.getIsOwner()).toBe(false);
      expect(smoother.getInterpolationTicks()).toBe(DEFAULT_TICK_SMOOTHER_CONFIG.spectatorInterpolationTicks);
    });
  });

  describe("edge cases", () => {
    test("should handle zero delta time", () => {
      smoother.onPostTick(1, 100, 50);
      const pos = smoother.getSmoothedPosition(0);
      expect(pos.x).toBe(100);
      expect(pos.y).toBe(50);
    });

    test("should handle very large delta times gracefully", () => {
      smoother.onPostTick(1, 0, 0);    // Initialize
      smoother.onPostTick(2, 100, 50); // Queue
      
      // Large delta should consume entry
      const pos = smoother.getSmoothedPosition(10000);
      expect(pos.x).toBe(100);
      expect(pos.y).toBe(50);
    });

    test("should handle negative positions", () => {
      smoother.onPostTick(1, -100, -50);
      const pos = smoother.getSmoothedPosition(0);
      expect(pos.x).toBe(-100);
      expect(pos.y).toBe(-50);
    });
  });

  describe("configuration", () => {
    test("should allow custom tick interval", () => {
      const customSmoother = new TickSmoother({
        tickIntervalMs: 33.33, // 30 TPS
      });
      
      customSmoother.onPostTick(1, 0, 0);
      customSmoother.onPostTick(2, 100, 0);
      
      // With longer tick interval, same deltaMs should produce less movement
      const pos = customSmoother.getSmoothedPosition(10);
      expect(pos.x).toBeGreaterThan(0);
      expect(pos.x).toBeLessThan(100);
    });

    test("should teleport when distance exceeds threshold", () => {
      const customSmoother = new TickSmoother({
        teleportThreshold: 50,
      });
      
      customSmoother.onPostTick(1, 0, 0);    // Initialize
      customSmoother.onPostTick(2, 100, 0);  // Queue - distance > 50
      
      // Should teleport instantly
      const pos = customSmoother.getSmoothedPosition(1); // Minimal delta
      expect(pos.x).toBe(100); // Teleported, not interpolated
    });
  });
});
