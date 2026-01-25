import { describe, expect, test } from "bun:test";
import {
  DEFAULT_FLOOR_Y,
} from "@game/netcode";
import {
  simulatePlatformer,
  addPlayerToWorld,
  removePlayerFromWorld,
  mergePlatformerInputs,
} from "./simulation.js";
import { createPlatformerWorld, createIdleInput } from "./types.js";
import type { PlatformerWorld, PlatformerInput } from "./types.js";
import { createTestPlayer, createPlayingWorld } from "./test-utils.js";
import { DEFAULT_PLAYER_CONFIG } from "./player.js";


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

/** Helper to create inputs map with idle input for a player */
const createIdleInputs = (...playerIds: string[]): Map<string, PlatformerInput> => {
  const inputs = new Map<string, PlatformerInput>();
  for (const id of playerIds) {
    inputs.set(id, createIdleInput());
  }
  return inputs;
};

describe("simulatePlatformer", () => {
  const createWorldWithPlayer = (
    playerId: string,
    position = { x: 0, y: 100 },
    velocity = { x: 0, y: 0 },
    isGrounded = false,
  ): PlatformerWorld => {
    const player = createTestPlayer(playerId, { position, velocity, isGrounded });
    return createPlayingWorld([player]);
  };

  describe("gravity", () => {
    test("should apply gravity to falling player", () => {
      // Setup: player at y=100, airborne, idle input
      // Physics: gravity = -800, dt = 0.05s
      // Expected: velocity.y = 0 + (-800 * 0.05) = -40
      // Expected: position.y = 100 + (-40 * 0.05) = 98
      const world = createWorldWithPlayer("player-1", { x: 0, y: 100 });
      const inputs = createIdleInputs("player-1");

      const newWorld = simulatePlatformer(world, inputs, 50);
      const player = newWorld.players.get("player-1");

      expect(player?.velocity.y).toBe(-40);
      expect(player?.position.y).toBe(98);
    });

    test("should accumulate gravity over time", () => {
      // Setup: player at y=100, airborne, idle input, 3 ticks
      // Physics: gravity = -800, dt = 0.05s per tick
      // Expected after 3 ticks: velocity.y = -40 + -40 + -40 = -120
      let world = createWorldWithPlayer("player-1", { x: 0, y: 100 });
      const inputs = createIdleInputs("player-1");

      world = simulatePlatformer(world, inputs, 50);
      world = simulatePlatformer(world, inputs, 50);
      world = simulatePlatformer(world, inputs, 50);

      const player = world.players.get("player-1");
      expect(player?.velocity.y).toBe(-120);
    });
  });

  describe("floor collision", () => {
    test("should stop player at floor", () => {
      // Y-up: Player just above floor (floor at y=0, player center should end at y=10)
      const world = createWorldWithPlayer("player-1", { x: 0, y: 15 });
      const inputs = createIdleInputs("player-1");

      // Simulate until player hits floor
      let newWorld = world;
      for (let i = 0; i < 20; i++) {
        newWorld = simulatePlatformer(newWorld, inputs, 50);
      }

      const player = newWorld.players.get("player-1");

      // Y-up: Player should be on floor (center at floor + half height = 0 + 10 = 10)
      // Use toBeCloseTo due to floating-point precision in physics engine
      expect(player?.position.y).toBeCloseTo(DEFAULT_FLOOR_Y + 10, 5);
      expect(player?.velocity.y).toBe(0);
      expect(player?.isGrounded).toBe(true);
    });
  });

  describe("horizontal movement", () => {
    test("should move right when moveX is positive", () => {
      // Setup: grounded player at x=0, moveX=1, dt=50ms
      // Physics: smoothDamp from 0 to 200 with smoothTime=0.1, dt=0.05
      // Expected velocity.x: 52.67034990791896 (from smoothDamp formula)
      // Expected position.x: 2.633517495395948 (velocity * dt)
      const world = createWorldWithPlayer(
        "player-1",
        { x: 0, y: DEFAULT_FLOOR_Y + 10 },
        { x: 0, y: 0 },
        true,
      );
      const inputs = new Map<string, PlatformerInput>([
        ["player-1", createInput(1, 0, false, Date.now())],
      ]);

      const newWorld = simulatePlatformer(world, inputs, 50);
      const player = newWorld.players.get("player-1");

      expect(player?.velocity.x).toBe(52.67034990791896);
      expect(player?.position.x).toBe(2.633517495395948);
    });

    test("should move left when moveX is negative", () => {
      // Setup: grounded player at x=0, moveX=-1, dt=50ms
      // Physics: smoothDamp from 0 to -200 with smoothTime=0.1, dt=0.05
      // Expected: same magnitude as right, but negative
      const world = createWorldWithPlayer(
        "player-1",
        { x: 0, y: DEFAULT_FLOOR_Y + 10 },
        { x: 0, y: 0 },
        true,
      );
      const inputs = new Map<string, PlatformerInput>([
        ["player-1", createInput(-1, 0, false, Date.now())],
      ]);

      const newWorld = simulatePlatformer(world, inputs, 50);
      const player = newWorld.players.get("player-1");

      expect(player?.velocity.x).toBe(-52.67034990791896);
      expect(player?.position.x).toBe(-2.633517495395948);
    });

    test("should decelerate when no input", () => {
      // Setup: grounded player moving at 200 u/s, idle input, dt=50ms
      // Physics: smoothDamp from 200 to 0 with smoothTime=0.1, dt=0.05
      // Expected: velocity decreases toward 0
      const world = createWorldWithPlayer(
        "player-1",
        { x: 0, y: DEFAULT_FLOOR_Y + 10 },
        { x: DEFAULT_PLAYER_CONFIG.moveSpeed, y: 0 },
        true,
      );
      const inputs = createIdleInputs("player-1");

      const newWorld = simulatePlatformer(world, inputs, 50);
      const player = newWorld.players.get("player-1");

      // Velocity decelerates from 200 toward 0
      // smoothDamp(200, 0, 0, 0.1, 0.05) gives approximately 147.33
      expect(player?.velocity.x).toBe(147.32965009208104);
    });
  });

  describe("jumping", () => {
    test("should jump when grounded and jump pressed", () => {
      // Setup: grounded player, jump pressed, dt=50ms
      // Physics: maxJumpVelocity = 320 (from derivePhysics)
      // Order: gravity applied first (-40), then jump sets velocity to 320
      // Expected: velocity.y = 320, isGrounded = false
      const world = createWorldWithPlayer(
        "player-1",
        { x: 0, y: DEFAULT_FLOOR_Y + 10 },
        { x: 0, y: 0 },
        true,
      );
      const inputs = new Map<string, PlatformerInput>([
        ["player-1", createInput(0, 0, true, Date.now(), true)], // jumpPressed: true
      ]);

      const newWorld = simulatePlatformer(world, inputs, 50);
      const player = newWorld.players.get("player-1");

      expect(player?.velocity.y).toBe(320); // maxJumpVelocity
      expect(player?.isGrounded).toBe(false);
    });

    test("should not jump when not grounded", () => {
      // Setup: airborne player at y=100, velocity.y=-50, jump pressed, dt=50ms
      // Physics: gravity = -800, dt = 0.05
      // Expected: velocity.y = -50 + (-800 * 0.05) = -90 (no jump, just gravity)
      const world = createWorldWithPlayer("player-1", { x: 0, y: 100 }, { x: 0, y: -50 }, false);
      const inputs = new Map<string, PlatformerInput>([
        ["player-1", createInput(0, 0, true, Date.now(), true)], // jumpPressed: true but not grounded
      ]);

      const newWorld = simulatePlatformer(world, inputs, 50);
      const player = newWorld.players.get("player-1");

      expect(player?.velocity.y).toBe(-90);
    });
  });

  describe("multiple players", () => {
    test("should simulate all players independently", () => {
      // Setup: Two grounded players far apart
      // Player 1: moveX=1, no jump
      // Player 2: moveX=-1, jump
      const player1 = createTestPlayer("player-1", {
        position: { x: 0, y: DEFAULT_FLOOR_Y + 10 },
        isGrounded: true,
      });
      const player2 = createTestPlayer("player-2", {
        position: { x: 100, y: DEFAULT_FLOOR_Y + 10 },
        isGrounded: true,
      });
      const world = createPlayingWorld([player1, player2]);

      const inputs = new Map<string, PlatformerInput>([
        ["player-1", createInput(1, 0, false, Date.now())],
        ["player-2", createInput(-1, 0, true, Date.now(), true)], // jumpPressed: true
      ]);

      const newWorld = simulatePlatformer(world, inputs, 50);

      const newP1 = newWorld.players.get("player-1");
      const newP2 = newWorld.players.get("player-2");

      // Player 1: moved right (exact values from smoothDamp)
      expect(newP1?.position.x).toBe(2.633517495395948);
      expect(newP1?.velocity.x).toBe(52.67034990791896);
      expect(newP1?.isGrounded).toBe(true);

      // Player 2: moved left and jumped
      expect(newP2?.position.x).toBe(100 - 2.633517495395948);
      expect(newP2?.velocity.x).toBe(-52.67034990791896);
      expect(newP2?.velocity.y).toBe(320); // maxJumpVelocity
      expect(newP2?.isGrounded).toBe(false);
    });
  });

  describe("player-player collision", () => {
    test("horizontal collision: players should not overlap when walking into each other", () => {
      // Y-up: Two players on the ground
      const player1 = createTestPlayer("player-1", {
        position: { x: 0, y: DEFAULT_FLOOR_Y + 10 },
        isGrounded: true,
      });
      const player2 = createTestPlayer("player-2", {
        position: { x: 25, y: DEFAULT_FLOOR_Y + 10 }, // 25 units apart (player width is 20)
        isGrounded: true,
      });
      let world = createPlayingWorld([player1, player2]);

      // Player 1 walks right into player 2
      const inputs = new Map<string, PlatformerInput>([
        ["player-1", createInput(1, 0, false, Date.now())],
        ["player-2", createInput(0, 0, false, Date.now())],
      ]);

      // Simulate several ticks and check EVERY frame for overlap
      for (let i = 0; i < 20; i++) {
        world = simulatePlatformer(world, inputs, 50);
        
        const p1 = world.players.get("player-1");
        const p2 = world.players.get("player-2");
        
        // Players should NEVER overlap - their centers should be at least 20 units apart
        // (player width is 20, so centers must be >= 20 apart to not overlap)
        const distance = Math.abs((p2?.position.x ?? 0) - (p1?.position.x ?? 0));
        expect(distance).toBeGreaterThanOrEqual(20);
      }
    });

    test("horizontal collision: pushing should be stable (no jitter)", () => {
      // Two players overlapping - simulate collision resolution
      const player1 = createTestPlayer("player-1", {
        position: { x: 0, y: DEFAULT_FLOOR_Y + 10 },
        isGrounded: true,
      });
      const player2 = createTestPlayer("player-2", {
        position: { x: 15, y: DEFAULT_FLOOR_Y + 10 }, // Overlapping (within 20 units)
        isGrounded: true,
      });
      let world = createPlayingWorld([player1, player2]);

      // Idle input for both players - just let collision resolve
      const inputs = createIdleInputs("player-1", "player-2");

      // Simulate several ticks and record positions
      const p1Positions: number[] = [];
      const p2Positions: number[] = [];
      
      for (let i = 0; i < 10; i++) {
        world = simulatePlatformer(world, inputs, 50);
        p1Positions.push(world.players.get("player-1")?.position.x ?? 0);
        p2Positions.push(world.players.get("player-2")?.position.x ?? 0);
      }

      // After first frame, positions should stabilize (not jitter back and forth)
      // Check that positions don't oscillate after frame 2
      for (let i = 2; i < p1Positions.length - 1; i++) {
        const p1Diff = Math.abs((p1Positions[i + 1] ?? 0) - (p1Positions[i] ?? 0));
        const p2Diff = Math.abs((p2Positions[i + 1] ?? 0) - (p2Positions[i] ?? 0));
        expect(p1Diff).toBeLessThan(0.1); // Should be stable, not moving
        expect(p2Diff).toBeLessThan(0.1);
      }
    });

    test("horizontal collision: continuous movement into player should not jitter", () => {
      // This tests the bug where holding left/right into another player causes jitter
      const player1 = createTestPlayer("player-1", {
        position: { x: 0, y: DEFAULT_FLOOR_Y + 10 },
        isGrounded: true,
      });
      const player2 = createTestPlayer("player-2", {
        position: { x: 25, y: DEFAULT_FLOOR_Y + 10 }, // 25 units apart (player width is 20)
        isGrounded: true,
      });
      let world = createPlayingWorld([player1, player2]);

      // Player 1 continuously holds right, player 2 is stationary
      const inputs = new Map<string, PlatformerInput>([
        ["player-1", createInput(1, 0, false, Date.now())],
        ["player-2", createInput(0, 0, false, Date.now())],
      ]);

      // Simulate many ticks with continuous input
      const p2Positions: number[] = [];
      
      for (let i = 0; i < 30; i++) {
        world = simulatePlatformer(world, inputs, 50);
        p2Positions.push(world.players.get("player-2")?.position.x ?? 0);
      }

      // After initial contact, player 2's position should stabilize
      // (player 1 pushing shouldn't cause oscillation)
      // Find when they first make contact (p2 starts moving)
      let contactFrame = -1;
      for (let i = 1; i < p2Positions.length; i++) {
        if (Math.abs((p2Positions[i] ?? 0) - (p2Positions[i - 1] ?? 0)) > 0.1) {
          contactFrame = i;
          break;
        }
      }

      // After contact + 2 frames of settling, position should be stable
      if (contactFrame >= 0 && contactFrame + 3 < p2Positions.length) {
        for (let i = contactFrame + 3; i < p2Positions.length - 1; i++) {
          const diff = Math.abs((p2Positions[i + 1] ?? 0) - (p2Positions[i] ?? 0));
          // Should be stable (not jittering), allowing small movement from being pushed
          expect(diff).toBeLessThan(2); // Allow some push but not wild oscillation
        }
      }
    });

    test("vertical collision: player should be able to stand on another player", () => {
      // Y-up: Player 2 on the ground, player 1 falling onto them
      const player1 = createTestPlayer("player-1", {
        position: { x: 0, y: DEFAULT_FLOOR_Y + 50 }, // Above player 2
        velocity: { x: 0, y: -100 }, // Y-up: falling down means negative velocity
        isGrounded: false,
      });
      const player2 = createTestPlayer("player-2", {
        position: { x: 0, y: DEFAULT_FLOOR_Y + 10 }, // On the ground
        isGrounded: true,
      });
      let world = createPlayingWorld([player1, player2]);

      const inputs = createIdleInputs("player-1", "player-2");

      // Simulate until player 1 lands
      for (let i = 0; i < 20; i++) {
        world = simulatePlatformer(world, inputs, 50);
      }

      const p1 = world.players.get("player-1");
      const p2 = world.players.get("player-2");

      // Y-up: Player 1 should be on top of player 2
      // Player 1's bottom (y - halfHeight) should be at player 2's top (y + halfHeight)
      const p1Bottom = (p1?.position.y ?? 0) - 10; // center - half height
      const p2Top = (p2?.position.y ?? 0) + 10; // center + half height
      
      expect(p1Bottom).toBeCloseTo(p2Top, 1);
      expect(p1?.isGrounded).toBe(true); // Should be grounded (standing on player)
      expect(p1?.velocity.y).toBe(0); // Should not be falling
    });

    test("vertical collision: standing on player should be stable (no bouncing)", () => {
      // Y-up: Player 1 already positioned on top of player 2
      const player2Y = DEFAULT_FLOOR_Y + 10;
      const player1Y = player2Y + 20; // Exactly on top (20 = player height, higher Y in Y-up)
      
      const player1 = createTestPlayer("player-1", {
        position: { x: 0, y: player1Y },
        velocity: { x: 0, y: 0 },
        isGrounded: true,
      });
      const player2 = createTestPlayer("player-2", {
        position: { x: 0, y: player2Y },
        isGrounded: true,
      });
      let world = createPlayingWorld([player1, player2]);

      const inputs = createIdleInputs("player-1", "player-2");

      // Record player 1's Y position over several frames
      const p1YPositions: number[] = [];
      for (let i = 0; i < 10; i++) {
        world = simulatePlatformer(world, inputs, 50);
        p1YPositions.push(world.players.get("player-1")?.position.y ?? 0);
      }

      // Player 1 should stay at the same Y position (not bounce)
      for (let i = 1; i < p1YPositions.length; i++) {
        const diff = Math.abs((p1YPositions[i] ?? 0) - (p1YPositions[0] ?? 0));
        expect(diff).toBeLessThan(1); // Should be stable
      }
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
      createInput(0, 0, true, 1000, true), // jumpPressed: true
      createInput(0, 0, false, 1016),
      createInput(0, 0, false, 1032),
    ];

    const merged = mergePlatformerInputs(inputs);

    expect(merged.jump).toBe(true);
    expect(merged.jumpPressed).toBe(true);
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
      createInput(0, 0, true, 1016, true), // Jump pressed (jumpPressed: true)
      createInput(0, 0, false, 1032, false, true), // Jump released (jumpReleased: true)
    ];

    const merged = mergePlatformerInputs(inputs);

    // Jump should still register
    expect(merged.jump).toBe(true);
    expect(merged.jumpPressed).toBe(true);
    expect(merged.jumpReleased).toBe(true);
  });
});
