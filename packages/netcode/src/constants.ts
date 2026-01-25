/**
 * Default configuration constants for the netcode library
 */

/**
 * Default server tick rate: 20 Hz (50ms per tick)
 * Matches industry standards like Apex Legends and Warzone
 */
export const DEFAULT_TICK_RATE = 20;

/**
 * Default tick interval in milliseconds (1000 / tickRate)
 */
export const DEFAULT_TICK_INTERVAL_MS = 1000 / DEFAULT_TICK_RATE; // 50ms

/**
 * Default interpolation delay: 100ms (2 ticks behind)
 * This ensures smooth rendering of other entities
 */
export const DEFAULT_INTERPOLATION_DELAY_MS = 100;

/**
 * Default snapshot history size: 60 snapshots
 * At 20 Hz, this covers 3 seconds of history for lag compensation
 */
export const DEFAULT_SNAPSHOT_HISTORY_SIZE = 60;

/**
 * Floor Y position (ground level)
 * In Y-up coordinates, floor is at y=0
 */
export const DEFAULT_FLOOR_Y = 0;

/**
 * Maximum input buffer size (prevent memory issues)
 */
export const MAX_INPUT_BUFFER_SIZE = 1024;

/**
 * Default frame delta time: ~16.67ms (60Hz)
 * Used when no previous timestamp is available for delta calculation
 */
export const DEFAULT_FRAME_DELTA_MS = 1000 / 60; // ~16.67ms

/**
 * Minimum delta time clamp (1ms)
 * Prevents division by zero and unrealistic physics
 */
export const MIN_DELTA_MS = 1;

/**
 * Maximum delta time clamp (100ms)
 * Prevents large jumps from network delays or paused clients
 */
export const MAX_DELTA_MS = 100;
