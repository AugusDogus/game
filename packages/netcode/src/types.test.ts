import { describe, test, expect } from "bun:test";
import type {
  Vector2,
  PlayerInput,
  PlayerState,
  WorldSnapshot,
  InputMessage,
  NetcodeServerConfig,
  NetcodeClientConfig,
} from "./types.js";
import { platformerPhysics } from "./physics.js";

describe("types", () => {
  describe("Vector2", () => {
    test("should represent a 2D position", () => {
      const position: Vector2 = { x: 100, y: 200 };
      expect(position.x).toBe(100);
      expect(position.y).toBe(200);
    });
  });

  describe("PlayerInput", () => {
    test("should represent movement input with jump", () => {
      const input: PlayerInput = {
        moveX: 1,
        moveY: -1,
        jump: true,
        timestamp: Date.now(),
      };
      expect(input.moveX).toBe(1);
      expect(input.moveY).toBe(-1);
      expect(input.jump).toBe(true);
      expect(input.timestamp).toBeGreaterThan(0);
    });
  });

  describe("PlayerState", () => {
    test("should represent a player's state with grounded flag", () => {
      const state: PlayerState = {
        id: "player-1",
        position: { x: 0, y: 0 },
        velocity: { x: 10, y: 0 },
        isGrounded: true,
        tick: 42,
      };
      expect(state.id).toBe("player-1");
      expect(state.position.x).toBe(0);
      expect(state.velocity.x).toBe(10);
      expect(state.isGrounded).toBe(true);
      expect(state.tick).toBe(42);
    });
  });

  describe("WorldSnapshot", () => {
    test("should represent a world state at a point in time", () => {
      const snapshot: WorldSnapshot = {
        tick: 100,
        timestamp: Date.now(),
        players: [
          { id: "p1", position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, isGrounded: true, tick: 100 },
          { id: "p2", position: { x: 50, y: 50 }, velocity: { x: 0, y: 0 }, isGrounded: false, tick: 100 },
        ],
        acks: { p1: 5, p2: 3 },
      };
      expect(snapshot.tick).toBe(100);
      expect(snapshot.players).toHaveLength(2);
      expect(snapshot.acks["p1"]).toBe(5);
    });
  });

  describe("InputMessage", () => {
    test("should represent an input message with sequence number", () => {
      const message: InputMessage = {
        seq: 42,
        input: { moveX: 1, moveY: 0, jump: false, timestamp: Date.now() },
        timestamp: Date.now(),
      };
      expect(message.seq).toBe(42);
      expect(message.input.moveX).toBe(1);
      expect(message.input.jump).toBe(false);
    });
  });

  describe("NetcodeServerConfig", () => {
    test("should allow optional configuration", () => {
      const config: NetcodeServerConfig = {
        tickRate: 60,
        snapshotHistorySize: 120,
        applyInput: platformerPhysics,
      };
      expect(config.tickRate).toBe(60);
      expect(config.snapshotHistorySize).toBe(120);
    });

    test("should require applyInput", () => {
      const config: NetcodeServerConfig = {
        applyInput: platformerPhysics,
      };
      expect(config.applyInput).toBeDefined();
    });
  });

  describe("NetcodeClientConfig", () => {
    test("should allow optional configuration with callbacks", () => {
      let called = false;
      const config: NetcodeClientConfig = {
        interpolationDelay: 150,
        applyInput: platformerPhysics,
        onWorldUpdate: () => { called = true; },
      };
      expect(config.interpolationDelay).toBe(150);
      config.onWorldUpdate?.({} as WorldSnapshot);
      expect(called).toBe(true);
    });
  });
});
