import { describe, test, expect } from "bun:test";
import { NoPredictionScope } from "./prediction-scope.js";

interface TestWorld {
  players: Map<string, { x: number; y: number }>;
  tick: number;
}

interface TestInput {
  moveX: number;
  timestamp: number;
}

describe("NoPredictionScope", () => {
  const idleInput: TestInput = { moveX: 0, timestamp: 0 };
  const scope = new NoPredictionScope<TestWorld, TestInput>(idleInput);

  describe("extractPredictable", () => {
    test("should return empty object", () => {
      const world: TestWorld = {
        players: new Map([["player1", { x: 100, y: 200 }]]),
        tick: 42,
      };

      const result = scope.extractPredictable(world, "player1");

      expect(result).toEqual({});
    });

    test("should return empty object regardless of player ID", () => {
      const world: TestWorld = {
        players: new Map([
          ["player1", { x: 100, y: 200 }],
          ["player2", { x: 300, y: 400 }],
        ]),
        tick: 10,
      };

      expect(scope.extractPredictable(world, "player1")).toEqual({});
      expect(scope.extractPredictable(world, "player2")).toEqual({});
      expect(scope.extractPredictable(world, "nonexistent")).toEqual({});
    });

    test("should return empty object for empty world", () => {
      const emptyWorld: TestWorld = {
        players: new Map(),
        tick: 0,
      };

      const result = scope.extractPredictable(emptyWorld, "anyPlayer");

      expect(result).toEqual({});
    });

    test("should not modify original world", () => {
      const world: TestWorld = {
        players: new Map([["player1", { x: 100, y: 200 }]]),
        tick: 42,
      };
      const originalPlayers = new Map(world.players);

      scope.extractPredictable(world, "player1");

      expect(world.players).toEqual(originalPlayers);
      expect(world.tick).toBe(42);
    });
  });

  describe("mergePrediction", () => {
    test("should return server world unchanged", () => {
      const serverWorld: TestWorld = {
        players: new Map([["player1", { x: 100, y: 200 }]]),
        tick: 42,
      };
      const predicted: Partial<TestWorld> = {
        players: new Map([["player1", { x: 999, y: 999 }]]),
      };

      const result = scope.mergePrediction(serverWorld, predicted);

      expect(result).toBe(serverWorld);
      expect(result.players.get("player1")).toEqual({ x: 100, y: 200 });
    });

    test("should return server world even with empty prediction", () => {
      const serverWorld: TestWorld = {
        players: new Map([["player1", { x: 50, y: 60 }]]),
        tick: 5,
      };

      const result = scope.mergePrediction(serverWorld, {});

      expect(result).toBe(serverWorld);
    });

    test("should ignore all predicted data", () => {
      const serverWorld: TestWorld = {
        players: new Map(),
        tick: 0,
      };
      const predicted: Partial<TestWorld> = {
        players: new Map([
          ["player1", { x: 100, y: 100 }],
          ["player2", { x: 200, y: 200 }],
        ]),
        tick: 999,
      };

      const result = scope.mergePrediction(serverWorld, predicted);

      expect(result).toBe(serverWorld);
      expect(result.players.size).toBe(0);
      expect(result.tick).toBe(0);
    });
  });

  describe("simulatePredicted", () => {
    test("should return state unchanged", () => {
      const state: Partial<TestWorld> = {
        players: new Map([["player1", { x: 100, y: 200 }]]),
      };
      const input: TestInput = { moveX: 1, timestamp: 1000 };

      const result = scope.simulatePredicted(state, input, 16.67);

      expect(result).toBe(state);
    });

    test("should ignore input completely", () => {
      const state: Partial<TestWorld> = {
        players: new Map([["player1", { x: 0, y: 0 }]]),
      };
      const input: TestInput = { moveX: 100, timestamp: 1000 };

      const result = scope.simulatePredicted(state, input, 1000);

      expect(result.players?.get("player1")).toEqual({ x: 0, y: 0 });
    });

    test("should return empty state unchanged", () => {
      const emptyState: Partial<TestWorld> = {};
      const input: TestInput = { moveX: 1, timestamp: 1000 };

      const result = scope.simulatePredicted(emptyState, input, 16.67);

      expect(result).toBe(emptyState);
      expect(result).toEqual({});
    });

    test("should handle zero delta time", () => {
      const state: Partial<TestWorld> = {
        players: new Map([["p", { x: 50, y: 50 }]]),
      };
      const input: TestInput = { moveX: 1, timestamp: 1000 };

      const result = scope.simulatePredicted(state, input, 0);

      expect(result).toBe(state);
    });

    test("should handle negative delta time", () => {
      const state: Partial<TestWorld> = {
        players: new Map([["p", { x: 50, y: 50 }]]),
      };
      const input: TestInput = { moveX: 1, timestamp: 1000 };

      const result = scope.simulatePredicted(state, input, -100);

      expect(result).toBe(state);
    });
  });

  describe("createIdleInput", () => {
    test("should return the idle input provided in constructor", () => {
      const result = scope.createIdleInput();

      expect(result).toEqual(idleInput);
    });

    test("should return same reference each time", () => {
      const result1 = scope.createIdleInput();
      const result2 = scope.createIdleInput();

      expect(result1).toBe(result2);
    });

    test("should work with custom idle input", () => {
      const customIdleInput: TestInput = { moveX: 0, timestamp: 12345 };
      const customScope = new NoPredictionScope<TestWorld, TestInput>(customIdleInput);

      const result = customScope.createIdleInput();

      expect(result).toEqual(customIdleInput);
      expect(result.timestamp).toBe(12345);
    });
  });

  describe("use case: no prediction game mode", () => {
    test("full flow should leave server state untouched", () => {
      // Simulate a game that doesn't use client-side prediction
      const serverWorld: TestWorld = {
        players: new Map([
          ["local", { x: 100, y: 200 }],
          ["remote", { x: 300, y: 400 }],
        ]),
        tick: 50,
      };

      // 1. Extract predictable (should be empty)
      const predictable = scope.extractPredictable(serverWorld, "local");
      expect(predictable).toEqual({});

      // 2. Simulate with input (should do nothing)
      const input: TestInput = { moveX: 1, timestamp: 1000 };
      const predicted = scope.simulatePredicted(predictable, input, 16.67);
      expect(predicted).toEqual({});

      // 3. Merge back (should return server world unchanged)
      const merged = scope.mergePrediction(serverWorld, predicted);
      expect(merged).toBe(serverWorld);
      expect(merged.players.get("local")).toEqual({ x: 100, y: 200 });
    });
  });
});
