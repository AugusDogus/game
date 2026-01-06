import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { platformerPhysics } from "../physics.js";
import type { InputMessage, WorldSnapshot } from "../types.js";
import { GameLoop } from "./game-loop.js";
import { InputQueue } from "./input-queue.js";
import { SnapshotHistory } from "./snapshot-history.js";
import { WorldState } from "./world-state.js";

describe("GameLoop", () => {
  let worldState: WorldState;
  let inputQueue: InputQueue;
  let snapshotHistory: SnapshotHistory;
  let gameLoop: GameLoop;

  beforeEach(() => {
    worldState = new WorldState();
    inputQueue = new InputQueue();
    snapshotHistory = new SnapshotHistory(60);
    gameLoop = new GameLoop(worldState, inputQueue, snapshotHistory, platformerPhysics, 50); // 20 Hz
  });

  afterEach(() => {
    gameLoop.stop();
  });

  describe("start/stop", () => {
    test("should start and stop the loop", () => {
      expect(gameLoop.isRunning()).toBe(false);

      gameLoop.start();
      expect(gameLoop.isRunning()).toBe(true);

      gameLoop.stop();
      expect(gameLoop.isRunning()).toBe(false);
    });

    test("should not start twice", () => {
      gameLoop.start();
      gameLoop.start(); // Should not throw or create duplicate intervals
      expect(gameLoop.isRunning()).toBe(true);
    });
  });

  describe("onTick callback", () => {
    test("should call onTick with snapshot", async () => {
      const onTickMock = mock<(snapshot: WorldSnapshot) => void>(() => {});
      gameLoop.onTick(onTickMock);

      gameLoop.start();

      // Wait for at least one tick
      await new Promise((resolve) => setTimeout(resolve, 100));

      gameLoop.stop();

      expect(onTickMock).toHaveBeenCalled();
      const snapshot = onTickMock.mock.calls[0]?.[0];
      expect(snapshot).toBeDefined();
      expect(snapshot?.tick).toBeGreaterThan(0);
    });
  });

  describe("input processing", () => {
    test("should process inputs and update player state", async () => {
      worldState.addPlayer("player-1", { x: 0, y: 0 });

      const input: InputMessage = {
        seq: 0,
        input: { moveX: 1, moveY: 0, jump: false, timestamp: Date.now() },
        timestamp: Date.now(),
      };
      inputQueue.enqueue("player-1", input);

      const onTickMock = mock<(snapshot: WorldSnapshot) => void>(() => {});
      gameLoop.onTick(onTickMock);

      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
      gameLoop.stop();

      // Check that player moved
      const player = worldState.getPlayer("player-1");
      expect(player?.position.x).toBeGreaterThan(0);
    });

    test("should acknowledge processed inputs", async () => {
      worldState.addPlayer("player-1", { x: 0, y: 0 });

      inputQueue.enqueue("player-1", {
        seq: 0,
        input: { moveX: 1, moveY: 0, jump: false, timestamp: Date.now() },
        timestamp: Date.now(),
      });

      let lastAck = -1;
      gameLoop.onTick((snapshot) => {
        if (snapshot.acks["player-1"] !== undefined) {
          lastAck = snapshot.acks["player-1"]!;
        }
      });

      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
      gameLoop.stop();

      expect(lastAck).toBe(0);
    });

    test("should add snapshots to history", async () => {
      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 150));
      gameLoop.stop();

      expect(snapshotHistory.size()).toBeGreaterThan(0);
    });
  });

  describe("real-world scenarios", () => {
    test("idle player: gravity should apply even when no inputs are received", async () => {
      // Player spawns in the air (simulating spawn point above ground)
      worldState.addPlayer("player-1", { x: 0, y: 0 }); // y=0 is above the floor

      // NO inputs sent - player is AFK or tabbed out

      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 150)); // ~3 ticks
      gameLoop.stop();

      // Player should have fallen due to gravity
      const player = worldState.getPlayer("player-1");
      expect(player?.position.y).toBeGreaterThan(0); // Y increases downward
    });

    test("two players: active player inputs should not affect idle player physics", async () => {
      // Two players spawn in the air
      worldState.addPlayer("active-player", { x: 0, y: 0 });
      worldState.addPlayer("idle-player", { x: 100, y: 0 });

      // Only active player sends inputs (moving right)
      inputQueue.enqueue("active-player", {
        seq: 0,
        input: { moveX: 1, moveY: 0, jump: false, timestamp: Date.now() },
        timestamp: Date.now(),
      });

      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 150));
      gameLoop.stop();

      const activePlayer = worldState.getPlayer("active-player");
      const idlePlayer = worldState.getPlayer("idle-player");

      // Active player moved right and fell
      expect(activePlayer?.position.x).toBeGreaterThan(0);
      expect(activePlayer?.position.y).toBeGreaterThan(0);

      // Idle player stayed at x=100 but still fell (gravity applied)
      expect(idlePlayer?.position.x).toBe(100);
      expect(idlePlayer?.position.y).toBeGreaterThan(0);
    });

    test("input burst: multiple inputs per tick should not multiply physics", async () => {
      // Player on the ground
      worldState.addPlayer("player-1", { x: 0, y: 190 }); // Near floor
      
      // Simulate 60fps client sending 3 inputs before server tick (at 20fps)
      const now = Date.now();
      inputQueue.enqueue("player-1", {
        seq: 0,
        input: { moveX: 1, moveY: 0, jump: false, timestamp: now },
        timestamp: now,
      });
      inputQueue.enqueue("player-1", {
        seq: 1,
        input: { moveX: 1, moveY: 0, jump: false, timestamp: now + 16 },
        timestamp: now + 16,
      });
      inputQueue.enqueue("player-1", {
        seq: 2,
        input: { moveX: 1, moveY: 0, jump: false, timestamp: now + 32 },
        timestamp: now + 32,
      });

      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 60)); // ~1 tick
      gameLoop.stop();

      const player = worldState.getPlayer("player-1");
      
      // Should have moved roughly 10 units (200 units/sec * 0.05 sec = 10 units)
      // NOT 30 units (which would happen if physics ran 3x)
      expect(player?.position.x).toBeGreaterThan(5);
      expect(player?.position.x).toBeLessThan(20);
    });

    test("jump input in burst: jump should register even if not in last input", async () => {
      // Player on the ground - spawn at floor level so first tick grounds them
      // Floor is at y=200, player height is 20, so center at y=190 is on floor
      worldState.addPlayer("player-1", { x: 0, y: 190 });
      
      // Let one tick run to ground the player (spawns with isGrounded=false)
      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 60));
      gameLoop.stop();
      
      // Verify player is now grounded
      const groundedPlayer = worldState.getPlayer("player-1");
      expect(groundedPlayer?.isGrounded).toBe(true);
      
      // Now player presses jump, then releases it before next tick processes
      const now = Date.now();
      inputQueue.enqueue("player-1", {
        seq: 0,
        input: { moveX: 0, moveY: 0, jump: true, timestamp: now }, // Jump pressed
        timestamp: now,
      });
      inputQueue.enqueue("player-1", {
        seq: 1,
        input: { moveX: 0, moveY: 0, jump: false, timestamp: now + 16 }, // Jump released
        timestamp: now + 16,
      });

      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 60));
      gameLoop.stop();

      const player = worldState.getPlayer("player-1");
      
      // Jump should have registered (velocity negative = upward)
      expect(player?.velocity.y).toBeLessThan(0);
    });
  });
});
