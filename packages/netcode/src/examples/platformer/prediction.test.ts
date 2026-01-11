import { describe, test, expect } from "bun:test";
import { platformerPredictionScope } from "./prediction.js";
import { createIdleInput } from "./types.js";
import type { PlatformerWorld, PlatformerPlayer, PlatformerInput } from "./types.js";
import { DEFAULT_FLOOR_Y, DEFAULT_PLAYER_SPEED, DEFAULT_JUMP_VELOCITY } from "../../constants.js";
import { createTestPlayer, createTestWorld } from "../../test-utils.js";

/** Helper to create test input with all required fields */
const createInput = (
  moveX: number,
  moveY: number,
  jump: boolean,
  timestamp: number,
): PlatformerInput => ({
  moveX,
  moveY,
  jump,
  shoot: false,
  shootTargetX: 0,
  shootTargetY: 0,
  timestamp,
});

const createPlayer = (
  id: string,
  overrides: Partial<Omit<PlatformerPlayer, "id">> = {},
): PlatformerPlayer =>
  createTestPlayer(id, {
    position: overrides.position ?? { x: 0, y: DEFAULT_FLOOR_Y - 10 },
    velocity: overrides.velocity ?? { x: 0, y: 0 },
    isGrounded: overrides.isGrounded ?? true,
    ...overrides,
  });

const createWorld = (players: PlatformerPlayer[], tick: number = 0): PlatformerWorld =>
  createTestWorld(players, { tick, gameState: "playing" });

