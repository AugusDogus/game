import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { SnapshotBuffer } from "../core/snapshot-buffer.js";
import type { Snapshot } from "../core/types.js";
import { DefaultWorldManager } from "../core/world.js";
import {
  addPlayerToWorld,
  forceStartGame,
  mergePlatformerInputs,
  simulatePlatformer,
  createIdleInput,
  type PlatformerInput,
  type PlatformerWorld,
  createPlatformerWorld,
  getPlayer,
} from "@game/example-platformer";
import { GameLoop } from "./game-loop.js";
import { InputQueue } from "./input-queue.js";

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

describe("GameLoop", () => {
  let worldManager: DefaultWorldManager<PlatformerWorld>;
  let inputQueue: InputQueue<PlatformerInput>;
  let snapshotBuffer: SnapshotBuffer<PlatformerWorld>;
  let gameLoop: GameLoop<PlatformerWorld, PlatformerInput>;
  let connectedClients: Set<string>;

  beforeEach(() => {
    // Create world in "playing" state so physics are applied
    const initialWorld = forceStartGame(createPlatformerWorld());
    worldManager = new DefaultWorldManager(initialWorld);
    inputQueue = new InputQueue<PlatformerInput>();
    snapshotBuffer = new SnapshotBuffer<PlatformerWorld>(60);
    connectedClients = new Set<string>();
    gameLoop = new GameLoop<PlatformerWorld, PlatformerInput>(
      worldManager,
      inputQueue,
      snapshotBuffer,
      simulatePlatformer,
      50, // 20 Hz
      mergePlatformerInputs, // Use platformer input merger to handle jump-in-burst
      () => connectedClients, // getConnectedClients
      createIdleInput, // createIdleInput
    );
  });

  afterEach(() => {
    gameLoop.stop();
  });

  // Helper to add a player to the world and track them as connected
  const addPlayer = (playerId: string, x: number = 0, y: number = 0) => {
    const world = worldManager.getState();
    const newWorld = addPlayerToWorld(world, playerId, { x, y });
    worldManager.setState(newWorld);
    connectedClients.add(playerId);
  };
  
  // Helper to remove a player from connected clients
  const removePlayer = (playerId: string) => {
    connectedClients.delete(playerId);
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
        input: createInput(1, 0, false, Date.now()),
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
        input: createInput(1, 0, false, Date.now()),
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
      // Player spawns in the air (Y-up: y=100 is above the floor at y=0)
      addPlayer("player-1", 0, 100);

      // NO inputs sent - player is AFK or tabbed out

      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 150)); // ~3 ticks
      gameLoop.stop();

      // Player should have fallen due to gravity
      const world = worldManager.getState();
      const player = world.players.get("player-1");
      expect(player?.position.y).toBeLessThan(100); // Y-up: Y decreases when falling
    });

    test("two players: active player inputs should not affect idle player physics", async () => {
      // Two players spawn in the air (Y-up)
      addPlayer("active-player", 0, 100);
      addPlayer("idle-player", 100, 100);

      // Only active player sends inputs (moving right)
      inputQueue.enqueue("active-player", {
        seq: 0,
        input: createInput(1, 0, false, Date.now()),
        timestamp: Date.now(),
      });

      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 150));
      gameLoop.stop();

      const world = worldManager.getState();
      const activePlayer = world.players.get("active-player");
      const idlePlayer = world.players.get("idle-player");

      // Active player moved right and fell (Y-up: Y decreased)
      expect(activePlayer?.position.x).toBeGreaterThan(0);
      expect(activePlayer?.position.y).toBeLessThan(100);

      // Idle player stayed at x=100 but still fell (gravity applied)
      expect(idlePlayer?.position.x).toBe(100);
      expect(idlePlayer?.position.y).toBeLessThan(100);
    });

    test("input burst: multiple inputs per tick should not multiply physics", async () => {
      // Player on the ground (Y-up: player center at y=10 when on floor at y=0)
      addPlayer("player-1", 0, 10);

      // Simulate 60fps client sending 3 inputs before server tick (at 20fps)
      const now = Date.now();
      inputQueue.enqueue("player-1", {
        seq: 0,
        input: createInput(1, 0, false, now),
        timestamp: now,
      });
      inputQueue.enqueue("player-1", {
        seq: 1,
        input: createInput(1, 0, false, now + 16),
        timestamp: now + 16,
      });
      inputQueue.enqueue("player-1", {
        seq: 2,
        input: createInput(1, 0, false, now + 32),
        timestamp: now + 32,
      });

      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 60)); // ~1 tick
      gameLoop.stop();

      const world = worldManager.getState();
      const player = world.players.get("player-1");

      // Should have moved in the right direction
      // With smoothDamp, exact distance varies based on acceleration curve
      // Key is: NOT 30+ units (which would happen if physics ran 3x)
      expect(player?.position.x).toBeGreaterThan(1);
      expect(player?.position.x).toBeLessThan(20);
    });

    test("jump input in burst: jump should register even if not in last input", async () => {
      // Y-up: Player on the ground - floor is at y=0, player height is 20
      // Player center at y=10 is on the floor
      addPlayer("player-1", 0, 10);

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
        input: createInput(0, 0, true, now, true), // Jump pressed (jumpPressed: true)
        timestamp: now,
      });
      inputQueue.enqueue("player-1", {
        seq: 1,
        input: createInput(0, 0, false, now + 16, false, true), // Jump released (jumpReleased: true)
        timestamp: now + 16,
      });

      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 60));
      gameLoop.stop();

      world = worldManager.getState();
      player = world.players.get("player-1");

      // Jump should have registered (Y-up: positive velocity = upward)
      expect(player?.velocity.y).toBeGreaterThan(0);
    });

    test("three players: gravity applied correctly to all", async () => {
      // Regression test for gravity multiplying with number of players
      // Y-up: start at y=100 (above floor)
      addPlayer("player-1", 0, 100);
      addPlayer("player-2", 100, 100);
      addPlayer("player-3", 200, 100);

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
      // Y-up: started at 100, should have fallen less than 15 units
      expect(p1.position.y).toBeGreaterThan(85);
    });

    test("mixed input rates: different clients can send different amounts", async () => {
      addPlayer("fast-client", 0, 190); // On ground
      addPlayer("slow-client", 100, 190); // On ground

      // Fast client sends 3 inputs
      const now = Date.now();
      inputQueue.enqueue("fast-client", {
        seq: 0,
        input: createInput(1, 0, false, now),
        timestamp: now,
      });
      inputQueue.enqueue("fast-client", {
        seq: 1,
        input: createInput(1, 0, false, now + 16),
        timestamp: now + 16,
      });
      inputQueue.enqueue("fast-client", {
        seq: 2,
        input: createInput(1, 0, false, now + 32),
        timestamp: now + 32,
      });

      // Slow client sends only 1 input
      inputQueue.enqueue("slow-client", {
        seq: 0,
        input: createInput(-1, 0, false, now),
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
      // Y-up: players start above floor
      addPlayer("staying", 0, 100);
      addPlayer("leaving", 100, 100);

      // Both send inputs
      const now = Date.now();
      inputQueue.enqueue("staying", {
        seq: 0,
        input: createInput(1, 0, false, now),
        timestamp: now,
      });
      inputQueue.enqueue("leaving", {
        seq: 0,
        input: createInput(-1, 0, false, now),
        timestamp: now,
      });

      gameLoop.start();
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Record Y position of staying player (testing gravity/falling)
      let world = worldManager.getState();
      const stayingY1 = world.players.get("staying")?.position.y ?? 0;

      // Remove leaving player from both world and connected clients
      removePlayer("leaving");
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

      // Staying player should have continued falling normally (Y-up: Y decreases)
      expect(stayingPlayer?.position.y).toBeLessThan(stayingY1);
      // Should NOT be affected by the other player's removal
      expect(world.players.has("leaving")).toBe(false);
    });
  });
});
