/**
 * ROUNDS arena level definitions
 *
 * Arenas are designed for 1v1 combat with:
 * - Symmetrical layouts for fair fights
 * - Multiple height levels for interesting combat
 * - Clear spawn points on opposite sides
 */

import type { LevelConfig, Platform, SpawnPoint } from "./types.js";

// =============================================================================
// Level Definitions
// =============================================================================

/**
 * Classic Arena - Simple symmetrical layout
 * Good for learning the game
 */
export const LEVEL_CLASSIC_ARENA: LevelConfig = {
  id: "classic-arena",
  name: "Classic Arena",
  platforms: [
    // Ground level - two platforms with gap
    {
      id: "ground-left",
      position: { x: -250, y: 0 },
      width: 200,
      height: 20,
    },
    {
      id: "ground-right",
      position: { x: 50, y: 0 },
      width: 200,
      height: 20,
    },
    // Middle platform
    {
      id: "mid-center",
      position: { x: -75, y: 100 },
      width: 150,
      height: 20,
    },
    // Upper platforms
    {
      id: "upper-left",
      position: { x: -200, y: 180 },
      width: 100,
      height: 20,
    },
    {
      id: "upper-right",
      position: { x: 100, y: 180 },
      width: 100,
      height: 20,
    },
  ],
  spawnPoints: [
    { position: { x: -180, y: 36 }, side: 0 }, // y = platform top (20) + player half-height (16)
    { position: { x: 180, y: 36 }, side: 1 },
  ],
  bounds: { width: 400, height: 400 },
};

/**
 * Tower Arena - Vertical combat focus
 */
export const LEVEL_TOWER: LevelConfig = {
  id: "tower",
  name: "Tower",
  platforms: [
    // Base
    {
      id: "base",
      position: { x: -150, y: 0 },
      width: 300,
      height: 20,
    },
    // Ascending platforms - left side
    {
      id: "level1-left",
      position: { x: -180, y: 80 },
      width: 80,
      height: 15,
    },
    {
      id: "level2-left",
      position: { x: -180, y: 160 },
      width: 80,
      height: 15,
    },
    {
      id: "level3-left",
      position: { x: -180, y: 240 },
      width: 80,
      height: 15,
    },
    // Ascending platforms - right side
    {
      id: "level1-right",
      position: { x: 100, y: 80 },
      width: 80,
      height: 15,
    },
    {
      id: "level2-right",
      position: { x: 100, y: 160 },
      width: 80,
      height: 15,
    },
    {
      id: "level3-right",
      position: { x: 100, y: 240 },
      width: 80,
      height: 15,
    },
    // Center platforms
    {
      id: "center-low",
      position: { x: -40, y: 120 },
      width: 80,
      height: 15,
    },
    {
      id: "center-high",
      position: { x: -40, y: 200 },
      width: 80,
      height: 15,
    },
    // Top platform
    {
      id: "top",
      position: { x: -60, y: 300 },
      width: 120,
      height: 20,
    },
  ],
  spawnPoints: [
    { position: { x: -120, y: 36 }, side: 0 }, // y = platform top (20) + player half-height (16)
    { position: { x: 120, y: 36 }, side: 1 },
  ],
  bounds: { width: 400, height: 500 },
};

/**
 * Pit Arena - Fight over a deadly pit
 */
export const LEVEL_PIT: LevelConfig = {
  id: "pit",
  name: "The Pit",
  platforms: [
    // Left safe area
    {
      id: "left-base",
      position: { x: -300, y: 0 },
      width: 150,
      height: 20,
    },
    // Right safe area
    {
      id: "right-base",
      position: { x: 150, y: 0 },
      width: 150,
      height: 20,
    },
    // Floating platforms over the pit
    {
      id: "pit-left",
      position: { x: -100, y: 60 },
      width: 60,
      height: 15,
    },
    {
      id: "pit-center",
      position: { x: -30, y: 100 },
      width: 60,
      height: 15,
    },
    {
      id: "pit-right",
      position: { x: 40, y: 60 },
      width: 60,
      height: 15,
    },
    // Upper platforms
    {
      id: "upper-left",
      position: { x: -200, y: 140 },
      width: 100,
      height: 15,
    },
    {
      id: "upper-right",
      position: { x: 100, y: 140 },
      width: 100,
      height: 15,
    },
    // Top center
    {
      id: "top-center",
      position: { x: -50, y: 200 },
      width: 100,
      height: 15,
    },
  ],
  spawnPoints: [
    { position: { x: -250, y: 36 }, side: 0 },
    { position: { x: 250, y: 36 }, side: 1 },
  ],
  bounds: { width: 500, height: 400 },
};