describe("platformerPredictionScope", () => {
  describe("extractPredictable", () => {
    test("should extract only the local player", () => {
      const world = createWorld([
        createPlayer("local", { position: { x: 100, y: 100 } }),
        createPlayer("remote1", { position: { x: 200, y: 200 } }),
        createPlayer("remote2", { position: { x: 300, y: 300 } }),
      ]);

      const result = platformerPredictionScope.extractPredictable(world, "local");

      expect(result.players?.size).toBe(1);
      expect(result.players?.has("local")).toBe(true);
      expect(result.players?.has("remote1")).toBe(false);
      expect(result.players?.has("remote2")).toBe(false);
    });

    test("should copy player data, not reference", () => {
      const originalPlayer = createPlayer("local", { position: { x: 100, y: 100 } });
      const world = createWorld([originalPlayer]);

      const result = platformerPredictionScope.extractPredictable(world, "local");
      const extractedPlayer = result.players?.get("local");

      // Should have same values
      expect(extractedPlayer?.position.x).toBe(100);

      // But not the same object reference
      expect(extractedPlayer).not.toBe(originalPlayer);
    });

    test("should return empty Map when player not found", () => {
      const world = createWorld([createPlayer("other")]);

      const result = platformerPredictionScope.extractPredictable(world, "nonexistent");

      expect(result.players?.size).toBe(0);
    });

    test("should return empty Map for empty world", () => {
      const world = createWorld([]);

      const result = platformerPredictionScope.extractPredictable(world, "anyPlayer");

      expect(result.players?.size).toBe(0);
    });
  });

  describe("mergePrediction", () => {
    test("should override local player with predicted state", () => {
      const serverWorld = createWorld([
        createPlayer("local", { position: { x: 100, y: 100 } }),
        createPlayer("remote", { position: { x: 200, y: 200 } }),
      ]);
      const predicted: Partial<PlatformerWorld> = {
        players: new Map([["local", createPlayer("local", { position: { x: 150, y: 150 } })]]),
      };

      const result = platformerPredictionScope.mergePrediction(serverWorld, predicted);

      // Local player should be from prediction
      expect(result.players.get("local")?.position.x).toBe(150);
      // Remote player should be from server
      expect(result.players.get("remote")?.position.x).toBe(200);
    });

    test("should keep all server players", () => {
      const serverWorld = createWorld([
        createPlayer("p1"),
        createPlayer("p2"),
        createPlayer("p3"),
      ]);
      const predicted: Partial<PlatformerWorld> = {
        players: new Map([["p1", createPlayer("p1", { position: { x: 999, y: 999 } })]]),
      };

      const result = platformerPredictionScope.mergePrediction(serverWorld, predicted);

      expect(result.players.size).toBe(3);
      expect(result.players.has("p1")).toBe(true);
      expect(result.players.has("p2")).toBe(true);
      expect(result.players.has("p3")).toBe(true);
    });

    test("should return server world if prediction is empty", () => {
      const serverWorld = createWorld([createPlayer("player", { position: { x: 100, y: 100 } })]);

      const result1 = platformerPredictionScope.mergePrediction(serverWorld, {});
      expect(result1).toBe(serverWorld);

      const result2 = platformerPredictionScope.mergePrediction(serverWorld, { players: new Map() });
      expect(result2).toBe(serverWorld);
    });

    test("should preserve other server world properties", () => {
      const serverWorld = createWorld([createPlayer("local")], 42);
      const predicted: Partial<PlatformerWorld> = {
        players: new Map([["local", createPlayer("local", { position: { x: 500, y: 500 } })]]),
      };

      const result = platformerPredictionScope.mergePrediction(serverWorld, predicted);

      expect(result.tick).toBe(42);
    });
  });

  describe("simulatePredicted", () => {
    test("should move player right on positive moveX", () => {
      const state: Partial<PlatformerWorld> = {
        players: new Map([
          ["player", createPlayer("player", { position: { x: 100, y: DEFAULT_FLOOR_Y - 10 } })],
        ]),
      };
      const input: PlatformerInput = createInput(1, 0, false, 1000);
      const deltaTime = 100; // 100ms

      const result = platformerPredictionScope.simulatePredicted(state, input, deltaTime);

      const player = result.players?.get("player");
      // Expected: 100 + (1 * DEFAULT_PLAYER_SPEED * 0.1)
      expect(player?.position.x).toBeGreaterThan(100);
    });

    test("should move player left on negative moveX", () => {
      const state: Partial<PlatformerWorld> = {
        players: new Map([
          ["player", createPlayer("player", { position: { x: 100, y: DEFAULT_FLOOR_Y - 10 } })],
        ]),
      };
      const input: PlatformerInput = createInput(-1, 0, false, 1000);
      const deltaTime = 100;

      const result = platformerPredictionScope.simulatePredicted(state, input, deltaTime);

      expect(result.players?.get("player")?.position.x).toBeLessThan(100);
    });

    test("should apply gravity when in air", () => {
      const state: Partial<PlatformerWorld> = {
        players: new Map([
          [
            "player",
            createPlayer("player", {
              position: { x: 0, y: 100 }, // Above floor
              velocity: { x: 0, y: 0 },
              isGrounded: false,
            }),
          ],
        ]),
      };
      const input: PlatformerInput = createInput(0, 0, false, 1000);
      const deltaTime = 100;

      const result = platformerPredictionScope.simulatePredicted(state, input, deltaTime);

      const player = result.players?.get("player");
      expect(player?.velocity.y).toBeGreaterThan(0); // Falling (gravity is positive)
    });

    test("should jump when grounded and jump=true", () => {
      const state: Partial<PlatformerWorld> = {
        players: new Map([
          [
            "player",
            createPlayer("player", {
              position: { x: 0, y: DEFAULT_FLOOR_Y - 10 },
              isGrounded: true,
            }),
          ],
        ]),
      };
      const input: PlatformerInput = createInput(0, 0, true, 1000);
      const deltaTime = 16.67;

      const result = platformerPredictionScope.simulatePredicted(state, input, deltaTime);

      const player = result.players?.get("player");
      expect(player?.velocity.y).toBe(DEFAULT_JUMP_VELOCITY);
    });

    test("should not jump when not grounded", () => {
      const state: Partial<PlatformerWorld> = {
        players: new Map([
          [
            "player",
            createPlayer("player", {
              position: { x: 0, y: 100 },
              velocity: { x: 0, y: 50 },
              isGrounded: false,
            }),
          ],
        ]),
      };
      const input: PlatformerInput = createInput(0, 0, true, 1000);
      const deltaTime = 16.67;

      const result = platformerPredictionScope.simulatePredicted(state, input, deltaTime);

      const player = result.players?.get("player");
      // Should not be jump velocity (would be negative)
      expect(player?.velocity.y).not.toBe(DEFAULT_JUMP_VELOCITY);
    });

    test("should land on floor", () => {
      const state: Partial<PlatformerWorld> = {
        players: new Map([
          [
            "player",
            createPlayer("player", {
              position: { x: 0, y: DEFAULT_FLOOR_Y - 5 }, // Just above floor
              velocity: { x: 0, y: 100 }, // Falling fast
              isGrounded: false,
            }),
          ],
        ]),
      };
      const input: PlatformerInput = createInput(0, 0, false, 1000);
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
      const input: PlatformerInput = createInput(1, 0, true, 1000);

      const result = platformerPredictionScope.simulatePredicted(state, input, 16.67);

      expect(result).toBe(state);
    });

    test("should return state unchanged for empty players map", () => {
      const state: Partial<PlatformerWorld> = { players: new Map() };
      const input: PlatformerInput = createInput(1, 0, true, 1000);

      const result = platformerPredictionScope.simulatePredicted(state, input, 16.67);

      expect(result).toBe(state);
    });

    test("should set velocity.x based on input", () => {
      const state: Partial<PlatformerWorld> = {
        players: new Map([["player", createPlayer("player", { velocity: { x: 0, y: 0 } })]]),
      };
      const input: PlatformerInput = createInput(1, 0, false, 1000);

      const result = platformerPredictionScope.simulatePredicted(state, input, 16.67);

      expect(result.players?.get("player")?.velocity.x).toBe(DEFAULT_PLAYER_SPEED);
    });

    test("should set velocity.x to 0 when no horizontal input", () => {
      const state: Partial<PlatformerWorld> = {
        players: new Map([["player", createPlayer("player", { velocity: { x: 100, y: 0 } })]]),
      };
      const input: PlatformerInput = createInput(0, 0, false, 1000);

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
      const serverWorld = createWorld(
        [
          createPlayer("local", { position: { x: 0, y: DEFAULT_FLOOR_Y - 10 } }),
          createPlayer("remote", { position: { x: 100, y: DEFAULT_FLOOR_Y - 10 } }),
        ],
        10,
      );

      // Extract local player for prediction
      const predictable = platformerPredictionScope.extractPredictable(serverWorld, "local");
      expect(predictable.players?.size).toBe(1);

      // Simulate movement input
      const input: PlatformerInput = createInput(1, 0, false, 1000);
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
          ["player", createPlayer("player", { position: { x: 0, y: DEFAULT_FLOOR_Y - 10 } })],
        ]),
      };

      // Apply 3 right movement inputs
      let state = initialState;
      for (let i = 0; i < 3; i++) {
        const input: PlatformerInput = createInput(1, 0, false, 1000 + i * 16);
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
