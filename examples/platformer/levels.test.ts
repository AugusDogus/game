import { describe, it, expect } from "bun:test";
import {
  LEVEL_BASIC_ARENA,
  LEVEL_PLATFORMS,
  LEVEL_DANGER_ZONE,
  LEVEL_TOWER,
  LEVELS,
  DEFAULT_LEVEL,
  getLevel,
  getLevelIds,
  getAllLevels,
  validateLevel,
  parseLevelFromJson,
} from "./levels.js";
import type { LevelConfig } from "./types.js";

describe("Level definitions", () => {
  it("should have valid basic arena", () => {
    expect(LEVEL_BASIC_ARENA.id).toBe("basic-arena");
    expect(LEVEL_BASIC_ARENA.name).toBe("Basic Arena");
    expect(LEVEL_BASIC_ARENA.spawnPoints.length).toBeGreaterThanOrEqual(2);
  });

  it("should have valid platforms level", () => {
    expect(LEVEL_PLATFORMS.id).toBe("platforms");
    expect(LEVEL_PLATFORMS.platforms.length).toBeGreaterThan(0);
    expect(LEVEL_PLATFORMS.spawnPoints.length).toBeGreaterThanOrEqual(2);
  });

  it("should have valid danger zone level", () => {
    expect(LEVEL_DANGER_ZONE.id).toBe("danger-zone");
    expect(LEVEL_DANGER_ZONE.hazards.length).toBeGreaterThan(0);
    expect(LEVEL_DANGER_ZONE.spawnPoints.length).toBeGreaterThanOrEqual(2);
  });

  it("should have valid tower level", () => {
    expect(LEVEL_TOWER.id).toBe("tower");
    expect(LEVEL_TOWER.platforms.length).toBeGreaterThan(0);
    expect(LEVEL_TOWER.spawnPoints.length).toBeGreaterThanOrEqual(2);
  });

  it("all built-in levels should pass validation", () => {
    for (const level of Object.values(LEVELS)) {
      const result = validateLevel(level);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    }
  });
});

describe("Level registry", () => {
  it("should contain all built-in levels", () => {
    expect(LEVELS["basic-arena"]).toBe(LEVEL_BASIC_ARENA);
    expect(LEVELS["platforms"]).toBe(LEVEL_PLATFORMS);
    expect(LEVELS["danger-zone"]).toBe(LEVEL_DANGER_ZONE);
    expect(LEVELS["tower"]).toBe(LEVEL_TOWER);
  });

  it("should have default level", () => {
    expect(DEFAULT_LEVEL).toBeDefined();
    expect(DEFAULT_LEVEL.id).toBeDefined();
  });

  it("getLevel should return correct level", () => {
    expect(getLevel("basic-arena")).toBe(LEVEL_BASIC_ARENA);
    expect(getLevel("platforms")).toBe(LEVEL_PLATFORMS);
    expect(getLevel("nonexistent")).toBeUndefined();
  });

  it("getLevelIds should return all level IDs", () => {
    const ids = getLevelIds();
    expect(ids).toContain("basic-arena");
    expect(ids).toContain("platforms");
    expect(ids).toContain("danger-zone");
    expect(ids).toContain("tower");
  });

  it("getAllLevels should return all levels", () => {
    const levels = getAllLevels();
    expect(levels.length).toBe(5);
    expect(levels).toContain(LEVEL_BASIC_ARENA);
    expect(levels).toContain(LEVEL_PLATFORMS);
  });
});

