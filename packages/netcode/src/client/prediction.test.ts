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
});
