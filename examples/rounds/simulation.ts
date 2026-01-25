/**
 * ROUNDS game simulation
 *
 * Handles the complete game loop:
 * - Waiting for players
 * - Round countdown
 * - Fighting (physics, combat)
 * - Round end transition
 * - Card pick phase
 * - Match completion
 */

import { DEFAULT_FLOOR_Y } from "@game/netcode";
import type { InputMerger, SimulateFunction } from "@game/netcode";
import { CharacterController, vec2 } from "@game/physics2d";
import type { Collider } from "@game/physics2d";
import {
  updatePlayerMovement,
  derivePhysics,
  DEFAULT_PLAYER_CONFIG,
  type PlayerMovementState,
} from "@game/platformer";

import { generateCardOptions, computePlayerStats, getCard } from "./cards.js";
import type {
  RoundsInput,
  RoundsPlayer,
  RoundsWorld,
  Projectile,
  LevelConfig,
  SpawnPoint,
  GamePhase,
  CardPickState,
} from "./types.js";
import {
  createIdleInput,
  createRoundsPlayer,
  isPlayerAlive,
  canPlayerTakeDamage,
  clampHealth,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  ROUND_COUNTDOWN_TICKS,
  ROUND_END_DELAY_TICKS,
  ROUNDS_TO_WIN,
  PROJECTILE_BASE_SPEED,
  PROJECTILE_BASE_DAMAGE,
  PROJECTILE_BASE_SIZE,
  PROJECTILE_LIFETIME_TICKS,
  DEFAULT_PLAYER_STATS,
} from "./types.js";

// =============================================================================
// Physics Setup
// =============================================================================

const derivedPhysics = derivePhysics(DEFAULT_PLAYER_CONFIG);

/** Cached colliders by level ID */
const colliderCache = new Map<string, Collider[]>();

function getLevelColliders(level: LevelConfig): Collider[] {
  const cached = colliderCache.get(level.id);
  if (cached) return cached;

  const colliders: Collider[] = [];

  for (const platform of level.platforms) {
    const centerX = platform.position.x + platform.width / 2;
    const centerY = platform.position.y + platform.height / 2;
    colliders.push({
      position: vec2(centerX, centerY),
      halfExtents: vec2(platform.width / 2, platform.height / 2),
      tag: platform.id,
    });
  }

  // Floor
  const floorThickness = 100;
  colliders.push({
    position: vec2(0, DEFAULT_FLOOR_Y - floorThickness / 2),
    halfExtents: vec2(level.bounds.width, floorThickness / 2),
    tag: "floor",
  });

  colliderCache.set(level.id, colliders);
  return colliders;
}

// =============================================================================
// AABB Collision
// =============================================================================

interface AABB {
  x: number;
  y: number;
  width: number;
  height: number;
}

const getPlayerAABB = (player: RoundsPlayer): AABB => ({
  x: player.position.x - PLAYER_WIDTH / 2,
  y: player.position.y - PLAYER_HEIGHT / 2,
  width: PLAYER_WIDTH,
  height: PLAYER_HEIGHT,
});

const aabbOverlap = (a: AABB, b: AABB): boolean =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

// =============================================================================
// Input Merging
// =============================================================================

export const mergeRoundsInputs: InputMerger<RoundsInput> = (
  inputs: RoundsInput[],
): RoundsInput => {
  if (inputs.length === 0) return createIdleInput();

  const lastInput = inputs.at(-1) as RoundsInput;
  const anyJump = inputs.some((i) => i.jump);
  const anyShoot = inputs.some((i) => i.shoot);
  const anyDash = inputs.some((i) => i.dash);
  // Card select: use first non-zero selection
  const cardSelect = inputs.find((i) => i.cardSelect !== 0)?.cardSelect ?? 0;

  return {
    ...lastInput,
    jump: anyJump,
    shoot: anyShoot,
    dash: anyDash,
    cardSelect,
  };
};

// =============================================================================
// Main Simulation
// =============================================================================

/**
 * Simulate one tick of the ROUNDS world.
 * This is the whole-world simulation function used by the netcode engine.
 *
 * Behavior:
 * - If inputs map is EMPTY: Apply idle physics to ALL players (legacy behavior)
 * - If inputs map has entries: ONLY simulate players in the map, leave others unchanged
 *
 * This is crucial for multi-client scenarios where each client's inputs
 * are processed separately with their own deltas.
 */
