/**
 * Generic core types for game-agnostic netcode engine
 */

/**
 * Function that simulates the entire world state given inputs from all players.
 * Must be deterministic - same inputs must produce same outputs.
 *
 * @param world - Current world state
 * @param inputs - Map of player ID to their input for this tick
 * @param deltaTime - Time delta in milliseconds
 * @returns New world state after simulation
 */
export type SimulateFunction<TWorld, TInput> = (
  world: TWorld,
  inputs: Map<string, TInput>,
  deltaTime: number,
) => TWorld;

/**
 * Function that interpolates between two world states for smooth rendering.
 *
 * @param from - Earlier world state
 * @param to - Later world state
 * @param alpha - Interpolation factor (0.0 = from, 1.0 = to)
 * @returns Interpolated world state
 */
export type InterpolateFunction<TWorld> = (from: TWorld, to: TWorld, alpha: number) => TWorld;

/**
 * Optional function to serialize world state for network transmission.
 * If not provided, JSON serialization will be used.
 */
export type SerializeFunction<TWorld> = (world: TWorld) => Uint8Array;

/**
 * Optional function to deserialize world state from network data.
 * If not provided, JSON deserialization will be used.
 */
export type DeserializeFunction<TWorld> = (data: Uint8Array) => TWorld;

/**
 * Game definition that provides all simulation and interpolation logic.
 * Games must implement this to use the netcode engine.
 */
export interface GameDefinition<TWorld, TInput> {
  /** Simulate one tick of the game world */
  simulate: SimulateFunction<TWorld, TInput>;

  /** Interpolate between two world states for smooth rendering */
  interpolate: InterpolateFunction<TWorld>;

  /** Optional: Custom serialization for network efficiency */
  serialize?: SerializeFunction<TWorld>;

  /** Optional: Custom deserialization for network efficiency */
  deserialize?: DeserializeFunction<TWorld>;
}

/**
 * Generic snapshot containing world state at a specific tick.
 * Replaces the old player-specific WorldSnapshot.
 */
export interface Snapshot<TWorld> {
  /** Server tick number */
  tick: number;

  /** Timestamp when snapshot was created (server time) */
  timestamp: number;

  /** Complete world state at this tick */
  state: TWorld;

  /** Last processed input sequence number per player */
  inputAcks: Map<string, number>;
}

/**
 * Generic input message sent from client to server.
 */
export interface InputMessage<TInput> {
  /** Client-assigned sequence number */
  seq: number;

  /** The input data */
  input: TInput;

  /** Client timestamp when input was captured */
  timestamp: number;
}

/**
 * Function to merge multiple inputs into one for a tick.
 * Used when multiple inputs arrive between ticks.
 * Default behavior: use the last input.
 */
export type InputMerger<TInput> = (inputs: TInput[]) => TInput;
