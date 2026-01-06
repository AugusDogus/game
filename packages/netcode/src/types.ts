/**
 * Core type definitions for the netcode library
 */

/**
 * 2D vector representing position or velocity
 */
export interface Vector2 {
  x: number;
  y: number;
}

/**
 * Player input state (keys pressed, mouse position, etc.)
 */
export interface PlayerInput {
  /** Movement direction (-1 to 1 for each axis) */
  moveX: number;
  moveY: number;
  /** Timestamp when input was captured (client-side) */
  timestamp: number;
}

/**
 * Player state as managed by the server
 */
export interface PlayerState {
  /** Unique player identifier */
  id: string;
  /** Current position */
  position: Vector2;
  /** Current velocity */
  velocity: Vector2;
  /** Last server tick this state was updated */
  tick: number;
}

/**
 * World snapshot containing all player states at a specific tick
 */
export interface WorldSnapshot {
  /** Server tick number */
  tick: number;
  /** Timestamp when snapshot was created */
  timestamp: number;
  /** All player states at this tick */
  players: PlayerState[];
  /** Last processed input sequence number per player */
  acks: Record<string, number>;
}

/**
 * Input message sent from client to server
 */
export interface InputMessage {
  /** Client-assigned sequence number */
  seq: number;
  /** The input data */
  input: PlayerInput;
  /** Client timestamp */
  timestamp: number;
}

/**
 * Configuration for NetcodeServer
 */
export interface NetcodeServerConfig {
  /** Server tick rate in Hz (default: 20) */
  tickRate?: number;
  /** Number of snapshots to keep in history for lag compensation (default: 60) */
  snapshotHistorySize?: number;
}

/**
 * Configuration for NetcodeClient
 */
export interface NetcodeClientConfig {
  /** Interpolation delay in milliseconds (default: 100) */
  interpolationDelay?: number;
  /** Callback when world state updates */
  onWorldUpdate?: (snapshot: WorldSnapshot) => void;
  /** Callback when a player joins */
  onPlayerJoin?: (playerId: string, state: PlayerState) => void;
  /** Callback when a player leaves */
  onPlayerLeave?: (playerId: string) => void;
}
