/**
 * Action validation for the platformer example.
 *
 * Demonstrates lag compensation by validating attacks against
 * historical world state.
 */

import type { ActionValidator } from "../../core/types.js";
import type {
  PlatformerWorld,
  PlatformerAction,
  PlatformerActionResult,
  PlatformerAttackResult,
  PlatformerShootResult,
  PlatformerPlayer,
} from "./types.js";
import { ATTACK_RADIUS, ATTACK_DAMAGE, canPlayerTakeDamage, isPlayerAlive } from "./types.js";
import { spawnProjectile } from "./simulation.js";

/**
 * Calculate distance between two points
 */
const calculateDistance = (x1: number, y1: number, x2: number, y2: number): number => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
};

/**
 * Check if a player can be hit by an attack
 */
const canBeHit = (player: PlatformerPlayer, attackerId: string): boolean =>
  player.id !== attackerId && canPlayerTakeDamage(player);

/**
 * Find the closest hittable player within attack radius
 */
const findHitTarget = (
  world: PlatformerWorld,
  attackerId: string,
  targetX: number,
  targetY: number,
): PlatformerPlayer | null => {
  let closestPlayer: PlatformerPlayer | null = null;
  let closestDistance = ATTACK_RADIUS;

  for (const player of world.players.values()) {
    if (!canBeHit(player, attackerId)) continue;

    const distance = calculateDistance(
      targetX,
      targetY,
      player.position.x,
      player.position.y,
    );

    if (distance <= closestDistance) {
      closestDistance = distance;
      closestPlayer = player;
    }
  }

  return closestPlayer;
};

/**
 * Validate a platformer action against the world state.
 *
 * For attack actions, checks if any player (other than the attacker)
 * is within the attack radius of the target position.
 *
 * @param world - The world state (may be historical for lag compensation)
 * @param clientId - The client performing the action
 * @param action - The action to validate
 * @returns Validation result with hit information
 */
export const validatePlatformerAction: ActionValidator<
  PlatformerWorld,
  PlatformerAction,
  PlatformerActionResult
> = (world, clientId, action) => {
  // Don't process actions if game is not in playing state
  if (world.gameState !== "playing") {
    return { success: false };
  }

  // Verify the attacker exists and is alive
  const attacker = world.players.get(clientId);
  if (!attacker || !canPlayerTakeDamage(attacker)) {
    return { success: false };
  }

  switch (action.type) {
    case "attack":
      return validateAttack(world, clientId, action.targetX, action.targetY);
    case "shoot":
      return validateShoot(world, clientId, action.targetX, action.targetY);
    default:
      return { success: false };
  }
};

/**
 * Validate an attack action.
 *
 * Checks if any player is within ATTACK_RADIUS of the target position.
 * The attacker cannot hit themselves.
 * Only hits players that can take damage (alive and not respawning).
 *
 * @param world - The world state
 * @param attackerId - The player performing the attack
 * @param targetX - Target X position
 * @param targetY - Target Y position
 * @returns Hit result or miss
 */
function validateAttack(
  world: PlatformerWorld,
  attackerId: string,
  targetX: number,
  targetY: number,
): { success: boolean; result?: PlatformerAttackResult } {
  const hitTarget = findHitTarget(world, attackerId, targetX, targetY);

  if (hitTarget) {
    return {
      success: true,
      result: {
        type: "attack",
        targetId: hitTarget.id,
        damage: ATTACK_DAMAGE,
      },
    };
  }

  return { success: false };
}

/**
 * Validate a shoot action.
 *
 * Spawns a projectile from the shooter toward the target position.
 * The shooter must be alive to shoot.
 *
 * @param world - The world state
 * @param shooterId - The player performing the shot
 * @param targetX - Target X position
 * @param targetY - Target Y position
 * @returns Shoot result with projectile ID
 */
function validateShoot(
  world: PlatformerWorld,
  shooterId: string,
  targetX: number,
  targetY: number,
): { success: boolean; result?: PlatformerShootResult; worldUpdate?: PlatformerWorld } {
  const shooter = world.players.get(shooterId);
  if (!shooter || !isPlayerAlive(shooter)) {
    return { success: false };
  }

  const spawnResult = spawnProjectile(world, shooterId, targetX, targetY);
  if (!spawnResult) {
    return { success: false };
  }

  return {
    success: true,
    result: {
      type: "shoot",
      projectileId: spawnResult.projectileId,
    },
    worldUpdate: spawnResult.world,
  };
}

/**
 * Check if a point is within attack range of a player.
 * Utility function for client-side visualization.
 *
 * @param playerX - Player X position
 * @param playerY - Player Y position
 * @param targetX - Target X position
 * @param targetY - Target Y position
 * @returns true if target is within attack range
 */
export function isInAttackRange(
  playerX: number,
  playerY: number,
  targetX: number,
  targetY: number,
): boolean {
  const dx = targetX - playerX;
  const dy = targetY - playerY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return distance <= ATTACK_RADIUS;
}
