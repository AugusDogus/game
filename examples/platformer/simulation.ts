/**
 * Platformer game simulation logic
 *
 * Coordinate System: Y-UP
 * - Positive Y points upward
 * - Floor is at y=0 (DEFAULT_FLOOR_Y)
 * - Jumping increases Y, falling decreases Y
 * - Gravity is negative (pulls down)
 *
 * Collision Detection:
 * - Uses @game/physics2d for platform/floor collision (raycast-based)
 * - Player-player collision uses AABB (dynamic objects)
 */

import {
    DEFAULT_FLOOR_Y,
} from "@game/netcode";
import type { InputMerger, SimulateFunction } from "@game/netcode";
import { CharacterController, vec2 } from "@game/physics2d";
import type { Collider } from "@game/physics2d";
import type {
    Hazard,
    LevelConfig,
    Platform,
    PlatformerInput,
    PlatformerPlayer,
    PlatformerWorld,
    Projectile,
    SpawnPoint,
    Vector2,
} from "./types.js";
import {
    canPlayerTakeDamage,
    clampHealth,
    createIdleInput,
    createPlatformerPlayer,
    DEFAULT_MAX_HEALTH,
    getPlayerWithMostKills,
    hasPlayerReachedKillTarget,
    isPlayerAlive,
    PLAYER_HEIGHT,
    PLAYER_WIDTH,
    PROJECTILE_DAMAGE,
    PROJECTILE_LIFETIME_TICKS,
    PROJECTILE_RADIUS,
    PROJECTILE_SPEED,
    RESPAWN_TIMER_TICKS,
} from "./types.js";
import {
    updatePlayerMovement,
    derivePhysics,
    DEFAULT_PLAYER_CONFIG,
    type PlayerMovementState,
} from "./player.js";

// =============================================================================
// Derived Physics (computed once at module load)
// =============================================================================

/**
 * Physics values derived from player config.
 * Calculated once to ensure consistency across all simulation calls.
 */
const derivedPhysics = derivePhysics(DEFAULT_PLAYER_CONFIG);

// =============================================================================
// Constants
// =============================================================================

/** Countdown duration in ticks (3 seconds at 20Hz) */
const COUNTDOWN_DURATION_TICKS = 60;

/** Minimum players required to start a match */
const MIN_PLAYERS_TO_START = 2;

// =============================================================================
// Level Colliders
// =============================================================================

/** Cached collider arrays by level ID */
const colliderCache = new Map<string, Collider[]>();

/**
 * Get or create a collider array for a level.
 *
 * The colliders are cached by level ID for efficiency.
 * Static geometry (platforms, floor) is converted to colliders.
 *
 * @param level The level configuration
 * @returns Array of colliders for this level
 */
function getLevelColliders(level: LevelConfig): Collider[] {
  // Check cache
  const cached = colliderCache.get(level.id);
  if (cached) {
    return cached;
  }

  const colliders: Collider[] = [];

  // Add platforms as colliders
  for (const platform of level.platforms) {
    // Platform position is bottom-left corner, collider needs center
    const centerX = platform.position.x + platform.width / 2;
    const centerY = platform.position.y + platform.height / 2;
    const halfWidth = platform.width / 2;
    const halfHeight = platform.height / 2;

    colliders.push({
      position: vec2(centerX, centerY),
      halfExtents: vec2(halfWidth, halfHeight),
      tag: platform.id,
    });
  }

  // Add floor as a large collider at y=DEFAULT_FLOOR_Y
  // Floor spans a large width and extends below the floor level
  const floorThickness = 100;
  colliders.push({
    position: vec2(0, DEFAULT_FLOOR_Y - floorThickness / 2), // Center below floor surface
    halfExtents: vec2(10000, floorThickness / 2), // Very wide, half-thickness
    tag: "floor",
  });

  // Cache the colliders
  colliderCache.set(level.id, colliders);

  return colliders;
}

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
 *
 * Y-UP coordinate system:
 * - Top of AABB = y + height (higher Y)
 * - Bottom of AABB = y (lower Y)
 */