export const simulateRounds: SimulateFunction<RoundsWorld, RoundsInput> = (
  world: RoundsWorld,
  inputs: Map<string, RoundsInput>,
  deltaTime: number,
): RoundsWorld => {
  // Phase-specific updates
  switch (world.phase) {
    case "waiting":
      return updateWaitingPhase(world);
    case "countdown":
      return updateCountdownPhase(world);
    case "fighting":
      return updateFightingPhase(world, inputs, deltaTime);
    case "round_end":
      return updateRoundEndPhase(world);
    case "card_pick":
      return updateCardPickPhase(world, inputs);
    case "match_over":
      return { ...world, tick: world.tick + 1 };
    default:
      return { ...world, tick: world.tick + 1 };
  }
};

// =============================================================================
// Phase Updates
// =============================================================================

function updateWaitingPhase(world: RoundsWorld): RoundsWorld {
  // Start when we have 2 players
  if (world.players.size >= 2) {
    return {
      ...world,
      phase: "countdown",
      countdownTicks: ROUND_COUNTDOWN_TICKS,
      roundNumber: 1,
      tick: world.tick + 1,
    };
  }
  return { ...world, tick: world.tick + 1 };
}

function updateCountdownPhase(world: RoundsWorld): RoundsWorld {
  if (world.countdownTicks === null) {
    return startFighting(world);
  }

  const newCountdown = world.countdownTicks - 1;
  if (newCountdown <= 0) {
    return startFighting(world);
  }

  return {
    ...world,
    countdownTicks: newCountdown,
    tick: world.tick + 1,
  };
}

function startFighting(world: RoundsWorld): RoundsWorld {
  // Reset players to spawn points and full health
  const newPlayers = new Map<string, RoundsPlayer>();
  const playerIds = Array.from(world.players.keys());

  for (let i = 0; i < playerIds.length; i++) {
    const playerId = playerIds[i] as string;
    const player = world.players.get(playerId);
    if (!player) continue;

    const spawn = getSpawnPoint(world.level.spawnPoints, i);
    newPlayers.set(playerId, resetPlayerForRound(player, spawn));
  }

  return {
    ...world,
    players: newPlayers,
    projectiles: [],
    phase: "fighting",
    countdownTicks: null,
    roundWinner: null,
    tick: world.tick + 1,
  };
}

function updateFightingPhase(
  world: RoundsWorld,
  inputs: Map<string, RoundsInput>,
  deltaTime: number,
): RoundsWorld {
  const deltaSeconds = deltaTime / 1000;

  // ==========================================================================
  // Step 1: Simulate player physics
  // The engine provides all players' inputs (either real or idle) in the inputs map
  // ==========================================================================
  let newPlayers = new Map<string, RoundsPlayer>();
  for (const [playerId, player] of world.players) {
    const input = inputs.get(playerId);
    
    if (input) {
      const updatedPlayer = simulatePlayer(player, input, deltaSeconds, world);
      newPlayers.set(playerId, updatedPlayer);
    } else {
      // Player not in inputs map (shouldn't happen with new engine contract,
      // but keep for client-side prediction which only sends local player)
      newPlayers.set(playerId, player);
    }
  }

  // ==========================================================================
  // Step 2: Process shooting (creates new projectiles)
  // ==========================================================================
  let newProjectiles = [...world.projectiles];
  for (const [playerId, input] of inputs) {
    if (input.shoot) {
      const player = newPlayers.get(playerId);
      if (player && isPlayerAlive(player) && player.fireCooldown <= 0 && player.ammo > 0) {
        const projectileResult = createProjectiles(player, input, world.tick);
        newProjectiles.push(...projectileResult.projectiles);
        newPlayers.set(playerId, projectileResult.player);
      }
    }
  }

  // ==========================================================================
  // Step 3: Simulate projectiles and handle collisions
  // ==========================================================================
  const projectileResult = simulateProjectiles(
    newProjectiles,
    newPlayers,
    deltaSeconds,
    world.level,
  );
  newPlayers = projectileResult.players;
  newProjectiles = projectileResult.projectiles;

  // ==========================================================================
  // Step 4: Update cooldowns and reload for all players
  // ==========================================================================
  newPlayers = updatePlayerCooldowns(newPlayers);

  // ==========================================================================
  // Step 5: Check for round end
  // ==========================================================================
  const alivePlayers = Array.from(newPlayers.values()).filter(isPlayerAlive);
  if (alivePlayers.length <= 1 && world.players.size >= 2) {
    const winner = alivePlayers[0];
    return {
      ...world,
      players: newPlayers,
      projectiles: newProjectiles,
      phase: "round_end",
      countdownTicks: ROUND_END_DELAY_TICKS,
      roundWinner: winner?.id ?? null,
      tick: world.tick + 1,
    };
  }

  return {
    ...world,
    players: newPlayers,
    projectiles: newProjectiles,
    tick: world.tick + 1,
  };
}

