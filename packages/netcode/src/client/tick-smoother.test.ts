import { describe, expect, test, beforeEach } from "bun:test";
import { TickSmoother, AdaptiveInterpolationLevel, AdaptiveSmoothingType, DEFAULT_TICK_SMOOTHER_CONFIG } from "./tick-smoother.js";

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
      // Default owner: interpolation 1 + maxOverBuffer 3 = 4 max entries
      smoother.onPostTick(1, 0, 0);     // Initialize
      smoother.onPostTick(2, 100, 50);  // Queue
      smoother.onPostTick(3, 200, 100);
      smoother.onPostTick(4, 300, 150);
      smoother.onPostTick(5, 400, 200);
      smoother.onPostTick(6, 500, 250); // Should trigger discard

      // Should have 4 entries max (owner interpolation 1 + maxOverBuffer 3)
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
      
      // Movement multiplier should be > 1 (buffer over target for owner interp=1)
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
    test("should default to owner mode with fixed interpolation", () => {
      expect(smoother.getIsOwner()).toBe(true);
      expect(smoother.getInterpolation()).toBe(DEFAULT_TICK_SMOOTHER_CONFIG.ownerInterpolation);
    });

    test("should switch to spectator mode with fixed interpolation when adaptive is off", () => {
      const spectatorSmoother = new TickSmoother({
        adaptiveInterpolation: AdaptiveInterpolationLevel.Off,
      });
      spectatorSmoother.setIsOwner(false);
      
      expect(spectatorSmoother.getIsOwner()).toBe(false);
      expect(spectatorSmoother.getInterpolation()).toBe(DEFAULT_TICK_SMOOTHER_CONFIG.spectatorInterpolation);
    });

    test("owner should ignore adaptive interpolation updates", () => {
      smoother.setIsOwner(true);
      const initial = smoother.getInterpolation();
      
      // Try to update adaptive interpolation
      smoother.updateAdaptiveInterpolation(10);
      
      // Should remain at owner interpolation
      expect(smoother.getInterpolation()).toBe(initial);
    });

    test("spectator should update adaptive interpolation based on tick lag", () => {
      const spectatorSmoother = new TickSmoother({
        adaptiveInterpolation: AdaptiveInterpolationLevel.Low,
      });
      spectatorSmoother.setIsOwner(false);
      
      // Update with tick lag of 5 (multiplier 0.8 for Low = 4)
      spectatorSmoother.updateAdaptiveInterpolation(5);
      
      // Should be around 5 * 0.8 = 4, clamped to min 2
      expect(spectatorSmoother.getInterpolation()).toBeGreaterThanOrEqual(2);
    });

    test("custom adaptive smoothing should use increase/decrease steps", () => {
      const spectatorSmoother = new TickSmoother({
        adaptiveInterpolation: AdaptiveInterpolationLevel.Low,
        adaptiveSmoothingType: AdaptiveSmoothingType.Custom,
        interpolationIncreaseStep: 3,
        interpolationDecreaseStep: 1,
      });
      spectatorSmoother.setIsOwner(false);

      spectatorSmoother.updateAdaptiveInterpolation(10);
      expect(spectatorSmoother.getInterpolation()).toBe(4); // 1 -> +3

      spectatorSmoother.updateAdaptiveInterpolation(10);
      expect(spectatorSmoother.getInterpolation()).toBe(7); // 4 -> +3

      spectatorSmoother.updateAdaptiveInterpolation(2); // desired ~2
      expect(spectatorSmoother.getInterpolation()).toBe(6); // 7 -> -1
    });
  });

  describe("reconciliation easing", () => {
    test("should ease correction into existing queue entry", () => {
      smoother.onPostTick(1, 0, 0);     // Initialize
      smoother.onPostTick(2, 100, 0);   // Queue
      smoother.onPostTick(3, 200, 0);   // Queue
      smoother.onPostTick(4, 300, 0);   // Queue
      
      // Ease a correction into tick 3
      smoother.easeCorrection(3, 250, 50);
      
      // The correction should be partially applied (eased)
      // We can verify the queue still has the same length
      expect(smoother.getQueueLength()).toBe(3);
    });

    test("should ignore correction for non-existent tick", () => {
      smoother.onPostTick(1, 0, 0);
      smoother.onPostTick(2, 100, 0);
      
      // Try to ease a tick that doesn't exist
      smoother.easeCorrection(99, 999, 999);
      
      // Should have no effect
      expect(smoother.getQueueLength()).toBe(1);
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

    test("should ignore stale ticks after processing newer ones", () => {
      smoother.onPostTick(1, 0, 0);    // Initialize
      smoother.onPostTick(2, 100, 0);  // Queue target

      // Process tick 2
      smoother.getSmoothedPosition(50);
      expect(smoother.getQueueLength()).toBe(0);

      // Stale tick should be ignored
      smoother.onPostTick(1, -100, 0);
      expect(smoother.getQueueLength()).toBe(0);
      const pos = smoother.getSmoothedPosition(0);
      expect(pos.x).toBe(100);
    });

    test("should remain stable under render delta jitter", () => {
      const spectatorSmoother = new TickSmoother({
        tickIntervalMs: 16.67,
        teleportThreshold: 100,
      });
      spectatorSmoother.setIsOwner(false);

      // Feed ordered snapshots (remote player moving right)
      spectatorSmoother.onPostTick(1, 0, 0);
      spectatorSmoother.onPostTick(2, 20, 0);
      spectatorSmoother.onPostTick(3, 40, 0);
      spectatorSmoother.onPostTick(4, 60, 0);
      spectatorSmoother.onPostTick(5, 80, 0);
      spectatorSmoother.onPostTick(6, 100, 0);

      const deltas = [5, 22, 9, 28, 14, 3, 25, 11, 19, 7, 16, 30, 8];
      let last = spectatorSmoother.getSmoothedPosition(0);
      let maxStep = 0;
      let maxBacktrack = 0;

      for (const delta of deltas) {
        const next = spectatorSmoother.getSmoothedPosition(delta);
        const step = Math.abs(next.x - last.x);
        const backtrack = last.x - next.x;
        if (step > maxStep) maxStep = step;
        if (backtrack > maxBacktrack) maxBacktrack = backtrack;
        last = next;
      }

      // No big jumps or backwards snaps under jittery frame times
      expect(maxStep).toBeLessThan(100);
      expect(maxBacktrack).toBeLessThan(0.01);
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

    test("should snap X when smoothPositionX is disabled", () => {
      const customSmoother = new TickSmoother({
        smoothPositionX: false,
        smoothPositionY: true,
        tickIntervalMs: 16.67,
      });

      customSmoother.onPostTick(1, 0, 0);
      customSmoother.onPostTick(2, 100, 100);

      const pos = customSmoother.getSmoothedPosition(8); // Half tick
      expect(pos.x).toBe(100); // Snapped X
      expect(pos.y).toBeGreaterThan(0); // Still smoothing Y
      expect(pos.y).toBeLessThan(100);
    });

    test("should snap Y when smoothPositionY is disabled", () => {
      const customSmoother = new TickSmoother({
        smoothPositionX: true,
        smoothPositionY: false,
        tickIntervalMs: 16.67,
      });

      customSmoother.onPostTick(1, 0, 0);
      customSmoother.onPostTick(2, 100, 100);

      const pos = customSmoother.getSmoothedPosition(8); // Half tick
      expect(pos.y).toBe(100); // Snapped Y
      expect(pos.x).toBeGreaterThan(0); // Still smoothing X
      expect(pos.x).toBeLessThan(100);
    });

    test("should snap scale X when smoothScaleX is disabled", () => {
      const customSmoother = new TickSmoother({
        smoothScale: true,
        smoothScaleX: false,
        smoothScaleY: true,
        tickIntervalMs: 16.67,
      });

      customSmoother.onPostTick(1, 0, 0, undefined, 1, 1);
      customSmoother.onPostTick(2, 0, 0, undefined, 2, 2);

      const transform = customSmoother.getSmoothedTransform(8);
      expect(transform.scaleX).toBe(2); // Snapped X
      expect(transform.scaleY).toBeGreaterThan(1);
      expect(transform.scaleY).toBeLessThan(2);
    });

    test("should snap scale Y when smoothScaleY is disabled", () => {
      const customSmoother = new TickSmoother({
        smoothScale: true,
        smoothScaleX: true,
        smoothScaleY: false,
        tickIntervalMs: 16.67,
      });

      customSmoother.onPostTick(1, 0, 0, undefined, 1, 1);
      customSmoother.onPostTick(2, 0, 0, undefined, 2, 2);

      const transform = customSmoother.getSmoothedTransform(8);
      expect(transform.scaleY).toBe(2); // Snapped Y
      expect(transform.scaleX).toBeGreaterThan(1);
      expect(transform.scaleX).toBeLessThan(2);
    });

    test("should teleport when axis-specific thresholds are exceeded", () => {
      const customSmoother = new TickSmoother({
        teleportThresholdX: 10,
        teleportThresholdY: 1000,
        tickIntervalMs: 16.67,
      });

      customSmoother.onPostTick(1, 0, 0);
      customSmoother.onPostTick(2, 50, 0); // Exceeds X threshold

      const pos = customSmoother.getSmoothedPosition(1);
      expect(pos.x).toBe(50);
    });
  });

  describe("rotation smoothing", () => {
    test("should smooth rotation when enabled", () => {
      const rotationSmoother = new TickSmoother({
        smoothRotation: true,
        tickIntervalMs: 16.67,
      });
      
      rotationSmoother.onPostTick(1, 0, 0, 0);                    // Initialize at rotation 0
      rotationSmoother.onPostTick(2, 0, 0, Math.PI / 2);          // Queue - rotate 90 degrees
      
      // Half tick should produce partial rotation
      const transform = rotationSmoother.getSmoothedTransform(8.33); // ~half tick
      expect(transform.rotation).toBeGreaterThan(0);
      expect(transform.rotation).toBeLessThan(Math.PI / 2);
    });

    test("should teleport rotation when exceeds threshold", () => {
      const rotationSmoother = new TickSmoother({
        smoothRotation: true,
        rotationTeleportThreshold: Math.PI / 4, // 45 degrees
      });
      
      rotationSmoother.onPostTick(1, 0, 0, 0);        // Initialize at rotation 0
      rotationSmoother.onPostTick(2, 0, 0, Math.PI);  // Queue - rotate 180 degrees (exceeds threshold)
      
      // Should teleport instantly
      const transform = rotationSmoother.getSmoothedTransform(1);
      expect(transform.rotation).toBe(Math.PI);
    });

    test("should not smooth rotation when disabled", () => {
      const noRotationSmoother = new TickSmoother({
        smoothRotation: false,
      });
      
      noRotationSmoother.onPostTick(1, 0, 0, 0);
      noRotationSmoother.onPostTick(2, 0, 0, Math.PI);
      
      // Rotation should stay at initial value when not smoothed
      const transform = noRotationSmoother.getSmoothedTransform(8);
      expect(transform.rotation).toBe(0); // Default rotation, not updated
    });
  });

  describe("scale smoothing", () => {
    test("should smooth scale when enabled", () => {
      const scaleSmoother = new TickSmoother({
        smoothScale: true,
        tickIntervalMs: 16.67,
      });
      
      scaleSmoother.onPostTick(1, 0, 0, undefined, 1, 1);   // Initialize at scale 1,1
      scaleSmoother.onPostTick(2, 0, 0, undefined, 2, 2);   // Queue - scale to 2,2
      
      // Half tick should produce partial scale
      const transform = scaleSmoother.getSmoothedTransform(8.33);
      expect(transform.scaleX).toBeGreaterThan(1);
      expect(transform.scaleX).toBeLessThan(2);
      expect(transform.scaleY).toBeGreaterThan(1);
      expect(transform.scaleY).toBeLessThan(2);
    });

    test("should not smooth scale when disabled", () => {
      const noScaleSmoother = new TickSmoother({
        smoothScale: false,
      });
      
      noScaleSmoother.onPostTick(1, 0, 0, undefined, 1, 1);
      noScaleSmoother.onPostTick(2, 0, 0, undefined, 2, 2);
      
      // Scale should snap to target when not smoothed
      const transform = noScaleSmoother.getSmoothedTransform(8);
      expect(transform.scaleX).toBe(2);
      expect(transform.scaleY).toBe(2);
    });
  });

  describe("tick alignment invariants", () => {
    test("easeCorrection should return true when tick exists in queue", () => {
      smoother.onPostTick(1, 0, 0);     // Initialize
      smoother.onPostTick(2, 100, 0);   // Queue seq 2
      smoother.onPostTick(3, 200, 0);   // Queue seq 3
      
      // Correction for existing tick should succeed
      const applied = smoother.easeCorrection(2, 150, 0);
      expect(applied).toBe(true);
    });

    test("easeCorrection should return false when tick does not exist in queue", () => {
      smoother.onPostTick(1, 0, 0);     // Initialize
      smoother.onPostTick(2, 100, 0);   // Queue seq 2
      
      // Correction for non-existent tick should fail
      const applied = smoother.easeCorrection(99, 150, 0);
      expect(applied).toBe(false);
    });

    test("hasTickInQueue should correctly report tick presence", () => {
      smoother.onPostTick(1, 0, 0);     // Initialize
      smoother.onPostTick(2, 100, 0);   // Queue seq 2
      smoother.onPostTick(3, 200, 0);   // Queue seq 3
      
      expect(smoother.hasTickInQueue(2)).toBe(true);
      expect(smoother.hasTickInQueue(3)).toBe(true);
      expect(smoother.hasTickInQueue(99)).toBe(false);
      expect(smoother.hasTickInQueue(1)).toBe(false); // First tick initializes, doesn't queue
    });

    test("owner smoother corrections must use same tick source as onPostTick", () => {
      // This simulates the owner smoothing flow:
      // 1. Input seq N is processed, onPostTick(predictionTick, ...) is called
      // 2. Reconcile replays input seq N, easeCorrection(predictionTick, ...) is called
      // Both must use the SAME tick source (prediction tick)
      
      const ownerSmoother = new TickSmoother();
      ownerSmoother.setIsOwner(true);
      
      const inputSeqs = [0, 1, 2, 3, 4];
      const predictionTicks = new Map<number, number>();
      let predTick = 0;
      
      // Simulate input processing
      const firstSeq = inputSeqs[0]!;
      predictionTicks.set(firstSeq, predTick);
      ownerSmoother.onPostTick(predTick, 0, 0); // Initialize
      predTick++;
      
      for (let i = 1; i < inputSeqs.length; i++) {
        const seq = inputSeqs[i]!;
        predictionTicks.set(seq, predTick);
        ownerSmoother.onPostTick(predTick, i * 100, 0);
        predTick++;
      }
      
      // Simulate reconciliation - corrections must find their ticks
      for (let i = 1; i < inputSeqs.length; i++) {
        const seq = inputSeqs[i]!;
        const tick = predictionTicks.get(seq);
        expect(tick).not.toBeUndefined();
        if (tick === undefined) continue;
        const exists = ownerSmoother.hasTickInQueue(tick);
        expect(exists).toBe(true);
        
        const applied = ownerSmoother.easeCorrection(tick, i * 100 + 10, 0);
        expect(applied).toBe(true);
      }
    });

    test("reconcile corrections should never use server ticks for owner smoother", () => {
      // Owner smoother uses prediction ticks (local), not server ticks
      // This test ensures that if someone accidentally passes server ticks,
      // the correction will fail (return false)
      
      const ownerSmoother = new TickSmoother();
      ownerSmoother.setIsOwner(true);
      
      // Queue with local prediction ticks 0-2
      ownerSmoother.onPostTick(0, 0, 0);
      ownerSmoother.onPostTick(1, 100, 0);
      ownerSmoother.onPostTick(2, 200, 0);
      
      // If someone tries to use server tick (e.g., 1000) it won't match
      const applied = ownerSmoother.easeCorrection(1000, 150, 0);
      expect(applied).toBe(false);
    });
  });

  describe("extrapolation", () => {
    test("should extrapolate for spectators when queue is empty", () => {
      const extrapolatingSmoother = new TickSmoother({
        enableExtrapolation: true,
        maxExtrapolationMs: 100,
        tickIntervalMs: 16.67,
      });
      extrapolatingSmoother.setIsOwner(false); // Spectator
      
      // Build up velocity data
      extrapolatingSmoother.onPostTick(1, 0, 0);
      extrapolatingSmoother.onPostTick(2, 100, 0);
      
      // Consume the queued entry
      extrapolatingSmoother.getSmoothedPosition(20); // Reach target
      expect(extrapolatingSmoother.getQueueLength()).toBe(0);
      
      // Now with empty queue, should extrapolate
      const pos = extrapolatingSmoother.getSmoothedPosition(10);
      expect(pos.x).toBeGreaterThan(100); // Moved beyond last position
      expect(extrapolatingSmoother.getIsExtrapolating()).toBe(true);
    });

    test("should not extrapolate for owners", () => {
      const ownerSmoother = new TickSmoother({
        enableExtrapolation: true,
        maxExtrapolationMs: 100,
      });
      ownerSmoother.setIsOwner(true); // Owner
      
      ownerSmoother.onPostTick(1, 0, 0);
      ownerSmoother.onPostTick(2, 100, 0);
      
      // Consume the queued entry
      ownerSmoother.getSmoothedPosition(20);
      expect(ownerSmoother.getQueueLength()).toBe(0);
      
      // With empty queue, owner should NOT extrapolate
      const pos = ownerSmoother.getSmoothedPosition(10);
      expect(pos.x).toBe(100); // Stays at last position
      expect(ownerSmoother.getIsExtrapolating()).toBe(false);
    });

    test("should clamp extrapolation to max time", () => {
      const extrapolatingSmoother = new TickSmoother({
        enableExtrapolation: true,
        maxExtrapolationMs: 50, // Short max
        tickIntervalMs: 16.67,
      });
      extrapolatingSmoother.setIsOwner(false);
      
      extrapolatingSmoother.onPostTick(1, 0, 0);
      extrapolatingSmoother.onPostTick(2, 100, 0);
      
      // Consume queued entry
      extrapolatingSmoother.getSmoothedPosition(20);
      
      // Extrapolate a lot
      extrapolatingSmoother.getSmoothedPosition(100);
      
      // Should have hit the max extrapolation time
      expect(extrapolatingSmoother.getExtrapolationTimeMs()).toBeLessThanOrEqual(50);
    });

    test("should stop extrapolating when new data arrives", () => {
      const extrapolatingSmoother = new TickSmoother({
        enableExtrapolation: true,
        maxExtrapolationMs: 100,
      });
      extrapolatingSmoother.setIsOwner(false);
      
      extrapolatingSmoother.onPostTick(1, 0, 0);
      extrapolatingSmoother.onPostTick(2, 100, 0);
      
      // Consume and extrapolate
      extrapolatingSmoother.getSmoothedPosition(20);
      extrapolatingSmoother.getSmoothedPosition(10);
      expect(extrapolatingSmoother.getIsExtrapolating()).toBe(true);
      
      // New data arrives
      extrapolatingSmoother.onPostTick(3, 150, 0);
      extrapolatingSmoother.getSmoothedPosition(10);
      
      // Should stop extrapolating
      expect(extrapolatingSmoother.getIsExtrapolating()).toBe(false);
    });

    test("should not extrapolate when disabled", () => {
      const noExtrapolationSmoother = new TickSmoother({
        enableExtrapolation: false,
      });
      noExtrapolationSmoother.setIsOwner(false);
      
      noExtrapolationSmoother.onPostTick(1, 0, 0);
      noExtrapolationSmoother.onPostTick(2, 100, 0);
      
      // Consume queued entry
      noExtrapolationSmoother.getSmoothedPosition(20);
      
      // With extrapolation disabled, should stay at last position
      const pos = noExtrapolationSmoother.getSmoothedPosition(10);
      expect(pos.x).toBe(100);
      expect(noExtrapolationSmoother.getIsExtrapolating()).toBe(false);
    });
  });
});