const calculateSeparation = (a: AABB, b: AABB): Vector2 => {
  const overlapLeft = a.x + a.width - b.x;
  const overlapRight = b.x + b.width - a.x;
  // In Y-up: "top" means higher Y, "bottom" means lower Y
  const overlapTop = a.y + a.height - b.y; // a's top overlaps into b's bottom
  const overlapBottom = b.y + b.height - a.y; // b's top overlaps into a's bottom

  const minOverlapX = overlapLeft < overlapRight ? -overlapLeft : overlapRight;
  // Positive Y pushes up, negative Y pushes down
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

  // Step 1: Check which players are supported (standing on floor or another player)
  // This must happen BEFORE physics so we don't apply gravity to supported players
  const supportedPlayers = new Set<string>();
  for (const [playerId, player] of worldAfterStateUpdate.players) {
    if (isPlayerSupported(player, worldAfterStateUpdate.players, playerId)) {
      supportedPlayers.add(playerId);
    }
  }

  // Step 2: Simulate physics for each player
  // We pass all OTHER players so we can check for collisions during movement
  let newPlayers = new Map<string, PlatformerPlayer>();
  for (const [playerId, player] of worldAfterStateUpdate.players) {
    const isSupported = supportedPlayers.has(playerId);
    const input = simulateAll ? createIdleInput() : (inputs.get(playerId) ?? null);
    
    // Get other players for collision checking during movement
    const otherPlayers = new Map(worldAfterStateUpdate.players);
    otherPlayers.delete(playerId);
    
    if (input) {
      const newPlayer = simulatePlayerWithSupport(
        player,
        input,
        deltaSeconds,
        worldAfterStateUpdate,
        isSupported,
        otherPlayers,
      );
      newPlayers.set(playerId, newPlayer);
    } else {
      newPlayers.set(playerId, player);
    }
  }

  // Step 3: Handle player-player collisions (resolve any new overlaps from movement)
  // We pass the original positions so we can detect if a player was pushed back
  // and prevent them from moving into the collision again
  newPlayers = resolvePlayerCollisions(newPlayers);

  // Step 4: Handle hazard damage
  newPlayers = processHazardDamage(newPlayers, worldAfterStateUpdate.hazards);

  // Step 5: Process shooting inputs and spawn projectiles
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
          player.projectileSeq,
        );
        if (projectile) {
          newProjectiles.push(projectile);
          // Increment the player's projectile sequence counter
          newPlayers.set(playerId, {
            ...player,
            projectileSeq: player.projectileSeq + 1,
          });
        }
      }
    }
  }

  // Step 6: Simulate projectiles and handle projectile-player collisions
  const projectileResult = simulateProjectiles(
    newProjectiles,
    newPlayers,
    deltaSeconds,
  );
  newPlayers = projectileResult.players;
  newProjectiles = projectileResult.projectiles;

  // Step 7: Process respawn timers and deaths
  newPlayers = processRespawns(newPlayers, worldAfterStateUpdate.spawnPoints, worldAfterStateUpdate.tick);

  // Step 8: Check win conditions
  const worldWithPlayers: PlatformerWorld = {
    ...worldAfterStateUpdate,
    players: newPlayers,
    projectiles: newProjectiles,
    tick: worldAfterStateUpdate.tick + 1,
  };

  return checkWinConditions(worldWithPlayers);
};

/**
 * Simulate a single player with platformer physics.
 *
 * Uses Sebastian Lague's movement system from player.ts for:
 * - Variable jump height (tap vs hold)
 * - Movement smoothing (acceleration/deceleration)
 * - Wall sliding and wall jumping
 *
 * Uses @game/physics2d CharacterController for platform/floor collision detection.
 * Uses AABB for player-player collision (dynamic objects).
 *
 * @param player - The player to simulate
 * @param input - Player input for this frame
 * @param deltaSeconds - Time step in seconds
 * @param world - The game world (for physics world lookup)
 * @param isSupported - Whether player is standing on another player
 * @param otherPlayers - Other players for collision checking
 */