function updateRoundEndPhase(world: RoundsWorld): RoundsWorld {
  if (world.countdownTicks === null) {
    return transitionFromRoundEnd(world);
  }

  const newCountdown = world.countdownTicks - 1;
  if (newCountdown <= 0) {
    return transitionFromRoundEnd(world);
  }

  return {
    ...world,
    countdownTicks: newCountdown,
    tick: world.tick + 1,
  };
}

function transitionFromRoundEnd(world: RoundsWorld): RoundsWorld {
  // Award round win
  let newPlayers = new Map(world.players);
  if (world.roundWinner) {
    const winner = newPlayers.get(world.roundWinner);
    if (winner) {
      newPlayers.set(world.roundWinner, {
        ...winner,
        roundsWon: winner.roundsWon + 1,
      });
    }
  }

  // Check for match win
  const winnerPlayer = newPlayers.get(world.roundWinner ?? "");
  if (winnerPlayer && winnerPlayer.roundsWon >= ROUNDS_TO_WIN) {
    return {
      ...world,
      players: newPlayers,
      phase: "match_over",
      matchWinner: world.roundWinner,
      countdownTicks: null,
      tick: world.tick + 1,
    };
  }

  // Loser picks a card
  const loserId = findLoserId(world, world.roundWinner);
  if (!loserId) {
    // No loser (draw?) - just start next round
    return {
      ...world,
      players: newPlayers,
      phase: "countdown",
      countdownTicks: ROUND_COUNTDOWN_TICKS,
      roundNumber: world.roundNumber + 1,
      tick: world.tick + 1,
    };
  }

  // Generate card options
  const loser = newPlayers.get(loserId);
  const cardOptions = generateCardOptions(
    loser?.cards ?? [],
    world.tick + hashString(loserId),
  );

  const cardPick: CardPickState = {
    pickingPlayerId: loserId,
    options: cardOptions,
    ticksRemaining: Infinity, // No time limit - player must select
    selectedIndex: null,
  };

  return {
    ...world,
    players: newPlayers,
    phase: "card_pick",
    cardPick,
    countdownTicks: null,
    tick: world.tick + 1,
  };
}

function updateCardPickPhase(
  world: RoundsWorld,
  inputs: Map<string, RoundsInput>,
): RoundsWorld {
  if (!world.cardPick) {
    return startNextRound(world);
  }

  // Check for card selection from the picking player
  const pickerId = world.cardPick.pickingPlayerId;
  const pickerInput = inputs.get(pickerId);
  let selectedIndex = world.cardPick.selectedIndex;

  if (pickerInput && pickerInput.cardSelect >= 1 && pickerInput.cardSelect <= 3) {
    selectedIndex = pickerInput.cardSelect - 1;
  }

  // Only transition when a card is explicitly selected (no timer)
  if (selectedIndex !== null) {
    const selectedCard = world.cardPick.options[selectedIndex];

    // Apply card to player
    const newPlayers = new Map(world.players);
    const picker = newPlayers.get(pickerId);
    if (picker && selectedCard) {
      const newCards = [...picker.cards, selectedCard.id];
      const newStats = computePlayerStats(newCards);
      newPlayers.set(pickerId, {
        ...picker,
        cards: newCards,
        stats: newStats,
      });
    }

    return startNextRound({ ...world, players: newPlayers });
  }

  // No timer - just wait for selection
  return {
    ...world,
    tick: world.tick + 1,
  };
}

