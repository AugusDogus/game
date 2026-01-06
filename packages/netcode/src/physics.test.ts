import { describe, test, expect } from "bun:test";
import { platformerPhysics, createPlayerState } from "./physics.js";
import type { PlayerInput, PlayerState } from "./types.js";
import {
  DEFAULT_PLAYER_SPEED,
  DEFAULT_TICK_INTERVAL_MS,
  DEFAULT_JUMP_VELOCITY,
  DEFAULT_FLOOR_Y,
} from "./constants.js";

describe("physics", () => {
  describe("createPlayerState", () => {
    test("should create a player at the given position", () => {
      const state = createPlayerState("player-1", { x: 100, y: 200 });

      expect(state.id).toBe("player-1");
      expect(state.position.x).toBe(100);
      expect(state.position.y).toBe(200);
      expect(state.velocity.x).toBe(0);
      expect(state.velocity.y).toBe(0);
      expect(state.isGrounded).toBe(false);
      expect(state.tick).toBe(0);
    });

    test("should create players at origin", () => {
      const state = createPlayerState("player-2", { x: 0, y: 0 });

      expect(state.position.x).toBe(0);
      expect(state.position.y).toBe(0);
    });
  });

  describe("applyInput", () => {
    // Helper to create input
    const makeInput = (
      moveX: number,
      moveY: number = 0,
      jump: boolean = false,
    ): PlayerInput => ({
      moveX,
      moveY,
      jump,
      timestamp: Date.now(),
    });

    // Helper to create a grounded player state
    const createGroundedPlayer = (id: string, x: number = 0): PlayerState => ({
      id,
      position: { x, y: DEFAULT_FLOOR_Y - 10 }, // 10 = half player height
      velocity: { x: 0, y: 0 },
      isGrounded: true,
      tick: 0,
    });

    test("should move player right when moveX is positive", () => {
      const state = createGroundedPlayer("test");
      const input = makeInput(1);

      const newState = platformerPhysics(state, input);

      const expectedMovement = DEFAULT_PLAYER_SPEED * (DEFAULT_TICK_INTERVAL_MS / 1000);
      expect(newState.position.x).toBe(expectedMovement);
      expect(newState.velocity.x).toBe(DEFAULT_PLAYER_SPEED);
    });

    test("should move player left when moveX is negative", () => {
      const state = createGroundedPlayer("test", 100);
      const input = makeInput(-1);

      const newState = platformerPhysics(state, input);

      const expectedMovement = DEFAULT_PLAYER_SPEED * (DEFAULT_TICK_INTERVAL_MS / 1000);
      expect(newState.position.x).toBe(100 - expectedMovement);
    });

    test("should apply gravity when player is in the air", () => {
      const state = createPlayerState("test", { x: 0, y: 0 }); // In the air
      const input = makeInput(0);

      const newState = platformerPhysics(state, input);

      // Gravity should increase Y velocity (positive Y is down)
      expect(newState.velocity.y).toBeGreaterThan(0);
      expect(newState.position.y).toBeGreaterThan(0);
    });

    test("should land on floor and become grounded", () => {
      // Start very close to the floor with downward velocity
      // Position + velocity * deltaTime should cross the floor
      const state: PlayerState = {
        id: "test",
        position: { x: 0, y: DEFAULT_FLOOR_Y - 12 }, // Just 2 pixels above floor surface (floor - 10 is grounded position)
        velocity: { x: 0, y: 200 }, // Falling fast
        isGrounded: false,
        tick: 0,
      };
      const input = makeInput(0);

      const newState = platformerPhysics(state, input);

      expect(newState.isGrounded).toBe(true);
      expect(newState.position.y).toBe(DEFAULT_FLOOR_Y - 10); // Snapped to floor
      expect(newState.velocity.y).toBe(0); // Velocity reset
    });

    test("should allow jump when grounded", () => {
      const state = createGroundedPlayer("test");
      const input = makeInput(0, 0, true); // Jump pressed

      const newState = platformerPhysics(state, input);

      expect(newState.velocity.y).toBe(DEFAULT_JUMP_VELOCITY);
      expect(newState.isGrounded).toBe(false);
    });

    test("should not allow jump when in the air", () => {
      const state: PlayerState = {
        id: "test",
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: -100 }, // Already jumping
        isGrounded: false,
        tick: 0,
      };
      const input = makeInput(0, 0, true); // Jump pressed

      const newState = platformerPhysics(state, input);

      // Should not apply jump velocity again
      expect(newState.velocity.y).not.toBe(DEFAULT_JUMP_VELOCITY);
    });

    test("should combine horizontal movement with jump", () => {
      const state = createGroundedPlayer("test");
      const input = makeInput(1, 0, true); // Move right + jump

      const newState = platformerPhysics(state, input);

      expect(newState.velocity.x).toBe(DEFAULT_PLAYER_SPEED);
      expect(newState.velocity.y).toBe(DEFAULT_JUMP_VELOCITY);
    });

    test("should not move player horizontally when input is zero", () => {
      const state = createGroundedPlayer("test", 50);
      const input = makeInput(0);

      const newState = platformerPhysics(state, input);

      expect(newState.position.x).toBe(50);
      expect(newState.velocity.x).toBe(0);
    });

    test("should increment tick counter", () => {
      const state = createGroundedPlayer("test");
      const input = makeInput(1);

      const newState = platformerPhysics(state, input);

      expect(newState.tick).toBe(state.tick + 1);
    });

    test("should use custom deltaTime when provided", () => {
      const state = createGroundedPlayer("test");
      const input = makeInput(1);
      const customDeltaTime = 100; // 100ms

      const newState = platformerPhysics(state, input, customDeltaTime);

      const expectedMovement = DEFAULT_PLAYER_SPEED * (customDeltaTime / 1000);
      expect(newState.position.x).toBe(expectedMovement);
    });

    test("should be deterministic (same input = same output)", () => {
      const state = createGroundedPlayer("test");
      const input = makeInput(0.5, 0, true);

      const result1 = platformerPhysics(state, input);
      const result2 = platformerPhysics(state, input);

      expect(result1.position.x).toBe(result2.position.x);
      expect(result1.position.y).toBe(result2.position.y);
      expect(result1.velocity.x).toBe(result2.velocity.x);
      expect(result1.velocity.y).toBe(result2.velocity.y);
      expect(result1.isGrounded).toBe(result2.isGrounded);
    });

    test("should preserve player id", () => {
      const state = createGroundedPlayer("unique-id-123");
      const input = makeInput(1, 0, true);

      const newState = platformerPhysics(state, input);

      expect(newState.id).toBe("unique-id-123");
    });

    test("should apply gravity over multiple frames", () => {
      let state = createPlayerState("test", { x: 0, y: 0 });
      const input = makeInput(0);

      // Apply multiple frames
      for (let i = 0; i < 10; i++) {
        state = platformerPhysics(state, input);
      }

      // Player should have fallen significantly
      expect(state.position.y).toBeGreaterThan(50);
      expect(state.velocity.y).toBeGreaterThan(0);
    });

    test("should complete a full jump arc", () => {
      // Start grounded
      let state = createGroundedPlayer("test");
      const jumpInput = makeInput(0, 0, true);
      const noInput = makeInput(0);

      // Jump
      state = platformerPhysics(state, jumpInput);
      expect(state.velocity.y).toBe(DEFAULT_JUMP_VELOCITY);

      // Track peak height
      let peakY = state.position.y;
      let frames = 0;
      const maxFrames = 100;

      // Rise until we start falling
      while (state.velocity.y < 0 && frames < maxFrames) {
        state = platformerPhysics(state, noInput);
        if (state.position.y < peakY) {
          peakY = state.position.y;
        }
        frames++;
      }

      // Should have risen (negative Y is up)
      expect(peakY).toBeLessThan(DEFAULT_FLOOR_Y - 10);

      // Continue until grounded
      while (!state.isGrounded && frames < maxFrames) {
        state = platformerPhysics(state, noInput);
        frames++;
      }

      // Should land back on the floor
      expect(state.isGrounded).toBe(true);
      expect(state.position.y).toBe(DEFAULT_FLOOR_Y - 10);
    });
  });
});
