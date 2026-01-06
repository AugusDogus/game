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
  /** Whether jump was pressed this frame */
  jump: boolean;
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
  /** Whether player is on the ground */
  isGrounded: boolean;
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
 * Physics function that applies player input to state.
 * Must be deterministic - same inputs must produce same outputs.
 * 
 * @param state - Current player state
 * @param input - Player input to apply
 * @param deltaTime - Time delta in milliseconds (optional, implementations should provide defaults)
 * @returns New player state after applying input
 */
export type PhysicsFunction = (
  state: PlayerState,
  input: PlayerInput,
  deltaTime?: number,
) => PlayerState;

/**
 * Configuration for NetcodeServer
 */
export interface NetcodeServerConfig {
  /** Server tick rate in Hz (default: 20) */
  tickRate?: number;
  /** Number of snapshots to keep in history for lag compensation (default: 60) */
  snapshotHistorySize?: number;
  /** Physics function to apply inputs (required) */
  applyInput: PhysicsFunction;
}

/**
 * Configuration for NetcodeClient
 */
export interface NetcodeClientConfig {
  /** Interpolation delay in milliseconds (default: 100) */
  interpolationDelay?: number;
  /** 
   * Simulated network latency in milliseconds (default: 0).
   * Useful for testing interpolation locally. Delays both incoming
   * snapshots and outgoing inputs.
   */
  simulatedLatency?: number;
  /** Physics function to apply inputs (required) */
  applyInput: PhysicsFunction;
  /** Callback when world state updates */
  onWorldUpdate?: (snapshot: WorldSnapshot) => void;
  /** Callback when a player joins */
  onPlayerJoin?: (playerId: string, state: PlayerState) => void;
  /** Callback when a player leaves */
  onPlayerLeave?: (playerId: string) => void;
}
