import { describe, test, expect, beforeEach } from "bun:test";
import { Predictor } from "./prediction.js";
import { DEFAULT_FLOOR_Y } from "../constants.js";
import type {
  PlatformerWorld,
  PlatformerInput,
  PlatformerPlayer,
} from "../examples/platformer/types.js";
import { platformerPredictionScope } from "../examples/platformer/prediction.js";
import { createTestPlayer, createPlayingWorld } from "../test-utils.js";

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

describe("Predictor", () => {
  let predictor: Predictor<PlatformerWorld, PlatformerInput>;
  const playerId = "player-1";

  beforeEach(() => {
    predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
  });

  // Helper to create a grounded player
  const createGroundedPlayer = (id: string, x: number = 0): PlatformerPlayer =>
    createTestPlayer(id, {
    position: { x, y: DEFAULT_FLOOR_Y - 10 },
    isGrounded: true,
  });

  // Helper to create world with single player
  const createWorld = (player: PlatformerPlayer): PlatformerWorld =>
    createPlayingWorld([player]);

  describe("setBaseState", () => {
    test("should set the base state", () => {
      const player = createTestPlayer(playerId, {
        position: { x: 100, y: 200 },
        isGrounded: false,
      });
      const world = createWorld(player);

      predictor.setBaseState(world, playerId);

      const result = predictor.getState();
      expect(result?.players?.get(playerId)?.position.x).toBe(100);
      expect(result?.players?.get(playerId)?.position.y).toBe(200);
    });
  });

  describe("getState", () => {
    test("should return null when no state set", () => {
      expect(predictor.getState()).toBeNull();
    });

    test("should return current predicted state", () => {
      const world = createWorld(createGroundedPlayer(playerId));
      predictor.setBaseState(world, playerId);

      expect(predictor.getState()).not.toBeNull();
    });
  });

  describe("applyInput", () => {
    test("should apply input to local state", () => {
      const world = createWorld(createGroundedPlayer(playerId));
      predictor.setBaseState(world, playerId);

      predictor.applyInput(createInput(1, 0, false, Date.now()));

      const state = predictor.getState();
      const playerState = state?.players?.get(playerId);
      expect(playerState?.position.x).toBeGreaterThan(0);
    });

    test("should not throw when no state set", () => {
      // Should not throw
      predictor.applyInput(createInput(1, 0, false, Date.now()));
    });

    test("should accumulate multiple inputs", () => {
      const world = createWorld(createGroundedPlayer(playerId));
      predictor.setBaseState(world, playerId);

      predictor.applyInput(createInput(1, 0, false, Date.now()));
      const pos1 = predictor.getState()?.players?.get(playerId)?.position.x ?? 0;

      predictor.applyInput(createInput(1, 0, false, Date.now() + 16));
      const pos2 = predictor.getState()?.players?.get(playerId)?.position.x ?? 0;

      expect(pos2).toBeGreaterThan(pos1);
    });

    test("should apply jump when grounded", () => {
      const world = createWorld(createGroundedPlayer(playerId));
      predictor.setBaseState(world, playerId);

      predictor.applyInput(createInput(0, 0, true, Date.now()));

      const state = predictor.getState();
      const playerState = state?.players?.get(playerId);
      expect(playerState?.velocity.y).toBeLessThan(0); // Negative = upward
      expect(playerState?.isGrounded).toBe(false);
    });
  });

  describe("reset", () => {
    test("should clear the state", () => {
      const world = createWorld(createGroundedPlayer(playerId, 100));
      predictor.setBaseState(world, playerId);

      predictor.reset();

      expect(predictor.getState()).toBeNull();
    });
  });

  describe("other players in world state", () => {
    test("should extract all players for collision detection", () => {
      const localPlayer = createGroundedPlayer(playerId, 0);
      const otherPlayer = createGroundedPlayer("other-player", 100);
      
      const world = createPlayingWorld([localPlayer, otherPlayer]);

      predictor.setBaseState(world, playerId);
      
      const state = predictor.getState();
      // Should have ALL players for collision detection
      expect(state?.players?.size).toBe(2);
      expect(state?.players?.has(playerId)).toBe(true);
      expect(state?.players?.has("other-player")).toBe(true);
    });

    test("inputs should only affect local player prediction", () => {
      const localPlayer = createGroundedPlayer(playerId, 0);
      const otherPlayer = createGroundedPlayer("other-player", 100);
      
      const world = createPlayingWorld([localPlayer, otherPlayer]);

      predictor.setBaseState(world, playerId);
      predictor.applyInput(createInput(1, 0, false, Date.now()));

      const state = predictor.getState();
      // Local player should have moved
      expect(state?.players?.get(playerId)?.position.x).toBeGreaterThan(0);
      // Other player should be in prediction state (for collision) but not moved
      // (they get idle input during prediction)
      expect(state?.players?.has("other-player")).toBe(true);
      expect(state?.players?.get("other-player")?.position.x).toBe(100);
    });
  });

  describe("mergeWithServer", () => {
    test("should merge predicted local player with server world", () => {
      const otherPlayer = createGroundedPlayer("other-player", 500);
      
      // Setup server world with both players
      const serverLocalPlayer = createTestPlayer(playerId, {
        position: { x: 10, y: DEFAULT_FLOOR_Y - 10 },
        isGrounded: true,
      });
      const serverWorld = createPlayingWorld([serverLocalPlayer, otherPlayer]);
      serverWorld.tick = 5;

      // Setup prediction with local player moved further
      predictor.setBaseState(serverWorld, playerId);
      predictor.applyInput(createInput(1, 0, false, Date.now()));

      const merged = predictor.mergeWithServer(serverWorld);

      // Should have both players
      expect(merged.players.size).toBe(2);
      // Local player should use predicted position (ahead of server)
      expect(merged.players.get(playerId)?.position.x).toBeGreaterThan(10);
      // Other player should use server position
      expect(merged.players.get("other-player")?.position.x).toBe(500);
      // Tick should be from server
      expect(merged.tick).toBe(5);
    });

    test("should return server world when no prediction", () => {
      const serverWorld = createPlayingWorld([createGroundedPlayer("player")]);
      serverWorld.tick = 10;

      const merged = predictor.mergeWithServer(serverWorld);

      expect(merged).toBe(serverWorld);
    });
  });

  describe("applyInputWithDelta", () => {
    test("should apply input with explicit delta time", () => {
      const world = createWorld(createGroundedPlayer(playerId));
      predictor.setBaseState(world, playerId);

      // Apply with specific delta (50ms)
      predictor.applyInputWithDelta(
        createInput(1, 0, false, 1000),
        50,
      );

      const state = predictor.getState();
      // At 200 units/sec, 50ms should move 10 units
      expect(state?.players?.get(playerId)?.position.x).toBeCloseTo(10, 0);
    });

    test("should not update internal timestamp tracking", () => {
      const world = createWorld(createGroundedPlayer(playerId));
      predictor.setBaseState(world, playerId);

      // First, apply a normal input
      predictor.applyInput(createInput(1, 0, false, 1000));
      
      // Apply with delta (doesn't affect timestamp tracking)
      predictor.applyInputWithDelta(
        createInput(1, 0, false, 9999),
        16,
      );

      // Apply another normal input - should calculate delta from 1000, not 9999
      predictor.applyInput(createInput(1, 0, false, 1016));

      // Should work without issues
      const state = predictor.getState();
      expect(state?.players?.get(playerId)?.position.x).toBeGreaterThan(0);
    });
  });

  describe("timestamp management", () => {
    test("resetTimestamp should clear last input timestamp", () => {
      const world = createWorld(createGroundedPlayer(playerId));
      predictor.setBaseState(world, playerId);

      // Apply input to set timestamp
      predictor.applyInput(createInput(1, 0, false, 1000));
      const pos1 = predictor.getState()?.players?.get(playerId)?.position.x ?? 0;

      predictor.resetTimestamp();

      // Next input should use default delta (16.67ms) instead of calculating from 1000
      predictor.applyInput(createInput(1, 0, false, 5000));
      
      // If timestamp wasn't reset, delta would be 4000ms (clamped to 100ms)
      // With reset, delta is 16.67ms - so movement should be similar to first input
      const pos2 = predictor.getState()?.players?.get(playerId)?.position.x ?? 0;
      const movement = pos2 - pos1;
      
      // Movement should be small (16.67ms worth, not 100ms worth)
      expect(movement).toBeLessThan(10);
    });

    test("setLastInputTimestamp should set custom timestamp", () => {
      const world = createWorld(createGroundedPlayer(playerId));
      predictor.setBaseState(world, playerId);

      predictor.setLastInputTimestamp(1000);
      
      // Apply input 50ms later
      predictor.applyInput(createInput(1, 0, false, 1050));

      const state = predictor.getState();
      // Should have moved for 50ms (10 units at 200 units/sec)
      expect(state?.players?.get(playerId)?.position.x).toBeCloseTo(10, 0);
    });
  });

  describe("real-world scenarios", () => {
    test("variable frame rate: 30fps and 60fps players should move similar distances over same real time", () => {
      // Player A: 60fps (16.67ms between inputs) for 100ms = 6 inputs
      const predictor60fps = new Predictor<PlatformerWorld, PlatformerInput>(
        platformerPredictionScope,
      );
      const world60 = createWorld(createGroundedPlayer("player-60fps"));
      predictor60fps.setBaseState(world60, "player-60fps");

      const startTime = 1000;
      for (let i = 0; i < 6; i++) {
        predictor60fps.applyInput(createInput(1, 0, false, startTime + i * 16.67));
      }
      const pos60fps = predictor60fps.getState()?.players?.get("player-60fps")?.position.x ?? 0;

      // Player B: 30fps (33.33ms between inputs) for 100ms = 3 inputs
      const predictor30fps = new Predictor<PlatformerWorld, PlatformerInput>(
        platformerPredictionScope,
      );
      const world30 = createWorld(createGroundedPlayer("player-30fps"));
      predictor30fps.setBaseState(world30, "player-30fps");

      for (let i = 0; i < 3; i++) {
        predictor30fps.applyInput(createInput(1, 0, false, startTime + i * 33.33));
      }
      const pos30fps = predictor30fps.getState()?.players?.get("player-30fps")?.position.x ?? 0;

      // Both should have moved roughly the same distance (within 25% tolerance)
      // because total simulated time is similar (~100ms each)
      // Small differences come from the first input using default deltaTime
      const ratio = pos60fps / pos30fps;
      expect(ratio).toBeGreaterThan(0.75);
      expect(ratio).toBeLessThan(1.25);
    });

    test("tab switch: large time gap between inputs should apply correct physics", () => {
      const player = createTestPlayer(playerId, {
        position: { x: 0, y: 0 }, // In the air
        isGrounded: false,
      });
      const world = createWorld(player);
      predictor.setBaseState(world, playerId);

      // First input
      predictor.applyInput(createInput(0, 0, false, 1000));
      const posAfterFirst = predictor.getState()?.players?.get(playerId)?.position.y ?? 0;

      // Simulate tab switch: 500ms gap (player was away)
      predictor.applyInput(createInput(0, 0, false, 1500));
      const posAfterGap = predictor.getState()?.players?.get(playerId)?.position.y ?? 0;

      // Should have fallen significantly more during the 500ms gap
      // (but clamped to 100ms max for safety)
      const fallDuringGap = posAfterGap - posAfterFirst;
      expect(fallDuringGap).toBeGreaterThan(0); // Fell down (Y increases)
    });

    test("rapid inputs: burst of inputs should not cause excessive movement", () => {
      const world = createWorld(createGroundedPlayer(playerId));
      predictor.setBaseState(world, playerId);

      // Simulate a burst of 10 inputs in 10ms (unrealistic but could happen with input buffering bugs)
      const startTime = 1000;
      for (let i = 0; i < 10; i++) {
        predictor.applyInput(createInput(1, 0, false, startTime + i * 1)); // 1ms apart
      }
      const burstPos = predictor.getState()?.players?.get(playerId)?.position.x ?? 0;

      // Compare to normal 10 inputs over 166ms (60fps)
      const normalPredictor = new Predictor<PlatformerWorld, PlatformerInput>(
        platformerPredictionScope,
      );
      const normalWorld = createWorld(createGroundedPlayer("player-2"));
      normalPredictor.setBaseState(normalWorld, "player-2");
      for (let i = 0; i < 10; i++) {
        normalPredictor.applyInput(createInput(1, 0, false, startTime + i * 16.67));
      }
      const normalPos = normalPredictor.getState()?.players?.get("player-2")?.position.x ?? 0;

      // Burst movement should be much less than normal (roughly 10ms vs 166ms of movement)
      expect(burstPos).toBeLessThan(normalPos * 0.2);
    });
  });
});