function simulatePlayerWithSupport(
  player: PlatformerPlayer,
  input: PlatformerInput,
  deltaSeconds: number,
  world: PlatformerWorld,
  isSupported: boolean,
  otherPlayers: Map<string, PlatformerPlayer>,
): PlatformerPlayer {
  // If player is respawning, they can't act - just decrement timer
  if (player.respawnTimer !== null) {
    return player; // Respawn timer is handled in processRespawns
  }

  // If player is dead, don't simulate
  if (player.health <= 0) {
    return player;
  }

  // --- Get colliders for this level ---
  const colliders = getLevelColliders({
    id: world.levelId,
    name: world.levelId,
    platforms: world.platforms,
    spawnPoints: world.spawnPoints,
    hazards: world.hazards,
  });

  // --- Create CharacterController for this frame ---
  const controller = new CharacterController(colliders, {
    position: vec2(player.position.x, player.position.y),
    halfSize: vec2(PLAYER_WIDTH / 2, PLAYER_HEIGHT / 2),
  });

  // Store previous frame's grounded state for jump/acceleration logic
  // Sebastian's code uses a persistent controller where collisions carry over,
  // but we create a new controller each frame, so we pass this separately.
  const wasGrounded = player.isGrounded || isSupported;
  // Only consider player on wall if they were NOT grounded
  // This prevents wall jump from triggering when player lands on ground near a wall
  const wasOnWallLeft = !wasGrounded && player.wallDirX === -1;
  const wasOnWallRight = !wasGrounded && player.wallDirX === 1;


  // --- Build movement state from player ---
  const movementState: PlayerMovementState = {
    velocity: { ...player.velocity },
    velocityXSmoothing: player.velocityXSmoothing,
    wallSliding: player.wallSliding,
    wallDirX: player.wallDirX,
    timeToWallUnstick: player.timeToWallUnstick,
    jumpWasPressedLastFrame: player.jumpWasPressedLastFrame,
    jumpHeld: input.jump,
  };

  // --- Run player movement (handles gravity, jump, wall mechanics) ---
  // This now matches Sebastian Lague's Player.cs structure exactly
  const newState = updatePlayerMovement(
    controller,
    movementState,
    input,
    DEFAULT_PLAYER_CONFIG,
    derivedPhysics,
    deltaSeconds,
    {
      below: wasGrounded,
      left: wasOnWallLeft,
      right: wasOnWallRight,
    },
  );

  // --- Extract position from controller ---
  let newX = controller.position.x;
  let newY = controller.position.y;
  let velocityX = newState.velocity.x;
  let velocityY = newState.velocity.y;
  // Player is grounded if touching ground (from NEW collision state after move)
  // Note: isSupported was for jump INPUT, not for the output grounded state
  let isGrounded = controller.collisions.below;

  // If supported by another player, snap to their top
  if (isSupported && !newState.jumpWasPressedLastFrame) {
    for (const [, other] of otherPlayers) {
      if (!isPlayerAlive(other)) continue;
      const aBottom = newY - PLAYER_HEIGHT / 2;
      const bTop = other.position.y + PLAYER_HEIGHT / 2;
      const aLeft = newX - PLAYER_WIDTH / 2;
      const aRight = newX + PLAYER_WIDTH / 2;
      const bLeft = other.position.x - PLAYER_WIDTH / 2;
      const bRight = other.position.x + PLAYER_WIDTH / 2;
      const horizontalOverlap = aLeft < bRight && aRight > bLeft;
      // If we're within snapping distance and horizontally overlapping, snap to top
      if (horizontalOverlap && Math.abs(aBottom - bTop) < 2) {
        newY = other.position.y + PLAYER_HEIGHT;
        velocityY = 0;
        isGrounded = true;
        break;
      }
    }
  }

  // --- Player-player collision (AABB) ---
  // Physics engine handles static geometry, but players are dynamic
  // so we use AABB for player-player collision

  let playerAABB = getPlayerAABB({
    ...player,
    position: { x: newX, y: newY },
  });

  for (const [, other] of otherPlayers) {
    if (!isPlayerAlive(other)) continue;

    const otherAABB = getPlayerAABB(other);
    // Use >= for collision check to catch players that are exactly touching
    const touching = 
      playerAABB.x <= otherAABB.x + otherAABB.width &&
      playerAABB.x + playerAABB.width >= otherAABB.x &&
      playerAABB.y <= otherAABB.y + otherAABB.height &&
      playerAABB.y + playerAABB.height >= otherAABB.y;
    
    if (!touching) continue;

    // Calculate overlap on each axis
    const overlapX = Math.min(
      playerAABB.x + playerAABB.width - otherAABB.x,
      otherAABB.x + otherAABB.width - playerAABB.x,
    );
    const overlapY = Math.min(
      playerAABB.y + playerAABB.height - otherAABB.y,
      otherAABB.y + otherAABB.height - playerAABB.y,
    );

    if (overlapX < overlapY) {
      // Horizontal collision - push this player back
      const pushDir = newX < other.position.x ? -1 : 1;
      newX += pushDir * (overlapX + 0.1);
      velocityX = 0;
    } else {
      // Vertical collision (Y-up: higher Y = on top)
      if (newY > other.position.y) {
        // This player is on top - land on the other player
        newY = other.position.y + PLAYER_HEIGHT;
        velocityY = 0;
        isGrounded = true;
      } else {
        // This player is below - get pushed down
        newY = other.position.y - PLAYER_HEIGHT;
        velocityY = Math.min(0, velocityY);
      }
    }

    // Update AABB for next collision check
    playerAABB = getPlayerAABB({
      ...player,
      position: { x: newX, y: newY },
    });
  }

  return {
    ...player,
    position: { x: newX, y: newY },
    velocity: { x: velocityX, y: velocityY },
    isGrounded,
    // Update movement state fields
    velocityXSmoothing: newState.velocityXSmoothing,
    wallSliding: newState.wallSliding,
    wallDirX: newState.wallDirX,
    timeToWallUnstick: newState.timeToWallUnstick,
    jumpWasPressedLastFrame: newState.jumpWasPressedLastFrame,
  };
}

