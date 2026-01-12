/**
 * Platformer game simulation logic
 */

import {
  DEFAULT_PLAYER_SPEED,
  DEFAULT_GRAVITY,
  DEFAULT_JUMP_VELOCITY,
  DEFAULT_FLOOR_Y,
} from "../../constants.js";
import type { SimulateFunction, InputMerger } from "../../core/types.js";
import type {
  PlatformerWorld,
  PlatformerInput,
  PlatformerPlayer,
  Vector2,
  Platform,
  Hazard,
  SpawnPoint,
  Projectile,
} from "./types.js";
import {
  createPlatformerPlayer,
  createIdleInput,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  RESPAWN_TIMER_TICKS,
  clampHealth,
  isPlayerAlive,
  canPlayerTakeDamage,
  getPlayerWithMostKills,
  hasPlayerReachedKillTarget,
  DEFAULT_MAX_HEALTH,
  PROJECTILE_RADIUS,
  PROJECTILE_SPEED,
  PROJECTILE_DAMAGE,
  PROJECTILE_LIFETIME_TICKS,
} from "./types.js";

// =============================================================================
// Constants
// =============================================================================

/** Countdown duration in ticks (3 seconds at 20Hz) */
const COUNTDOWN_DURATION_TICKS = 60;

/** Minimum players required to start a match */
const MIN_PLAYERS_TO_START = 2;

// =============================================================================
// AABB Collision Detection
// =============================================================================

/**
 * Axis-Aligned Bounding Box for collision detection
 */
interface AABB {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Get the AABB for a player
 */
const getPlayerAABB = (player: PlatformerPlayer): AABB => ({
  x: player.position.x - PLAYER_WIDTH / 2,
  y: player.position.y - PLAYER_HEIGHT / 2,
  width: PLAYER_WIDTH,
  height: PLAYER_HEIGHT,
});

/**
 * Check if two AABBs are overlapping
 */
const aabbOverlap = (a: AABB, b: AABB): boolean =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

/**
 * Calculate the minimum translation vector to separate two overlapping AABBs
 * Returns the vector to move 'a' so it no longer overlaps 'b'
 */
const calculateSeparation = (a: AABB, b: AABB): Vector2 => {
  const overlapLeft = a.x + a.width - b.x;
  const overlapRight = b.x + b.width - a.x;
  const overlapTop = a.y + a.height - b.y;
  const overlapBottom = b.y + b.height - a.y;

  const minOverlapX = overlapLeft < overlapRight ? -overlapLeft : overlapRight;
  const minOverlapY = overlapTop < overlapBottom ? -overlapTop : overlapBottom;

  // Push out along the axis with the smallest overlap
  if (Math.abs(minOverlapX) < Math.abs(minOverlapY)) {
    return { x: minOverlapX, y: 0 };
  }
  return { x: 0, y: minOverlapY };
};

/**
 * Check if a player AABB collides with a platform
 */
const playerPlatformCollision = (
  playerAABB: AABB,
  platform: Platform,
): { collides: boolean; separation: Vector2 } => {
  const platformAABB: AABB = {
    x: platform.position.x,
    y: platform.position.y,
    width: platform.width,
    height: platform.height,
  };

  if (!aabbOverlap(playerAABB, platformAABB)) {
    return { collides: false, separation: { x: 0, y: 0 } };
  }

  return {
    collides: true,
    separation: calculateSeparation(playerAABB, platformAABB),
  };
};

/**
 * Check if a player AABB collides with a hazard
 */
const playerHazardCollision = (playerAABB: AABB, hazard: Hazard): boolean => {
  const hazardAABB: AABB = {
    x: hazard.position.x,
    y: hazard.position.y,
    width: hazard.width,
    height: hazard.height,
  };
  return aabbOverlap(playerAABB, hazardAABB);
};

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

