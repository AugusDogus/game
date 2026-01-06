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
 * Default player movement speed (units per second)
 */
export const DEFAULT_PLAYER_SPEED = 200;

/**
 * Maximum input buffer size (prevent memory issues)
 */
export const MAX_INPUT_BUFFER_SIZE = 1024;
