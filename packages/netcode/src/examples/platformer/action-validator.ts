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
} from "./types.js";
import { ATTACK_RADIUS, ATTACK_DAMAGE } from "./types.js";

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
  switch (action.type) {
    case "attack":
      return validateAttack(world, clientId, action.targetX, action.targetY);
    default:
      return { success: false };
  }
};

/**
 * Validate an attack action.
 *
 * Checks if any player is within ATTACK_RADIUS of the target position.
 * The attacker cannot hit themselves.
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
  // Check each player for a hit
  for (const [playerId, player] of world.players) {
    // Can't hit yourself
    if (playerId === attackerId) continue;

    // Calculate distance from attack target to player center
    const dx = player.position.x - targetX;
    const dy = player.position.y - targetY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Check if within attack radius
    if (distance <= ATTACK_RADIUS) {
      return {
        success: true,
        result: {
          targetId: playerId,
          damage: ATTACK_DAMAGE,
        },
      };
    }
  }

  // No hit
  return { success: false };
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
