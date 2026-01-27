import { describe, expect, test, beforeEach } from "bun:test";
import { DefaultWorldManager } from "../core/world.js";
import {
  type PlatformerWorld,
  type PlatformerInput,
  createPlatformerWorld,
  createIdleInput,
  simulatePlatformer,
  addPlayerToWorld,
  removePlayerFromWorld,
  mergePlatformerInputs,
  forceStartGame,
  platformerPredictionScope,
  getPlayer,
} from "@game/example-platformer";
import { ServerAuthoritativeClient, ServerAuthoritativeServer } from "./server-authoritative.js";

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

describe("ServerAuthoritativeClient", () => {
  let client: ServerAuthoritativeClient<PlatformerWorld, PlatformerInput>;

  beforeEach(() => {
    client = new ServerAuthoritativeClient<PlatformerWorld, PlatformerInput>(
      platformerPredictionScope,
      50, // 50ms tick interval (20 TPS)
    );
  });

  describe("initialization", () => {
    test("should start with null state", () => {
      expect(client.getStateForRendering()).toBeNull();
    });

    test("should start with null player ID", () => {
      expect(client.getLocalPlayerId()).toBeNull();
    });
  });

  describe("onLocalInput", () => {
    test("should add input to buffer", () => {
      client.setLocalPlayerId("player-1");

      const input = createInput(1, 0, false, Date.now());

      client.onLocalInput(input);

      expect(client.getLastInputSeq()).toBe(0);
    });

    test("should increment sequence number", () => {
      client.setLocalPlayerId("player-1");

      const input1 = createInput(1, 0, false, Date.now());
      const input2 = createInput(-1, 0, false, Date.now() + 16);

      client.onLocalInput(input1);
      expect(client.getLastInputSeq()).toBe(0);

      client.onLocalInput(input2);
      expect(client.getLastInputSeq()).toBe(1);
    });
  });

  describe("onSnapshot", () => {
    test("should accept snapshots", () => {
      const world = addPlayerToWorld(createPlatformerWorld(), "player-1");

      client.onSnapshot({
        tick: 1,
        timestamp: Date.now(),
        state: world,
        inputAcks: new Map([["player-1", 0]]),
      });

      // Should have state after receiving snapshot
      const state = client.getStateForRendering();
      expect(state).not.toBeNull();
    });
  });

  describe("reset", () => {
    test("should clear prediction state but preserve player ID", () => {
      client.setLocalPlayerId("player-1");

      const input: PlatformerInput = createInput(1, 0, false, Date.now());
      client.onLocalInput(input);

      client.reset();

      // Player ID should be preserved (tied to socket connection, not game state)
      expect(client.getLocalPlayerId()).toBe("player-1");
      // But input buffer should be cleared
      expect(client.getInputBuffer().getUnacknowledged(-1)).toEqual([]);
    });
  });

  describe("world reset detection", () => {
    test("should auto-reset when tick goes backwards significantly (level change)", () => {
      client.setLocalPlayerId("player-1");

      // Receive initial snapshot at tick 100
      const world1 = addPlayerToWorld(createPlatformerWorld(), "player-1");
      client.onSnapshot({
        tick: 100,
        timestamp: Date.now(),
        state: world1,
        inputAcks: new Map([["player-1", -1]]),
      });

      // Add some inputs that would normally be replayed
      const input1 = createInput(1, 0, false, Date.now());
      client.onLocalInput(input1);
      const input2 = createInput(1, 0, true, Date.now() + 16, true); // jumpPressed: true
      client.onLocalInput(input2);

      // Verify inputs are in buffer
      expect(client.getInputBuffer().getUnacknowledged(-1).length).toBe(2);

      // Receive snapshot with tick reset to 0 (simulating level change)
      const world2 = addPlayerToWorld(createPlatformerWorld(), "player-1");
      client.onSnapshot({
        tick: 0,
        timestamp: Date.now() + 100,
        state: world2,
        inputAcks: new Map([["player-1", -1]]),
      });

      // Input buffer should have been cleared by auto-reset
      expect(client.getInputBuffer().getUnacknowledged(-1).length).toBe(0);
    });

    test("should NOT reset for normal tick progression", () => {
      client.setLocalPlayerId("player-1");

      // Receive initial snapshot
      const world1 = addPlayerToWorld(createPlatformerWorld(), "player-1");
      client.onSnapshot({
        tick: 100,
        timestamp: Date.now(),
        state: world1,
        inputAcks: new Map([["player-1", -1]]),
      });

      // Add input
      const input = createInput(1, 0, false, Date.now());
      client.onLocalInput(input);

      // Receive next snapshot with normal tick progression
      const world2 = addPlayerToWorld(createPlatformerWorld(), "player-1");
      client.onSnapshot({
        tick: 101,
        timestamp: Date.now() + 50,
        state: world2,
        inputAcks: new Map([["player-1", -1]]),
      });

      // Input should still be in buffer (not cleared)
      expect(client.getInputBuffer().getUnacknowledged(-1).length).toBe(1);
    });

    test("should NOT reset for small tick reordering", () => {
      client.setLocalPlayerId("player-1");

      // Receive snapshot at tick 100
      const world1 = addPlayerToWorld(createPlatformerWorld(), "player-1");
      client.onSnapshot({
        tick: 100,
        timestamp: Date.now(),
        state: world1,
        inputAcks: new Map([["player-1", -1]]),
      });

      // Add input
      const input = createInput(1, 0, false, Date.now());
      client.onLocalInput(input);

      // Receive out-of-order snapshot (tick 98 arrived late)
      // This is within the threshold (100 - 98 = 2, threshold is 5)
      const world2 = addPlayerToWorld(createPlatformerWorld(), "player-1");
      client.onSnapshot({
        tick: 98,
        timestamp: Date.now() + 50,
        state: world2,
        inputAcks: new Map([["player-1", -1]]),
      });

      // Input should still be in buffer (not cleared for minor reordering)
      expect(client.getInputBuffer().getUnacknowledged(-1).length).toBe(1);
    });
  });
});

