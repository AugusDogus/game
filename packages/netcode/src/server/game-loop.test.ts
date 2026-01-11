import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { SnapshotBuffer } from "../core/snapshot-buffer.js";
import type { Snapshot } from "../core/types.js";
import { DefaultWorldManager } from "../core/world.js";
import {
    addPlayerToWorld,
    mergePlatformerInputs,
    simulatePlatformer,
} from "../examples/platformer/simulation.js";
import type { PlatformerInput, PlatformerWorld } from "../examples/platformer/types.js";
import { createPlatformerWorld } from "../examples/platformer/types.js";
import { GameLoop } from "./game-loop.js";
import { InputQueue } from "./input-queue.js";
import { getPlayer } from "../test-utils.js";

describe("GameLoop", () => {
  let worldManager: DefaultWorldManager<PlatformerWorld>;
  let inputQueue: InputQueue<PlatformerInput>;
  let snapshotBuffer: SnapshotBuffer<PlatformerWorld>;
  let gameLoop: GameLoop<PlatformerWorld, PlatformerInput>;

  beforeEach(() => {
    worldManager = new DefaultWorldManager(createPlatformerWorld());
    inputQueue = new InputQueue<PlatformerInput>();
    snapshotBuffer = new SnapshotBuffer<PlatformerWorld>(60);
    gameLoop = new GameLoop<PlatformerWorld, PlatformerInput>(
      worldManager,
      inputQueue,
      snapshotBuffer,
      simulatePlatformer,
      50, // 20 Hz
      mergePlatformerInputs, // Use platformer input merger to handle jump-in-burst
    );
  });

  afterEach(() => {
    gameLoop.stop();
  });

  // Helper to add a player to the world
  const addPlayer = (playerId: string, x: number = 0, y: number = 0) => {
    const world = worldManager.getState();
    const newWorld = addPlayerToWorld(world, playerId, { x, y });
    worldManager.setState(newWorld);
  };

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
      const onTickMock = mock<(snapshot: Snapshot<PlatformerWorld>) => void>(() => {});
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
      addPlayer("player-1", 0, 0);

      inputQueue.enqueue("player-1", {
        seq: 0,
        input: { moveX: 1, moveY: 0, jump: false, timestamp: Date.now() },
        timestamp: Date.now(),
      });

      const onTickMock = mock<(snapshot: Snapshot<PlatformerWorld>) => void>(() => {});
      gameLoop.onTick(onTickMock);

      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
      gameLoop.stop();

      // Check that player moved
      const world = worldManager.getState();
      const player = world.players.get("player-1");
      expect(player?.position.x).toBeGreaterThan(0);
    });

    test("should acknowledge processed inputs", async () => {
      addPlayer("player-1", 0, 0);

      inputQueue.enqueue("player-1", {
        seq: 0,
        input: { moveX: 1, moveY: 0, jump: false, timestamp: Date.now() },
        timestamp: Date.now(),
      });

      let lastAck = -1;
      gameLoop.onTick((snapshot: Snapshot<PlatformerWorld>) => {
        const ack = snapshot.inputAcks.get("player-1");
        if (ack !== undefined) {
          lastAck = ack;
        }
      });

      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
      gameLoop.stop();

      expect(lastAck).toBe(0);
    });

    test("should add snapshots to buffer", async () => {
      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 150));
      gameLoop.stop();

      expect(snapshotBuffer.size()).toBeGreaterThan(0);
    });
  });

  describe("real-world scenarios", () => {
    test("idle player: gravity should apply even when no inputs are received", async () => {
      // Player spawns in the air (simulating spawn point above ground)
      addPlayer("player-1", 0, 0); // y=0 is above the floor

      // NO inputs sent - player is AFK or tabbed out

      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 150)); // ~3 ticks
      gameLoop.stop();

      // Player should have fallen due to gravity
      const world = worldManager.getState();
      const player = world.players.get("player-1");
      expect(player?.position.y).toBeGreaterThan(0); // Y increases downward
    });

    test("two players: active player inputs should not affect idle player physics", async () => {
      // Two players spawn in the air
      addPlayer("active-player", 0, 0);
      addPlayer("idle-player", 100, 0);

      // Only active player sends inputs (moving right)
      inputQueue.enqueue("active-player", {
        seq: 0,
        input: { moveX: 1, moveY: 0, jump: false, timestamp: Date.now() },
        timestamp: Date.now(),
      });

      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 150));
      gameLoop.stop();

      const world = worldManager.getState();
      const activePlayer = world.players.get("active-player");
      const idlePlayer = world.players.get("idle-player");

      // Active player moved right and fell
      expect(activePlayer?.position.x).toBeGreaterThan(0);
      expect(activePlayer?.position.y).toBeGreaterThan(0);

      // Idle player stayed at x=100 but still fell (gravity applied)
      expect(idlePlayer?.position.x).toBe(100);
      expect(idlePlayer?.position.y).toBeGreaterThan(0);
    });

    test("input burst: multiple inputs per tick should not multiply physics", async () => {
      // Player on the ground
      addPlayer("player-1", 0, 190); // Near floor

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

      const world = worldManager.getState();
      const player = world.players.get("player-1");

      // Should have moved roughly 10 units (200 units/sec * 0.05 sec = 10 units)
      // NOT 30 units (which would happen if physics ran 3x)
      expect(player?.position.x).toBeGreaterThan(5);
      expect(player?.position.x).toBeLessThan(20);
    });

    test("jump input in burst: jump should register even if not in last input", async () => {
      // Player on the ground - spawn at floor level so first tick grounds them
      // Floor is at y=200, player height is 20, so center at y=190 is on floor
      addPlayer("player-1", 0, 190);

      // Let one tick run to ground the player (spawns with isGrounded=false)
      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 60));
      gameLoop.stop();

      // Verify player is now grounded
      let world = worldManager.getState();
      let player = world.players.get("player-1");
      expect(player?.isGrounded).toBe(true);

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

      world = worldManager.getState();
      player = world.players.get("player-1");

      // Jump should have registered (velocity negative = upward)
      expect(player?.velocity.y).toBeLessThan(0);
    });

    test("three players: gravity applied correctly to all", async () => {
      // Regression test for gravity multiplying with number of players
      addPlayer("player-1", 0, 0);
      addPlayer("player-2", 100, 0);
      addPlayer("player-3", 200, 0);

      // No inputs - all players should fall due to gravity
      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 100)); // ~2 ticks
      gameLoop.stop();

      const world = worldManager.getState();
      const p1 = getPlayer(world, "player-1");
      const p2 = getPlayer(world, "player-2");
      const p3 = getPlayer(world, "player-3");

      // All players should have fallen the same amount
      expect(p1.position.y).toBeCloseTo(p2.position.y, 2);
      expect(p2.position.y).toBeCloseTo(p3.position.y, 2);

      // Position should be reasonable (not 3x gravity)
      // After 100ms at 980 gravity: y ≈ 0.5 * 980 * 0.1^2 = 4.9 units
      expect(p1.position.y).toBeLessThan(15);
    });

    test("mixed input rates: different clients can send different amounts", async () => {
      addPlayer("fast-client", 0, 190); // On ground
      addPlayer("slow-client", 100, 190); // On ground

      // Fast client sends 3 inputs
      const now = Date.now();
      inputQueue.enqueue("fast-client", {
        seq: 0,
        input: { moveX: 1, moveY: 0, jump: false, timestamp: now },
        timestamp: now,
      });
      inputQueue.enqueue("fast-client", {
        seq: 1,
        input: { moveX: 1, moveY: 0, jump: false, timestamp: now + 16 },
        timestamp: now + 16,
      });
      inputQueue.enqueue("fast-client", {
        seq: 2,
        input: { moveX: 1, moveY: 0, jump: false, timestamp: now + 32 },
        timestamp: now + 32,
      });

      // Slow client sends only 1 input
      inputQueue.enqueue("slow-client", {
        seq: 0,
        input: { moveX: -1, moveY: 0, jump: false, timestamp: now },
        timestamp: now,
      });

      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 60));
      gameLoop.stop();

      const world = worldManager.getState();
      const fastPlayer = world.players.get("fast-client");
      const slowPlayer = world.players.get("slow-client");

      // Fast client moved right
      expect(fastPlayer?.position.x).toBeGreaterThan(0);
      // Slow client moved left (but less total distance due to fewer inputs)
      expect(slowPlayer?.position.x).toBeLessThan(100);
    });

    test("client disconnect: remaining clients unaffected", async () => {
      addPlayer("staying", 0, 0);
      addPlayer("leaving", 100, 0);

      // Both send inputs
      const now = Date.now();
      inputQueue.enqueue("staying", {
        seq: 0,
        input: { moveX: 1, moveY: 0, jump: false, timestamp: now },
        timestamp: now,
      });
      inputQueue.enqueue("leaving", {
        seq: 0,
        input: { moveX: -1, moveY: 0, jump: false, timestamp: now },
        timestamp: now,
      });

      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Record position of staying player
      let world = worldManager.getState();
      const stayingX1 = world.players.get("staying")?.position.x ?? 0;
      const stayingY1 = world.players.get("staying")?.position.y ?? 0;

      // Remove leaving player
      const newWorld = {
        ...world,
        players: new Map([...world.players].filter(([id]) => id !== "leaving")),
      };
      worldManager.setState(newWorld);

      // Continue running
      await new Promise((resolve) => setTimeout(resolve, 60));
      gameLoop.stop();

      world = worldManager.getState();
      const stayingPlayer = world.players.get("staying");

      // Staying player should have continued falling normally
      expect(stayingPlayer?.position.y).toBeGreaterThan(stayingY1);
      // Should NOT be affected by the other player's removal
      expect(world.players.has("leaving")).toBe(false);
    });
  });
});
