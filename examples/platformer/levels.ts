/**
 * Level definitions for the platformer game.
 *
 * Levels define platforms, spawn points, and hazards.
 * These are loaded at game start and set via setLevelConfig().
 *
 * Coordinate System: Y-UP
 * - Floor is at y=0 (DEFAULT_FLOOR_Y)
 * - Positive Y points upward
 * - Platform.position is the bottom-left corner
 * - Player spawns should have y = PLAYER_HEIGHT/2 to be on the floor
 *
 * @module examples/platformer/levels
 */

import { DEFAULT_FLOOR_Y } from "@game/netcode";
import type { Hazard, LevelConfig, Platform, SpawnPoint } from "./types.js";
import { PLAYER_HEIGHT } from "./types.js";

// =============================================================================
// Level: Basic Arena
// =============================================================================

/**
 * A simple flat arena with spawn points on either side.
 * Good for testing and 1v1 fights.
 */
export const LEVEL_BASIC_ARENA: LevelConfig = {
  id: "basic-arena",
  name: "Basic Arena",
  description: "A simple flat arena for 1v1 combat",
  bounds: { width: 800, height: 600 },
  platforms: [],
  spawnPoints: [
    // Y-up: player center at halfHeight above floor
    { position: { x: -200, y: DEFAULT_FLOOR_Y + PLAYER_HEIGHT / 2 } },
    { position: { x: 200, y: DEFAULT_FLOOR_Y + PLAYER_HEIGHT / 2 } },
  ],
  hazards: [],
};

// =============================================================================
// Level: Platforms
// =============================================================================

/**
 * An arena with floating platforms at different heights.
 * Supports 2-4 players.
 */
export const LEVEL_PLATFORMS: LevelConfig = {
  id: "platforms",
  name: "Sky Platforms",
  description: "Floating platforms at various heights",
  bounds: { width: 1000, height: 800 },
  platforms: [
    // Center platform (high) - bottom at y=180
    {
      id: "plat-center",
      position: { x: -75, y: 180 },
      width: 150,
      height: 20,
    },
    // Left platform (medium height) - bottom at y=100
    {
      id: "plat-left",
      position: { x: -350, y: 100 },
      width: 120,
      height: 20,
    },
    // Right platform (medium height) - bottom at y=100
    {
      id: "plat-right",
      position: { x: 230, y: 100 },
      width: 120,
      height: 20,
    },
    // Lower left platform - bottom at y=40
    {
      id: "plat-lower-left",
      position: { x: -250, y: 40 },
      width: 100,
      height: 20,
    },
    // Lower right platform - bottom at y=40
    {
      id: "plat-lower-right",
      position: { x: 150, y: 40 },
      width: 100,
      height: 20,
    },
  ],
  spawnPoints: [
    // Ground spawns (player center at halfHeight above floor)
    { position: { x: -300, y: DEFAULT_FLOOR_Y + PLAYER_HEIGHT / 2 } },
    { position: { x: 300, y: DEFAULT_FLOOR_Y + PLAYER_HEIGHT / 2 } },
    // Platform spawns (player center at halfHeight above platform top)
    // Platform top = platform.y + platform.height = 100 + 20 = 120
    { position: { x: -290, y: 120 + PLAYER_HEIGHT / 2 } },
    { position: { x: 290, y: 120 + PLAYER_HEIGHT / 2 } },
  ],
  hazards: [],
};

// =============================================================================
// Level: Danger Zone
// =============================================================================

/**
 * An arena with hazards (spikes) on the floor.
 * Forces players to stay on platforms or take damage.
 */
