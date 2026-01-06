import { describe, test, expect, beforeEach } from "bun:test";
import { Predictor } from "./prediction.js";
import type { PlayerState } from "../types.js";

describe("Predictor", () => {
  let predictor: Predictor;

  beforeEach(() => {
    predictor = new Predictor();
  });

  describe("setBaseState", () => {
    test("should set the base state", () => {
      const state: PlayerState = {
        id: "player-1",
        position: { x: 100, y: 200 },
        velocity: { x: 0, y: 0 },
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
      predictor.setBaseState({
        id: "player-1",
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        tick: 0,
      });

      expect(predictor.getState()).toBeDefined();
    });
  });

  describe("applyInput", () => {
    test("should apply input to local state", () => {
      predictor.setBaseState({
        id: "player-1",
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        tick: 0,
      });

      predictor.applyInput({ moveX: 1, moveY: 0, timestamp: Date.now() });

      const state = predictor.getState();
      expect(state?.position.x).toBeGreaterThan(0);
    });

    test("should not throw when no state set", () => {
      // Should not throw
      predictor.applyInput({ moveX: 1, moveY: 0, timestamp: Date.now() });
    });

    test("should accumulate multiple inputs", () => {
      predictor.setBaseState({
        id: "player-1",
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        tick: 0,
      });

      predictor.applyInput({ moveX: 1, moveY: 0, timestamp: Date.now() });
      const pos1 = predictor.getState()?.position.x ?? 0;

      predictor.applyInput({ moveX: 1, moveY: 0, timestamp: Date.now() });
      const pos2 = predictor.getState()?.position.x ?? 0;

      expect(pos2).toBeGreaterThan(pos1);
    });
  });

  describe("reset", () => {
    test("should clear the state", () => {
      predictor.setBaseState({
        id: "player-1",
        position: { x: 100, y: 200 },
        velocity: { x: 0, y: 0 },
        tick: 0,
      });

      predictor.reset();

      expect(predictor.getState()).toBeNull();
    });
  });
});
