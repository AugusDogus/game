import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
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
    gameLoop = new GameLoop(worldState, inputQueue, snapshotHistory, 50); // 20 Hz
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
        input: { moveX: 1, moveY: 0, timestamp: Date.now() },
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
        input: { moveX: 1, moveY: 0, timestamp: Date.now() },
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
});