export const LEVEL_DANGER_ZONE: LevelConfig = {
  id: "danger-zone",
  name: "Danger Zone",
  description: "Watch out for the spikes!",
  bounds: { width: 1000, height: 800 },
  platforms: [
    // Safe center platform - bottom at y=130
    {
      id: "plat-safe-center",
      position: { x: -100, y: 130 },
      width: 200,
      height: 20,
    },
    // Left safe platform - bottom at y=80
    {
      id: "plat-safe-left",
      position: { x: -400, y: 80 },
      width: 150,
      height: 20,
    },
    // Right safe platform - bottom at y=80
    {
      id: "plat-safe-right",
      position: { x: 250, y: 80 },
      width: 150,
      height: 20,
    },
    // High platform - bottom at y=230
    {
      id: "plat-high",
      position: { x: -50, y: 230 },
      width: 100,
      height: 20,
    },
  ],
  spawnPoints: [
    // All spawns are on safe platforms (player center at halfHeight above platform top)
    { position: { x: 0, y: 150 + PLAYER_HEIGHT / 2 } },      // center platform top = 150
    { position: { x: -325, y: 100 + PLAYER_HEIGHT / 2 } },   // left platform top = 100
    { position: { x: 325, y: 100 + PLAYER_HEIGHT / 2 } },    // right platform top = 100
    { position: { x: 0, y: 250 + PLAYER_HEIGHT / 2 } },      // high platform top = 250
  ],
  hazards: [
    // Spikes on the floor (bottom at y=0, height=15)
    {
      id: "spikes-left",
      position: { x: -450, y: 0 },
      width: 300,
      height: 15,
      damage: 5, // Damage per tick while touching
    },
    {
      id: "spikes-center",
      position: { x: -100, y: 0 },
      width: 200,
      height: 15,
      damage: 5,
    },
    {
      id: "spikes-right",
      position: { x: 150, y: 0 },
      width: 300,
      height: 15,
      damage: 5,
    },
  ],
};

// =============================================================================
// Level: Tower
// =============================================================================

/**
 * A vertical level with platforms stacked like a tower.
 * King of the hill style gameplay.
 */
export const LEVEL_TOWER: LevelConfig = {
  id: "tower",
  name: "The Tower",
  description: "Climb to the top!",
  bounds: { width: 600, height: 1000 },
  platforms: [
    // Ground level platforms (left and right) - just above floor
    {
      id: "plat-ground-left",
      position: { x: -250, y: 0 },
      width: 100,
      height: 20,
    },
    {
      id: "plat-ground-right",
      position: { x: 150, y: 0 },
      width: 100,
      height: 20,
    },
    // Level 1 - bottom at y=60
    {
      id: "plat-l1-center",
      position: { x: -60, y: 60 },
      width: 120,
      height: 20,
    },
    // Level 2 - bottom at y=130
    {
      id: "plat-l2-left",
      position: { x: -180, y: 130 },
      width: 100,
      height: 20,
    },
    {
      id: "plat-l2-right",
      position: { x: 80, y: 130 },
      width: 100,
      height: 20,
    },
    // Level 3 - bottom at y=200
    {
      id: "plat-l3-center",
      position: { x: -50, y: 200 },
      width: 100,
      height: 20,
    },
    // Level 4 (top) - bottom at y=280
    {
      id: "plat-top",
      position: { x: -75, y: 280 },
      width: 150,
      height: 20,
    },
  ],
  spawnPoints: [
    // Ground spawns
    { position: { x: -200, y: DEFAULT_FLOOR_Y + PLAYER_HEIGHT / 2 } },
    { position: { x: 200, y: DEFAULT_FLOOR_Y + PLAYER_HEIGHT / 2 } },
    // Platform spawns (L1 top = 80, top platform top = 300)
    { position: { x: 0, y: 80 + PLAYER_HEIGHT / 2 } },
    { position: { x: 0, y: 300 + PLAYER_HEIGHT / 2 } },
  ],
  hazards: [],
};

// =============================================================================
// Level: Wall Jump Test
// =============================================================================

/**
 * A level designed to test wall jumping mechanics.
 * Features tall walls on both sides and platforms to climb using wall jumps.
 */
