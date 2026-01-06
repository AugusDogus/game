/**
 * Platformer game interpolation logic
 */

import type { InterpolateFunction } from "../../core/types.js";
import type { PlatformerWorld, PlatformerPlayer } from "./types.js";

/**
 * Interpolate between two platformer world states.
 * Used for smooth rendering of remote entities.
 */
export const interpolatePlatformer: InterpolateFunction<PlatformerWorld> = (
  from: PlatformerWorld,
  to: PlatformerWorld,
  alpha: number,
): PlatformerWorld => {
  const interpolatedPlayers = new Map<string, PlatformerPlayer>();

  // Interpolate players that exist in both states
  for (const [playerId, toPlayer] of to.players) {
    const fromPlayer = from.players.get(playerId);

    if (!fromPlayer) {
      // Player is new, just use their current state
      interpolatedPlayers.set(playerId, toPlayer);
      continue;
    }

    // Linear interpolation of position and velocity
    interpolatedPlayers.set(playerId, {
      ...toPlayer,
      position: {
        x: lerp(fromPlayer.position.x, toPlayer.position.x, alpha),
        y: lerp(fromPlayer.position.y, toPlayer.position.y, alpha),
      },
      velocity: {
        x: lerp(fromPlayer.velocity.x, toPlayer.velocity.x, alpha),
        y: lerp(fromPlayer.velocity.y, toPlayer.velocity.y, alpha),
      },
      // Don't interpolate boolean - use target state
      isGrounded: toPlayer.isGrounded,
    });
  }

  // Include players that were in 'from' but not in 'to' (recently left)
  // They'll disappear next frame
  for (const [playerId, fromPlayer] of from.players) {
    if (!to.players.has(playerId)) {
      interpolatedPlayers.set(playerId, fromPlayer);
    }
  }

  return {
    players: interpolatedPlayers,
    // Use target tick (we're interpolating towards it)
    tick: to.tick,
  };
};

/**
 * Linear interpolation helper
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
