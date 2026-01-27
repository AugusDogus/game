/**
 * Platformer game interpolation logic
 */

import type { InterpolateFunction } from "@game/netcode";
import type { PlatformerPlayer, PlatformerWorld, Projectile } from "./types.js";

/**
 * Linear interpolation helper
 */
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Distance between two positions
 */
const distance = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
};

/** Teleport threshold - don't interpolate if position changed more than this */
const TELEPORT_THRESHOLD = 200;

/**
 * Interpolate a single player between two states
 */
const interpolatePlayer = (
  fromPlayer: PlatformerPlayer,
  toPlayer: PlatformerPlayer,
  alpha: number,
): PlatformerPlayer => {
  // Snap position if player teleported (respawn, large correction)
  const positionDistance = distance(fromPlayer.position, toPlayer.position);
  const shouldTeleport = positionDistance > TELEPORT_THRESHOLD;

  return {
    ...toPlayer,
    // Interpolate position smoothly (unless teleporting)
    position: shouldTeleport
      ? toPlayer.position
      : {
          x: lerp(fromPlayer.position.x, toPlayer.position.x, alpha),
          y: lerp(fromPlayer.position.y, toPlayer.position.y, alpha),
        },
    // Interpolate velocity smoothly (unless teleporting)
    velocity: shouldTeleport
      ? toPlayer.velocity
      : {
          x: lerp(fromPlayer.velocity.x, toPlayer.velocity.x, alpha),
          y: lerp(fromPlayer.velocity.y, toPlayer.velocity.y, alpha),
        },
    // Don't interpolate discrete values - use target state
    isGrounded: toPlayer.isGrounded,
    health: toPlayer.health,
    maxHealth: toPlayer.maxHealth,
    deaths: toPlayer.deaths,
    kills: toPlayer.kills,
    lastHitBy: toPlayer.lastHitBy,
    respawnTimer: toPlayer.respawnTimer,
  };
};

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

    interpolatedPlayers.set(playerId, interpolatePlayer(fromPlayer, toPlayer, alpha));
  }

  // Include players that were in 'from' but not in 'to' (recently left)
  // They'll disappear next frame
  for (const [playerId, fromPlayer] of from.players) {
    if (!to.players.has(playerId)) {
      interpolatedPlayers.set(playerId, fromPlayer);
    }
  }

  // Interpolate projectiles
  const interpolatedProjectiles = interpolateProjectiles(from.projectiles, to.projectiles, alpha);

  return {
    ...to,
    players: interpolatedPlayers,
    projectiles: interpolatedProjectiles,
    // Use target tick (we're interpolating towards it)
    tick: to.tick,
  };
};

/**
 * Interpolate projectiles between two states
 */
const interpolateProjectiles = (
  fromProjectiles: Projectile[],
  toProjectiles: Projectile[],
  alpha: number,
): Projectile[] => {
  // Create a map of 'from' projectiles for quick lookup
  const fromMap = new Map<string, Projectile>();
  for (const proj of fromProjectiles) {
    fromMap.set(proj.id, proj);
  }

  // Interpolate projectiles that exist in 'to'
  const interpolated: Projectile[] = [];
  for (const toProj of toProjectiles) {
    const fromProj = fromMap.get(toProj.id);
    if (fromProj) {
      // Snap position if projectile teleported
      const positionDistance = distance(fromProj.position, toProj.position);
      const shouldTeleport = positionDistance > TELEPORT_THRESHOLD;

      interpolated.push({
        ...toProj,
        position: shouldTeleport
          ? toProj.position
          : {
              x: lerp(fromProj.position.x, toProj.position.x, alpha),
              y: lerp(fromProj.position.y, toProj.position.y, alpha),
            },
      });
    } else {
      // New projectile, use current state
      interpolated.push(toProj);
    }
  }

  return interpolated;
};
