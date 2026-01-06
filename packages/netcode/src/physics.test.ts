import { describe, test, expect } from "bun:test";
import { applyInput, createPlayerState } from "./physics.js";
import type { PlayerInput } from "./types.js";
import { DEFAULT_PLAYER_SPEED, DEFAULT_TICK_INTERVAL_MS } from "./constants.js";

describe("physics", () => {
  describe("createPlayerState", () => {
    test("should create a player at the given position", () => {
      const state = createPlayerState("player-1", { x: 100, y: 200 });

      expect(state.id).toBe("player-1");
      expect(state.position.x).toBe(100);
      expect(state.position.y).toBe(200);
      expect(state.velocity.x).toBe(0);
      expect(state.velocity.y).toBe(0);
      expect(state.tick).toBe(0);
    });

    test("should create players at origin", () => {
      const state = createPlayerState("player-2", { x: 0, y: 0 });

      expect(state.position.x).toBe(0);
      expect(state.position.y).toBe(0);
    });
  });

  describe("applyInput", () => {
    test("should move player right when moveX is positive", () => {
      const state = createPlayerState("test", { x: 0, y: 0 });
      const input: PlayerInput = { moveX: 1, moveY: 0, timestamp: Date.now() };

      const newState = applyInput(state, input);

      // Movement = speed * deltaTime / 1000 = 200 * 50 / 1000 = 10
      const expectedMovement = DEFAULT_PLAYER_SPEED * (DEFAULT_TICK_INTERVAL_MS / 1000);
      expect(newState.position.x).toBe(expectedMovement);
      expect(newState.position.y).toBe(0);
      expect(newState.velocity.x).toBe(DEFAULT_PLAYER_SPEED);
      expect(newState.velocity.y).toBe(0);
    });

    test("should move player left when moveX is negative", () => {
      const state = createPlayerState("test", { x: 100, y: 0 });
      const input: PlayerInput = { moveX: -1, moveY: 0, timestamp: Date.now() };

      const newState = applyInput(state, input);

      const expectedMovement = DEFAULT_PLAYER_SPEED * (DEFAULT_TICK_INTERVAL_MS / 1000);
      expect(newState.position.x).toBe(100 - expectedMovement);
    });

    test("should move player down when moveY is positive", () => {
      const state = createPlayerState("test", { x: 0, y: 0 });
      const input: PlayerInput = { moveX: 0, moveY: 1, timestamp: Date.now() };

      const newState = applyInput(state, input);

      const expectedMovement = DEFAULT_PLAYER_SPEED * (DEFAULT_TICK_INTERVAL_MS / 1000);
      expect(newState.position.y).toBe(expectedMovement);
      expect(newState.position.x).toBe(0);
    });

    test("should move player diagonally", () => {
      const state = createPlayerState("test", { x: 0, y: 0 });
      const input: PlayerInput = { moveX: 1, moveY: 1, timestamp: Date.now() };

      const newState = applyInput(state, input);

      const expectedMovement = DEFAULT_PLAYER_SPEED * (DEFAULT_TICK_INTERVAL_MS / 1000);
      expect(newState.position.x).toBe(expectedMovement);
      expect(newState.position.y).toBe(expectedMovement);
    });

    test("should not move player when input is zero", () => {
      const state = createPlayerState("test", { x: 50, y: 50 });
      const input: PlayerInput = { moveX: 0, moveY: 0, timestamp: Date.now() };

      const newState = applyInput(state, input);

      expect(newState.position.x).toBe(50);
      expect(newState.position.y).toBe(50);
      expect(newState.velocity.x).toBe(0);
      expect(newState.velocity.y).toBe(0);
    });

    test("should increment tick counter", () => {
      const state = createPlayerState("test", { x: 0, y: 0 });
      const input: PlayerInput = { moveX: 1, moveY: 0, timestamp: Date.now() };

      const newState = applyInput(state, input);

      expect(newState.tick).toBe(state.tick + 1);
    });

    test("should use custom deltaTime when provided", () => {
      const state = createPlayerState("test", { x: 0, y: 0 });
      const input: PlayerInput = { moveX: 1, moveY: 0, timestamp: Date.now() };
      const customDeltaTime = 100; // 100ms

      const newState = applyInput(state, input, customDeltaTime);

      const expectedMovement = DEFAULT_PLAYER_SPEED * (customDeltaTime / 1000);
      expect(newState.position.x).toBe(expectedMovement);
    });

    test("should be deterministic (same input = same output)", () => {
      const state = createPlayerState("test", { x: 0, y: 0 });
      const input: PlayerInput = { moveX: 0.5, moveY: -0.5, timestamp: 12345 };

      const result1 = applyInput(state, input);
      const result2 = applyInput(state, input);

      expect(result1.position.x).toBe(result2.position.x);
      expect(result1.position.y).toBe(result2.position.y);
      expect(result1.velocity.x).toBe(result2.velocity.x);
      expect(result1.velocity.y).toBe(result2.velocity.y);
    });

    test("should preserve player id", () => {
      const state = createPlayerState("unique-id-123", { x: 0, y: 0 });
      const input: PlayerInput = { moveX: 1, moveY: 1, timestamp: Date.now() };

      const newState = applyInput(state, input);

      expect(newState.id).toBe("unique-id-123");
    });
  });
});