  // Safe to use at() here since we checked length > 0 above
  const lastInput = inputs.at(-1) as PlatformerInput;
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
  // First, handle game state transitions
  const worldAfterStateUpdate = updateGameState(world);

  // Only simulate player physics during 'playing' state
  if (worldAfterStateUpdate.gameState !== "playing") {
    return {
      ...worldAfterStateUpdate,
      tick: worldAfterStateUpdate.tick + 1,
    };
  }

  const deltaSeconds = deltaTime / 1000;

  // If no inputs provided, simulate ALL players with idle input (legacy behavior)
  const simulateAll = inputs.size === 0;

  // Step 1: Simulate physics for each player
  let newPlayers = new Map<string, PlatformerPlayer>();
  for (const [playerId, player] of worldAfterStateUpdate.players) {
    if (simulateAll) {
      const input = createIdleInput();
      const newPlayer = simulatePlayer(
        player,
        input,
        deltaSeconds,
        worldAfterStateUpdate.platforms,
      );
      newPlayers.set(playerId, newPlayer);
    } else {
      const input = inputs.get(playerId);
      if (input) {
        const newPlayer = simulatePlayer(
          player,
          input,
          deltaSeconds,
          worldAfterStateUpdate.platforms,
        );
        newPlayers.set(playerId, newPlayer);
      } else {
        newPlayers.set(playerId, player);
      }
    }
  }

  // Step 2: Handle player-player collisions
  newPlayers = resolvePlayerCollisions(newPlayers);

  // Step 3: Handle hazard damage
  newPlayers = processHazardDamage(newPlayers, worldAfterStateUpdate.hazards);

  // Step 4: Process shooting inputs and spawn projectiles
  let newProjectiles = [...worldAfterStateUpdate.projectiles];
  for (const [playerId, input] of inputs) {
    if (input.shoot) {
      const player = newPlayers.get(playerId);
      if (player && isPlayerAlive(player)) {
        const projectile = createProjectileFromInput(
          playerId,
          player.position,
          input.shootTargetX,
          input.shootTargetY,
          worldAfterStateUpdate.tick,
        );
        if (projectile) {
          newProjectiles.push(projectile);
        }
      }
    }
  }

  // Step 5: Simulate projectiles and handle projectile-player collisions
  const projectileResult = simulateProjectiles(
    newProjectiles,
    newPlayers,
    deltaSeconds,
  );
  newPlayers = projectileResult.players;
  newProjectiles = projectileResult.projectiles;

  // Step 6: Process respawn timers and deaths
  newPlayers = processRespawns(newPlayers, worldAfterStateUpdate.spawnPoints);

  // Step 7: Check win conditions
  const worldWithPlayers: PlatformerWorld = {
    ...worldAfterStateUpdate,
    players: newPlayers,
    projectiles: newProjectiles,
    tick: worldAfterStateUpdate.tick + 1,
  };

  return checkWinConditions(worldWithPlayers);
};

/**
 * Simulate a single player with platformer physics
 */
function simulatePlayer(
  player: PlatformerPlayer,
  input: PlatformerInput,
  deltaSeconds: number,
  platforms: Platform[],
): PlatformerPlayer {
  // If player is respawning, they can't act - just decrement timer
  if (player.respawnTimer !== null) {
    return player; // Respawn timer is handled in processRespawns
  }

  // If player is dead, don't simulate
  if (player.health <= 0) {
    return player;
  }

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

  if (newY + PLAYER_HEIGHT / 2 >= DEFAULT_FLOOR_Y) {
    newY = DEFAULT_FLOOR_Y - PLAYER_HEIGHT / 2;
    velocityY = 0;
    isGrounded = true;
  }

  // Check platform collisions
  const playerAABB = getPlayerAABB({
    ...player,
    position: { x: newX, y: newY },
  });

  for (const platform of platforms) {
    const collision = playerPlatformCollision(playerAABB, platform);
    if (collision.collides) {
      newX += collision.separation.x;
      newY += collision.separation.y;

      // If pushed up (landed on platform), ground the player
      if (collision.separation.y < 0) {
        velocityY = 0;
        isGrounded = true;
      }
      // If pushed down (hit head), stop upward velocity
      if (collision.separation.y > 0) {
        velocityY = Math.max(0, velocityY);
      }
      // If pushed horizontally, stop horizontal velocity
      if (collision.separation.x !== 0) {
        velocityX = 0;
      }
    }
  }

  return {
    ...player,
    position: { x: newX, y: newY },
    velocity: { x: velocityX, y: velocityY },
    isGrounded,
  };
}