function startNextRound(world: RoundsWorld): RoundsWorld {
  return {
    ...world,
    phase: "countdown",
    cardPick: null,
    countdownTicks: ROUND_COUNTDOWN_TICKS,
    roundNumber: world.roundNumber + 1,
    tick: world.tick + 1,
  };
}

// =============================================================================
// Player Simulation
// =============================================================================

function simulatePlayer(
  player: RoundsPlayer,
  input: RoundsInput,
  deltaSeconds: number,
  world: RoundsWorld,
): RoundsPlayer {
  if (!isPlayerAlive(player)) return player;

  // Get colliders
  const colliders = getLevelColliders(world.level);

  // Create character controller
  const controller = new CharacterController(colliders, {
    position: vec2(player.position.x, player.position.y),
    halfSize: vec2(PLAYER_WIDTH / 2, PLAYER_HEIGHT / 2),
  });

  const wasGrounded = player.isGrounded;
  const wasOnWallLeft = !wasGrounded && player.wallDirX === -1;
  const wasOnWallRight = !wasGrounded && player.wallDirX === 1;

  // Build movement state
  const movementState: PlayerMovementState = {
    velocity: { ...player.velocity },
    velocityXSmoothing: player.velocityXSmoothing,
    wallSliding: player.wallSliding,
    wallDirX: player.wallDirX,
    timeToWallUnstick: player.timeToWallUnstick,
    jumpWasPressedLastFrame: player.jumpWasPressedLastFrame,
    jumpHeld: input.jump,
    coyoteTimeCounter: player.coyoteTimeCounter,
    jumpBufferCounter: player.jumpBufferCounter,
  };

  // Create modified physics based on player stats
  const modifiedPhysics = {
    ...derivedPhysics,
    gravity: derivedPhysics.gravity * player.stats.gravity,
    maxJumpVelocity: derivedPhysics.maxJumpVelocity * player.stats.jumpForce,
    minJumpVelocity: derivedPhysics.minJumpVelocity * player.stats.jumpForce,
  };

  const modifiedConfig = {
    ...DEFAULT_PLAYER_CONFIG,
    moveSpeed: DEFAULT_PLAYER_CONFIG.moveSpeed * player.stats.moveSpeed,
  };

  // Handle extra jumps
  let extraJumpsRemaining = player.extraJumpsRemaining;
  const movementInput = {
    moveX: input.moveX,
    moveY: 0,
    jump: input.jump,
  };

  // Air jump logic
  if (input.jump && !wasGrounded && !player.jumpWasPressedLastFrame && extraJumpsRemaining > 0) {
    // Consume an extra jump
    extraJumpsRemaining--;
    // Apply jump velocity - create new velocity object since Vector2 is readonly
    movementState.velocity = { x: movementState.velocity.x, y: modifiedPhysics.maxJumpVelocity };
  }

  // Run movement
  const newState = updatePlayerMovement(
    controller,
    movementState,
    movementInput,
    modifiedConfig,
    modifiedPhysics,
    deltaSeconds,
    { below: wasGrounded, left: wasOnWallLeft, right: wasOnWallRight },
  );

  // Reset extra jumps when landing
  if (controller.collisions.below && !wasGrounded) {
    extraJumpsRemaining = player.stats.extraJumps;
  }

  // Decrement invulnerability
  const invulnerabilityTicks = Math.max(0, player.invulnerabilityTicks - 1);

  return {
    ...player,
    position: { x: controller.position.x, y: controller.position.y },
    velocity: { x: newState.velocity.x, y: newState.velocity.y },
    isGrounded: controller.collisions.below,
    extraJumpsRemaining,
    velocityXSmoothing: newState.velocityXSmoothing,
    wallSliding: newState.wallSliding,
    wallDirX: newState.wallDirX,
    timeToWallUnstick: newState.timeToWallUnstick,
    jumpWasPressedLastFrame: newState.jumpWasPressedLastFrame,
    coyoteTimeCounter: newState.coyoteTimeCounter,
    jumpBufferCounter: newState.jumpBufferCounter,
    invulnerabilityTicks,
  };
}

// =============================================================================
// Projectile Simulation
// =============================================================================

