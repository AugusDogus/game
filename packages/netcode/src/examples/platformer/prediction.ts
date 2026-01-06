/**
 * Platformer game prediction scope
 */

import type { PredictionScope } from "../../client/prediction-scope.js";
import {
    DEFAULT_FLOOR_Y,
    DEFAULT_GRAVITY,
    DEFAULT_JUMP_VELOCITY,
    DEFAULT_PLAYER_SPEED,
} from "../../constants.js";
import type { PlatformerInput, PlatformerPlayer, PlatformerWorld } from "./types.js";
import { createIdleInput } from "./types.js";

/**
 * Prediction scope for platformer game.
 * Only predicts the local player's state.
 */
export const platformerPredictionScope: PredictionScope<PlatformerWorld, PlatformerInput> = {
  extractPredictable(world: PlatformerWorld, localPlayerId: string): Partial<PlatformerWorld> {
    const localPlayer = world.players.get(localPlayerId);
    if (!localPlayer) {
      return { players: new Map() };
    }

    const players = new Map<string, PlatformerPlayer>();
    players.set(localPlayerId, { ...localPlayer });

    return { players };
  },

  mergePrediction(
    serverWorld: PlatformerWorld,
    predicted: Partial<PlatformerWorld>,
  ): PlatformerWorld {
    if (!predicted.players || predicted.players.size === 0) {
      return serverWorld;
    }

    // Start with server world
    const mergedPlayers = new Map(serverWorld.players);

    // Override with predicted local player
    for (const [playerId, player] of predicted.players) {
      mergedPlayers.set(playerId, player);
    }

    return {
      ...serverWorld,
      players: mergedPlayers,
    };
  },

  simulatePredicted(
    state: Partial<PlatformerWorld>,
    input: PlatformerInput,
    deltaTime: number,
  ): Partial<PlatformerWorld> {
    if (!state.players || state.players.size === 0) {
      return state;
    }

    const deltaSeconds = deltaTime / 1000;
    const newPlayers = new Map<string, PlatformerPlayer>();

    for (const [playerId, player] of state.players) {
      // Apply platformer physics
      let velocityX = input.moveX * DEFAULT_PLAYER_SPEED;
      let velocityY = player.velocity.y;

      // Apply gravity
      velocityY += DEFAULT_GRAVITY * deltaSeconds;

      // Handle jumping
      if (input.jump && player.isGrounded) {
        velocityY = DEFAULT_JUMP_VELOCITY;
      }

      // Calculate new position
      let newX = player.position.x + velocityX * deltaSeconds;
      let newY = player.position.y + velocityY * deltaSeconds;

      // Floor collision
      let isGrounded = false;
      const playerHeight = 20;

      if (newY + playerHeight / 2 >= DEFAULT_FLOOR_Y) {
        newY = DEFAULT_FLOOR_Y - playerHeight / 2;
        velocityY = 0;
        isGrounded = true;
      }

      newPlayers.set(playerId, {
        ...player,
        position: { x: newX, y: newY },
        velocity: { x: velocityX, y: velocityY },
        isGrounded,
      });
    }

    return { players: newPlayers };
  },

  createIdleInput(): PlatformerInput {
    return createIdleInput();
  },
};