// =============================================================================
// Player Collision Resolution
// =============================================================================

/**
 * Resolve collisions between all players using proper AABB collision.
 * Uses minimum translation vector (MTV) to push players apart along the
 * axis of least penetration. This allows:
 * - Standing on top of other players
 * - Solid horizontal blocking (no overlap/jitter)
 */
function resolvePlayerCollisions(
  players: Map<string, PlatformerPlayer>,
): Map<string, PlatformerPlayer> {
  const playerIds = Array.from(players.keys());
  const newPlayers = new Map(players);

  // Multiple iterations to resolve stacked collisions
  const iterations = 3;
  
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < playerIds.length; i++) {
      for (let j = i + 1; j < playerIds.length; j++) {
        const idA = playerIds[i] as string;
        const idB = playerIds[j] as string;

        const playerA = newPlayers.get(idA);
        const playerB = newPlayers.get(idB);

        if (!playerA || !playerB) continue;

        // Skip dead or respawning players
        if (!isPlayerAlive(playerA) || !isPlayerAlive(playerB)) {
          continue;
        }

        const aabbA = getPlayerAABB(playerA);
        const aabbB = getPlayerAABB(playerB);

        if (!aabbOverlap(aabbA, aabbB)) continue;

        // Calculate overlap on each axis
        const overlapX = Math.min(
          aabbA.x + aabbA.width - aabbB.x,
          aabbB.x + aabbB.width - aabbA.x,
        );
        const overlapY = Math.min(
          aabbA.y + aabbA.height - aabbB.y,
          aabbB.y + aabbB.height - aabbA.y,
        );

        // Resolve along axis of minimum penetration
        if (overlapX < overlapY) {
          // Horizontal collision - push apart equally
          const pushDir = playerA.position.x < playerB.position.x ? -1 : 1;
          const halfPush = overlapX / 2;

          newPlayers.set(idA, {
            ...playerA,
            position: {
              x: playerA.position.x + pushDir * halfPush,
              y: playerA.position.y,
            },
          });
          newPlayers.set(idB, {
            ...playerB,
            position: {
              x: playerB.position.x - pushDir * halfPush,
              y: playerB.position.y,
            },
          });
        } else {
          // Vertical collision - determine who's on top
          const aOnTop = playerA.position.y < playerB.position.y;
          const topPlayer = aOnTop ? playerA : playerB;
          const bottomPlayer = aOnTop ? playerB : playerA;
          const topId = aOnTop ? idA : idB;
          const bottomId = aOnTop ? idB : idA;

          // Push the top player up, bottom player stays (they're probably on floor)
          // Top player lands on bottom player's head
          const topAABB = getPlayerAABB(topPlayer);
          const bottomAABB = getPlayerAABB(bottomPlayer);
          const newTopY = bottomAABB.y - topAABB.height / 2 - PLAYER_HEIGHT / 2;

          newPlayers.set(topId, {
            ...topPlayer,
            position: { x: topPlayer.position.x, y: newTopY },
            velocity: { x: topPlayer.velocity.x, y: 0 },
            isGrounded: true, // Standing on another player counts as grounded
          });
          
          // Bottom player unchanged (or slightly pushed down if needed)
          newPlayers.set(bottomId, bottomPlayer);
        }
      }
    }
  }

  // Final pass: ensure no one is below the floor
  for (const [playerId, player] of newPlayers) {
    const maxY = DEFAULT_FLOOR_Y - PLAYER_HEIGHT / 2;
    if (player.position.y > maxY) {
      newPlayers.set(playerId, {
        ...player,
        position: { x: player.position.x, y: maxY },
        velocity: { x: player.velocity.x, y: 0 },
        isGrounded: true,
      });
    }
  }

  return newPlayers;
}

