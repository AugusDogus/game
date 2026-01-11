import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PLAYER_SPEED,
  DEFAULT_GRAVITY,
  DEFAULT_JUMP_VELOCITY,
  DEFAULT_FLOOR_Y,
} from "../../constants.js";
import {
  simulatePlatformer,
  addPlayerToWorld,
  removePlayerFromWorld,
  mergePlatformerInputs,
} from "./simulation.js";
import { createPlatformerWorld } from "./types.js";
import type { PlatformerWorld, PlatformerInput } from "./types.js";
import { createTestPlayer, createPlayingWorld } from "../../test-utils.js";

/** Helper to create test input with all required fields */
const createInput = (
  moveX: number,
  moveY: number,
  jump: boolean,
  timestamp: number,
): PlatformerInput => ({
  moveX,
  moveY,
  jump,
  shoot: false,
  shootTargetX: 0,
  shootTargetY: 0,
  timestamp,
});

describe("simulatePlatformer", () => {
  const createWorldWithPlayer = (
    playerId: string,
    position = { x: 0, y: 0 },
    velocity = { x: 0, y: 0 },
    isGrounded = false,
  ): PlatformerWorld => {
    const player = createTestPlayer(playerId, { position, velocity, isGrounded });
    return createPlayingWorld([player]);
  };

  describe("gravity", () => {
    test("should apply gravity to falling player", () => {
      const world = createWorldWithPlayer("player-1", { x: 0, y: 0 });
      const inputs = new Map<string, PlatformerInput>();

      const newWorld = simulatePlatformer(world, inputs, 50);
      const player = newWorld.players.get("player-1");

      // Velocity should increase (positive = downward)
      expect(player?.velocity.y).toBeGreaterThan(0);
      // Position should move down
      expect(player?.position.y).toBeGreaterThan(0);
    });

    test("should accumulate gravity over time", () => {
      let world = createWorldWithPlayer("player-1", { x: 0, y: 0 });
      const inputs = new Map<string, PlatformerInput>();

      // Simulate multiple ticks
      world = simulatePlatformer(world, inputs, 50);
      world = simulatePlatformer(world, inputs, 50);
      world = simulatePlatformer(world, inputs, 50);

      const player = world.players.get("player-1");
      // After 3 ticks, should have fallen significantly
      expect(player?.velocity.y).toBeGreaterThan(DEFAULT_GRAVITY * 0.05 * 2);
    });
  });

  describe("floor collision", () => {
    test("should stop player at floor", () => {
      // Player just above floor
      const world = createWorldWithPlayer("player-1", { x: 0, y: DEFAULT_FLOOR_Y - 15 });
      const inputs = new Map<string, PlatformerInput>();

      // Simulate until player hits floor
      let newWorld = world;
      for (let i = 0; i < 20; i++) {
        newWorld = simulatePlatformer(newWorld, inputs, 50);
      }

      const player = newWorld.players.get("player-1");

      // Player should be on floor (center at floor - half height)
      expect(player?.position.y).toBe(DEFAULT_FLOOR_Y - 10);
      expect(player?.velocity.y).toBe(0);
      expect(player?.isGrounded).toBe(true);
    });
  });

  describe("horizontal movement", () => {
    test("should move right when moveX is positive", () => {
      const world = createWorldWithPlayer(
        "player-1",
        { x: 0, y: DEFAULT_FLOOR_Y - 10 },
        { x: 0, y: 0 },
        true,
      );
      const inputs = new Map<string, PlatformerInput>([
        ["player-1", createInput(1, 0, false, Date.now())],
      ]);

      const newWorld = simulatePlatformer(world, inputs, 50);
      const player = newWorld.players.get("player-1");

      expect(player?.position.x).toBeGreaterThan(0);
      expect(player?.velocity.x).toBe(DEFAULT_PLAYER_SPEED);
    });

    test("should move left when moveX is negative", () => {
      const world = createWorldWithPlayer(
        "player-1",
        { x: 0, y: DEFAULT_FLOOR_Y - 10 },
        { x: 0, y: 0 },
        true,
      );
      const inputs = new Map<string, PlatformerInput>([
        ["player-1", createInput(-1, 0, false, Date.now())],
      ]);

      const newWorld = simulatePlatformer(world, inputs, 50);
      const player = newWorld.players.get("player-1");

      expect(player?.position.x).toBeLessThan(0);
      expect(player?.velocity.x).toBe(-DEFAULT_PLAYER_SPEED);
    });

    test("should stop when no input", () => {
      const world = createWorldWithPlayer(
        "player-1",
        { x: 0, y: DEFAULT_FLOOR_Y - 10 },
        { x: DEFAULT_PLAYER_SPEED, y: 0 },
        true,
      );
      const inputs = new Map<string, PlatformerInput>();

      const newWorld = simulatePlatformer(world, inputs, 50);
      const player = newWorld.players.get("player-1");

      // Velocity should be 0 with no input (no momentum in this simple physics)
      expect(player?.velocity.x).toBe(0);
    });
  });

  describe("jumping", () => {
    test("should jump when grounded and jump pressed", () => {
      const world = createWorldWithPlayer(
        "player-1",
        { x: 0, y: DEFAULT_FLOOR_Y - 10 },
        { x: 0, y: 0 },
        true,
      );
      const inputs = new Map<string, PlatformerInput>([
        ["player-1", createInput(0, 0, true, Date.now())],
      ]);

      const newWorld = simulatePlatformer(world, inputs, 50);
      const player = newWorld.players.get("player-1");

      // Should have upward velocity (negative Y)
      expect(player?.velocity.y).toBe(DEFAULT_JUMP_VELOCITY);
      expect(player?.isGrounded).toBe(false);
    });

    test("should not jump when not grounded", () => {
      const world = createWorldWithPlayer("player-1", { x: 0, y: 0 }, { x: 0, y: 50 }, false);
      const inputs = new Map<string, PlatformerInput>([
        ["player-1", createInput(0, 0, true, Date.now())],
      ]);

      const newWorld = simulatePlatformer(world, inputs, 50);
      const player = newWorld.players.get("player-1");

      // Should not have jump velocity, just gravity
      expect(player?.velocity.y).not.toBe(DEFAULT_JUMP_VELOCITY);
    });
  });

  describe("multiple players", () => {
    test("should simulate all players independently", () => {
      const player1 = createTestPlayer("player-1", {
        position: { x: 0, y: DEFAULT_FLOOR_Y - 10 },
        isGrounded: true,
      });
      const player2 = createTestPlayer("player-2", {
        position: { x: 100, y: DEFAULT_FLOOR_Y - 10 },
        isGrounded: true,
      });
      const world = createPlayingWorld([player1, player2]);

      const inputs = new Map<string, PlatformerInput>([
        ["player-1", createInput(1, 0, false, Date.now())],
        ["player-2", createInput(-1, 0, true, Date.now())],
      ]);

      const newWorld = simulatePlatformer(world, inputs, 50);

      const newP1 = newWorld.players.get("player-1");
      const newP2 = newWorld.players.get("player-2");

      // Player 1 moved right and stays on ground (grounded players have y velocity = 0)
      expect(newP1?.position.x).toBeGreaterThan(0);
      expect(newP1?.isGrounded).toBe(true);

      // Player 2 moved left and jumped
      expect(newP2?.position.x).toBeLessThan(100);
      expect(newP2?.velocity.y).toBe(DEFAULT_JUMP_VELOCITY);
    });
  });

  describe("tick increment", () => {
    test("should increment world tick", () => {
      const world = createPlatformerWorld();
      expect(world.tick).toBe(0);

      const newWorld = simulatePlatformer(world, new Map(), 50);
      expect(newWorld.tick).toBe(1);
    });
  });
});

