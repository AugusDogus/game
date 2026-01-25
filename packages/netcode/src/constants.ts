/**
 * Default configuration constants for the netcode library
 */

/**
 * Default server tick rate: 60 Hz (~16.67ms per tick)
 * Aligns with standard client input rate (60Hz) to minimize prediction errors.
 * Games can override this for different requirements:
 * - 30 TPS for turn-based or slower games
 * - 128 TPS for competitive shooters
 */
export const DEFAULT_TICK_RATE = 60;

/**
 * Default tick interval in milliseconds (1000 / tickRate)
 */
export const DEFAULT_TICK_INTERVAL_MS = 1000 / DEFAULT_TICK_RATE; // ~16.67ms

/**
 * Default interpolation delay: ~50ms (3 ticks behind at 60 TPS)
 * This ensures smooth rendering of other entities while minimizing perceived lag.
 */
export const DEFAULT_INTERPOLATION_DELAY_MS = 50;

/**
 * Default snapshot history size: 180 snapshots
 * At 60 Hz, this covers 3 seconds of history for lag compensation
 */
export const DEFAULT_SNAPSHOT_HISTORY_SIZE = 180;

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