// =============================================================================
// Hazard Processing
// =============================================================================

/**
 * Process hazard damage for all players
 */
function processHazardDamage(
  players: Map<string, PlatformerPlayer>,
  hazards: Hazard[],
): Map<string, PlatformerPlayer> {
  if (hazards.length === 0) return players;

  const newPlayers = new Map<string, PlatformerPlayer>();

  for (const [playerId, player] of players) {
    if (!canPlayerTakeDamage(player)) {
      newPlayers.set(playerId, player);
      continue;
    }

    const playerAABB = getPlayerAABB(player);
    let totalDamage = 0;

    for (const hazard of hazards) {
      if (playerHazardCollision(playerAABB, hazard)) {
        totalDamage += hazard.damage;
      }
    }

    if (totalDamage > 0) {
      newPlayers.set(playerId, {
        ...player,
        health: clampHealth(player.health - totalDamage, player.maxHealth),
        // Hazard damage doesn't set lastHitBy (environmental death)
      });
    } else {
      newPlayers.set(playerId, player);
    }
  }

  return newPlayers;
}

// =============================================================================
// Projectile Simulation
// =============================================================================

/**
 * Check if a projectile collides with a player
 */
const projectileHitsPlayer = (
  projectile: Projectile,
  player: PlatformerPlayer,
): boolean => {
  // Simple circle-rectangle collision
  const playerAABB = getPlayerAABB(player);
  
  // Find closest point on rectangle to circle center
  const closestX = Math.max(playerAABB.x, Math.min(projectile.position.x, playerAABB.x + playerAABB.width));
  const closestY = Math.max(playerAABB.y, Math.min(projectile.position.y, playerAABB.y + playerAABB.height));
  
  // Calculate distance from closest point to circle center
  const dx = projectile.position.x - closestX;
  const dy = projectile.position.y - closestY;
  const distanceSquared = dx * dx + dy * dy;
  
  return distanceSquared <= PROJECTILE_RADIUS * PROJECTILE_RADIUS;
};

/**
 * Simulate all projectiles: move them, check collisions, remove expired ones
 */
function simulateProjectiles(
  projectiles: Projectile[],
  players: Map<string, PlatformerPlayer>,
  deltaSeconds: number,
): { projectiles: Projectile[]; players: Map<string, PlatformerPlayer> } {
  const newProjectiles: Projectile[] = [];
  let newPlayers = new Map(players);

  for (const projectile of projectiles) {
    // Move projectile
    const newPosition: Vector2 = {
      x: projectile.position.x + projectile.velocity.x * deltaSeconds,
      y: projectile.position.y + projectile.velocity.y * deltaSeconds,
    };

    // Decrement lifetime
    const newLifetime = projectile.lifetime - 1;

    // Check if projectile is expired
    if (newLifetime <= 0) {
      continue; // Remove projectile
    }

    // Check if projectile is out of bounds (simple bounds check)
    if (Math.abs(newPosition.x) > 1000 || Math.abs(newPosition.y) > 1000) {
      continue; // Remove projectile
    }

    // Check collision with floor
    if (newPosition.y >= DEFAULT_FLOOR_Y) {
      continue; // Remove projectile
    }

    // Check collision with players
    let hitPlayer = false;
    for (const [playerId, player] of newPlayers) {
      // Don't hit the owner
      if (playerId === projectile.ownerId) continue;
      
      // Don't hit players who can't take damage
      if (!canPlayerTakeDamage(player)) continue;

      // Check collision
      const projectileAtNewPos: Projectile = { ...projectile, position: newPosition };
      if (projectileHitsPlayer(projectileAtNewPos, player)) {
        // Apply damage
        const newHealth = clampHealth(player.health - projectile.damage, player.maxHealth);
        newPlayers.set(playerId, {
          ...player,
          health: newHealth,
          lastHitBy: projectile.ownerId,
        });
        hitPlayer = true;
        break; // Projectile is consumed
      }
    }

    if (!hitPlayer) {
      // Keep projectile alive
      newProjectiles.push({
        ...projectile,
        position: newPosition,
        lifetime: newLifetime,
      });
    }
  }

  return { projectiles: newProjectiles, players: newPlayers };
}

