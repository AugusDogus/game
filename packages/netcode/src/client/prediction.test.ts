import { describe, test, expect, beforeEach } from "bun:test";
import { Predictor } from "./prediction.js";
import type { PlayerState } from "../types.js";
import { DEFAULT_FLOOR_Y } from "../constants.js";
import { platformerPhysics } from "../physics.js";

describe("Predictor", () => {
  let predictor: Predictor;

  beforeEach(() => {
    predictor = new Predictor(platformerPhysics);
  });

  // Helper to create a grounded player state
  const createGroundedState = (id: string, x: number = 0): PlayerState => ({
    id,
    position: { x, y: DEFAULT_FLOOR_Y - 10 },
    velocity: { x: 0, y: 0 },
    isGrounded: true,
    tick: 0,
  });

  describe("setBaseState", () => {
    test("should set the base state", () => {
      const state: PlayerState = {
        id: "player-1",
        position: { x: 100, y: 200 },
        velocity: { x: 0, y: 0 },
        isGrounded: false,
        tick: 5,
      };

      predictor.setBaseState(state);

      const result = predictor.getState();
      expect(result?.position.x).toBe(100);
      expect(result?.position.y).toBe(200);
    });
  });

  describe("getState", () => {
    test("should return null when no state set", () => {
      expect(predictor.getState()).toBeNull();
    });

    test("should return current predicted state", () => {
      predictor.setBaseState(createGroundedState("player-1"));

      expect(predictor.getState()).toBeDefined();
    });
  });

  describe("applyInput", () => {
    test("should apply input to local state", () => {
      predictor.setBaseState(createGroundedState("player-1"));

      predictor.applyInput({ moveX: 1, moveY: 0, jump: false, timestamp: Date.now() });

      const state = predictor.getState();
      expect(state?.position.x).toBeGreaterThan(0);
    });

    test("should not throw when no state set", () => {
      // Should not throw
      predictor.applyInput({ moveX: 1, moveY: 0, jump: false, timestamp: Date.now() });
    });

    test("should accumulate multiple inputs", () => {
      predictor.setBaseState(createGroundedState("player-1"));

      predictor.applyInput({ moveX: 1, moveY: 0, jump: false, timestamp: Date.now() });
      const pos1 = predictor.getState()?.position.x ?? 0;

      predictor.applyInput({ moveX: 1, moveY: 0, jump: false, timestamp: Date.now() });
      const pos2 = predictor.getState()?.position.x ?? 0;

      expect(pos2).toBeGreaterThan(pos1);
    });

    test("should apply jump when grounded", () => {
      predictor.setBaseState(createGroundedState("player-1"));

      predictor.applyInput({ moveX: 0, moveY: 0, jump: true, timestamp: Date.now() });

      const state = predictor.getState();
      expect(state?.velocity.y).toBeLessThan(0); // Negative = upward
      expect(state?.isGrounded).toBe(false);
    });
  });

  describe("reset", () => {
    test("should clear the state", () => {
      predictor.setBaseState(createGroundedState("player-1", 100));

      predictor.reset();

      expect(predictor.getState()).toBeNull();
    });
  });

  describe("real-world scenarios", () => {
    test("variable frame rate: 30fps and 60fps players should move similar distances over same real time", () => {
      // Player A: 60fps (16.67ms between inputs) for 100ms = 6 inputs
      const predictor60fps = new Predictor(platformerPhysics);
      predictor60fps.setBaseState(createGroundedState("player-60fps"));
      
      const startTime = 1000;
      for (let i = 0; i < 6; i++) {
        predictor60fps.applyInput({ 
          moveX: 1, moveY: 0, jump: false, 
          timestamp: startTime + i * 16.67 
        });
      }
      const pos60fps = predictor60fps.getState()!.position.x;

      // Player B: 30fps (33.33ms between inputs) for 100ms = 3 inputs
      const predictor30fps = new Predictor(platformerPhysics);
      predictor30fps.setBaseState(createGroundedState("player-30fps"));
      
      for (let i = 0; i < 3; i++) {
        predictor30fps.applyInput({ 
          moveX: 1, moveY: 0, jump: false, 
          timestamp: startTime + i * 33.33 
        });
      }
      const pos30fps = predictor30fps.getState()!.position.x;

      // Both should have moved roughly the same distance (within 25% tolerance)
      // because total simulated time is similar (~100ms each)
      // Small differences come from the first input using default deltaTime
      const ratio = pos60fps / pos30fps;
      expect(ratio).toBeGreaterThan(0.75);
      expect(ratio).toBeLessThan(1.25);
    });

    test("tab switch: large time gap between inputs should apply correct physics", () => {
      predictor.setBaseState({
        id: "player-1",
        position: { x: 0, y: 0 }, // In the air
        velocity: { x: 0, y: 0 },
        isGrounded: false,
        tick: 0,
      });

      // First input
      predictor.applyInput({ moveX: 0, moveY: 0, jump: false, timestamp: 1000 });
      const posAfterFirst = predictor.getState()!.position.y;

      // Simulate tab switch: 500ms gap (player was away)
      predictor.applyInput({ moveX: 0, moveY: 0, jump: false, timestamp: 1500 });
      const posAfterGap = predictor.getState()!.position.y;

      // Should have fallen significantly more during the 500ms gap
      // (but clamped to 100ms max for safety)
      const fallDuringGap = posAfterGap - posAfterFirst;
      expect(fallDuringGap).toBeGreaterThan(0); // Fell down (Y increases)
    });

    test("rapid inputs: burst of inputs should not cause excessive movement", () => {
      predictor.setBaseState(createGroundedState("player-1"));

      // Simulate a burst of 10 inputs in 10ms (unrealistic but could happen with input buffering bugs)
      const startTime = 1000;
      for (let i = 0; i < 10; i++) {
        predictor.applyInput({ 
          moveX: 1, moveY: 0, jump: false, 
          timestamp: startTime + i * 1 // 1ms apart
        });
      }
      const burstPos = predictor.getState()!.position.x;

      // Compare to normal 10 inputs over 166ms (60fps)
      const normalPredictor = new Predictor(platformerPhysics);
      normalPredictor.setBaseState(createGroundedState("player-2"));
      for (let i = 0; i < 10; i++) {
        normalPredictor.applyInput({ 
          moveX: 1, moveY: 0, jump: false, 
          timestamp: startTime + i * 16.67 
        });
      }
      const normalPos = normalPredictor.getState()!.position.x;

      // Burst movement should be much less than normal (roughly 10ms vs 166ms of movement)
      expect(burstPos).toBeLessThan(normalPos * 0.2);
    });
  });
});
