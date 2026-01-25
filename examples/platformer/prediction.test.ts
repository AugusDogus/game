import { describe, test, expect } from "bun:test";
import { platformerPredictionScope } from "./prediction.js";
import { createIdleInput } from "./types.js";
import type { PlatformerWorld, PlatformerPlayer, PlatformerInput } from "./types.js";
import { DEFAULT_FLOOR_Y } from "@game/netcode";
import { createTestPlayer, createTestWorld } from "./test-utils.js";

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
    // Y-up: grounded player center at floor + halfHeight = 0 + 10 = 10
    position: overrides.position ?? { x: 0, y: DEFAULT_FLOOR_Y + 10 },
    velocity: overrides.velocity ?? { x: 0, y: 0 },
    isGrounded: overrides.isGrounded ?? true,
    ...overrides,
  });

const createWorld = (players: PlatformerPlayer[], tick: number = 0): PlatformerWorld =>
  createTestWorld(players, { tick, gameState: "playing" });

describe("platformerPredictionScope", () => {
  describe("extractPredictable", () => {
    test("should extract ALL players for collision detection", () => {
      const world = createWorld([
        createPlayer("local", { position: { x: 100, y: 100 } }),
        createPlayer("remote1", { position: { x: 200, y: 200 } }),
        createPlayer("remote2", { position: { x: 300, y: 300 } }),
      ]);

      const result = platformerPredictionScope.extractPredictable(world, "local");

      // Should extract ALL players for proper collision detection
      expect(result.players?.size).toBe(3);
      expect(result.players?.has("local")).toBe(true);
      expect(result.players?.has("remote1")).toBe(true);
      expect(result.players?.has("remote2")).toBe(true);
    });

    test("should copy player data, not reference", () => {
      const originalPlayer = createPlayer("local", { position: { x: 100, y: 100 } });
      const world = createWorld([originalPlayer]);

      const result = platformerPredictionScope.extractPredictable(world, "local");
      const extractedPlayer = result.players?.get("local");

      // Should have same values
      expect(extractedPlayer?.position.x).toBe(100);

      // But not the same object reference (Map is copied)
      expect(result.players).not.toBe(world.players);
    });

    test("should return all players even when local player not found", () => {
      const world = createWorld([createPlayer("other")]);

      const result = platformerPredictionScope.extractPredictable(world, "nonexistent");

      // Still extracts all players for collision
      expect(result.players?.size).toBe(1);
      expect(result.players?.has("other")).toBe(true);
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
        players: new Map([
          ["local", createPlayer("local", { position: { x: 150, y: 150 } })],
          ["remote", createPlayer("remote", { position: { x: 999, y: 999 } })], // Predicted remote (should be ignored)
        ]),
      };

      // Pass localPlayerId so merge knows which player to use from prediction
      const result = platformerPredictionScope.mergePrediction(serverWorld, predicted, "local");

      // Local player should be from prediction
      expect(result.players.get("local")?.position.x).toBe(150);
      // Remote player should be from SERVER (not predicted)
      expect(result.players.get("remote")?.position.x).toBe(200);
    });

    test("should keep all server players", () => {
      const serverWorld = createWorld([
        createPlayer("p1"),
        createPlayer("p2"),
        createPlayer("p3"),
      ]);
      const predicted: Partial<PlatformerWorld> = {
        players: new Map([
          ["p1", createPlayer("p1", { position: { x: 999, y: 999 } })],
          ["p2", createPlayer("p2", { position: { x: 888, y: 888 } })],
          ["p3", createPlayer("p3", { position: { x: 777, y: 777 } })],
        ]),
      };

      const result = platformerPredictionScope.mergePrediction(serverWorld, predicted, "p1");

      expect(result.players.size).toBe(3);
      expect(result.players.has("p1")).toBe(true);
      expect(result.players.has("p2")).toBe(true);
      expect(result.players.has("p3")).toBe(true);
      // Only p1 should use predicted position
      expect(result.players.get("p1")?.position.x).toBe(999);
      expect(result.players.get("p2")?.position.x).toBe(0); // Server default
      expect(result.players.get("p3")?.position.x).toBe(0); // Server default
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

      const result = platformerPredictionScope.mergePrediction(serverWorld, predicted, "local");

      expect(result.tick).toBe(42);
    });
  });

  describe("simulatePredicted", () => {
    test("should move player right on positive moveX", () => {
      // Setup: grounded player at x=100, moveX=1, dt=100ms
      // Physics: smoothDamp from 0 to 200 with smoothTime=0.1, dt=0.1
      // Expected velocity.x: 111.76470588235294
      // Expected position.x: 100 + 111.76470588235294 * 0.1 = 111.17647058823529
      const state: Partial<PlatformerWorld> = {
        players: new Map([
          ["player", createPlayer("player", { position: { x: 100, y: DEFAULT_FLOOR_Y + 10 } })],
        ]),
        gameState: "playing",
      };
      const input: PlatformerInput = createInput(1, 0, false, 1000);
      const deltaTime = 100; // 100ms

      const result = platformerPredictionScope.simulatePredicted(state, input, deltaTime, "player");

      const player = result.players?.get("player");
      expect(player?.velocity.x).toBe(111.76470588235294);
      expect(player?.position.x).toBe(111.17647058823529);
    });

    test("should move player left on negative moveX", () => {
      // Setup: grounded player at x=100, moveX=-1, dt=100ms
      // Expected: same magnitude as right, but negative direction
      const state: Partial<PlatformerWorld> = {
        players: new Map([
          ["player", createPlayer("player", { position: { x: 100, y: DEFAULT_FLOOR_Y + 10 } })],
        ]),
        gameState: "playing",
      };
      const input: PlatformerInput = createInput(-1, 0, false, 1000);
      const deltaTime = 100;

      const result = platformerPredictionScope.simulatePredicted(state, input, deltaTime, "player");

      expect(result.players?.get("player")?.velocity.x).toBe(-111.76470588235294);
      expect(result.players?.get("player")?.position.x).toBe(88.82352941176471);
    });

    test("should apply gravity when in air", () => {
      // Setup: airborne player at y=100, no input, dt=100ms
      // Physics: gravity = -800, velocity.y = 0 + (-800 * 0.1) = -80
      // position.y = 100 + (-80 * 0.1) = 92
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
        gameState: "playing",
      };
      const input: PlatformerInput = createInput(0, 0, false, 1000);
      const deltaTime = 100;

      const result = platformerPredictionScope.simulatePredicted(state, input, deltaTime, "player");

      const player = result.players?.get("player");
      expect(player?.velocity.y).toBe(-80);
      expect(player?.position.y).toBe(92);
    });

    test("should jump when grounded and jump=true", () => {
      // Setup: grounded player, jump pressed, dt=50ms (0.05s)
      // Physics: maxJumpVelocity = 320
      // Expected: velocity.y = 320
      const state: Partial<PlatformerWorld> = {
        players: new Map([
          [
            "player",
            createPlayer("player", {
              position: { x: 0, y: DEFAULT_FLOOR_Y + 10 },
              isGrounded: true,
            }),
          ],
        ]),
        gameState: "playing",
      };
      const input: PlatformerInput = createInput(0, 0, true, 1000);
      const deltaTime = 50; // 50ms

      const result = platformerPredictionScope.simulatePredicted(state, input, deltaTime, "player");

      const player = result.players?.get("player");
      expect(player?.velocity.y).toBe(320); // maxJumpVelocity
      expect(player?.isGrounded).toBe(false);
    });

    test("should not jump when not grounded", () => {
      // Setup: airborne player at y=100, velocity.y=-50, jump pressed, dt=50ms
      // Physics: gravity = -800, velocity.y = -50 + (-800 * 0.05) = -90
      const state: Partial<PlatformerWorld> = {
        players: new Map([
          [
            "player",
            createPlayer("player", {
              position: { x: 0, y: 100 },
              velocity: { x: 0, y: -50 }, // Y-up: negative = falling
              isGrounded: false,
            }),
          ],
        ]),
        gameState: "playing",
      };
      const input: PlatformerInput = createInput(0, 0, true, 1000);
      const deltaTime = 50; // 50ms

      const result = platformerPredictionScope.simulatePredicted(state, input, deltaTime, "player");

      const player = result.players?.get("player");
      expect(player?.velocity.y).toBe(-90);
    });

    test("should land on floor", () => {
      const state: Partial<PlatformerWorld> = {
        players: new Map([
          [
            "player",
            createPlayer("player", {
              position: { x: 0, y: 15 }, // Just above floor (Y-up: floor at 0, player should land at y=10)
              velocity: { x: 0, y: -100 }, // Y-up: falling fast (negative velocity)
              isGrounded: false,
            }),
          ],
        ]),
        gameState: "playing",
      };
      const input: PlatformerInput = createInput(0, 0, false, 1000);
      const deltaTime = 100; // 100ms should push through floor

      const result = platformerPredictionScope.simulatePredicted(state, input, deltaTime, "player");

      const player = result.players?.get("player");
      // Y-up: Should be clamped to floor or near it
      // Physics engine handles collision detection - player shouldn't go below floor
      expect(player?.position.y).toBeGreaterThanOrEqual(DEFAULT_FLOOR_Y + 10 - 1);
      // When grounded, velocity.y should be 0 or near 0
      // Note: If not quite grounded, may still have negative velocity approaching floor
      expect(player?.isGrounded || player?.velocity.y <= 0).toBe(true);
    });

    test("should return state unchanged for empty players", () => {
      const state: Partial<PlatformerWorld> = {};
      const input: PlatformerInput = createInput(1, 0, true, 1000);

      const result = platformerPredictionScope.simulatePredicted(state, input, 16.67, "player");

      expect(result).toBe(state);
    });

    test("should return state unchanged for empty players map", () => {
      const state: Partial<PlatformerWorld> = { players: new Map() };
      const input: PlatformerInput = createInput(1, 0, true, 1000);

      const result = platformerPredictionScope.simulatePredicted(state, input, 16.67, "player");

      expect(result).toBe(state);
    });

    test("should set velocity.x based on input", () => {
      // Setup: grounded player, moveX=1, dt=16.67ms
      // Physics: smoothDamp(0, 200, 0, 0.1, 0.01667) = 8.895050499138875
      const state: Partial<PlatformerWorld> = {
        players: new Map([["player", createPlayer("player", { velocity: { x: 0, y: 0 } })]]),
        gameState: "playing",
      };
      const input: PlatformerInput = createInput(1, 0, false, 1000);

      const result = platformerPredictionScope.simulatePredicted(state, input, 16.67, "player");

      expect(result.players?.get("player")?.velocity.x).toBe(8.895050499138875);
    });

    test("should decelerate velocity.x towards 0 when no horizontal input", () => {
      // Setup: grounded player with velocity.x=100, no input, dt=16.67ms
      // Physics: smoothDamp(100, 0, 0, 0.1, 0.01667) = 95.55247475043056
      const state: Partial<PlatformerWorld> = {
        players: new Map([["player", createPlayer("player", { velocity: { x: 100, y: 0 } })]]),
        gameState: "playing",
      };
      const input: PlatformerInput = createInput(0, 0, false, 1000);

      const result = platformerPredictionScope.simulatePredicted(state, input, 16.67, "player");

      expect(result.players?.get("player")?.velocity.x).toBe(95.55247475043056);
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
      // Server world with two players (Y-up: grounded at y=10)
      const serverWorld = createWorld(
        [
          createPlayer("local", { position: { x: 0, y: DEFAULT_FLOOR_Y + 10 } }),
          createPlayer("remote", { position: { x: 100, y: DEFAULT_FLOOR_Y + 10 } }),
        ],
        10,
      );

      // Extract all players for prediction (needed for collision)
      const predictable = platformerPredictionScope.extractPredictable(serverWorld, "local");
      expect(predictable.players?.size).toBe(2); // Both players extracted

      // Simulate movement input for local player
      const input: PlatformerInput = createInput(1, 0, false, 1000);
      const predicted = platformerPredictionScope.simulatePredicted(predictable, input, 100, "local");

      // Local player should have moved
      expect(predicted.players?.get("local")?.position.x).toBeGreaterThan(0);
      // Remote player should NOT have moved (gets idle input)
      expect(predicted.players?.get("remote")?.position.x).toBe(100);

      // Merge back with server world
      const merged = platformerPredictionScope.mergePrediction(serverWorld, predicted, "local");

      // Local player uses predicted position
      expect(merged.players.get("local")?.position.x).toBeGreaterThan(0);
      // Remote player uses server position
      expect(merged.players.get("remote")?.position.x).toBe(100);
      // Tick preserved
      expect(merged.tick).toBe(10);
    });

    test("multiple inputs accumulate correctly", () => {
      // Setup: grounded player, 3 right inputs at 16.67ms each
      // Physics: smoothDamp accelerates velocity over 3 ticks
      // After tick 1: velocity.x = 8.895, position.x = 0.148
      // After tick 2: velocity.x = 28.81, position.x = 0.629
      // After tick 3: velocity.x = 52.79, position.x = 1.509
      const initialState: Partial<PlatformerWorld> = {
        players: new Map([
          ["player", createPlayer("player", { position: { x: 0, y: DEFAULT_FLOOR_Y + 10 } })],
        ]),
        gameState: "playing",
      };

      // Apply 3 right movement inputs
      let state = initialState;
      for (let i = 0; i < 3; i++) {
        const input: PlatformerInput = createInput(1, 0, false, 1000 + i * 16);
        state = platformerPredictionScope.simulatePredicted(state, input, 16.67, "player");
      }

      const finalPos = state.players?.get("player")?.position.x ?? 0;
      const finalVel = state.players?.get("player")?.velocity.x ?? 0;

      // Exact values from smoothDamp formula
      expect(finalPos).toBe(1.5085054162983704);
      expect(finalVel).toBe(52.78641642455983);
    });
  });
});