/**
 * Create a projectile from player input
 */
function createProjectileFromInput(
  ownerId: string,
  ownerPosition: Vector2,
  targetX: number,
  targetY: number,
  tick: number,
): Projectile | null {
  // Calculate direction to target
  const dx = targetX - ownerPosition.x;
  const dy = targetY - ownerPosition.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Prevent division by zero - need some minimum distance
  if (distance < 10) {
    return null;
  }

  // Normalize and apply speed
  const velocity: Vector2 = {
    x: (dx / distance) * PROJECTILE_SPEED,
    y: (dy / distance) * PROJECTILE_SPEED,
  };

  // Generate unique projectile ID
  const projectileId = `proj-${ownerId}-${tick}-${Math.random().toString(36).substring(2, 7)}`;

  return {
    id: projectileId,
    ownerId,
    position: { ...ownerPosition },
    velocity,
    damage: PROJECTILE_DAMAGE,
    lifetime: PROJECTILE_LIFETIME_TICKS,
  };
}

/**
 * Spawn a new projectile from a player toward a target
 */
export function spawnProjectile(
  world: PlatformerWorld,
  ownerId: string,
  targetX: number,
  targetY: number,
): { world: PlatformerWorld; projectileId: string } | null {
  const owner = world.players.get(ownerId);
  if (!owner || !isPlayerAlive(owner)) {
    return null;
  }

  const projectile = createProjectileFromInput(ownerId, owner.position, targetX, targetY, world.tick);
  if (!projectile) {
    return null;
  }

  return {
    world: {
      ...world,
      projectiles: [...world.projectiles, projectile],
    },
    projectileId: projectile.id,
  };
}

// =============================================================================
// Respawn Processing
// =============================================================================

/**
 * Get a random spawn point
 */
const getRandomSpawnPoint = (spawnPoints: SpawnPoint[]): Vector2 => {
  if (spawnPoints.length === 0) {
    return { x: 0, y: DEFAULT_FLOOR_Y - PLAYER_HEIGHT / 2 };
  }
  const index = Math.floor(Math.random() * spawnPoints.length);
  const spawnPoint = spawnPoints[index];
  return spawnPoint ? spawnPoint.position : { x: 0, y: DEFAULT_FLOOR_Y - PLAYER_HEIGHT / 2 };
};

/**
 * Process respawn timers and handle deaths
 */
