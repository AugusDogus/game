import { describe, test, expect, beforeEach } from "bun:test";
import { Predictor } from "./prediction.js";
import { DEFAULT_FLOOR_Y, DEFAULT_TICK_INTERVAL_MS } from "../constants.js";
import {
  type PlatformerWorld,
  type PlatformerInput,
  type PlatformerPlayer,
  platformerPredictionScope,
  createTestPlayer,
  createPlayingWorld,
} from "@game/example-platformer";

/** Helper to create test input with all required fields */
const createInput = (
  moveX: number,
  moveY: number,
  jump: boolean,
  timestamp: number,
  jumpPressed: boolean = false,
  jumpReleased: boolean = false,
): PlatformerInput => ({
  moveX,
  moveY,
  jump,
  jumpPressed,
  jumpReleased,
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
  // Y-up: floor at y=0, player center at halfHeight (10) above floor
  const createGroundedPlayer = (id: string, x: number = 0): PlatformerPlayer =>
    createTestPlayer(id, {
    position: { x, y: DEFAULT_FLOOR_Y + 10 },
    isGrounded: true,
  });

  // Helper to create world with single player
  const createWorld = (player: PlatformerPlayer): PlatformerWorld =>
    createPlayingWorld([player]);

  describe("constructor", () => {
    test("should use default tick interval", () => {
      const p = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
      expect(p).toBeDefined();
    });

    test("should accept custom tick interval", () => {
      const customInterval = 33; // ~30fps
      const p = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope, customInterval);
      expect(p).toBeDefined();
    });
  });

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
    test("should apply input to local state using fixed tick delta", () => {
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

    test("should accumulate multiple inputs with consistent delta", () => {
      const world = createWorld(createGroundedPlayer(playerId));
      predictor.setBaseState(world, playerId);

      predictor.applyInput(createInput(1, 0, false, Date.now()));
      const pos1 = predictor.getState()?.players?.get(playerId)?.position.x ?? 0;

      // Second input - uses same fixed delta regardless of timestamp
      predictor.applyInput(createInput(1, 0, false, Date.now() + 16));
      const pos2 = predictor.getState()?.players?.get(playerId)?.position.x ?? 0;

      expect(pos2).toBeGreaterThan(pos1);
    });

    test("should apply jump when grounded", () => {
      const world = createWorld(createGroundedPlayer(playerId));
      predictor.setBaseState(world, playerId);

      predictor.applyInput(createInput(0, 0, true, Date.now(), true)); // jumpPressed: true

      const state = predictor.getState();
      const playerState = state?.players?.get(playerId);
      expect(playerState?.velocity.y).toBeGreaterThan(0); // Y-up: positive = upward
      expect(playerState?.isGrounded).toBe(false);
    });

    test("should use fixed tick interval for deterministic prediction", () => {
      // With fixed delta, inputs always produce the same physics regardless of timestamps
      // This ensures client prediction matches server simulation exactly
      const world1 = createWorld(createGroundedPlayer("player1"));
      const predictor1 = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
      predictor1.setBaseState(world1, "player1");
      
      // Two inputs 16ms apart
      predictor1.applyInput(createInput(1, 0, false, 1000));
      predictor1.applyInput(createInput(1, 0, false, 1016));
      const pos1 = predictor1.getState()?.players?.get("player1")?.position.x ?? 0;

      const world2 = createWorld(createGroundedPlayer("player2"));
      const predictor2 = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
      predictor2.setBaseState(world2, "player2");
      
      // Two inputs with large timestamp gap - but fixed delta is still used
      predictor2.applyInput(createInput(1, 0, false, 1000));
      predictor2.applyInput(createInput(1, 0, false, 6000)); // Large gap, but delta is fixed
      const pos2 = predictor2.getState()?.players?.get("player2")?.position.x ?? 0;

      // Both should produce same movement since fixed delta is used regardless of timestamps
      expect(pos1).toBeCloseTo(pos2, 5);
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
      // Y-up: grounded player at halfHeight above floor
      const serverLocalPlayer = createTestPlayer(playerId, {
        position: { x: 10, y: DEFAULT_FLOOR_Y + 10 },
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
      // With smoothDamp acceleration, player moves some distance in the direction of input
      // Exact distance depends on acceleration curve, but should be positive and reasonable
      expect(state?.players?.get(playerId)?.position.x).toBeGreaterThan(0);
      expect(state?.players?.get(playerId)?.position.x).toBeLessThan(15); // Upper bound
    });

    test("should allow different delta than tick interval", () => {
      const world = createWorld(createGroundedPlayer(playerId));
      predictor.setBaseState(world, playerId);

      // Apply with custom delta that differs from default tick interval
      predictor.applyInputWithDelta(
        createInput(1, 0, false, 1000),
        100, // 100ms instead of default 50ms
      );

      const state = predictor.getState();
      expect(state?.players?.get(playerId)?.position.x).toBeGreaterThan(0);
    });
  });

  describe("fixed delta prediction behavior", () => {
    test("different input timestamps should produce same movement (fixed delta)", () => {
      // Player A: inputs with 16ms timestamps (60fps)
      const predictor16ms = new Predictor<PlatformerWorld, PlatformerInput>(
        platformerPredictionScope,
      );
      const world16 = createWorld(createGroundedPlayer("player-16ms"));
      predictor16ms.setBaseState(world16, "player-16ms");

      for (let i = 0; i < 5; i++) {
        predictor16ms.applyInput(createInput(1, 0, false, 1000 + i * 16));
      }
      const pos16ms = predictor16ms.getState()?.players?.get("player-16ms")?.position.x ?? 0;

      // Player B: inputs with 33ms timestamps (30fps)
      const predictor33ms = new Predictor<PlatformerWorld, PlatformerInput>(
        platformerPredictionScope,
      );
      const world33 = createWorld(createGroundedPlayer("player-33ms"));
      predictor33ms.setBaseState(world33, "player-33ms");

      for (let i = 0; i < 5; i++) {
        predictor33ms.applyInput(createInput(1, 0, false, 1000 + i * 33));
      }
      const pos33ms = predictor33ms.getState()?.players?.get("player-33ms")?.position.x ?? 0;

      // With fixed delta, both should produce the same movement
      // (5 inputs * fixed tick delta = same total movement)
      expect(pos16ms).toBeCloseTo(pos33ms, 5);
    });

    test("more inputs = more movement", () => {
      // Player A: 3 inputs
      const predictor3 = new Predictor<PlatformerWorld, PlatformerInput>(
        platformerPredictionScope,
      );
      const world3 = createWorld(createGroundedPlayer("player-3"));
      predictor3.setBaseState(world3, "player-3");

      for (let i = 0; i < 3; i++) {
        predictor3.applyInput(createInput(1, 0, false, 1000 + i * 50));
      }
      const pos3 = predictor3.getState()?.players?.get("player-3")?.position.x ?? 0;

      // Player B: 6 inputs
      const predictor6 = new Predictor<PlatformerWorld, PlatformerInput>(
        platformerPredictionScope,
      );
      const world6 = createWorld(createGroundedPlayer("player-6"));
      predictor6.setBaseState(world6, "player-6");

      for (let i = 0; i < 6; i++) {
        predictor6.applyInput(createInput(1, 0, false, 1000 + i * 50));
      }
      const pos6 = predictor6.getState()?.players?.get("player-6")?.position.x ?? 0;

      // 6 inputs should move more than 3 inputs
      expect(pos6).toBeGreaterThan(pos3);
    });

    test("applyInputWithDelta uses explicit delta (not timestamps)", () => {
      // Player A: 50ms explicit delta
      const predictor50 = new Predictor<PlatformerWorld, PlatformerInput>(
        platformerPredictionScope,
        50,
      );
      const world50 = createWorld(createGroundedPlayer("player-50ms"));
      predictor50.setBaseState(world50, "player-50ms");
      predictor50.applyInputWithDelta(createInput(1, 0, false, 1000), 50);
      const pos50 = predictor50.getState()?.players?.get("player-50ms")?.position.x ?? 0;

      // Player B: 100ms explicit delta  
      const predictor100 = new Predictor<PlatformerWorld, PlatformerInput>(
        platformerPredictionScope,
        100,
      );
      const world100 = createWorld(createGroundedPlayer("player-100ms"));
      predictor100.setBaseState(world100, "player-100ms");
      predictor100.applyInputWithDelta(createInput(1, 0, false, 1000), 100);
      const pos100 = predictor100.getState()?.players?.get("player-100ms")?.position.x ?? 0;

      // 100ms delta should produce more movement than 50ms delta
      expect(pos100).toBeGreaterThan(pos50);
    });
  });

  describe("real-world scenarios", () => {
    test("tab switch: fixed delta ensures consistent physics regardless of gaps", () => {
      const player = createTestPlayer(playerId, {
        position: { x: 0, y: 100 }, // In the air (above floor in Y-up)
        isGrounded: false,
      });
      const world = createWorld(player);
      predictor.setBaseState(world, playerId);

      // First input
      predictor.applyInput(createInput(0, 0, false, 1000));
      const posAfterFirst = predictor.getState()?.players?.get(playerId)?.position.y ?? 0;

      // Simulate tab switch: 5000ms gap - but fixed delta is used anyway
      predictor.applyInput(createInput(0, 0, false, 6000));
      const posAfterGap = predictor.getState()?.players?.get(playerId)?.position.y ?? 0;

      // Y-up: falling means Y decreases
      const fallDuringTabSwitch = posAfterFirst - posAfterGap;
      
      // Compare to normal 16ms timing
      const normalPredictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
      const normalWorld = createWorld(createTestPlayer("normal-player", {
        position: { x: 0, y: 100 },
        isGrounded: false,
      }));
      normalPredictor.setBaseState(normalWorld, "normal-player");
      normalPredictor.applyInput(createInput(0, 0, false, 1000));
      const normalPosFirst = normalPredictor.getState()?.players?.get("normal-player")?.position.y ?? 0;
      normalPredictor.applyInput(createInput(0, 0, false, 1016)); // 16ms later
      const normalPosSecond = normalPredictor.getState()?.players?.get("normal-player")?.position.y ?? 0;
      const normalFall = normalPosFirst - normalPosSecond;

      // With fixed delta, both should produce same fall amount
      // This ensures determinism - the physics doesn't depend on real-world timing
      expect(fallDuringTabSwitch).toBeCloseTo(normalFall, 5);
    });
  });
});