function createProjectiles(
  player: RoundsPlayer,
  input: RoundsInput,
  tick: number,
): { player: RoundsPlayer; projectiles: Projectile[] } {
  const { stats } = player;
  const projectiles: Projectile[] = [];

  // Calculate aim direction
  const aimDx = input.aimX - player.position.x;
  const aimDy = input.aimY - player.position.y;
  const aimDist = Math.sqrt(aimDx * aimDx + aimDy * aimDy);
  const baseAngle = aimDist > 1 ? Math.atan2(aimDy, aimDx) : 0;

  // Fire multiple bullets with spread
  const bulletCount = stats.bulletCount;
  const spreadRadians = (stats.bulletSpread * Math.PI) / 180;
  const spreadStep = bulletCount > 1 ? spreadRadians / (bulletCount - 1) : 0;
  const startAngle = baseAngle - spreadRadians / 2;

  for (let i = 0; i < bulletCount; i++) {
    const angle = bulletCount > 1 ? startAngle + spreadStep * i : baseAngle;
    const speed = PROJECTILE_BASE_SPEED * stats.bulletSpeed;

    const projectile: Projectile = {
      id: `proj-${player.id}-${tick}-${player.projectileSeq + i}`,
      ownerId: player.id,
      position: { ...player.position },
      velocity: {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed,
      },
      damage: PROJECTILE_BASE_DAMAGE * stats.damage,
      bouncesRemaining: stats.bulletBounces,
      size: PROJECTILE_BASE_SIZE * stats.bulletSize,
      explosionRadius: stats.explosionRadius,
      knockbackForce: stats.knockbackForce,
      lifetime: PROJECTILE_LIFETIME_TICKS,
    };
    projectiles.push(projectile);
  }

  // Calculate fire cooldown (ticks between shots)
  // Base: 10 ticks at 20Hz = 0.5 seconds between shots
  const baseCooldown = 10;
  const fireCooldown = Math.max(1, Math.round(baseCooldown / stats.fireRate));

  const updatedPlayer: RoundsPlayer = {
    ...player,
    ammo: player.ammo - 1,
    fireCooldown,
    projectileSeq: player.projectileSeq + bulletCount,
    // Start reload if out of ammo
    reloadTimer: player.ammo - 1 <= 0 ? Math.round(40 * stats.reloadTime) : player.reloadTimer,
  };

  return { player: updatedPlayer, projectiles };
}

