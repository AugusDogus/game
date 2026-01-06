import { describe, test, expect, beforeEach } from "bun:test";
import { Predictor } from "./prediction.js";
import { DEFAULT_FLOOR_Y } from "../constants.js";
import type {
  PlatformerWorld,
  PlatformerInput,
  PlatformerPlayer,
} from "../examples/platformer/types.js";
import { platformerPredictionScope } from "../examples/platformer/prediction.js";

describe("Predictor", () => {
  let predictor: Predictor<PlatformerWorld, PlatformerInput>;
  const playerId = "player-1";

  beforeEach(() => {
    predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
  });

  // Helper to create a grounded player
  const createGroundedPlayer = (id: string, x: number = 0): PlatformerPlayer => ({
    id,
    position: { x, y: DEFAULT_FLOOR_Y - 10 },
    velocity: { x: 0, y: 0 },
    isGrounded: true,
  });

  // Helper to create world with single player
  const createWorld = (player: PlatformerPlayer): PlatformerWorld => ({
    players: new Map([[player.id, player]]),
    tick: 0,
  });

  describe("setBaseState", () => {
    test("should set the base state", () => {
      const player: PlatformerPlayer = {
        id: playerId,
        position: { x: 100, y: 200 },
        velocity: { x: 0, y: 0 },
        isGrounded: false,
      };
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

      predictor.applyInput({ moveX: 1, moveY: 0, jump: false, timestamp: Date.now() });

      const state = predictor.getState();
      const playerState = state?.players?.get(playerId);
      expect(playerState?.position.x).toBeGreaterThan(0);
    });

    test("should not throw when no state set", () => {
      // Should not throw
      predictor.applyInput({ moveX: 1, moveY: 0, jump: false, timestamp: Date.now() });
    });

    test("should accumulate multiple inputs", () => {
      const world = createWorld(createGroundedPlayer(playerId));
      predictor.setBaseState(world, playerId);

      predictor.applyInput({ moveX: 1, moveY: 0, jump: false, timestamp: Date.now() });
      const pos1 = predictor.getState()?.players?.get(playerId)?.position.x ?? 0;

      predictor.applyInput({ moveX: 1, moveY: 0, jump: false, timestamp: Date.now() + 16 });
      const pos2 = predictor.getState()?.players?.get(playerId)?.position.x ?? 0;

      expect(pos2).toBeGreaterThan(pos1);
    });

    test("should apply jump when grounded", () => {
      const world = createWorld(createGroundedPlayer(playerId));
      predictor.setBaseState(world, playerId);

      predictor.applyInput({ moveX: 0, moveY: 0, jump: true, timestamp: Date.now() });

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
        predictor60fps.applyInput({
          moveX: 1,
          moveY: 0,
          jump: false,
          timestamp: startTime + i * 16.67,
        });
      }
      const pos60fps = predictor60fps.getState()?.players?.get("player-60fps")?.position.x ?? 0;

      // Player B: 30fps (33.33ms between inputs) for 100ms = 3 inputs
      const predictor30fps = new Predictor<PlatformerWorld, PlatformerInput>(
        platformerPredictionScope,
      );
      const world30 = createWorld(createGroundedPlayer("player-30fps"));
      predictor30fps.setBaseState(world30, "player-30fps");

      for (let i = 0; i < 3; i++) {
        predictor30fps.applyInput({
          moveX: 1,
          moveY: 0,
          jump: false,
          timestamp: startTime + i * 33.33,
        });
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
      const player: PlatformerPlayer = {
        id: playerId,
        position: { x: 0, y: 0 }, // In the air
        velocity: { x: 0, y: 0 },
        isGrounded: false,
      };
      const world = createWorld(player);
      predictor.setBaseState(world, playerId);

      // First input
      predictor.applyInput({ moveX: 0, moveY: 0, jump: false, timestamp: 1000 });
      const posAfterFirst = predictor.getState()?.players?.get(playerId)?.position.y ?? 0;

      // Simulate tab switch: 500ms gap (player was away)
      predictor.applyInput({ moveX: 0, moveY: 0, jump: false, timestamp: 1500 });
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
        predictor.applyInput({
          moveX: 1,
          moveY: 0,
          jump: false,
          timestamp: startTime + i * 1, // 1ms apart
        });
      }
      const burstPos = predictor.getState()?.players?.get(playerId)?.position.x ?? 0;

      // Compare to normal 10 inputs over 166ms (60fps)
      const normalPredictor = new Predictor<PlatformerWorld, PlatformerInput>(
        platformerPredictionScope,
      );
      const normalWorld = createWorld(createGroundedPlayer("player-2"));
      normalPredictor.setBaseState(normalWorld, "player-2");
      for (let i = 0; i < 10; i++) {
        normalPredictor.applyInput({
          moveX: 1,
          moveY: 0,
          jump: false,
          timestamp: startTime + i * 16.67,
        });
      }
      const normalPos = normalPredictor.getState()?.players?.get("player-2")?.position.x ?? 0;

      // Burst movement should be much less than normal (roughly 10ms vs 166ms of movement)
      expect(burstPos).toBeLessThan(normalPos * 0.2);
    });
  });
});