export const LEVEL_WALL_TEST: LevelConfig = {
  id: "wall-test",
  name: "Wall Jump Test",
  description: "Practice wall jumping between tall walls",
  bounds: { width: 400, height: 600 },
  platforms: [
    // Left wall (tall, from floor to high up)
    {
      id: "wall-left",
      position: { x: -180, y: 0 },
      width: 20,
      height: 400,
    },
    // Right wall (tall, from floor to high up)
    {
      id: "wall-right",
      position: { x: 160, y: 0 },
      width: 20,
      height: 400,
    },
    // Ground platform in the middle (between walls)
    {
      id: "plat-ground",
      position: { x: -80, y: 0 },
      width: 160,
      height: 20,
    },
    // Mid-height platform (reachable by wall jumping)
    {
      id: "plat-mid",
      position: { x: -50, y: 150 },
      width: 100,
      height: 20,
    },
    // High platform (goal - requires multiple wall jumps)
    {
      id: "plat-high",
      position: { x: -60, y: 300 },
      width: 120,
      height: 20,
    },
    // Small ledges on walls for resting
    {
      id: "ledge-left",
      position: { x: -160, y: 200 },
      width: 40,
      height: 15,
    },
    {
      id: "ledge-right",
      position: { x: 120, y: 250 },
      width: 40,
      height: 15,
    },
  ],
  spawnPoints: [
    // Spawn on ground platform
    { position: { x: 0, y: 20 + PLAYER_HEIGHT / 2 } },
    { position: { x: -40, y: 20 + PLAYER_HEIGHT / 2 } },
    { position: { x: 40, y: 20 + PLAYER_HEIGHT / 2 } },
    // Spawn on mid platform
    { position: { x: 0, y: 170 + PLAYER_HEIGHT / 2 } },
  ],
  hazards: [],
};

// =============================================================================
// Level Registry
// =============================================================================

/**
 * All available levels indexed by ID.
 */
export const LEVELS: Record<string, LevelConfig> = {
  "basic-arena": LEVEL_BASIC_ARENA,
  platforms: LEVEL_PLATFORMS,
  "danger-zone": LEVEL_DANGER_ZONE,
  tower: LEVEL_TOWER,
  "wall-test": LEVEL_WALL_TEST,
};

/**
 * Get a level by ID.
 * @param levelId - The level ID to look up
 * @returns The level config, or undefined if not found
 */
export function getLevel(levelId: string): LevelConfig | undefined {
  return LEVELS[levelId];
}

/**
 * Get all available level IDs.
 */
export function getLevelIds(): string[] {
  return Object.keys(LEVELS);
}

/**
 * Get all available levels as an array.
 */
export function getAllLevels(): LevelConfig[] {
  return Object.values(LEVELS);
}

/**
 * The default level to use when no level is specified.
 */
export const DEFAULT_LEVEL = LEVEL_PLATFORMS;

// =============================================================================
// Level Validation
// =============================================================================

/**
 * Validation result for a level config.
 */
export interface LevelValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a level configuration.
 * Checks for common issues like missing spawn points, overlapping platforms, etc.
 *
 * @param level - The level config to validate
 * @returns Validation result with errors and warnings
 */
