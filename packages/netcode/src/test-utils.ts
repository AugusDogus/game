/**
 * Test utilities providing safe access to values that might be undefined.
 * These helpers throw descriptive errors instead of using non-null assertions.
 *
 * NOTE: For production code, use the helpers in core/utils.ts instead.
 * This file re-exports those plus adds test-specific helpers.
 */

import type { PlatformerPlayer, PlatformerWorld } from "./examples/platformer/types.js";
import {
  DEFAULT_MAX_HEALTH,
  DEFAULT_MATCH_CONFIG,
} from "./examples/platformer/types.js";
export { getAt, getLast, getFromMap, assertDefined } from "./core/utils.js";

/**
 * Get a player from a world, throwing if not found.
 * This is a test-specific helper for PlatformerWorld.
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
    tick: overrides.tick ?? 0,
    gameState: overrides.gameState ?? "playing",
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