describe("addPlayerToWorld", () => {
  test("should add new player", () => {
    const world = createPlatformerWorld();
    const newWorld = addPlayerToWorld(world, "player-1");

    expect(newWorld.players.has("player-1")).toBe(true);
  });

  test("should add player at specified position", () => {
    const world = createPlatformerWorld();
    const newWorld = addPlayerToWorld(world, "player-1", { x: 100, y: 50 });

    const player = newWorld.players.get("player-1");
    expect(player?.position.x).toBe(100);
    expect(player?.position.y).toBe(50);
  });

  test("should not modify original world", () => {
    const world = createPlatformerWorld();
    addPlayerToWorld(world, "player-1");

    expect(world.players.has("player-1")).toBe(false);
  });
});

describe("removePlayerFromWorld", () => {
  test("should remove existing player", () => {
    let world = createPlatformerWorld();
    world = addPlayerToWorld(world, "player-1");
    world = removePlayerFromWorld(world, "player-1");

    expect(world.players.has("player-1")).toBe(false);
  });

  test("should handle removing non-existent player", () => {
    const world = createPlatformerWorld();
    const newWorld = removePlayerFromWorld(world, "non-existent");

    expect(newWorld.players.size).toBe(0);
  });
});

describe("mergePlatformerInputs", () => {
  test("should return idle input for empty array", () => {
    const merged = mergePlatformerInputs([]);

    expect(merged.moveX).toBe(0);
    expect(merged.jump).toBe(false);
  });

  test("should use last input for movement", () => {
    const inputs: PlatformerInput[] = [
      createInput(1, 0, false, 1000),
      createInput(-1, 0, false, 1016),
    ];

    const merged = mergePlatformerInputs(inputs);

    expect(merged.moveX).toBe(-1);
  });

  test("should preserve jump if any input had it", () => {
    const inputs: PlatformerInput[] = [
      createInput(0, 0, true, 1000),
      createInput(0, 0, false, 1016),
      createInput(0, 0, false, 1032),
    ];

    const merged = mergePlatformerInputs(inputs);

    expect(merged.jump).toBe(true);
  });

  test("should not set jump if no input had it", () => {
    const inputs: PlatformerInput[] = [
      createInput(1, 0, false, 1000),
      createInput(1, 0, false, 1016),
    ];

    const merged = mergePlatformerInputs(inputs);

    expect(merged.jump).toBe(false);
  });

  test("real-world: quick jump tap should register", () => {
    // Player taps jump briefly - might be released before next server tick
    const inputs: PlatformerInput[] = [
      createInput(0, 0, false, 1000),
      createInput(0, 0, true, 1016), // Jump pressed
      createInput(0, 0, false, 1032), // Jump released
    ];

    const merged = mergePlatformerInputs(inputs);

    // Jump should still register
    expect(merged.jump).toBe(true);
  });
});