function processRespawns(
  players: Map<string, PlatformerPlayer>,
  spawnPoints: SpawnPoint[],
): Map<string, PlatformerPlayer> {
  const newPlayers = new Map<string, PlatformerPlayer>();

  for (const [playerId, player] of players) {
    // Player just died - start respawn timer
    if (player.health <= 0 && player.respawnTimer === null) {
      // Attribute kill to lastHitBy player
      const killerId = player.lastHitBy;
      if (killerId) {
        const killer = players.get(killerId);
        if (killer) {
          // We'll update the killer's kills in a second pass
        }
      }

      newPlayers.set(playerId, {
        ...player,
        respawnTimer: RESPAWN_TIMER_TICKS,
        deaths: player.deaths + 1,
      });
      continue;
    }

    // Player is respawning - decrement timer
    if (player.respawnTimer !== null) {
      const newTimer = player.respawnTimer - 1;

      if (newTimer <= 0) {
        // Respawn complete - reset player
        const spawnPos = getRandomSpawnPoint(spawnPoints);
        newPlayers.set(playerId, {
          ...player,
          position: spawnPos,
          velocity: { x: 0, y: 0 },
          health: DEFAULT_MAX_HEALTH,
          respawnTimer: null,
          lastHitBy: null,
          isGrounded: false,
        });
      } else {
        newPlayers.set(playerId, {
          ...player,
          respawnTimer: newTimer,
        });
      }
      continue;
    }

    newPlayers.set(playerId, player);
  }

  // Second pass: attribute kills
  const playersToUpdate = new Map(newPlayers);
  for (const [_playerId, player] of players) {
    if (player.health <= 0 && player.respawnTimer === null && player.lastHitBy) {
      const killer = playersToUpdate.get(player.lastHitBy);
      if (killer) {
        playersToUpdate.set(player.lastHitBy, {
          ...killer,
          kills: killer.kills + 1,
        });
      }
    }
  }

  return playersToUpdate;
}

// =============================================================================
// Game State Management
// =============================================================================

/**
 * Update game state based on current conditions
 */
function updateGameState(world: PlatformerWorld): PlatformerWorld {
  switch (world.gameState) {
    case "lobby":
      return updateLobbyState(world);
    case "countdown":
      return updateCountdownState(world);
    case "playing":
      return world; // Playing state is handled by win condition checks
    case "gameover":
      return world; // Game over - no more updates
    default:
      return world;
  }
}

/**
 * Update lobby state - check if enough players to start
 */
function updateLobbyState(world: PlatformerWorld): PlatformerWorld {
  if (world.players.size >= MIN_PLAYERS_TO_START) {
    return {
      ...world,
      gameState: "countdown",
      countdownTicks: COUNTDOWN_DURATION_TICKS,
    };
  }
  return world;
}

/**
 * Update countdown state - decrement timer and start game
 */
function updateCountdownState(world: PlatformerWorld): PlatformerWorld {
  if (world.countdownTicks === null) {
    return {
      ...world,
      gameState: "playing",
      matchStartTick: world.tick,
    };
  }

  const newCountdown = world.countdownTicks - 1;

  if (newCountdown <= 0) {
    return {
      ...world,
      gameState: "playing",
      countdownTicks: null,
      matchStartTick: world.tick,
    };
  }

  return {
    ...world,
    countdownTicks: newCountdown,
  };
}

// =============================================================================
// Win Condition Checking
// =============================================================================

/**
 * Check win conditions and update game state if a winner is found
 */
function checkWinConditions(world: PlatformerWorld): PlatformerWorld {
  if (world.gameState !== "playing") {
    return world;
  }

  const { winCondition, killTarget, timeLimitMs } = world.matchConfig;

  switch (winCondition) {
    case "last_standing":
      return checkLastStandingWin(world);
    case "first_to_x":
      return checkFirstToXWin(world, killTarget ?? 10);
    case "most_kills":
      return checkMostKillsWin(world, timeLimitMs ?? 120000);
    default:
      return world;
  }
}

/**
 * Check last standing win condition
 */
function checkLastStandingWin(world: PlatformerWorld): PlatformerWorld {
  const alivePlayers = Array.from(world.players.values()).filter(isPlayerAlive);

  // Need at least 2 players to have a winner
  if (world.players.size < 2) {
    return world;
  }

  // If only one player is alive, they win
  if (alivePlayers.length === 1 && alivePlayers[0]) {
    return {
      ...world,
      gameState: "gameover",
      winner: alivePlayers[0].id,
    };
  }

  // If no players are alive, it's a draw (no winner)
  if (alivePlayers.length === 0) {
    return {
      ...world,
      gameState: "gameover",
      winner: null,
    };
  }

  return world;
}

/**
 * Check first to X kills win condition
 */
