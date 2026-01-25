/**
 * ROUNDS client-side prediction scope
 *
 * Handles extracting predictable state and merging predictions
 * with authoritative server state.
 *
 * NOTE: Input edge detection (jumpPressed/jumpReleased) is handled client-side
 * at input sampling time. This makes the simulation fully deterministic and
 * replayable without needing to preserve input tracking state during reconciliation.
 */

import type { PredictionScope } from "@game/netcode";
import { simulateRounds } from "./simulation.js";
import type { RoundsInput, RoundsWorld } from "./types.js";
import { createIdleInput } from "./types.js";

/**
 * Extract the predictable portion of the world for a given player.
 * Returns a partial world containing just the local player.
 */
function extractPredictable(
  world: RoundsWorld,
  localPlayerId: string,
): Partial<RoundsWorld> {
  const localPlayer = world.players.get(localPlayerId);
  if (!localPlayer) {
    return {};
  }

  const ownedProjectiles = world.projectiles.filter(
    (p) => p.ownerId === localPlayerId,
  );

  return {
    players: new Map([[localPlayerId, localPlayer]]),
    projectiles: ownedProjectiles,
    tick: world.tick,
    phase: world.phase,
    level: world.level,
  };
}

/**
 * Merge predicted state back into the server's authoritative world.
 */
function mergePrediction(
  serverWorld: RoundsWorld,
  predicted: Partial<RoundsWorld>,
  localPlayerId?: string,
): RoundsWorld {
  // If no local player or no predicted data, return server world
  if (!localPlayerId || !predicted.players) {
    return serverWorld;
  }

  const predictedPlayer = predicted.players.get(localPlayerId);
  if (!predictedPlayer) {
    return serverWorld;
  }

  // During non-fighting phases, don't predict movement
  if (serverWorld.phase !== "fighting") {
    return serverWorld;
  }

  // Create new players map with predicted local player
  const players = new Map(serverWorld.players);
  const serverPlayer = players.get(localPlayerId);

  if (serverPlayer) {
    // Merge predicted position/velocity with server state for other fields
    players.set(localPlayerId, {
      ...serverPlayer,
      position: predictedPlayer.position,
      velocity: predictedPlayer.velocity,
      isGrounded: predictedPlayer.isGrounded,
      // Keep server-authoritative combat state
      // health, ammo, etc. come from server
      // Movement state from prediction
      velocityXSmoothing: predictedPlayer.velocityXSmoothing,
      wallSliding: predictedPlayer.wallSliding,
      wallDirX: predictedPlayer.wallDirX,
      timeToWallUnstick: predictedPlayer.timeToWallUnstick,
      coyoteTimeCounter: predictedPlayer.coyoteTimeCounter,
      jumpBufferCounter: predictedPlayer.jumpBufferCounter,
      extraJumpsRemaining: predictedPlayer.extraJumpsRemaining,
    });
  }

  // Merge projectiles - prefer predicted positions for owned projectiles
  const projectiles = serverWorld.projectiles.map((serverProj) => {
    const predictedProj = predicted.projectiles?.find(
      (p) => p.id === serverProj.id,
    );
    if (predictedProj) {
      return {
        ...serverProj,
        position: predictedProj.position,
      };
    }
    return serverProj;
  });

  return {
    ...serverWorld,
    players,
    projectiles,
  };
}

/**
 * Simulate predicted state forward one tick.
 */
function simulatePredicted(
  state: Partial<RoundsWorld>,
  input: RoundsInput,
  deltaTime: number,
  localPlayerId?: string,
): Partial<RoundsWorld> {
  // Need player and level to simulate
  if (!localPlayerId || !state.players || !state.level) {
    return state;
  }

  const localPlayer = state.players.get(localPlayerId);
  if (!localPlayer) {
    return state;
  }

  // Only predict during fighting phase
  if (state.phase !== "fighting") {
    return state;
  }

  const world: RoundsWorld = {
    players: new Map([[localPlayerId, localPlayer]]),
    projectiles: state.projectiles ?? [],
    tick: state.tick ?? 0,
    phase: state.phase,
    level: state.level,
    cardPick: null,
    countdownTicks: null,
    matchWinner: null,
    roundWinner: null,
    roundNumber: 0,
  };

  const inputs = new Map([[localPlayerId, input]]);
  const newWorld = simulateRounds(world, inputs, deltaTime);

  const newLocalPlayer = newWorld.players.get(localPlayerId);
  if (!newLocalPlayer) {
    return state;
  }

  return {
    players: new Map([[localPlayerId, newLocalPlayer]]),
    projectiles: newWorld.projectiles.filter(
      (p) => p.ownerId === localPlayerId,
    ),
    tick: newWorld.tick,
    phase: newWorld.phase,
    level: newWorld.level,
  };
}

/**
 * Get the local player's position from the predicted state.
 * Used by FishNet-style tick smoothing to track position changes during reconciliation.
 */
function getLocalPlayerPosition(
  state: Partial<RoundsWorld>,
  localPlayerId: string,
): { x: number; y: number } | null {
  const player = state.players?.get(localPlayerId);
  if (!player) return null;
  return { x: player.position.x, y: player.position.y };
}

/**
 * Prediction scope for ROUNDS game
 */
export const roundsPredictionScope: PredictionScope<RoundsWorld, RoundsInput> = {
  extractPredictable,
  mergePrediction,
  simulatePredicted,
  createIdleInput,
  getLocalPlayerPosition,
};