// =============================================================================
// Player Collision Resolution
// =============================================================================

/**
 * Check if player A is standing on player B (A's bottom touches B's top)
 * Y-up: bottom = y - halfHeight, top = y + halfHeight
 */
function isStandingOn(playerA: PlatformerPlayer, playerB: PlatformerPlayer): boolean {
  const aBottom = playerA.position.y - PLAYER_HEIGHT / 2;
  const bTop = playerB.position.y + PLAYER_HEIGHT / 2;
  
  // Check vertical alignment (A's bottom near B's top)
  const verticallyAligned = Math.abs(aBottom - bTop) < 2;
  
  // Check horizontal overlap
  const aLeft = playerA.position.x - PLAYER_WIDTH / 2;
  const aRight = playerA.position.x + PLAYER_WIDTH / 2;
  const bLeft = playerB.position.x - PLAYER_WIDTH / 2;
  const bRight = playerB.position.x + PLAYER_WIDTH / 2;
  const horizontalOverlap = aLeft < bRight && aRight > bLeft;
  
  return verticallyAligned && horizontalOverlap;
}

/**
 * Check if a player is supported (standing on floor or another player)
 * Y-up: floor at y=0, player bottom = y - halfHeight
 */
function isPlayerSupported(
  player: PlatformerPlayer,
  allPlayers: Map<string, PlatformerPlayer>,
  playerId: string,
): boolean {
  // Check floor (Y-up: bottom of player should be at or below floor level)
  const playerBottom = player.position.y - PLAYER_HEIGHT / 2;
  if (playerBottom <= DEFAULT_FLOOR_Y + 1) {
    return true;
  }
  
  // Check other players
  for (const [otherId, other] of allPlayers) {
    if (otherId === playerId) continue;
    if (!isPlayerAlive(other)) continue;
    if (isStandingOn(player, other)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Resolve collisions between all players using proper AABB collision.
 * - Horizontal collisions: push players apart equally
 * - Vertical collisions: top player lands on bottom player
 */
function resolvePlayerCollisions(
  players: Map<string, PlatformerPlayer>,
): Map<string, PlatformerPlayer> {
  const playerIds = Array.from(players.keys());
  const newPlayers = new Map(players);

  // Resolve collisions
  for (let i = 0; i < playerIds.length; i++) {
    for (let j = i + 1; j < playerIds.length; j++) {
      const idA = playerIds[i] as string;
      const idB = playerIds[j] as string;

      const playerA = newPlayers.get(idA);
      const playerB = newPlayers.get(idB);

      if (!playerA || !playerB) continue;
      if (!isPlayerAlive(playerA) || !isPlayerAlive(playerB)) continue;

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

      if (overlapX < overlapY) {
        // Horizontal collision - push apart equally and stop horizontal velocity
        const pushDir = playerA.position.x < playerB.position.x ? -1 : 1;
        const halfPush = overlapX / 2 + 0.1; // Tiny buffer for floating point precision

        // Stop horizontal velocity for both players to prevent jitter
        // (they can't move through each other)
        newPlayers.set(idA, {
          ...playerA,
          position: {
            x: playerA.position.x + pushDir * halfPush,
            y: playerA.position.y,
          },
          velocity: { x: 0, y: playerA.velocity.y },
        });
        newPlayers.set(idB, {
          ...playerB,
          position: {
            x: playerB.position.x - pushDir * halfPush,
            y: playerB.position.y,
          },
          velocity: { x: 0, y: playerB.velocity.y },
        });
      } else {
        // Vertical collision - top player lands on bottom player
        // Y-up: higher Y = on top
        const aOnTop = playerA.position.y > playerB.position.y;
        const topId = aOnTop ? idA : idB;
        const bottomId = aOnTop ? idB : idA;
        const topPlayer = newPlayers.get(topId) as PlatformerPlayer;
        const bottomPlayer = newPlayers.get(bottomId) as PlatformerPlayer;

        // Position top player exactly on bottom player's head
        const newTopY = bottomPlayer.position.y + PLAYER_HEIGHT;

        newPlayers.set(topId, {
          ...topPlayer,
          position: { x: topPlayer.position.x, y: newTopY },
          velocity: { x: topPlayer.velocity.x, y: 0 },
          isGrounded: true,
        });
      }
    }
  }

  // Final pass: clamp to floor (Y-up: floor at y=0, player center must be >= halfHeight)
  for (const [playerId, player] of newPlayers) {
    const minY = DEFAULT_FLOOR_Y + PLAYER_HEIGHT / 2;
    if (player.position.y < minY) {
      newPlayers.set(playerId, {
        ...player,
        position: { x: player.position.x, y: minY },
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

    // Check collision with floor (Y-up: floor at y=0)
    if (newPosition.y <= DEFAULT_FLOOR_Y) {
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
 * Create a projectile from player input.
 * Uses a deterministic ID based on ownerId, tick, and sequence number.
 */
function createProjectileFromInput(
  ownerId: string,
  ownerPosition: Vector2,
  targetX: number,
  targetY: number,
  tick: number,
  projectileSeq: number,
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

  // Generate deterministic projectile ID from ownerId, tick, and sequence
  const projectileId = `proj-${ownerId}-${tick}-${projectileSeq}`;

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

  const projectile = createProjectileFromInput(
    ownerId,
    owner.position,
    targetX,
    targetY,
    world.tick,
    owner.projectileSeq,
  );
  if (!projectile) {
    return null;
  }

  // Update the player's projectile sequence counter
  const updatedPlayers = new Map(world.players);
  updatedPlayers.set(ownerId, {
    ...owner,
    projectileSeq: owner.projectileSeq + 1,
  });

  return {
    world: {
      ...world,
      players: updatedPlayers,
      projectiles: [...world.projectiles, projectile],
    },
    projectileId: projectile.id,
  };
}

// =============================================================================
// Respawn Processing
// =============================================================================

/**
 * Get a deterministic spawn point based on a seed value.
 * Uses the seed to select a spawn point index, ensuring client and server
 * derive the same spawn point for the same seed.
 */
const getDeterministicSpawnPoint = (spawnPoints: SpawnPoint[], seed: number): Vector2 => {
  if (spawnPoints.length === 0) {
    // Y-up: spawn player with center at halfHeight above floor
    return { x: 0, y: DEFAULT_FLOOR_Y + PLAYER_HEIGHT / 2 };
  }
  // Use absolute value and modulo to get a deterministic index
  const index = Math.abs(seed) % spawnPoints.length;
  const spawnPoint = spawnPoints[index];
  return spawnPoint ? spawnPoint.position : { x: 0, y: DEFAULT_FLOOR_Y + PLAYER_HEIGHT / 2 };
};

/**
 * Simple hash function to combine playerId string with tick for deterministic spawn selection.
 * Returns a positive integer suitable for modulo operations.
 */
function hashPlayerIdWithTick(playerId: string, tick: number): number {
  let hash = tick;
  for (let i = 0; i < playerId.length; i++) {
    hash = ((hash << 5) - hash + playerId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Process respawn timers and handle deaths
 */
function processRespawns(
  players: Map<string, PlatformerPlayer>,
  spawnPoints: SpawnPoint[],
  tick: number,
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
        // Respawn complete - reset player using deterministic spawn selection
        // Seed is derived from playerId and tick to ensure client/server sync
        const spawnSeed = hashPlayerIdWithTick(playerId, tick);
        const spawnPos = getDeterministicSpawnPoint(spawnPoints, spawnSeed);
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
 * Add a player to the world.
 * If no position is provided, picks a spawn point from the world's spawn points.
 */
export function addPlayerToWorld(
  world: PlatformerWorld,
  playerId: string,
  position?: { x: number; y: number },
): PlatformerWorld {
  // If no position provided, use a spawn point from the world
  const spawnPosition = position ?? getDeterministicSpawnPoint(
    world.spawnPoints,
    hashPlayerIdWithTick(playerId, world.tick)
  );
  
  const newPlayers = new Map(world.players);
  newPlayers.set(playerId, createPlatformerPlayer(playerId, spawnPosition));
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
  const normalizedY = magnitude > 0 ? direction.y / magnitude : 1; // Default up if no direction (Y-up: positive = up)

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
  levelId: string,
  platforms: Platform[],
  spawnPoints: SpawnPoint[],
  hazards: Hazard[],
): PlatformerWorld {
  return {
    ...world,
    levelId,
    platforms,
    spawnPoints,
    hazards,
  };
}
