import { describe, expect, it, beforeEach } from "bun:test";
import {
  VisualSmoother,
  DEFAULT_VISUAL_SMOOTHER_CONFIG,
  type VisualSmootherConfig,
} from "./visual-smoother.js";

describe("VisualSmoother", () => {
  describe("constructor", () => {
    it("should use default config when none provided", () => {
      const smoother = new VisualSmoother();
      const config = smoother.getConfig();
      
      expect(config.smoothFactor).toBe(DEFAULT_VISUAL_SMOOTHER_CONFIG.smoothFactor);
      expect(config.snapThreshold).toBe(DEFAULT_VISUAL_SMOOTHER_CONFIG.snapThreshold);
    });

    it("should merge partial config with defaults", () => {
      const smoother = new VisualSmoother({ smoothFactor: 0.8 });
      const config = smoother.getConfig();
      
      expect(config.smoothFactor).toBe(0.8);
      expect(config.snapThreshold).toBe(DEFAULT_VISUAL_SMOOTHER_CONFIG.snapThreshold);
    });

    it("should accept full custom config", () => {
      const customConfig: VisualSmootherConfig = {
        smoothFactor: 0.95,
        snapThreshold: 100,
      };
      const smoother = new VisualSmoother(customConfig);
      const config = smoother.getConfig();
      
      expect(config.smoothFactor).toBe(0.95);
      expect(config.snapThreshold).toBe(100);
    });
  });

  describe("onReconciliationSnap", () => {
    let smoother: VisualSmoother;

    beforeEach(() => {
      smoother = new VisualSmoother();
    });

    it("should accumulate small position deltas", () => {
      smoother.onReconciliationSnap(2, 3);
      const offset = smoother.getOffset();
      
      expect(offset.x).toBe(2);
      expect(offset.y).toBe(3);
    });

    it("should accumulate multiple deltas", () => {
      smoother.onReconciliationSnap(2, 3);
      smoother.onReconciliationSnap(1, -1);
      const offset = smoother.getOffset();
      
      expect(offset.x).toBe(3);
      expect(offset.y).toBe(2);
    });

    it("should clear offset when delta exceeds snap threshold", () => {
      // Default threshold is 50
      smoother.onReconciliationSnap(2, 3); // Small delta, should accumulate
      
      expect(smoother.hasOffset()).toBe(true);
      
      // Large delta (magnitude > 50)
      smoother.onReconciliationSnap(40, 40); // magnitude = ~56.6
      
      const offset = smoother.getOffset();
      expect(offset.x).toBe(0);
      expect(offset.y).toBe(0);
      expect(smoother.hasOffset()).toBe(false);
    });

    it("should respect custom snap threshold", () => {
      const smoother = new VisualSmoother({ snapThreshold: 10 });
      
      // Delta with magnitude ~7.07, below threshold
      smoother.onReconciliationSnap(5, 5);
      expect(smoother.hasOffset()).toBe(true);
      
      // Delta with magnitude ~14.14, above threshold
      smoother.onReconciliationSnap(10, 10);
      expect(smoother.hasOffset()).toBe(false);
    });

    it("should handle negative deltas", () => {
      smoother.onReconciliationSnap(-5, -3);
      const offset = smoother.getOffset();
      
      expect(offset.x).toBe(-5);
      expect(offset.y).toBe(-3);
    });
  });

  describe("update", () => {
    it("should decay offset over time", () => {
      const smoother = new VisualSmoother({ smoothFactor: 0.9 });
      smoother.onReconciliationSnap(10, 10);
      
      const initialOffset = smoother.getOffset();
      expect(initialOffset.x).toBe(10);
      expect(initialOffset.y).toBe(10);
      
      // Update with ~one frame at 60fps
      smoother.update(16.67);
      
      const afterOneFrame = smoother.getOffset();
      expect(afterOneFrame.x).toBeLessThan(10);
      expect(afterOneFrame.y).toBeLessThan(10);
      expect(afterOneFrame.x).toBeGreaterThan(0);
      expect(afterOneFrame.y).toBeGreaterThan(0);
    });

    it("should be frame-rate independent", () => {
      // Two smoothers with same initial state
      const smoother60fps = new VisualSmoother({ smoothFactor: 0.9 });
      const smoother120fps = new VisualSmoother({ smoothFactor: 0.9 });
      
      smoother60fps.onReconciliationSnap(100, 100);
      smoother120fps.onReconciliationSnap(100, 100);
      
      // Simulate 100ms at different frame rates
      // 60fps: 6 frames of ~16.67ms
      for (let i = 0; i < 6; i++) {
        smoother60fps.update(16.67);
      }
      
      // 120fps: 12 frames of ~8.33ms
      for (let i = 0; i < 12; i++) {
        smoother120fps.update(8.33);
      }
      
      const offset60 = smoother60fps.getOffset();
      const offset120 = smoother120fps.getOffset();
      
      // Should be approximately equal (within ~1% due to float precision)
      expect(Math.abs(offset60.x - offset120.x)).toBeLessThan(1);
      expect(Math.abs(offset60.y - offset120.y)).toBeLessThan(1);
    });

    it("should clear very small offsets to prevent float drift", () => {
      const smoother = new VisualSmoother({ smoothFactor: 0.5 });
      smoother.onReconciliationSnap(1, 1);
      
      // Decay until very small
      for (let i = 0; i < 100; i++) {
        smoother.update(16.67);
      }
      
      const offset = smoother.getOffset();
      expect(offset.x).toBe(0);
      expect(offset.y).toBe(0);
      expect(smoother.hasOffset()).toBe(false);
    });

    it("should handle zero delta time", () => {
      const smoother = new VisualSmoother();
      smoother.onReconciliationSnap(10, 10);
      
      smoother.update(0);
      
      // With zero time, decay = 0.9^0 = 1, so no change
      const offset = smoother.getOffset();
      expect(offset.x).toBe(10);
      expect(offset.y).toBe(10);
    });

    it("should decay faster with lower smooth factor", () => {
      // Use snap threshold of 200 to allow larger test values
      const smootherFast = new VisualSmoother({ smoothFactor: 0.7, snapThreshold: 200 });
      const smootherSlow = new VisualSmoother({ smoothFactor: 0.95, snapThreshold: 200 });
      
      smootherFast.onReconciliationSnap(100, 100);
      smootherSlow.onReconciliationSnap(100, 100);
      
      // Update for ~50ms (3 frames)
      for (let i = 0; i < 3; i++) {
        smootherFast.update(16.67);
        smootherSlow.update(16.67);
      }
      
      const fastOffset = smootherFast.getOffset();
      const slowOffset = smootherSlow.getOffset();
      
      // Fast should decay more (both should still have meaningful values)
      expect(fastOffset.x).toBeLessThan(slowOffset.x);
      expect(fastOffset.y).toBeLessThan(slowOffset.y);
      // Verify both still have non-trivial offsets
      expect(fastOffset.x).toBeGreaterThan(10);
      expect(slowOffset.x).toBeGreaterThan(50);
    });
  });

  describe("hasOffset", () => {
    it("should return false when no offset", () => {
      const smoother = new VisualSmoother();
      expect(smoother.hasOffset()).toBe(false);
    });

    it("should return true when offset exists", () => {
      const smoother = new VisualSmoother();
      smoother.onReconciliationSnap(1, 1);
      expect(smoother.hasOffset()).toBe(true);
    });

    it("should return false for very small offsets", () => {
      const smoother = new VisualSmoother();
      // The epsilon is 0.01, so anything smaller should be considered "no offset"
      smoother.onReconciliationSnap(0.005, 0.005);
      smoother.update(16.67); // This will clear small values
      expect(smoother.hasOffset()).toBe(false);
    });
  });

  describe("reset", () => {
    it("should clear all offset", () => {
      const smoother = new VisualSmoother();
      smoother.onReconciliationSnap(10, 20);
      
      expect(smoother.hasOffset()).toBe(true);
      
      smoother.reset();
      
      expect(smoother.hasOffset()).toBe(false);
      const offset = smoother.getOffset();
      expect(offset.x).toBe(0);
      expect(offset.y).toBe(0);
    });
  });

  describe("setConfig", () => {
    it("should update config values", () => {
      const smoother = new VisualSmoother();
      
      smoother.setConfig({ smoothFactor: 0.8, snapThreshold: 100 });
      
      const config = smoother.getConfig();
      expect(config.smoothFactor).toBe(0.8);
      expect(config.snapThreshold).toBe(100);
    });

    it("should merge partial config updates", () => {
      const smoother = new VisualSmoother({ smoothFactor: 0.9, snapThreshold: 50 });
      
      smoother.setConfig({ smoothFactor: 0.7 });
      
      const config = smoother.getConfig();
      expect(config.smoothFactor).toBe(0.7);
      expect(config.snapThreshold).toBe(50); // Unchanged
    });
  });

  describe("getConfig", () => {
    it("should return a copy of config", () => {
      const smoother = new VisualSmoother({ smoothFactor: 0.9 });
      
      const config1 = smoother.getConfig();
      const config2 = smoother.getConfig();
      
      // Should be equal but not the same object
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
    });
  });

  describe("integration scenarios", () => {
    it("should handle typical game reconciliation pattern", () => {
      const smoother = new VisualSmoother({ smoothFactor: 0.9 });
      
      // Frame 1: reconciliation causes small snap
      smoother.onReconciliationSnap(2, 1);
      smoother.update(16.67);
      
      // Frame 2-10: decay
      for (let i = 0; i < 9; i++) {
        smoother.update(16.67);
      }
      
      // After ~10 frames (166ms), offset should be significantly reduced
      const offset = smoother.getOffset();
      expect(offset.x).toBeLessThan(1);
      expect(offset.y).toBeLessThan(0.5);
    });

    it("should handle rapid successive snaps", () => {
      const smoother = new VisualSmoother({ smoothFactor: 0.9 });
      
      // Multiple server updates cause multiple snaps
      smoother.onReconciliationSnap(1, 1);
      smoother.update(16.67);
      
      smoother.onReconciliationSnap(0.5, 0.5);
      smoother.update(16.67);
      
      smoother.onReconciliationSnap(-0.3, -0.3);
      smoother.update(16.67);
      
      // Should still have some offset but be reasonable
      expect(smoother.hasOffset()).toBe(true);
      const offset = smoother.getOffset();
      expect(Math.abs(offset.x)).toBeLessThan(5);
      expect(Math.abs(offset.y)).toBeLessThan(5);
    });

    it("should handle teleport (large snap)", () => {
      const smoother = new VisualSmoother({ snapThreshold: 50 });
      
      // Small snaps accumulate
      smoother.onReconciliationSnap(5, 5);
      smoother.onReconciliationSnap(5, 5);
      expect(smoother.hasOffset()).toBe(true);
      
      // Teleport - large snap clears everything
      smoother.onReconciliationSnap(100, 100); // magnitude > 50
      
      expect(smoother.hasOffset()).toBe(false);
      const offset = smoother.getOffset();
      expect(offset.x).toBe(0);
      expect(offset.y).toBe(0);
    });
  });
});
