import { describe, test, expect } from "bun:test";
import { platformerPredictionScope } from "./prediction.js";
import { createIdleInput } from "./types.js";
import type { PlatformerWorld, PlatformerPlayer, PlatformerInput } from "./types.js";
import { DEFAULT_FLOOR_Y, DEFAULT_PLAYER_SPEED, DEFAULT_JUMP_VELOCITY } from "../../constants.js";

function createPlayer(overrides: Partial<PlatformerPlayer> = {}): PlatformerPlayer {
  return {
    id: "test-player",
    position: { x: 0, y: DEFAULT_FLOOR_Y - 10 }, // On ground (player height ~20)
    velocity: { x: 0, y: 0 },
    isGrounded: true,
    ...overrides,
  };
}

function createWorld(players: Map<string, PlatformerPlayer>, tick: number = 0): PlatformerWorld {
  return { players, tick };
}

describe("platformerPredictionScope", () => {
  describe("extractPredictable", () => {
    test("should extract only the local player", () => {
      const world = createWorld(new Map([
        ["local", createPlayer({ position: { x: 100, y: 100 } })],
        ["remote1", createPlayer({ position: { x: 200, y: 200 } })],
        ["remote2", createPlayer({ position: { x: 300, y: 300 } })],
      ]));

      const result = platformerPredictionScope.extractPredictable(world, "local");

      expect(result.players?.size).toBe(1);
      expect(result.players?.has("local")).toBe(true);
      expect(result.players?.has("remote1")).toBe(false);
      expect(result.players?.has("remote2")).toBe(false);
    });

    test("should copy player data, not reference", () => {
      const originalPlayer = createPlayer({ position: { x: 100, y: 100 } });
      const world = createWorld(new Map([["local", originalPlayer]]));

      const result = platformerPredictionScope.extractPredictable(world, "local");
      const extractedPlayer = result.players?.get("local");

      // Should have same values
      expect(extractedPlayer?.position.x).toBe(100);
      
      // But not the same object reference
      expect(extractedPlayer).not.toBe(originalPlayer);
    });

    test("should return empty Map when player not found", () => {
      const world = createWorld(new Map([
        ["other", createPlayer()],
      ]));

      const result = platformerPredictionScope.extractPredictable(world, "nonexistent");

      expect(result.players?.size).toBe(0);
    });

    test("should return empty Map for empty world", () => {
      const world = createWorld(new Map());

      const result = platformerPredictionScope.extractPredictable(world, "anyPlayer");

      expect(result.players?.size).toBe(0);
    });
  });

  describe("mergePrediction", () => {
    test("should override local player with predicted state", () => {
      const serverWorld = createWorld(new Map([
        ["local", createPlayer({ position: { x: 100, y: 100 } })],
        ["remote", createPlayer({ position: { x: 200, y: 200 } })],
      ]));
      const predicted: Partial<PlatformerWorld> = {
        players: new Map([
          ["local", createPlayer({ position: { x: 150, y: 150 } })],
        ]),
      };

      const result = platformerPredictionScope.mergePrediction(serverWorld, predicted);

      // Local player should be from prediction
      expect(result.players.get("local")?.position.x).toBe(150);
      // Remote player should be from server
      expect(result.players.get("remote")?.position.x).toBe(200);
    });

    test("should keep all server players", () => {
      const serverWorld = createWorld(new Map([
        ["p1", createPlayer()],
        ["p2", createPlayer()],
        ["p3", createPlayer()],
      ]));
      const predicted: Partial<PlatformerWorld> = {
        players: new Map([
          ["p1", createPlayer({ position: { x: 999, y: 999 } })],
        ]),
      };

      const result = platformerPredictionScope.mergePrediction(serverWorld, predicted);

      expect(result.players.size).toBe(3);
      expect(result.players.has("p1")).toBe(true);
      expect(result.players.has("p2")).toBe(true);
      expect(result.players.has("p3")).toBe(true);
    });

    test("should return server world if prediction is empty", () => {
      const serverWorld = createWorld(new Map([
        ["player", createPlayer({ position: { x: 100, y: 100 } })],
      ]));

      const result1 = platformerPredictionScope.mergePrediction(serverWorld, {});
      expect(result1).toBe(serverWorld);

      const result2 = platformerPredictionScope.mergePrediction(serverWorld, { players: new Map() });
      expect(result2).toBe(serverWorld);
    });

    test("should preserve other server world properties", () => {
      const serverWorld = createWorld(new Map([
        ["local", createPlayer()],
      ]), 42);
      const predicted: Partial<PlatformerWorld> = {
        players: new Map([
          ["local", createPlayer({ position: { x: 500, y: 500 } })],
        ]),
      };

      const result = platformerPredictionScope.mergePrediction(serverWorld, predicted);

      expect(result.tick).toBe(42);
    });
  });

  describe("simulatePredicted", () => {
    test("should move player right on positive moveX", () => {
      const state: Partial<PlatformerWorld> = {
        players: new Map([
          ["player", createPlayer({ position: { x: 100, y: DEFAULT_FLOOR_Y - 10 } })],
        ]),
      };
      const input: PlatformerInput = { moveX: 1, moveY: 0, jump: false, timestamp: 1000 };
      const deltaTime = 100; // 100ms

      const result = platformerPredictionScope.simulatePredicted(state, input, deltaTime);

      const player = result.players?.get("player");
      // Expected: 100 + (1 * DEFAULT_PLAYER_SPEED * 0.1)
      expect(player?.position.x).toBeGreaterThan(100);
    });

    test("should move player left on negative moveX", () => {
      const state: Partial<PlatformerWorld> = {
        players: new Map([
          ["player", createPlayer({ position: { x: 100, y: DEFAULT_FLOOR_Y - 10 } })],
        ]),
      };
      const input: PlatformerInput = { moveX: -1, moveY: 0, jump: false, timestamp: 1000 };
      const deltaTime = 100;

      const result = platformerPredictionScope.simulatePredicted(state, input, deltaTime);

      expect(result.players?.get("player")?.position.x).toBeLessThan(100);
    });

    test("should apply gravity when in air", () => {
      const state: Partial<PlatformerWorld> = {
        players: new Map([
          ["player", createPlayer({ 
            position: { x: 0, y: 100 }, // Above floor
            velocity: { x: 0, y: 0 },
            isGrounded: false 
          })],
        ]),
      };
      const input: PlatformerInput = { moveX: 0, moveY: 0, jump: false, timestamp: 1000 };
      const deltaTime = 100;

      const result = platformerPredictionScope.simulatePredicted(state, input, deltaTime);

      const player = result.players?.get("player");
      expect(player?.velocity.y).toBeGreaterThan(0); // Falling (gravity is positive)
    });

    test("should jump when grounded and jump=true", () => {
      const state: Partial<PlatformerWorld> = {
        players: new Map([
          ["player", createPlayer({ 
            position: { x: 0, y: DEFAULT_FLOOR_Y - 10 },
            isGrounded: true 
          })],
        ]),
      };
      const input: PlatformerInput = { moveX: 0, moveY: 0, jump: true, timestamp: 1000 };
      const deltaTime = 16.67;

      const result = platformerPredictionScope.simulatePredicted(state, input, deltaTime);

      const player = result.players?.get("player");
      expect(player?.velocity.y).toBe(DEFAULT_JUMP_VELOCITY);
    });

    test("should not jump when not grounded", () => {
      const state: Partial<PlatformerWorld> = {
        players: new Map([
          ["player", createPlayer({ 
            position: { x: 0, y: 100 },
            velocity: { x: 0, y: 50 },
            isGrounded: false 
          })],
        ]),
      };
      const input: PlatformerInput = { moveX: 0, moveY: 0, jump: true, timestamp: 1000 };
      const deltaTime = 16.67;

      const result = platformerPredictionScope.simulatePredicted(state, input, deltaTime);

      const player = result.players?.get("player");
      // Should not be jump velocity (would be negative)
      expect(player?.velocity.y).not.toBe(DEFAULT_JUMP_VELOCITY);
    });

    test("should land on floor", () => {
      const state: Partial<PlatformerWorld> = {
        players: new Map([
          ["player", createPlayer({ 
            position: { x: 0, y: DEFAULT_FLOOR_Y - 5 }, // Just above floor
            velocity: { x: 0, y: 100 }, // Falling fast
            isGrounded: false 
          })],
        ]),
      };
      const input: PlatformerInput = { moveX: 0, moveY: 0, jump: false, timestamp: 1000 };
      const deltaTime = 100; // 100ms should push through floor

      const result = platformerPredictionScope.simulatePredicted(state, input, deltaTime);

      const player = result.players?.get("player");
      // Should be clamped to floor
      expect(player?.position.y).toBeLessThanOrEqual(DEFAULT_FLOOR_Y);
      expect(player?.velocity.y).toBe(0);
      expect(player?.isGrounded).toBe(true);
    });

    test("should return state unchanged for empty players", () => {
      const state: Partial<PlatformerWorld> = {};
      const input: PlatformerInput = { moveX: 1, moveY: 0, jump: true, timestamp: 1000 };

      const result = platformerPredictionScope.simulatePredicted(state, input, 16.67);

      expect(result).toBe(state);
    });

    test("should return state unchanged for empty players map", () => {
      const state: Partial<PlatformerWorld> = { players: new Map() };
      const input: PlatformerInput = { moveX: 1, moveY: 0, jump: true, timestamp: 1000 };

      const result = platformerPredictionScope.simulatePredicted(state, input, 16.67);

      expect(result).toBe(state);
    });

    test("should set velocity.x based on input", () => {
      const state: Partial<PlatformerWorld> = {
        players: new Map([
          ["player", createPlayer({ velocity: { x: 0, y: 0 } })],
        ]),
      };
      const input: PlatformerInput = { moveX: 1, moveY: 0, jump: false, timestamp: 1000 };

      const result = platformerPredictionScope.simulatePredicted(state, input, 16.67);

      expect(result.players?.get("player")?.velocity.x).toBe(DEFAULT_PLAYER_SPEED);
    });

    test("should set velocity.x to 0 when no horizontal input", () => {
      const state: Partial<PlatformerWorld> = {
        players: new Map([
          ["player", createPlayer({ velocity: { x: 100, y: 0 } })],
        ]),
      };
      const input: PlatformerInput = { moveX: 0, moveY: 0, jump: false, timestamp: 1000 };

      const result = platformerPredictionScope.simulatePredicted(state, input, 16.67);

      expect(result.players?.get("player")?.velocity.x).toBe(0);
    });
  });

  describe("createIdleInput", () => {
    test("should return idle input", () => {
      const result = platformerPredictionScope.createIdleInput();

      expect(result.moveX).toBe(0);
      expect(result.moveY).toBe(0);
      expect(result.jump).toBe(false);
    });

    test("should match createIdleInput from types", () => {
      const scopeIdle = platformerPredictionScope.createIdleInput();
      const typesIdle = createIdleInput();

      expect(scopeIdle.moveX).toBe(typesIdle.moveX);
      expect(scopeIdle.moveY).toBe(typesIdle.moveY);
      expect(scopeIdle.jump).toBe(typesIdle.jump);
    });
  });

  describe("integration scenarios", () => {
    test("full prediction flow: extract, simulate, merge", () => {
      // Server world with two players
      const serverWorld = createWorld(new Map([
        ["local", createPlayer({ position: { x: 0, y: DEFAULT_FLOOR_Y - 10 } })],
        ["remote", createPlayer({ position: { x: 100, y: DEFAULT_FLOOR_Y - 10 } })],
      ]), 10);

      // Extract local player for prediction
      const predictable = platformerPredictionScope.extractPredictable(serverWorld, "local");
      expect(predictable.players?.size).toBe(1);

      // Simulate movement input
      const input: PlatformerInput = { moveX: 1, moveY: 0, jump: false, timestamp: 1000 };
      const predicted = platformerPredictionScope.simulatePredicted(predictable, input, 100);

      // Local player should have moved
      expect(predicted.players?.get("local")?.position.x).toBeGreaterThan(0);

      // Merge back with server world
      const merged = platformerPredictionScope.mergePrediction(serverWorld, predicted);

      // Local player uses predicted position
      expect(merged.players.get("local")?.position.x).toBeGreaterThan(0);
      // Remote player uses server position
      expect(merged.players.get("remote")?.position.x).toBe(100);
      // Tick preserved
      expect(merged.tick).toBe(10);
    });

    test("multiple inputs accumulate correctly", () => {
      const initialState: Partial<PlatformerWorld> = {
        players: new Map([
          ["player", createPlayer({ position: { x: 0, y: DEFAULT_FLOOR_Y - 10 } })],
        ]),
      };

      // Apply 3 right movement inputs
      let state = initialState;
      for (let i = 0; i < 3; i++) {
        const input: PlatformerInput = { moveX: 1, moveY: 0, jump: false, timestamp: 1000 + i * 16 };
        state = platformerPredictionScope.simulatePredicted(state, input, 16.67);
      }

      const finalPos = state.players?.get("player")?.position.x ?? 0;
      
      // Should have moved significantly right (3 frames at ~16.67ms each)
      // Speed = 200, time = ~50ms = 0.05s, distance ≈ 10 units
      expect(finalPos).toBeGreaterThan(9);
      expect(finalPos).toBeLessThan(12);
    });
  });
});
