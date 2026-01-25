import { describe, test, expect } from "bun:test";
import {
  DEFAULT_TICK_RATE,
  DEFAULT_TICK_INTERVAL_MS,
  DEFAULT_INTERPOLATION_DELAY_MS,
  DEFAULT_SNAPSHOT_HISTORY_SIZE,
  DEFAULT_FLOOR_Y,
  MAX_INPUT_BUFFER_SIZE,
} from "./constants.js";

describe("constants", () => {
  test("DEFAULT_TICK_RATE should be 20 Hz", () => {
    expect(DEFAULT_TICK_RATE).toBe(20);
  });

  test("DEFAULT_TICK_INTERVAL_MS should be 50ms (1000/20)", () => {
    expect(DEFAULT_TICK_INTERVAL_MS).toBe(50);
    expect(DEFAULT_TICK_INTERVAL_MS).toBe(1000 / DEFAULT_TICK_RATE);
  });

  test("DEFAULT_INTERPOLATION_DELAY_MS should be 100ms", () => {
    expect(DEFAULT_INTERPOLATION_DELAY_MS).toBe(100);
  });

  test("DEFAULT_SNAPSHOT_HISTORY_SIZE should cover 3 seconds", () => {
    // At 20 Hz, 60 snapshots = 3 seconds
    expect(DEFAULT_SNAPSHOT_HISTORY_SIZE).toBe(60);
    expect(DEFAULT_SNAPSHOT_HISTORY_SIZE / DEFAULT_TICK_RATE).toBe(3);
  });

  test("DEFAULT_FLOOR_Y should be at ground level (y=0)", () => {
    expect(DEFAULT_FLOOR_Y).toBe(0);
  });

  test("MAX_INPUT_BUFFER_SIZE should be reasonable", () => {
    expect(MAX_INPUT_BUFFER_SIZE).toBeGreaterThan(0);
    expect(MAX_INPUT_BUFFER_SIZE).toBeLessThanOrEqual(10000);
  });
});
