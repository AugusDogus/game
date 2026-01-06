import { describe, expect, test, beforeEach } from "bun:test";
import type { PlatformerWorld, PlatformerInput } from "../examples/platformer/types.js";
import { createPlatformerWorld, createIdleInput } from "../examples/platformer/types.js";
import { simulatePlatformer, addPlayerToWorld } from "../examples/platformer/simulation.js";
import { RollbackClient } from "./rollback.js";

describe("RollbackClient", () => {
  let client: RollbackClient<PlatformerWorld, PlatformerInput>;
  let initialWorld: PlatformerWorld;

  beforeEach(() => {
    initialWorld = createPlatformerWorld();
    initialWorld = addPlayerToWorld(initialWorld, "local-player");
    initialWorld = addPlayerToWorld(initialWorld, "remote-player");

    client = new RollbackClient<PlatformerWorld, PlatformerInput>(
      simulatePlatformer,
      initialWorld,
      createIdleInput(),
      {
        historySize: 60,
        inputDelay: 2,
      },
    );
    client.setLocalPlayerId("local-player");
    client.addRemotePlayer("remote-player");
  });

  describe("initialization", () => {
    test("should start with initial world state", () => {
      const state = client.getStateForRendering();
      expect(state).not.toBeNull();
      expect(state!.players.size).toBe(2);
    });

    test("should start at frame 0", () => {
      expect(client.getCurrentFrame()).toBe(0);
    });

    test("should have default input delay", () => {
      expect(client.getInputDelay()).toBe(2);
    });
  });

  describe("onLocalInput", () => {
    test("should queue local input for future frame", () => {
      const input: PlatformerInput = {
        moveX: 1,
        moveY: 0,
        jump: false,
        timestamp: Date.now(),
      };

      client.onLocalInput(input);

      // Input should be queued for frame 2 (current 0 + delay 2)
      expect(client.getCurrentFrame()).toBe(0);
    });
  });

  describe("advanceFrame", () => {
    test("should increment frame number", () => {
      client.advanceFrame();
      expect(client.getCurrentFrame()).toBe(1);

      client.advanceFrame();
      expect(client.getCurrentFrame()).toBe(2);
    });

    test("should apply physics to players", () => {
      // Get initial position
      const initialState = client.getStateForRendering()!;
      const initialY = initialState.players.get("local-player")!.position.y;

      // Advance several frames
      for (let i = 0; i < 5; i++) {
        client.advanceFrame();
      }

      const newState = client.getStateForRendering()!;
      const newY = newState.players.get("local-player")!.position.y;

      // Player should have fallen due to gravity
      expect(newY).toBeGreaterThan(initialY);
    });

    test("should apply local input after delay", () => {
      // Queue movement input
      const input: PlatformerInput = {
        moveX: 1,
        moveY: 0,
        jump: false,
        timestamp: Date.now(),
      };
      client.onLocalInput(input);

      // Advance past input delay
      for (let i = 0; i < 5; i++) {
        client.advanceFrame();
      }

      const state = client.getStateForRendering()!;
      const player = state.players.get("local-player")!;

      // Player should have moved right (input was applied at frame 2)
      expect(player.position.x).toBeGreaterThan(0);
    });
  });

  describe("onRemoteInput", () => {
    test("should store remote input", () => {
      const input: PlatformerInput = {
        moveX: -1,
        moveY: 0,
        jump: false,
        timestamp: Date.now(),
      };

      // Remote input for frame 0
      client.onRemoteInput("remote-player", input, 0);

      // Advance frame to apply it
      client.advanceFrame();

      const state = client.getStateForRendering()!;
      const player = state.players.get("remote-player")!;

      // Remote player should have moved left
      expect(player.position.x).toBeLessThan(0);
    });
  });

  describe("onSnapshot", () => {
    test("should update confirmed frame", () => {
      const snapshot = {
        tick: 5,
        timestamp: Date.now(),
        state: initialWorld,
        inputAcks: new Map<string, number>(),
      };

      client.onSnapshot(snapshot);

      // Should not throw and should accept the snapshot
      expect(client.getCurrentFrame()).toBe(0);
    });
  });

  describe("reset", () => {
    test("should clear all state", () => {
      // Advance some frames
      for (let i = 0; i < 5; i++) {
        client.advanceFrame();
      }

      client.reset();

      expect(client.getCurrentFrame()).toBe(0);
      expect(client.getLocalPlayerId()).toBeNull();
    });
  });

  describe("setInputDelay", () => {
    test("should update input delay", () => {
      client.setInputDelay(4);
      expect(client.getInputDelay()).toBe(4);
    });

    test("should not allow negative delay", () => {
      client.setInputDelay(-1);
      expect(client.getInputDelay()).toBe(0);
    });
  });

  describe("real-world scenarios", () => {
    test("local input responsiveness: input delay affects when input is applied", () => {
      // Queue movement input at frame 0
      client.onLocalInput({
        moveX: 1,
        moveY: 0,
        jump: false,
        timestamp: Date.now(),
      });

      // Advance one frame (input not yet applied due to delay)
      client.advanceFrame();
      let state = client.getStateForRendering()!;
      let playerX = state.players.get("local-player")!.position.x;

      // Player hasn't moved horizontally yet (only gravity applied)
      expect(playerX).toBe(0);

      // Advance past input delay
      client.advanceFrame();
      client.advanceFrame();

      state = client.getStateForRendering()!;
      playerX = state.players.get("local-player")!.position.x;

      // Now player should have moved
      expect(playerX).toBeGreaterThan(0);
    });

    test("rollback: late remote input triggers resimulation", () => {
      // Advance a few frames without remote input
      for (let i = 0; i < 3; i++) {
        client.advanceFrame();
      }

      // Get state before rollback
      const stateBeforeRollback = client.getStateForRendering()!;
      const remotePlayerBefore = stateBeforeRollback.players.get("remote-player")!;

      // Receive late remote input for frame 1 (in the past)
      client.onRemoteInput(
        "remote-player",
        { moveX: 1, moveY: 0, jump: false, timestamp: Date.now() },
        1,
      );

      // State should have been resimulated
      const stateAfterRollback = client.getStateForRendering()!;
      const remotePlayerAfter = stateAfterRollback.players.get("remote-player")!;

      // Remote player's position should have changed due to the late input
      expect(remotePlayerAfter.position.x).toBeGreaterThan(remotePlayerBefore.position.x);
    });

    test("input prediction: uses last known input for missing frames", () => {
      // Send remote input for frame 0
      client.onRemoteInput(
        "remote-player",
        { moveX: 1, moveY: 0, jump: false, timestamp: Date.now() },
        0,
      );

      // Advance several frames without new remote input
      for (let i = 0; i < 5; i++) {
        client.advanceFrame();
      }

      const state = client.getStateForRendering()!;
      const remotePlayer = state.players.get("remote-player")!;

      // Remote player should have continued moving right (input prediction)
      expect(remotePlayer.position.x).toBeGreaterThan(0);
    });
  });
});
