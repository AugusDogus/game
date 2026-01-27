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
 * Default interpolation ticks for spectators (used for lag compensation calculations).
 * With adaptive interpolation, this is dynamically adjusted based on RTT.
 */
export const DEFAULT_SPECTATOR_INTERPOLATION_TICKS = 2;

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

/**
 * Tolerance for tick interval mismatch between server and client config.
 * If the server's tickIntervalMs differs from client config by more than this,
 * an error is thrown. Default: 1ms (allows for floating point rounding).
 */
export const TICK_INTERVAL_MISMATCH_TOLERANCE_MS = 1;

/**
 * Timeout in milliseconds for waiting for server config handshake.
 * If the client doesn't receive netcode:config within this time, an error is thrown.
 * Default: 10 seconds.
 */
export const CONFIG_HANDSHAKE_TIMEOUT_MS = 10000;

/**
 * Default interval for server timing updates (1 second).
 * Used for client-side tick alignment.
 */
export const DEFAULT_TIMING_UPDATE_INTERVAL_MS = 1000;