function checkFirstToXWin(world: PlatformerWorld, killTarget: number): PlatformerWorld {
  const winner = hasPlayerReachedKillTarget(world, killTarget);

  if (winner) {
    return {
      ...world,
      gameState: "gameover",
      winner: winner.id,
    };
  }

  return world;
}

/**
 * Check most kills within time limit win condition
 */
function checkMostKillsWin(world: PlatformerWorld, timeLimitMs: number): PlatformerWorld {
  if (world.matchStartTick === null) {
    return world;
  }

  // Convert time limit to ticks (assuming 50ms per tick)
  const timeLimitTicks = Math.floor(timeLimitMs / 50);
  const elapsedTicks = world.tick - world.matchStartTick;

  if (elapsedTicks >= timeLimitTicks) {
    const winner = getPlayerWithMostKills(world);
    return {
      ...world,
      gameState: "gameover",
      winner: winner?.id ?? null,
    };
  }

  return world;
}

// =============================================================================
// World Management Functions
// =============================================================================

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

/**
 * Start the game (transition from lobby to countdown)
 */
export function startGame(world: PlatformerWorld): PlatformerWorld {
  if (world.gameState !== "lobby") {
    return world;
  }
  return {
    ...world,
    gameState: "countdown",
    countdownTicks: COUNTDOWN_DURATION_TICKS,
  };
}

/**
 * Force start the game immediately (skip countdown)
 */
export function forceStartGame(world: PlatformerWorld): PlatformerWorld {
  return {
    ...world,
    gameState: "playing",
    countdownTicks: null,
    matchStartTick: world.tick,
  };
}

/**
 * Reset the game to lobby state
 */
export function resetGame(world: PlatformerWorld): PlatformerWorld {
  // Reset all players
  const newPlayers = new Map<string, PlatformerPlayer>();
  for (const [playerId, player] of world.players) {
    newPlayers.set(playerId, {
      ...createPlatformerPlayer(playerId, player.position),
    });
  }

  return {
    ...world,
    players: newPlayers,
    gameState: "lobby",
    winner: null,
    countdownTicks: null,
    matchStartTick: null,
  };
}

/**
 * Apply damage to a player (used by action validator)
 */
export function applyDamage(
  world: PlatformerWorld,
  targetId: string,
  damage: number,
  attackerId: string,
): PlatformerWorld {
  const target = world.players.get(targetId);
  if (!target || !canPlayerTakeDamage(target)) {
    return world;
  }

  const newHealth = clampHealth(target.health - damage, target.maxHealth);
  const newPlayers = new Map(world.players);

  newPlayers.set(targetId, {
    ...target,
    health: newHealth,
    lastHitBy: attackerId,
  });

  return {
    ...world,
    players: newPlayers,
  };
}

/**
 * Apply knockback to a player
 */
export function applyKnockback(
  world: PlatformerWorld,
  targetId: string,
  direction: Vector2,
  force: number,
): PlatformerWorld {
  const target = world.players.get(targetId);
  if (!target) {
    return world;
  }

  // Normalize direction and apply force
  const magnitude = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
  const normalizedX = magnitude > 0 ? direction.x / magnitude : 0;
  const normalizedY = magnitude > 0 ? direction.y / magnitude : -1; // Default up if no direction

  const newPlayers = new Map(world.players);
  newPlayers.set(targetId, {
    ...target,
    velocity: {
      x: target.velocity.x + normalizedX * force,
      y: target.velocity.y + normalizedY * force,
    },
    isGrounded: false,
  });

  return {
    ...world,
    players: newPlayers,
  };
}

/**
 * Set the level configuration
 */
export function setLevelConfig(
  world: PlatformerWorld,
  platforms: Platform[],
  spawnPoints: SpawnPoint[],
  hazards: Hazard[],
): PlatformerWorld {
  return {
    ...world,
    platforms,
    spawnPoints,
    hazards,
  };
}