function simulateProjectiles(
  projectiles: Projectile[],
  players: Map<string, RoundsPlayer>,
  deltaSeconds: number,
  level: LevelConfig,
): { projectiles: Projectile[]; players: Map<string, RoundsPlayer> } {
  const newProjectiles: Projectile[] = [];
  let newPlayers = new Map(players);
  const colliders = getLevelColliders(level);

  for (const proj of projectiles) {
    // Move projectile
    const newPos = {
      x: proj.position.x + proj.velocity.x * deltaSeconds,
      y: proj.position.y + proj.velocity.y * deltaSeconds,
    };

    // Decrement lifetime
    const newLifetime = proj.lifetime - 1;
    if (newLifetime <= 0) continue;

    // Check bounds
    if (
      Math.abs(newPos.x) > level.bounds.width ||
      Math.abs(newPos.y) > level.bounds.height
    ) {
      continue;
    }

    // Check player collision
    let hitPlayer = false;
    for (const [playerId, player] of newPlayers) {
      if (playerId === proj.ownerId) continue;
      if (!canPlayerTakeDamage(player)) continue;

      const playerAABB = getPlayerAABB(player);
      const projAABB: AABB = {
        x: newPos.x - proj.size / 2,
        y: newPos.y - proj.size / 2,
        width: proj.size,
        height: proj.size,
      };

      if (aabbOverlap(projAABB, playerAABB)) {
        // Apply damage
        let newHealth = clampHealth(
          player.health - proj.damage,
          player.stats.maxHealth,
        );

        // Apply knockback
        const knockbackDir = {
          x: player.position.x - proj.position.x,
          y: player.position.y - proj.position.y,
        };
        const knockbackDist = Math.sqrt(
          knockbackDir.x * knockbackDir.x + knockbackDir.y * knockbackDir.y,
        );
        const normalizedKnockback =
          knockbackDist > 0
            ? { x: knockbackDir.x / knockbackDist, y: knockbackDir.y / knockbackDist }
            : { x: 0, y: 1 };

        const knockbackForce = 300 * proj.knockbackForce;

        // Life steal
        const owner = newPlayers.get(proj.ownerId);
        if (owner && owner.stats.lifeSteal > 0) {
          const healAmount = proj.damage * owner.stats.lifeSteal;
          newPlayers.set(proj.ownerId, {
            ...owner,
            health: clampHealth(
              owner.health + healAmount,
              owner.stats.maxHealth,
            ),
          });
        }

        newPlayers.set(playerId, {
          ...player,
          health: newHealth,
          velocity: {
            x: player.velocity.x + normalizedKnockback.x * knockbackForce,
            y: player.velocity.y + normalizedKnockback.y * knockbackForce,
          },
          isGrounded: false,
        });

        hitPlayer = true;
        break;
      }
    }

    if (hitPlayer) {
      // Handle explosion
      if (proj.explosionRadius > 0) {
        newPlayers = applyExplosion(
          newPos,
          proj.explosionRadius,
          proj.damage * 0.5,
          proj.ownerId,
          newPlayers,
        );
      }
      continue;
    }

    // Check wall collision
    let bounced = false;
    for (const collider of colliders) {
      const colliderAABB: AABB = {
        x: collider.position.x - collider.halfExtents.x,
        y: collider.position.y - collider.halfExtents.y,
        width: collider.halfExtents.x * 2,
        height: collider.halfExtents.y * 2,
      };

      const projAABB: AABB = {
        x: newPos.x - proj.size / 2,
        y: newPos.y - proj.size / 2,
        width: proj.size,
        height: proj.size,
      };

      if (aabbOverlap(projAABB, colliderAABB)) {
        if (proj.bouncesRemaining > 0) {
          // Bounce
          // Determine which side we hit and reflect
          const overlapLeft = projAABB.x + projAABB.width - colliderAABB.x;
          const overlapRight =
            colliderAABB.x + colliderAABB.width - projAABB.x;
          const overlapTop = projAABB.y + projAABB.height - colliderAABB.y;
          const overlapBottom =
            colliderAABB.y + colliderAABB.height - projAABB.y;

          const minOverlapX = Math.min(overlapLeft, overlapRight);
          const minOverlapY = Math.min(overlapTop, overlapBottom);

          let newVelocity = { ...proj.velocity };
          if (minOverlapX < minOverlapY) {
            newVelocity.x *= -1;
          } else {
            newVelocity.y *= -1;
          }

          newProjectiles.push({
            ...proj,
            position: newPos,
            velocity: newVelocity,
            bouncesRemaining: proj.bouncesRemaining - 1,
            lifetime: newLifetime,
          });
          bounced = true;
        }
        // If no bounces, projectile is destroyed
        break;
      }
    }

    if (!bounced && !hitPlayer) {
      // Keep projectile alive
      newProjectiles.push({
        ...proj,
        position: newPos,
        lifetime: newLifetime,
      });
    }
  }

  return { projectiles: newProjectiles, players: newPlayers };
}

function applyExplosion(
  center: { x: number; y: number },
  radius: number,
  damage: number,
  ownerId: string,
  players: Map<string, RoundsPlayer>,
): Map<string, RoundsPlayer> {
  const newPlayers = new Map(players);

  for (const [playerId, player] of players) {
    if (playerId === ownerId) continue;
    if (!canPlayerTakeDamage(player)) continue;

    const dx = player.position.x - center.x;
    const dy = player.position.y - center.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= radius) {
      // Damage falls off with distance
      const falloff = 1 - distance / radius;
      const actualDamage = damage * falloff;

      // Knockback away from center
      const knockbackDir =
        distance > 0
          ? { x: dx / distance, y: dy / distance }
          : { x: 0, y: 1 };
      const knockbackForce = 400 * falloff;

      newPlayers.set(playerId, {
        ...player,
        health: clampHealth(
          player.health - actualDamage,
          player.stats.maxHealth,
        ),
        velocity: {
          x: player.velocity.x + knockbackDir.x * knockbackForce,
          y: player.velocity.y + knockbackDir.y * knockbackForce,
        },
        isGrounded: false,
      });
    }
  }

  return newPlayers;
}

