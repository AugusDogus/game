/**
 * Platformer game prediction scope
 *
 * Uses the SAME simulation logic as the server to ensure client and server
 * physics match exactly. This is critical for proper client-side prediction.
 */

import type { PredictionScope } from "@game/netcode";
import { simulatePlatformer } from "./simulation.js";
import type { PlatformerInput, PlatformerPlayer, PlatformerWorld } from "./types.js";
import { createIdleInput } from "./types.js";

/**
 * Prediction scope for platformer game.
 * Simulates ALL players to ensure collision detection matches the server.
 */
export const platformerPredictionScope: PredictionScope<PlatformerWorld, PlatformerInput> = {
  /**
   * Extract the full world state for prediction.
   * We need ALL players to properly simulate collisions.
   */
  extractPredictable(world: PlatformerWorld, _localPlayerId: string): Partial<PlatformerWorld> {
    // Return the full world state - we need all players for collision detection
    return {
      players: new Map(world.players),
      levelId: world.levelId, // Critical: must include levelId for correct collision detection
      platforms: world.platforms,
      hazards: world.hazards,
      spawnPoints: world.spawnPoints,
      projectiles: [...world.projectiles],
      gameState: world.gameState,
      tick: world.tick,
      matchConfig: world.matchConfig,
      countdownTicks: world.countdownTicks,
      matchStartTick: world.matchStartTick,
      winner: world.winner,
    };
  },

  /**
   * Merge predicted state with server state.
   * Only the local player's position is predicted - other players use server state.
   */
  mergePrediction(
    serverWorld: PlatformerWorld,
    predicted: Partial<PlatformerWorld>,
    localPlayerId?: string,
  ): PlatformerWorld {
    if (!predicted.players || predicted.players.size === 0 || !localPlayerId) {
      return serverWorld;
    }

    // Start with server world
    const mergedPlayers = new Map(serverWorld.players);

    // Only override the LOCAL player with predicted state
    // Other players should use server-authoritative positions
    const predictedLocal = predicted.players.get(localPlayerId);
    if (predictedLocal) {
      mergedPlayers.set(localPlayerId, predictedLocal);
    }

    return {
      ...serverWorld,
      players: mergedPlayers,
      // Use predicted projectiles if available (for shooting prediction)
      projectiles: predicted.projectiles ?? serverWorld.projectiles,
    };
  },

  /**
   * Simulate the predicted state using the SAME physics as the server.
   * This ensures client and server physics match exactly.
   */
  simulatePredicted(
    state: Partial<PlatformerWorld>,
    input: PlatformerInput,
    deltaTime: number,
    localPlayerId?: string,
  ): Partial<PlatformerWorld> {
    if (!state.players || state.players.size === 0) {
      return state;
    }

    // Build a full world state for simulation
    const worldForSimulation: PlatformerWorld = {
      players: state.players as Map<string, PlatformerPlayer>,
      levelId: state.levelId ?? "default",
      platforms: state.platforms ?? [],
      hazards: state.hazards ?? [],
      spawnPoints: state.spawnPoints ?? [],
      projectiles: state.projectiles ?? [],
      gameState: state.gameState ?? "playing",
      tick: state.tick ?? 0,
      matchConfig: state.matchConfig ?? { winCondition: "last_standing" },
      countdownTicks: state.countdownTicks ?? null,
      matchStartTick: state.matchStartTick ?? null,
      winner: state.winner ?? null,
    };

    // Build inputs map - only local player has input, others are idle
    const inputs = new Map<string, PlatformerInput>();
    if (localPlayerId) {
      inputs.set(localPlayerId, input);
    }
    // Other players get idle input (they'll be corrected by server snapshots)
    for (const playerId of worldForSimulation.players.keys()) {
      if (playerId !== localPlayerId) {
        inputs.set(playerId, createIdleInput(input.timestamp));
      }
    }

    // Use the SAME simulation function as the server
    const newWorld = simulatePlatformer(worldForSimulation, inputs, deltaTime);

    return {
      players: newWorld.players,
      levelId: newWorld.levelId, // Critical: preserve levelId for next tick's collision detection
      projectiles: newWorld.projectiles,
      tick: newWorld.tick,
      gameState: newWorld.gameState,
      platforms: newWorld.platforms,
      hazards: newWorld.hazards,
      spawnPoints: newWorld.spawnPoints,
      matchConfig: newWorld.matchConfig,
      countdownTicks: newWorld.countdownTicks,
      matchStartTick: newWorld.matchStartTick,
      winner: newWorld.winner,
    };
  },

  createIdleInput(): PlatformerInput {
    return createIdleInput();
  },

  /**
   * Get the local player's position from the predicted state.
   * Used by FishNet-style tick smoothing to track position changes during reconciliation.
   */
  getLocalPlayerPosition(
    state: Partial<PlatformerWorld>,
    localPlayerId: string,
  ): { x: number; y: number } | null {
    const player = state.players?.get(localPlayerId);
    if (!player) return null;
    return { x: player.position.x, y: player.position.y };
  },
};
