/**
 * Platformer game simulation logic
 */

import {
  DEFAULT_PLAYER_SPEED,
  DEFAULT_GRAVITY,
  DEFAULT_JUMP_VELOCITY,
  DEFAULT_FLOOR_Y,
} from "../../constants.js";
import type { SimulateFunction } from "../../core/types.js";
import type { InputMerger } from "../../server/game-loop.js";
import type { PlatformerWorld, PlatformerInput, PlatformerPlayer } from "./types.js";
import { createPlatformerPlayer, createIdleInput } from "./types.js";

/**
 * Merge multiple platformer inputs into one.
 * Uses the last input for movement, but preserves jump if ANY input had it.
 * This prevents missed jumps when multiple inputs arrive in one tick.
 */
export const mergePlatformerInputs: InputMerger<PlatformerInput> = (
  inputs: PlatformerInput[],
): PlatformerInput => {
  if (inputs.length === 0) {
    return createIdleInput();
  }

  const lastInput = inputs[inputs.length - 1]!;
  const anyJump = inputs.some((input) => input.jump);

  return {
    ...lastInput,
    jump: anyJump,
  };
};

/**
 * Simulate one tick of the platformer world.
 * This is the whole-world simulation function used by the netcode engine.
 * 
 * Behavior:
 * - If inputs map is EMPTY: Apply idle physics to ALL players (legacy behavior)
 * - If inputs map has entries: ONLY simulate players in the map, leave others unchanged
 * 
 * This is crucial for multi-client scenarios where each client's inputs
 * are processed separately with their own deltas.
 */
export const simulatePlatformer: SimulateFunction<PlatformerWorld, PlatformerInput> = (
  world: PlatformerWorld,
  inputs: Map<string, PlatformerInput>,
  deltaTime: number,
): PlatformerWorld => {
  const deltaSeconds = deltaTime / 1000;
  const newPlayers = new Map<string, PlatformerPlayer>();

  // If no inputs provided, simulate ALL players with idle input (legacy behavior)
  const simulateAll = inputs.size === 0;

  // Process each player
  for (const [playerId, player] of world.players) {
    if (simulateAll) {
      // No inputs at all - apply idle physics to everyone
      const input = createIdleInput();
      const newPlayer = simulatePlayer(player, input, deltaSeconds);
      newPlayers.set(playerId, newPlayer);
    } else if (inputs.has(playerId)) {
      // This player has input - simulate them
      const input = inputs.get(playerId)!;
      const newPlayer = simulatePlayer(player, input, deltaSeconds);
      newPlayers.set(playerId, newPlayer);
    } else {
      // Player not in inputs map - keep unchanged (they'll get their own simulation)
      newPlayers.set(playerId, player);
    }
  }

  return {
    players: newPlayers,
    tick: world.tick + 1,
  };
};

/**
 * Simulate a single player with platformer physics
 */
function simulatePlayer(
  player: PlatformerPlayer,
  input: PlatformerInput,
  deltaSeconds: number,
): PlatformerPlayer {
  // Start with current velocity
  let velocityX = input.moveX * DEFAULT_PLAYER_SPEED;
  let velocityY = player.velocity.y;

  // Apply gravity (Y increases downward)
  velocityY += DEFAULT_GRAVITY * deltaSeconds;

  // Handle jumping - only if grounded and jump pressed
  if (input.jump && player.isGrounded) {
    velocityY = DEFAULT_JUMP_VELOCITY;
  }

  // Calculate new position
  let newX = player.position.x + velocityX * deltaSeconds;
  let newY = player.position.y + velocityY * deltaSeconds;

  // Check floor collision
  let isGrounded = false;
  const playerHeight = 20; // Half of player size (10 from center to bottom)

  if (newY + playerHeight / 2 >= DEFAULT_FLOOR_Y) {
    newY = DEFAULT_FLOOR_Y - playerHeight / 2;
    velocityY = 0;
    isGrounded = true;
  }

  return {
    ...player,
    position: { x: newX, y: newY },
    velocity: { x: velocityX, y: velocityY },
    isGrounded,
  };
}

/**
 * Add a player to the world
 */
export function addPlayerToWorld(
  world: PlatformerWorld,
  playerId: string,
  position = { x: 0, y: 0 },
): PlatformerWorld {
  const newPlayers = new Map(world.players);
  newPlayers.set(playerId, createPlatformerPlayer(playerId, position));
  return {
    ...world,
    players: newPlayers,
  };
}

/**
 * Remove a player from the world
 */
export function removePlayerFromWorld(world: PlatformerWorld, playerId: string): PlatformerWorld {
  const newPlayers = new Map(world.players);
  newPlayers.delete(playerId);
  return {
    ...world,
    players: newPlayers,
  };
}