// =============================================================================
// Cooldown & Reload
// =============================================================================

function updatePlayerCooldowns(
  players: Map<string, RoundsPlayer>,
): Map<string, RoundsPlayer> {
  const newPlayers = new Map<string, RoundsPlayer>();

  for (const [playerId, player] of players) {
    let { fireCooldown, reloadTimer, ammo } = player;

    // Decrement fire cooldown
    fireCooldown = Math.max(0, fireCooldown - 1);

    // Handle reload
    if (reloadTimer !== null) {
      reloadTimer--;
      if (reloadTimer <= 0) {
        ammo = player.stats.ammoCapacity;
        reloadTimer = null;
      }
    } else if (ammo <= 0) {
      // Start reload if empty
      reloadTimer = Math.round(40 * player.stats.reloadTime);
    }

    newPlayers.set(playerId, {
      ...player,
      fireCooldown,
      reloadTimer,
      ammo,
    });
  }

  return newPlayers;
}

// =============================================================================
// Utility Functions
// =============================================================================

function getSpawnPoint(spawnPoints: SpawnPoint[], playerIndex: number): { x: number; y: number } {
  // Try to find spawn point for this side
  const side = playerIndex % 2;
  const spawn = spawnPoints.find((s) => s.side === side);
  if (spawn) return spawn.position;

  // Fallback
  if (spawnPoints.length > 0) {
    return spawnPoints[playerIndex % spawnPoints.length]?.position ?? { x: side === 0 ? -100 : 100, y: 50 };
  }

  return { x: side === 0 ? -100 : 100, y: 50 };
}

function resetPlayerForRound(
  player: RoundsPlayer,
  spawnPos: { x: number; y: number },
): RoundsPlayer {
  return {
    ...player,
    position: { ...spawnPos },
    velocity: { x: 0, y: 0 },
    isGrounded: false,
    health: player.stats.maxHealth,
    ammo: player.stats.ammoCapacity,
    reloadTimer: null,
    fireCooldown: 0,
    shieldHealth: player.stats.shieldHealth,
    extraJumpsRemaining: player.stats.extraJumps,
    dashesRemaining: player.stats.dashCount,
    dashCooldown: 0,
    invulnerabilityTicks: 40, // 2 seconds invuln at round start
    // Keep cards, roundsWon, stats
  };
}

function findLoserId(world: RoundsWorld, winnerId: string | null): string | null {
  for (const [playerId] of world.players) {
    if (playerId !== winnerId) {
      return playerId;
    }
  }
  return null;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// =============================================================================
// World Management
// =============================================================================

export function addPlayerToWorld(
  world: RoundsWorld,
  playerId: string,
): RoundsWorld {
  const playerIndex = world.players.size;
  const spawn = getSpawnPoint(world.level.spawnPoints, playerIndex);
  const player = createRoundsPlayer(playerId, spawn);

  const newPlayers = new Map(world.players);
  newPlayers.set(playerId, player);

  return { ...world, players: newPlayers };
}

export function removePlayerFromWorld(
  world: RoundsWorld,
  playerId: string,
): RoundsWorld {
  const newPlayers = new Map(world.players);
  newPlayers.delete(playerId);
  return { ...world, players: newPlayers };
}

export function resetMatch(world: RoundsWorld): RoundsWorld {
  // Reset all players
  const newPlayers = new Map<string, RoundsPlayer>();
  let index = 0;
  for (const [playerId] of world.players) {
    const spawn = getSpawnPoint(world.level.spawnPoints, index);
    newPlayers.set(playerId, createRoundsPlayer(playerId, spawn));
    index++;
  }

  return {
    ...world,
    players: newPlayers,
    projectiles: [],
    phase: "waiting",
    cardPick: null,
    countdownTicks: null,
    matchWinner: null,
    roundWinner: null,
    roundNumber: 0,
    tick: 0,
  };
}

export function forceStartGame(world: RoundsWorld, minPlayers: number = 2): RoundsWorld {
  if (world.players.size < minPlayers) return world;

  return {
    ...world,
    phase: "countdown",
    countdownTicks: ROUND_COUNTDOWN_TICKS,
    roundNumber: 1,
  };
}
