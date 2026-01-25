/**
 * Test utilities for platformer example tests.
 */

import type { PlatformerPlayer, PlatformerWorld, PlatformerInput } from "./types.js";
import { DEFAULT_MAX_HEALTH, DEFAULT_MATCH_CONFIG } from "./types.js";

/**
 * Create a test input with all required fields.
 * Allows partial overrides for testing specific scenarios.
 */
export function createTestInput(
  overrides: Partial<PlatformerInput> = {},
): PlatformerInput {
  return {
    moveX: overrides.moveX ?? 0,
    moveY: overrides.moveY ?? 0,
    jump: overrides.jump ?? false,
    jumpPressed: overrides.jumpPressed ?? false,
    jumpReleased: overrides.jumpReleased ?? false,
    shoot: overrides.shoot ?? false,
    shootTargetX: overrides.shootTargetX ?? 0,
    shootTargetY: overrides.shootTargetY ?? 0,
    timestamp: overrides.timestamp ?? Date.now(),
  };
}

/**
 * Get a player from a world, throwing if not found.
 */
export function getPlayer(world: PlatformerWorld, playerId: string): PlatformerPlayer {
  const player = world.players.get(playerId);
  if (!player) {
    const availableIds = Array.from(world.players.keys()).join(", ");
    throw new Error(`Player "${playerId}" not found in world. Available players: [${availableIds}]`);
  }
  return player;
}

/**
 * Create a test player with all required fields.
 * Allows partial overrides for testing specific scenarios.
 */
export function createTestPlayer(
  id: string,
  overrides: Partial<Omit<PlatformerPlayer, "id">> = {},
): PlatformerPlayer {
  return {
    id,
    position: overrides.position ?? { x: 0, y: 0 },
    velocity: overrides.velocity ?? { x: 0, y: 0 },
    isGrounded: overrides.isGrounded ?? false,
    health: overrides.health ?? DEFAULT_MAX_HEALTH,
    maxHealth: overrides.maxHealth ?? DEFAULT_MAX_HEALTH,
    deaths: overrides.deaths ?? 0,
    kills: overrides.kills ?? 0,
    lastHitBy: overrides.lastHitBy ?? null,
    respawnTimer: overrides.respawnTimer ?? null,
    projectileSeq: overrides.projectileSeq ?? 0,
    // Movement state fields
    velocityXSmoothing: overrides.velocityXSmoothing ?? 0,
    wallSliding: overrides.wallSliding ?? false,
    wallDirX: overrides.wallDirX ?? 0,
    timeToWallUnstick: overrides.timeToWallUnstick ?? 0,
    coyoteTimeCounter: overrides.coyoteTimeCounter ?? 0,
    jumpBufferCounter: overrides.jumpBufferCounter ?? 0,
  };
}

/**
 * Create a grounded test player (common test scenario)
 */
export function createGroundedTestPlayer(
  id: string,
  x: number = 0,
  y: number = 0,
): PlatformerPlayer {
  return createTestPlayer(id, {
    position: { x, y },
    isGrounded: true,
  });
}

/**
 * Create a test world with all required fields.
 * Allows partial overrides for testing specific scenarios.
 */
export function createTestWorld(
  players: PlatformerPlayer[] = [],
  overrides: Partial<Omit<PlatformerWorld, "players">> = {},
): PlatformerWorld {
  const playerMap = new Map<string, PlatformerPlayer>();
  for (const player of players) {
    playerMap.set(player.id, player);
  }

  return {
    players: playerMap,
    projectiles: overrides.projectiles ?? [],
    tick: overrides.tick ?? 0,
    gameState: overrides.gameState ?? "playing",
    levelId: overrides.levelId ?? "test-level",
    platforms: overrides.platforms ?? [],
    spawnPoints: overrides.spawnPoints ?? [],
    hazards: overrides.hazards ?? [],
    winner: overrides.winner ?? null,
    matchConfig: overrides.matchConfig ?? DEFAULT_MATCH_CONFIG,
    countdownTicks: overrides.countdownTicks ?? null,
    matchStartTick: overrides.matchStartTick ?? null,
  };
}

/**
 * Create a test world in lobby state
 */
export function createLobbyWorld(players: PlatformerPlayer[] = []): PlatformerWorld {
  return createTestWorld(players, { gameState: "lobby" });
}

/**
 * Create a test world in playing state
 */
export function createPlayingWorld(players: PlatformerPlayer[] = []): PlatformerWorld {
  return createTestWorld(players, { gameState: "playing", matchStartTick: 0 });
}
