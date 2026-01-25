/**
 * Test to verify the idiomatic simulation contract:
 * - simulate() is called ONCE per tick with ALL players' inputs
 * - All players and shared state (projectiles) are processed in a single call
 */
import { describe, test, expect } from "bun:test";
import { simulatePlatformer, addPlayerToWorld, createPlatformerWorld, setLevelConfig, LEVELS } from "./index.js";
import { createIdleInput, type PlatformerInput, DEFAULT_MATCH_CONFIG, PROJECTILE_SPEED, PROJECTILE_DAMAGE, type Projectile } from "./types.js";

describe("Multi-player simulation (idiomatic single call per tick)", () => {
  const createTestWorld = () => {
    const level = LEVELS["basic-arena"]!;
    return setLevelConfig(
      addPlayerToWorld(
        addPlayerToWorld(createPlatformerWorld(DEFAULT_MATCH_CONFIG), "player-1"),
        "player-2"
      ),
      level.id,
      level.platforms,
      level.spawnPoints,
      level.hazards,
    );
  };

  test("simulating with all players inputs applies physics correctly", () => {
    let world = createTestWorld();
    
    // Force both players to be in the air at known positions
    const p1 = world.players.get("player-1")!;
    const p2 = world.players.get("player-2")!;
    world = {
      ...world,
      gameState: "playing",
      players: new Map([
        ["player-1", { ...p1, position: { x: -100, y: 100 }, velocity: { x: 0, y: 0 }, isGrounded: false }],
        ["player-2", { ...p2, position: { x: 100, y: 100 }, velocity: { x: 0, y: 0 }, isGrounded: false }],
      ]),
    };

    const deltaTime = 50; // ms

    // Idiomatic: single simulate call with ALL players' inputs
    const inputs = new Map<string, PlatformerInput>([
      ["player-1", { ...createIdleInput(), moveX: 1 }], // player 1 moves right
      ["player-2", createIdleInput()], // player 2 idle
    ]);
    
    const newWorld = simulatePlatformer(world, inputs, deltaTime);
    
    // Both players should have gravity applied (once each)
    const newP1 = newWorld.players.get("player-1")!;
    const newP2 = newWorld.players.get("player-2")!;
    
    // Gravity = -800, deltaSeconds = 0.05, velocity change = -40
    const expectedVelocityY = -40;
    
    expect(newP1.velocity.y).toBeCloseTo(expectedVelocityY, 0);
    expect(newP2.velocity.y).toBeCloseTo(expectedVelocityY, 0);
    
    // Player 1 moved right
    expect(newP1.position.x).toBeGreaterThan(-100);
    // Player 2 stayed in place (only idle input)
    expect(newP2.position.x).toBe(100);
  });

  test("projectiles move correctly with single simulate call", () => {
    let world = createTestWorld();
    
    // Force world into playing state with a projectile
    const p1 = world.players.get("player-1")!;
    const p2 = world.players.get("player-2")!;
    
    const projectile: Projectile = {
      id: "test-proj",
      ownerId: "player-1",
      position: { x: 0, y: 50 },
      velocity: { x: PROJECTILE_SPEED, y: 0 }, // Moving right
      damage: PROJECTILE_DAMAGE,
      lifetime: 100,
    };
    
    world = {
      ...world,
      gameState: "playing",
      projectiles: [projectile],
      players: new Map([
        ["player-1", { ...p1, position: { x: -200, y: 50 }, isGrounded: true }],
        ["player-2", { ...p2, position: { x: 200, y: 50 }, isGrounded: true }],
      ]),
    };

    const deltaTime = 50; // ms = 0.05 seconds

    // Idiomatic: single simulate call with ALL players' inputs
    const inputs = new Map<string, PlatformerInput>([
      ["player-1", createIdleInput()],
      ["player-2", createIdleInput()],
    ]);
    
    const newWorld = simulatePlatformer(world, inputs, deltaTime);

    // Projectile should have moved by velocity * deltaSeconds exactly ONCE
    const expectedX = PROJECTILE_SPEED * 0.05; // 500 * 0.05 = 25
    
    expect(newWorld.projectiles.length).toBe(1);
    const finalProj = newWorld.projectiles[0]!;
    
    expect(finalProj.position.x).toBeCloseTo(expectedX, 0);
  });

  test("client-side prediction: single player input works correctly", () => {
    let world = createTestWorld();
    
    // Force both players to be in the air
    const p1 = world.players.get("player-1")!;
    const p2 = world.players.get("player-2")!;
    world = {
      ...world,
      gameState: "playing",
      players: new Map([
        ["player-1", { ...p1, position: { x: -100, y: 100 }, velocity: { x: 0, y: 0 }, isGrounded: false }],
        ["player-2", { ...p2, position: { x: 100, y: 100 }, velocity: { x: 0, y: 0 }, isGrounded: false }],
      ]),
    };

    const deltaTime = 50; // ms

    // Client-side prediction: only local player's input
    // This is valid - players not in the map are left unchanged
    const inputs = new Map<string, PlatformerInput>([
      ["player-1", createIdleInput()],
    ]);
    
    const newWorld = simulatePlatformer(world, inputs, deltaTime);
    
    // Player 1 should have physics applied
    const newP1 = newWorld.players.get("player-1")!;
    expect(newP1.velocity.y).toBeLessThan(0); // Gravity applied
    
    // Player 2 should be unchanged (not in inputs map)
    const newP2 = newWorld.players.get("player-2")!;
    expect(newP2.position.y).toBe(100);
    expect(newP2.velocity.y).toBe(0);
  });
});
