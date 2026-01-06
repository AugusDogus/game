import { describe, expect, test, beforeEach } from "bun:test";
import { DefaultWorldManager } from "../core/world.js";
import type { PlatformerWorld, PlatformerInput } from "../examples/platformer/types.js";
import { createPlatformerWorld } from "../examples/platformer/types.js";
import {
  simulatePlatformer,
  addPlayerToWorld,
  removePlayerFromWorld,
  mergePlatformerInputs,
} from "../examples/platformer/simulation.js";
import { interpolatePlatformer } from "../examples/platformer/interpolation.js";
import { platformerPredictionScope } from "../examples/platformer/prediction.js";
import { ServerAuthoritativeClient, ServerAuthoritativeServer } from "./server-authoritative.js";

describe("ServerAuthoritativeClient", () => {
  let client: ServerAuthoritativeClient<PlatformerWorld, PlatformerInput>;

  beforeEach(() => {
    client = new ServerAuthoritativeClient<PlatformerWorld, PlatformerInput>(
      platformerPredictionScope,
      interpolatePlatformer,
      100, // 100ms interpolation delay
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

      const input: PlatformerInput = {
        moveX: 1,
        moveY: 0,
        jump: false,
        timestamp: Date.now(),
      };

      client.onLocalInput(input);

      expect(client.getLastInputSeq()).toBe(0);
    });

    test("should increment sequence number", () => {
      client.setLocalPlayerId("player-1");

      const input1: PlatformerInput = { moveX: 1, moveY: 0, jump: false, timestamp: Date.now() };
      const input2: PlatformerInput = {
        moveX: -1,
        moveY: 0,
        jump: false,
        timestamp: Date.now() + 16,
      };

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
    test("should clear all state", () => {
      client.setLocalPlayerId("player-1");

      const input: PlatformerInput = { moveX: 1, moveY: 0, jump: false, timestamp: Date.now() };
      client.onLocalInput(input);

      client.reset();

      expect(client.getLocalPlayerId()).toBeNull();
    });
  });
});

describe("ServerAuthoritativeServer", () => {
  let server: ServerAuthoritativeServer<PlatformerWorld, PlatformerInput>;
  let worldManager: DefaultWorldManager<PlatformerWorld>;

  beforeEach(() => {
    worldManager = new DefaultWorldManager(createPlatformerWorld());
    server = new ServerAuthoritativeServer<PlatformerWorld, PlatformerInput>(worldManager, {
      initialWorld: createPlatformerWorld(),
      simulate: simulatePlatformer,
      addPlayerToWorld: addPlayerToWorld,
      removePlayerFromWorld: removePlayerFromWorld,
      tickIntervalMs: 50,
      snapshotHistorySize: 60,
      mergeInputs: mergePlatformerInputs,
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

      const input: PlatformerInput = { moveX: 1, moveY: 0, jump: false, timestamp: Date.now() };
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

      const input: PlatformerInput = { moveX: 1, moveY: 0, jump: false, timestamp: Date.now() };
      server.onClientInput("player-1", input, 5);

      const snapshot = server.tick();

      expect(snapshot.inputAcks.get("player-1")).toBe(5);
    });

    test("should apply physics to idle players", () => {
      // Player spawns in the air
      server.addClient("player-1");

      // No inputs sent
      server.tick();
      server.tick();
      server.tick();

      const world = server.getWorldState();
      const player = world.players.get("player-1");

      // Player should have fallen due to gravity
      expect(player?.position.y).toBeGreaterThan(0);
    });
  });

  describe("real-world scenarios", () => {
    test("multiple clients: each client's input only affects their player", () => {
      server.addClient("player-1");
      server.addClient("player-2");

      // Player 1 moves right
      server.onClientInput(
        "player-1",
        { moveX: 1, moveY: 0, jump: false, timestamp: Date.now() },
        0,
      );

      // Player 2 moves left
      server.onClientInput(
        "player-2",
        { moveX: -1, moveY: 0, jump: false, timestamp: Date.now() },
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
      server.onClientInput("player-1", { moveX: 0, moveY: 0, jump: true, timestamp: now }, 0);
      server.onClientInput("player-1", { moveX: 0, moveY: 0, jump: false, timestamp: now + 16 }, 1);

      server.tick();

      world = server.getWorldState();
      player = world.players.get("player-1");

      // Jump should have registered (negative Y velocity = upward)
      expect(player?.velocity.y).toBeLessThan(0);
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
      const pastTimestamp = timestamps[2]!;
      const snapshot = server.getSnapshotAtTimestamp(pastTimestamp);

      expect(snapshot).toBeDefined();
      // Should return the snapshot closest to the requested timestamp
      expect(snapshot?.timestamp).toBe(pastTimestamp);
    });
  });
});