describe("validateLevel", () => {
  it("should pass valid level", () => {
    const result = validateLevel(LEVEL_PLATFORMS);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should fail level without id", () => {
    const badLevel = { ...LEVEL_BASIC_ARENA, id: "" };
    const result = validateLevel(badLevel);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("id"))).toBe(true);
  });

  it("should fail level without name", () => {
    const badLevel = { ...LEVEL_BASIC_ARENA, name: "" };
    const result = validateLevel(badLevel);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("should fail level without spawn points", () => {
    const badLevel = { ...LEVEL_BASIC_ARENA, spawnPoints: [] };
    const result = validateLevel(badLevel);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("spawn point"))).toBe(true);
  });

  it("should warn about single spawn point", () => {
    const singleSpawn = {
      ...LEVEL_BASIC_ARENA,
      spawnPoints: [LEVEL_BASIC_ARENA.spawnPoints[0]!],
    };
    const result = validateLevel(singleSpawn);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("one spawn point"))).toBe(true);
  });

  it("should fail on duplicate platform IDs", () => {
    const badLevel: LevelConfig = {
      ...LEVEL_BASIC_ARENA,
      platforms: [
        { id: "same", position: { x: 0, y: 0 }, width: 100, height: 20 },
        { id: "same", position: { x: 100, y: 0 }, width: 100, height: 20 },
      ],
    };
    const result = validateLevel(badLevel);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate platform ID"))).toBe(true);
  });

  it("should fail on invalid platform dimensions", () => {
    const badLevel: LevelConfig = {
      ...LEVEL_BASIC_ARENA,
      platforms: [{ id: "bad", position: { x: 0, y: 0 }, width: 0, height: 20 }],
    };
    const result = validateLevel(badLevel);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("invalid dimensions"))).toBe(true);
  });
});

describe("parseLevelFromJson", () => {
  it("should parse valid JSON string", () => {
    const json = JSON.stringify({
      id: "test-level",
      name: "Test Level",
      platforms: [],
      spawnPoints: [{ position: { x: 0, y: 0 } }, { position: { x: 100, y: 0 } }],
      hazards: [],
    });

    const level = parseLevelFromJson(json);
    expect(level.id).toBe("test-level");
    expect(level.name).toBe("Test Level");
  });

  it("should parse valid object", () => {
    const obj = {
      id: "test-level",
      name: "Test Level",
      platforms: [{ id: "plat1", position: { x: 0, y: 100 }, width: 100, height: 20 }],
      spawnPoints: [{ position: { x: 0, y: 0 } }, { position: { x: 100, y: 0 } }],
      hazards: [],
    };

    const level = parseLevelFromJson(obj);
    expect(level.id).toBe("test-level");
    expect(level.platforms.length).toBe(1);
    expect(level.platforms[0]?.width).toBe(100);
  });

  it("should throw on invalid JSON", () => {
    expect(() => parseLevelFromJson("not valid json")).toThrow("Invalid JSON");
  });

  it("should throw on missing id", () => {
    const obj = {
      name: "Test Level",
      platforms: [],
      spawnPoints: [{ position: { x: 0, y: 0 } }, { position: { x: 100, y: 0 } }],
      hazards: [],
    };
    expect(() => parseLevelFromJson(obj)).toThrow("id");
  });

  it("should throw on missing name", () => {
    const obj = {
      id: "test",
      platforms: [],
      spawnPoints: [{ position: { x: 0, y: 0 } }, { position: { x: 100, y: 0 } }],
      hazards: [],
    };
    expect(() => parseLevelFromJson(obj)).toThrow("name");
  });

  it("should throw on validation failure", () => {
    const obj = {
      id: "test",
      name: "Test",
      platforms: [],
      spawnPoints: [], // No spawn points - will fail validation
      hazards: [],
    };
    expect(() => parseLevelFromJson(obj)).toThrow("validation failed");
  });

  it("should parse optional fields", () => {
    const obj = {
      id: "test",
      name: "Test",
      description: "A test level",
      bounds: { width: 1000, height: 800 },
      platforms: [],
      spawnPoints: [{ position: { x: 0, y: 0 } }, { position: { x: 100, y: 0 } }],
      hazards: [],
    };

    const level = parseLevelFromJson(obj);
    expect(level.description).toBe("A test level");
    expect(level.bounds?.width).toBe(1000);
    expect(level.bounds?.height).toBe(800);
  });

  it("should handle missing optional fields gracefully", () => {
    const obj = {
      id: "minimal",
      name: "Minimal Level",
      spawnPoints: [{ position: { x: 0, y: 0 } }, { position: { x: 100, y: 0 } }],
    };

    const level = parseLevelFromJson(obj);
    expect(level.description).toBeUndefined();
    expect(level.bounds).toBeUndefined();
    expect(level.platforms).toHaveLength(0);
    expect(level.hazards).toHaveLength(0);
  });
});