describe("ServerAuthoritativeServer", () => {
  let server: ServerAuthoritativeServer<PlatformerWorld, PlatformerInput>;
  let worldManager: DefaultWorldManager<PlatformerWorld>;

  beforeEach(() => {
    // Create world in "playing" state so physics are applied
    const initialWorld = forceStartGame(createPlatformerWorld());
    worldManager = new DefaultWorldManager(initialWorld);
    server = new ServerAuthoritativeServer<PlatformerWorld, PlatformerInput>(worldManager, {
      simulate: simulatePlatformer,
      addPlayerToWorld: addPlayerToWorld,
      removePlayerFromWorld: removePlayerFromWorld,
      tickIntervalMs: 50,
      snapshotHistorySize: 60,
      mergeInputs: mergePlatformerInputs,
      createIdleInput: createIdleInput,
    });
  });

  describe("addClient", () => {
    test("should add player to world", () => {
      server.addClient("player-1");

      const world = server.getWorldState();
      expect(world.players.has("player-1")).toBe(true);
    });

    test("should not add duplicate players", () => {
      server.addClient("player-1");
      server.addClient("player-1");

      const world = server.getWorldState();
      expect(world.players.size).toBe(1);
    });
  });

  describe("removeClient", () => {
    test("should remove player from world", () => {
      server.addClient("player-1");
      server.removeClient("player-1");

      const world = server.getWorldState();
      expect(world.players.has("player-1")).toBe(false);
    });

    test("should handle removing non-existent player", () => {
      // Should not throw
      server.removeClient("non-existent");
      expect(server.getConnectedClients()).toEqual([]);
    });
  });

  describe("onClientInput", () => {
    test("should queue input for processing", () => {
      server.addClient("player-1");

      const input: PlatformerInput = createInput(1, 0, false, Date.now());
      server.onClientInput("player-1", input, 0);

      // Input should be processed on next tick
      const snapshot = server.tick();

      // Player should have moved
      const player = snapshot.state.players.get("player-1");
      expect(player?.position.x).toBeGreaterThan(0);
    });
  });

  describe("tick", () => {
    test("should return snapshot with tick number", () => {
      const snapshot = server.tick();

      expect(snapshot.tick).toBe(1);
      expect(snapshot.timestamp).toBeGreaterThan(0);
    });

    test("should increment tick each time", () => {
      server.tick();
      server.tick();
      const snapshot = server.tick();

      expect(snapshot.tick).toBe(3);
    });

    test("should acknowledge processed inputs", () => {
      server.addClient("player-1");

      const input: PlatformerInput = createInput(1, 0, false, Date.now());
      server.onClientInput("player-1", input, 5);

      const snapshot = server.tick();

      expect(snapshot.inputAcks.get("player-1")).toBe(5);
    });

    test("should apply physics to idle players", () => {
      // Player spawns at default position (0,0)
      server.addClient("player-1");
      
      // Move player into the air to test gravity (Y-up: y=100 is in air)
      const world = server.getWorldState();
      const p = world.players.get("player-1");
      if (p) {
        const newPlayers = new Map(world.players);
        newPlayers.set("player-1", { ...p, position: { x: 0, y: 100 } });
        worldManager.setState({ ...world, players: newPlayers });
      }

      // No inputs sent
      server.tick();
      server.tick();
      server.tick();

      const finalWorld = server.getWorldState();
      const player = finalWorld.players.get("player-1");

      // Y-up: Player should have fallen due to gravity (Y decreased from 100)
      expect(player?.position.y).toBeLessThan(100);
    });
  });

  describe("real-world scenarios", () => {
    test("multiple clients: each client's input only affects their player", () => {
      server.addClient("player-1");
      server.addClient("player-2");

      // Player 1 moves right
      server.onClientInput(
        "player-1",
        createInput(1, 0, false, Date.now()),
        0,
      );

      // Player 2 moves left
      server.onClientInput(
        "player-2",
        createInput(-1, 0, false, Date.now()),
        0,
      );

      const snapshot = server.tick();

      const player1 = snapshot.state.players.get("player-1");
      const player2 = snapshot.state.players.get("player-2");

      expect(player1?.position.x).toBeGreaterThan(0);
      expect(player2?.position.x).toBeLessThan(0);
    });

    test("input merging: jump in burst should register", () => {
      server.addClient("player-1");

      // Run many ticks to ensure player falls and lands on ground
      for (let i = 0; i < 20; i++) {
        server.tick();
      }

      // Verify player is grounded
      let world = server.getWorldState();
      let player = world.players.get("player-1");
      expect(player?.isGrounded).toBe(true);

      // Player presses jump, then releases before next tick
      const now = Date.now();
      server.onClientInput("player-1", createInput(0, 0, true, now, true), 0); // jumpPressed: true
      server.onClientInput("player-1", createInput(0, 0, false, now + 16, false, true), 1); // jumpReleased: true

      server.tick();

      world = server.getWorldState();
      player = world.players.get("player-1");

      // Y-up: Jump should have registered (positive Y velocity = upward)
      expect(player?.velocity.y).toBeGreaterThan(0);
    });

    test("lag compensation: getSnapshotAtTimestamp returns closest snapshot", () => {
      server.addClient("player-1");

      // Run several ticks with delays to ensure different timestamps
      const timestamps: number[] = [];
      for (let i = 0; i < 5; i++) {
        const snapshot = server.tick();
        timestamps.push(snapshot.timestamp);
      }

      // Get snapshot at a past timestamp
      const pastTimestamp = timestamps[2];
      const snapshot = pastTimestamp ? server.getSnapshotAtTimestamp(pastTimestamp) : undefined;

      expect(snapshot).toBeDefined();
      // Should return the snapshot closest to the requested timestamp
      expect(snapshot?.timestamp).toBe(pastTimestamp);
    });

    test("two clients: gravity should not double", () => {
      // This is a regression test for the bug where adding a second client
      // caused gravity to be applied multiple times per tick
      server.addClient("player-1");
      server.addClient("player-2");
      
      // Move players apart and into the air (Y-up: y=100 is above floor at y=0)
      const world = server.getWorldState();
      const p1 = world.players.get("player-1");
      const p2 = world.players.get("player-2");
      if (p1 && p2) {
        const newPlayers = new Map(world.players);
        newPlayers.set("player-1", { ...p1, position: { x: 0, y: 100 } });
        newPlayers.set("player-2", { ...p2, position: { x: 100, y: 100 } });
        worldManager.setState({ ...world, players: newPlayers });
      }

      // Both players send idle inputs (just standing)
      const now = Date.now();
      server.onClientInput("player-1", createInput(0, 0, false, now), 0);
      server.onClientInput("player-2", createInput(0, 0, false, now), 0);

      const snapshot = server.tick();

      const player1 = getPlayer(snapshot.state, "player-1");
      const player2 = getPlayer(snapshot.state, "player-2");

      // Both players should have fallen the same amount
      expect(player1.position.y).toBeCloseTo(player2.position.y, 5);
      
      // Y-up: Position should have decreased slightly from 100
      // Should NOT have fallen more than ~3 units in one tick
      expect(player1.position.y).toBeGreaterThan(97);
      expect(player1.position.y).toBeLessThan(100);
    });

    test("two clients with different input counts: physics isolation", () => {
      server.addClient("active");
      server.addClient("idle");
      
      // Move players apart and into the air (Y-up)
      const world = server.getWorldState();
      const activeP = world.players.get("active");
      const idleP = world.players.get("idle");
      if (activeP && idleP) {
        const newPlayers = new Map(world.players);
        newPlayers.set("active", { ...activeP, position: { x: 0, y: 10 }, isGrounded: true }); // On ground
        newPlayers.set("idle", { ...idleP, position: { x: 100, y: 100 } }); // In air
        worldManager.setState({ ...world, players: newPlayers });
      }

      // Active player sends 3 inputs
      const now = Date.now();
      server.onClientInput("active", createInput(1, 0, false, now), 0);
      server.onClientInput("active", createInput(1, 0, false, now + 16), 1);
      server.onClientInput("active", createInput(1, 0, false, now + 32), 2);

      // Idle player sends no inputs

      const snapshot = server.tick();

      const activePlayer = snapshot.state.players.get("active");
      const idlePlayer = snapshot.state.players.get("idle");

      // Active player should have moved
      expect(activePlayer?.position.x).toBeGreaterThan(0);

      // Idle player should NOT have moved horizontally (stays at x=100)
      expect(idlePlayer?.position.x).toBe(100);

      // Y-up: Idle player SHOULD have fallen (Y decreased from 100)
      expect(idlePlayer?.position.y).toBeLessThan(100);
    });

    test("stop movement: movement depends on number of inputs", () => {
      server.addClient("player-1");

      // Run ticks to ground the player
      for (let i = 0; i < 10; i++) {
        server.tick();
      }

      // Player moves right then stops
      // With per-input simulation, each input gets processed with fixed delta
      const now = Date.now();
      server.onClientInput("player-1", createInput(1, 0, false, now), 0);      // Move right
      server.onClientInput("player-1", createInput(1, 0, false, now + 16), 1); // Move right
      server.onClientInput("player-1", createInput(0, 0, false, now + 32), 2); // Stop
      server.onClientInput("player-1", createInput(0, 0, false, now + 48), 3); // Still stopped

      const snapshot = server.tick();
      const player = snapshot.state.players.get("player-1");

      // With per-input simulation:
      // - 2 inputs moving right, each with fixed delta
      // - 2 inputs stopped (deceleration)
      // Player should have moved some distance during the first 2 inputs
      expect(player?.position.x).toBeGreaterThan(0);
    });

    test("per-input simulation: each input processed with fixed delta", () => {
      server.addClient("player-1");

      // Wait for player to land
      for (let i = 0; i < 10; i++) {
        server.tick();
      }

      // 4 inputs moving right - each gets its own simulation step
      server.onClientInput("player-1", createInput(1, 0, false, 1000), 0);
      server.onClientInput("player-1", createInput(1, 0, false, 1010), 1);
      server.onClientInput("player-1", createInput(1, 0, false, 1040), 2);
      server.onClientInput("player-1", createInput(1, 0, false, 1055), 3);

      const snapshot = server.tick();
      const player = snapshot.state.players.get("player-1");

      // 4 inputs * fixed delta (~16.67ms each) = ~66.67ms of simulation
      // With smoothDamp acceleration, velocity ramps up gradually
      // Movement should be positive
      expect(player?.position.x).toBeGreaterThan(1);
      expect(player?.position.x).toBeLessThan(30);
    });

    test("three clients: physics remains consistent", () => {
      server.addClient("player-1");
      server.addClient("player-2");
      server.addClient("player-3");
      
      // Move players apart to avoid collision
      const world = server.getWorldState();
      const p1Init = world.players.get("player-1");
      const p2Init = world.players.get("player-2");
      const p3Init = world.players.get("player-3");
      if (p1Init && p2Init && p3Init) {
        const newPlayers = new Map(world.players);
        newPlayers.set("player-1", { ...p1Init, position: { x: 0, y: 0 } });
        newPlayers.set("player-2", { ...p2Init, position: { x: 100, y: 0 } });
        newPlayers.set("player-3", { ...p3Init, position: { x: 200, y: 0 } });
        worldManager.setState({ ...world, players: newPlayers });
      }

      const now = Date.now();
      // All three send different inputs
      server.onClientInput("player-1", createInput(1, 0, false, now), 0);
      server.onClientInput("player-2", createInput(-1, 0, false, now), 0);
      server.onClientInput("player-3", createInput(0, 0, false, now), 0);

      const snapshot = server.tick();

      const p1 = getPlayer(snapshot.state, "player-1");
      const p2 = getPlayer(snapshot.state, "player-2");
      const p3 = getPlayer(snapshot.state, "player-3");

      // Player 1 moved right (started at x=0)
      expect(p1.position.x).toBeGreaterThan(0);
      // Player 2 moved left (started at x=100)
      expect(p2.position.x).toBeLessThan(100);
      // Player 3 stayed put horizontally (at x=200)
      expect(p3.position.x).toBe(200);

      // All three should have fallen the same amount (same physics applied once each)
      expect(p1.position.y).toBeCloseTo(p2.position.y, 3);
      expect(p2.position.y).toBeCloseTo(p3.position.y, 3);
    });

    test("getSnapshotAtTimestamp: future timestamp should return latest", () => {
      server.addClient("player-1");

      // Run a few ticks
      server.tick();
      server.tick();
      const lastSnapshot = server.tick();

      // Request snapshot at a future timestamp
      const futureTimestamp = Date.now() + 10000;
      const snapshot = server.getSnapshotAtTimestamp(futureTimestamp);

      // Should return the latest available snapshot (or close to it)
      expect(snapshot).toBeDefined();
      // Since all ticks happen quickly, we just verify we get a snapshot
      expect(snapshot?.tick).toBeGreaterThanOrEqual(1);
      expect(snapshot?.tick).toBeLessThanOrEqual(lastSnapshot.tick);
    });

    test("getSnapshotAtTimestamp: very old timestamp should return earliest", () => {
      server.addClient("player-1");

      // Run several ticks
      for (let i = 0; i < 10; i++) {
        server.tick();
      }

      // Request snapshot at a very old timestamp
      const oldTimestamp = Date.now() - 100000;
      const snapshot = server.getSnapshotAtTimestamp(oldTimestamp);

      // Should return something (earliest or closest)
      expect(snapshot).toBeDefined();
    });

    test("getConnectedClients: should return clients in consistent order", () => {
      server.addClient("charlie");
      server.addClient("alice");
      server.addClient("bob");

      const clients1 = server.getConnectedClients();
      const clients2 = server.getConnectedClients();

      // Should return same order each time
      expect(clients1).toEqual(clients2);
      expect(clients1.length).toBe(3);
    });

    test("getConnectedClients: should update after add/remove", () => {
      server.addClient("player-1");
      server.addClient("player-2");
      
      let clients = server.getConnectedClients();
      expect(clients.length).toBe(2);
      
      server.removeClient("player-1");
      
      clients = server.getConnectedClients();
      expect(clients.length).toBe(1);
      expect(clients).toContain("player-2");
      expect(clients).not.toContain("player-1");
    });
  });

  describe("edge cases", () => {
    test("should handle client disconnect and reconnect", () => {
      server.addClient("player-1");
      server.tick();
      
      server.removeClient("player-1");
      server.tick();
      
      // Re-add the same player
      server.addClient("player-1");
      const snapshot = server.tick();
      
      expect(snapshot.state.players.has("player-1")).toBe(true);
      // Player should start fresh (default position)
      expect(snapshot.state.players.get("player-1")?.position.x).toBe(0);
    });

    test("should handle input for non-existent client", () => {
      // Send input for client that was never added
      server.onClientInput(
        "ghost-player",
        createInput(1, 0, false, Date.now()),
        0,
      );

      // Should not crash, tick should work
      const snapshot = server.tick();
      expect(snapshot).toBeDefined();
    });

    test("should handle empty tick (no clients, no inputs)", () => {
      const snapshot = server.tick();
      
      expect(snapshot.tick).toBe(1);
      expect(snapshot.state.players.size).toBe(0);
    });

    test("should handle very high tick rate", () => {
      // Create server with 120Hz tick rate (in playing state)
      const fastInitialWorld = forceStartGame(createPlatformerWorld());
      const fastWorldManager = new DefaultWorldManager(fastInitialWorld);
      const fastServer = new ServerAuthoritativeServer<PlatformerWorld, PlatformerInput>(
        fastWorldManager,
        {
          simulate: simulatePlatformer,
          addPlayerToWorld: addPlayerToWorld,
          removePlayerFromWorld: removePlayerFromWorld,
          tickIntervalMs: 1000 / 120, // 120Hz
          snapshotHistorySize: 60,
          mergeInputs: mergePlatformerInputs,
          createIdleInput,
        },
      );

      fastServer.addClient("player-1");
      
      // Run many fast ticks
      for (let i = 0; i < 240; i++) {
        fastServer.tick();
      }

      const state = fastServer.getWorldState();
      expect(state.players.has("player-1")).toBe(true);
    });
  });
});