/**
 * Pillars Arena - Vertical cover
 */
export const LEVEL_PILLARS: LevelConfig = {
  id: "pillars",
  name: "Pillars",
  platforms: [
    // Wide ground
    {
      id: "ground",
      position: { x: -250, y: 0 },
      width: 500,
      height: 20,
    },
    // Left pillar
    {
      id: "pillar-left-base",
      position: { x: -180, y: 20 },
      width: 40,
      height: 100,
    },
    {
      id: "pillar-left-top",
      position: { x: -200, y: 120 },
      width: 80,
      height: 15,
    },
    // Center pillar (taller)
    {
      id: "pillar-center-base",
      position: { x: -20, y: 20 },
      width: 40,
      height: 150,
    },
    {
      id: "pillar-center-top",
      position: { x: -40, y: 170 },
      width: 80,
      height: 15,
    },
    // Right pillar
    {
      id: "pillar-right-base",
      position: { x: 140, y: 20 },
      width: 40,
      height: 100,
    },
    {
      id: "pillar-right-top",
      position: { x: 120, y: 120 },
      width: 80,
      height: 15,
    },
  ],
  spawnPoints: [
    { position: { x: -220, y: 36 }, side: 0 },
    { position: { x: 220, y: 36 }, side: 1 },
  ],
  bounds: { width: 500, height: 400 },
};

/**
 * Bridges Arena - Multiple crossing paths
 */
export const LEVEL_BRIDGES: LevelConfig = {
  id: "bridges",
  name: "Bridges",
  platforms: [
    // Ground platforms
    {
      id: "ground-left",
      position: { x: -250, y: 0 },
      width: 120,
      height: 20,
    },
    {
      id: "ground-right",
      position: { x: 130, y: 0 },
      width: 120,
      height: 20,
    },
    // Lower bridge
    {
      id: "bridge-low",
      position: { x: -120, y: 60 },
      width: 240,
      height: 12,
    },
    // Middle platforms
    {
      id: "mid-left",
      position: { x: -200, y: 130 },
      width: 80,
      height: 15,
    },
    {
      id: "mid-right",
      position: { x: 120, y: 130 },
      width: 80,
      height: 15,
    },
    // Upper bridge
    {
      id: "bridge-high",
      position: { x: -100, y: 180 },
      width: 200,
      height: 12,
    },
    // Top platforms
    {
      id: "top-left",
      position: { x: -180, y: 240 },
      width: 70,
      height: 15,
    },
    {
      id: "top-right",
      position: { x: 110, y: 240 },
      width: 70,
      height: 15,
    },
  ],
  spawnPoints: [
    { position: { x: -200, y: 36 }, side: 0 },
    { position: { x: 200, y: 36 }, side: 1 },
  ],
  bounds: { width: 500, height: 400 },
};

// =============================================================================
// Level Registry
// =============================================================================

/** All available levels */
export const LEVELS: Record<string, LevelConfig> = {
  "classic-arena": LEVEL_CLASSIC_ARENA,
  tower: LEVEL_TOWER,
  pit: LEVEL_PIT,
  pillars: LEVEL_PILLARS,
  bridges: LEVEL_BRIDGES,
};

/** Default level */
export const DEFAULT_LEVEL = LEVEL_CLASSIC_ARENA;

/**
 * Get a level by ID
 */
export function getLevel(id: string): LevelConfig | undefined {
  return LEVELS[id];
}

/**
 * Get all level IDs
 */
export function getLevelIds(): string[] {
  return Object.keys(LEVELS);
}

/**
 * Get all levels
 */
export function getAllLevels(): LevelConfig[] {
  return Object.values(LEVELS);
}