export function validateLevel(level: LevelConfig): LevelValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required fields
  if (!level.id || level.id.trim() === "") {
    errors.push("Level must have an id");
  }
  if (!level.name || level.name.trim() === "") {
    errors.push("Level must have a name");
  }

  // Check spawn points
  if (!level.spawnPoints || level.spawnPoints.length === 0) {
    errors.push("Level must have at least one spawn point");
  } else if (level.spawnPoints.length < 2) {
    warnings.push("Level has only one spawn point - multiplayer may have issues");
  }

  // Check for duplicate platform IDs
  const platformIds = new Set<string>();
  for (const platform of level.platforms) {
    if (platformIds.has(platform.id)) {
      errors.push(`Duplicate platform ID: ${platform.id}`);
    }
    platformIds.add(platform.id);

    // Check platform dimensions
    if (platform.width <= 0 || platform.height <= 0) {
      errors.push(`Platform ${platform.id} has invalid dimensions`);
    }
  }

  // Check for duplicate hazard IDs
  const hazardIds = new Set<string>();
  for (const hazard of level.hazards) {
    if (hazardIds.has(hazard.id)) {
      errors.push(`Duplicate hazard ID: ${hazard.id}`);
    }
    hazardIds.add(hazard.id);

    // Check hazard dimensions
    if (hazard.width <= 0 || hazard.height <= 0) {
      errors.push(`Hazard ${hazard.id} has invalid dimensions`);
    }
    if (hazard.damage <= 0) {
      warnings.push(`Hazard ${hazard.id} has zero or negative damage`);
    }
  }

  // Check spawn point validity (should be above floor or on a platform)
  // Y-up: floor is at y=0, positive Y is above floor
  for (let i = 0; i < level.spawnPoints.length; i++) {
    const spawn = level.spawnPoints[i];
    if (!spawn) continue;

    // Check if spawn is below floor (probably a mistake)
    // Y-up: below floor means y < DEFAULT_FLOOR_Y (which is 0)
    if (spawn.position.y < DEFAULT_FLOOR_Y) {
      warnings.push(`Spawn point ${i} is below floor level`);
    }

    // Check if spawn is inside a hazard
    // Y-up: hazard box is from position.y to position.y + height
    for (const hazard of level.hazards) {
      if (
        spawn.position.x >= hazard.position.x &&
        spawn.position.x <= hazard.position.x + hazard.width &&
        spawn.position.y >= hazard.position.y &&
        spawn.position.y <= hazard.position.y + hazard.height
      ) {
        warnings.push(`Spawn point ${i} is inside hazard ${hazard.id}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Parse and validate a level from JSON.
 * This is useful for loading user-created levels.
 *
 * @param json - The JSON string or object to parse
 * @returns The validated level config
 * @throws Error if the JSON is invalid or the level fails validation
 */
export function parseLevelFromJson(json: string | object): LevelConfig {
  let data: unknown;

  if (typeof json === "string") {
    try {
      data = JSON.parse(json);
    } catch {
      throw new Error("Invalid JSON format");
    }
  } else {
    data = json;
  }

  // Type guard for level config
  if (typeof data !== "object" || data === null) {
    throw new Error("Level must be an object");
  }

  const level = data as Record<string, unknown>;

  // Required fields
  if (typeof level.id !== "string") {
    throw new Error("Level must have a string 'id' field");
  }
  if (typeof level.name !== "string") {
    throw new Error("Level must have a string 'name' field");
  }

  // Parse platforms
  const platforms: Platform[] = [];
  if (Array.isArray(level.platforms)) {
    for (const p of level.platforms) {
      if (typeof p !== "object" || p === null) continue;
      const plat = p as Record<string, unknown>;
      platforms.push({
        id: String(plat.id ?? `platform-${platforms.length}`),
        position: parseVector2(plat.position),
        width: Number(plat.width ?? 100),
        height: Number(plat.height ?? 20),
      });
    }
  }

  // Parse spawn points
  const spawnPoints: SpawnPoint[] = [];
  if (Array.isArray(level.spawnPoints)) {
    for (const s of level.spawnPoints) {
      if (typeof s !== "object" || s === null) continue;
      const spawn = s as Record<string, unknown>;
      spawnPoints.push({
        position: parseVector2(spawn.position),
      });
    }
  }

  // Parse hazards
  const hazards: Hazard[] = [];
  if (Array.isArray(level.hazards)) {
    for (const h of level.hazards) {
      if (typeof h !== "object" || h === null) continue;
      const hazard = h as Record<string, unknown>;
      hazards.push({
        id: String(hazard.id ?? `hazard-${hazards.length}`),
        position: parseVector2(hazard.position),
        width: Number(hazard.width ?? 100),
        height: Number(hazard.height ?? 20),
        damage: Number(hazard.damage ?? 10),
      });
    }
  }

  const config: LevelConfig = {
    id: level.id,
    name: level.name,
    description: typeof level.description === "string" ? level.description : undefined,
    bounds:
      typeof level.bounds === "object" && level.bounds !== null
        ? {
            width: Number((level.bounds as Record<string, unknown>).width ?? 800),
            height: Number((level.bounds as Record<string, unknown>).height ?? 600),
          }
        : undefined,
    platforms,
    spawnPoints,
    hazards,
  };

  // Validate
  const validation = validateLevel(config);
  if (!validation.valid) {
    throw new Error(`Level validation failed: ${validation.errors.join(", ")}`);
  }

  return config;
}

/**
 * Helper to parse a Vector2 from unknown data
 */
function parseVector2(data: unknown): { x: number; y: number } {
  if (typeof data !== "object" || data === null) {
    return { x: 0, y: 0 };
  }
  const v = data as Record<string, unknown>;
  return {
    x: Number(v.x ?? 0),
    y: Number(v.y ?? 0),
  };
}
