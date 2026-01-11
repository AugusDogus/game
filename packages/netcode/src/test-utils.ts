/**
 * Test utilities providing safe access to values that might be undefined.
 * These helpers throw descriptive errors instead of using non-null assertions.
 * 
 * NOTE: For production code, use the helpers in core/utils.ts instead.
 * This file re-exports those plus adds test-specific helpers.
 */

import type { PlatformerPlayer, PlatformerWorld } from "./examples/platformer/types.js";
export { getAt, getLast, getFromMap, assertDefined } from "./core/utils.js";

/**
 * Get a player from a world, throwing if not found.
 * This is a test-specific helper for PlatformerWorld.
 */
export function getPlayer(world: PlatformerWorld, playerId: string): PlatformerPlayer {
  const player = world.players.get(playerId);
  if (!player) {
    const availableIds = Array.from(world.players.keys()).join(", ");
    throw new Error(
      `Player "${playerId}" not found in world. Available players: [${availableIds}]`
    );
  }
  return player;
}
