/**
 * ROUNDS interpolation for smooth rendering between server snapshots
 */

import type { InterpolateFunction } from "@game/netcode";
import type { RoundsPlayer, RoundsWorld, Projectile, Vector2 } from "./types.js";

/**
 * Linear interpolation for a number
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Linear interpolation for a Vector2
 */
function lerpVector2(a: Vector2, b: Vector2, t: number): Vector2 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
  };
}

/**
 * Distance between two vectors
 */
function distance(a: Vector2, b: Vector2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Teleport threshold - don't interpolate if position changed more than this */
const TELEPORT_THRESHOLD = 200;

/**
 * Interpolate a player between two states
 */
function interpolatePlayer(
  from: RoundsPlayer,
  to: RoundsPlayer,
  alpha: number,
): RoundsPlayer {
  // Snap position if player teleported (respawn, large correction)
  const positionDistance = distance(from.position, to.position);
  const shouldTeleport = positionDistance > TELEPORT_THRESHOLD;

  return {
    ...to, // Use 'to' for discrete values
    // Interpolate continuous values (unless teleporting)
    position: shouldTeleport ? to.position : lerpVector2(from.position, to.position, alpha),
    velocity: shouldTeleport ? to.velocity : lerpVector2(from.velocity, to.velocity, alpha),
    // Health interpolates for smooth damage feedback
    health: lerp(from.health, to.health, alpha),
    shieldHealth: lerp(from.shieldHealth, to.shieldHealth, alpha),
  };
}

/**
 * Interpolate a projectile between two states
 */
function interpolateProjectile(
  from: Projectile,
  to: Projectile,
  alpha: number,
): Projectile {
  // Snap position if projectile teleported (bounced off wall, wrapped around)
  const positionDistance = distance(from.position, to.position);
  const shouldTeleport = positionDistance > TELEPORT_THRESHOLD;

  return {
    ...to,
    position: shouldTeleport ? to.position : lerpVector2(from.position, to.position, alpha),
    // Don't interpolate velocity - it changes suddenly on bounce
  };
}

/**
 * Main interpolation function for ROUNDS world state
 */
export const interpolateRounds: InterpolateFunction<RoundsWorld> = (
  from: RoundsWorld,
  to: RoundsWorld,
  alpha: number,
): RoundsWorld => {
  // Interpolate players
  const players = new Map<string, RoundsPlayer>();
  for (const [playerId, toPlayer] of to.players) {
    const fromPlayer = from.players.get(playerId);
    if (fromPlayer) {
      players.set(playerId, interpolatePlayer(fromPlayer, toPlayer, alpha));
    } else {
      // New player, no interpolation
      players.set(playerId, toPlayer);
    }
  }

  // Interpolate projectiles
  const projectiles: Projectile[] = [];
  for (const toProj of to.projectiles) {
    const fromProj = from.projectiles.find((p) => p.id === toProj.id);
    if (fromProj) {
      projectiles.push(interpolateProjectile(fromProj, toProj, alpha));
    } else {
      projectiles.push(toProj);
    }
  }

  // Interpolate countdown for smooth display
  let countdownTicks = to.countdownTicks;
  if (from.countdownTicks !== null && to.countdownTicks !== null) {
    countdownTicks = Math.round(lerp(from.countdownTicks, to.countdownTicks, alpha));
  }

  return {
    ...to, // Use 'to' for all discrete state
    players,
    projectiles,
    countdownTicks,
  };
};
