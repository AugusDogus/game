/**
 * Core type definitions for the game-agnostic netcode engine.
 *
 * These types define the contracts between your game logic and the netcode system.
 * Implement these for your specific game to enable prediction, reconciliation, and interpolation.
 *
 * @module core/types
 */

/**
 * Function that simulates one tick of the game world.
 *
 * This is the heart of your game logic. It must be **deterministic** - given the same
 * world state and inputs, it must always produce the exact same output. This is critical
 * for client-side prediction to match server simulation.
 *
 * @typeParam TWorld - Your game's world state type
 * @typeParam TInput - Your game's input type
 *
 * @param world - Current world state
 * @param inputs - Map of player ID to their input for this tick. Empty map means no inputs.
 * @param deltaTime - Time delta in milliseconds since last tick
 * @returns New world state after simulation (must be a new object, not mutated)
 *
 * @example
 * ```ts
 * const simulate: SimulateFunction<MyWorld, MyInput> = (world, inputs, dt) => {
 *   const newPlayers = new Map(world.players);
 *   for (const [id, input] of inputs) {
 *     const player = newPlayers.get(id);
 *     if (player) {
 *       newPlayers.set(id, {
 *         ...player,
 *         x: player.x + input.moveX * SPEED * (dt / 1000),
 *       });
 *     }
 *   }
 *   return { ...world, players: newPlayers };
 * };
 * ```
 */
export type SimulateFunction<TWorld, TInput> = (
  world: TWorld,
  inputs: Map<string, TInput>,
  deltaTime: number,
) => TWorld;

/**
 * Function that interpolates between two world states for smooth rendering.
 *
 * Used to render other players smoothly between server snapshots. The local player
 * uses prediction instead, so you typically only interpolate remote player positions.
 *
 * @typeParam TWorld - Your game's world state type
 *
 * @param from - Earlier world state (the "past" snapshot)
 * @param to - Later world state (the "future" snapshot)
 * @param alpha - Interpolation factor: 0.0 = fully `from`, 1.0 = fully `to`
 * @returns Interpolated world state
 *
 * @example
 * ```ts
 * const interpolate: InterpolateFunction<MyWorld> = (from, to, alpha) => {
 *   const players = new Map();
 *   for (const [id, toPlayer] of to.players) {
 *     const fromPlayer = from.players.get(id);
 *     if (fromPlayer) {
 *       players.set(id, {
 *         ...toPlayer,
 *         x: fromPlayer.x + (toPlayer.x - fromPlayer.x) * alpha,
 *         y: fromPlayer.y + (toPlayer.y - fromPlayer.y) * alpha,
 *       });
 *     } else {
 *       players.set(id, toPlayer);
 *     }
 *   }
 *   return { ...to, players };
 * };
 * ```
 */
export type InterpolateFunction<TWorld> = (from: TWorld, to: TWorld, alpha: number) => TWorld;

/**
 * Function to serialize world state for network transmission.
 *
 * Optional - if not provided, the library uses SuperJSON which handles
 * Map, Set, Date, and other JavaScript types automatically.
 *
 * @typeParam TWorld - Your game's world state type
 * @param world - World state to serialize
 * @returns Binary representation of the world state
 */
export type SerializeFunction<TWorld> = (world: TWorld) => Uint8Array;

/**
 * Function to deserialize world state from network data.
 *
 * Optional - if not provided, the library uses SuperJSON which handles
 * Map, Set, Date, and other JavaScript types automatically.
 *
 * @typeParam TWorld - Your game's world state type
 * @param data - Binary data received from network
 * @returns Deserialized world state
 */
export type DeserializeFunction<TWorld> = (data: Uint8Array) => TWorld;

/**
 * Complete game definition providing all simulation and rendering logic.
 *
 * This interface bundles all the functions the netcode engine needs from your game.
 * Used by lower-level APIs; the high-level `createNetcodeServer`/`createNetcodeClient`
 * accept these as separate config options.
 *
 * @typeParam TWorld - Your game's world state type
 * @typeParam TInput - Your game's input type
 */
export interface GameDefinition<TWorld, TInput> {
  /** Simulate one tick of the game world. See {@link SimulateFunction}. */
  simulate: SimulateFunction<TWorld, TInput>;

  /** Interpolate between two world states. See {@link InterpolateFunction}. */
  interpolate: InterpolateFunction<TWorld>;

  /** Optional custom binary serialization for network efficiency */
  serialize?: SerializeFunction<TWorld>;

  /** Optional custom binary deserialization for network efficiency */
  deserialize?: DeserializeFunction<TWorld>;
}

/**
 * A snapshot of the world state at a specific server tick.
 *
 * The server broadcasts snapshots to all clients at the tick rate (e.g., 20 Hz).
 * Clients use snapshots for:
 * - Reconciliation: comparing predicted state to authoritative state
 * - Interpolation: smoothly rendering other players between snapshots
 * - Lag compensation: rewinding to validate hits (via snapshot history)
 *
 * @typeParam TWorld - Your game's world state type
 */
export interface Snapshot<TWorld> {
  /** Server tick number (monotonically increasing) */
  tick: number;

  /** Server timestamp when this snapshot was created (Date.now() on server) */
  timestamp: number;

  /** Complete authoritative world state at this tick */
  state: TWorld;

  /**
   * Last processed input sequence number per player.
   * Used for reconciliation - client discards acknowledged inputs from buffer.
   */
  inputAcks: Map<string, number>;
}

/**
 * Input message sent from client to server.
 *
 * Wraps player input with metadata needed for server processing and reconciliation.
 *
 * @typeParam TInput - Your game's input type
 */
export interface InputMessage<TInput> {
  /** Client-assigned sequence number (monotonically increasing per client) */
  seq: number;

  /** The actual input data from the player */
  input: TInput;

  /** Client timestamp when input was captured (used for delta time calculation) */
  timestamp: number;
}

/**
 * Function to merge multiple inputs into one when several arrive in a single tick.
 *
 * When a client sends inputs faster than the server tick rate, multiple inputs
 * may queue up. This function decides how to combine them.
 *
 * Common strategies:
 * - Use the last input (default)
 * - Combine inputs (e.g., OR all jump presses so jumps aren't missed)
 *
 * @typeParam TInput - Your game's input type
 * @param inputs - Array of inputs to merge (never empty when called by the engine)
 * @returns Single merged input
 *
 * @example
 * ```ts
 * // Preserve jump if ANY input had it pressed (prevents missed jumps)
 * const mergeInputs: InputMerger<MyInput> = (inputs) => {
 *   const last = inputs[inputs.length - 1];
 *   const anyJump = inputs.some(i => i.jump);
 *   return { ...last, jump: anyJump };
 * };
 * ```
 */
export type InputMerger<TInput> = (inputs: TInput[]) => TInput;

// =============================================================================
// Action Types (for Lag Compensation)
// =============================================================================

/**
 * Action message sent from client to server for discrete game events.
 *
 * Actions are distinct from inputs:
 * - Inputs = continuous state (movement, aiming direction)
 * - Actions = discrete events (shoot, attack, use ability)
 *
 * Actions include a client timestamp for lag compensation - the server can
 * rewind to validate hits against where targets were from the shooter's perspective.
 *
 * @typeParam TAction - Your game's action type
 */
export interface ActionMessage<TAction> {
  /** Client-assigned sequence number (monotonically increasing per client) */
  seq: number;

  /** The actual action data */
  action: TAction;

  /**
   * Client timestamp when action occurred (Date.now() on client).
   * Server uses this + clock offset to calculate rewind time.
   */
  clientTimestamp: number;
}

/**
 * Result of an action after server validation.
 *
 * Sent back to the client to confirm or deny the action's effect.
 *
 * @typeParam TResult - Your game's result type (e.g., damage dealt, ability effect)
 */
export interface ActionResult<TResult> {
  /** Sequence number of the action this result corresponds to */
  seq: number;

  /** Whether the action was successful (e.g., hit landed) */
  success: boolean;

  /** Optional result data (e.g., damage dealt, target hit) */
  result?: TResult;

  /** Server timestamp when action was processed */
  serverTimestamp: number;
}

/**
 * Function to validate an action against a historical world state.
 *
 * This is the core of lag compensation - given the action and the world state
 * at the time the client performed the action, determine if it succeeds.
 *
 * @typeParam TWorld - Your game's world state type
 * @typeParam TAction - Your game's action type
 * @typeParam TResult - Your game's result type
 *
 * @param world - Historical world state (rewound to client's perspective)
 * @param clientId - ID of the client who performed the action
 * @param action - The action to validate
 * @returns Validation result with success flag and optional result data
 *
 * @example
 * ```ts
 * const validateAttack: ActionValidator<MyWorld, AttackAction, DamageResult> = (
 *   world, clientId, action
 * ) => {
 *   const attacker = world.players.get(clientId);
 *   if (!attacker) return { success: false };
 *
 *   // Check if any player is within attack range at historical position
 *   for (const [id, player] of world.players) {
 *     if (id === clientId) continue;
 *     const distance = Math.hypot(
 *       player.position.x - action.targetX,
 *       player.position.y - action.targetY
 *     );
 *     if (distance < ATTACK_RADIUS) {
 *       return { success: true, result: { targetId: id, damage: 10 } };
 *     }
 *   }
 *   return { success: false };
 * };
 * ```
 */
export type ActionValidator<TWorld, TAction, TResult> = (
  world: TWorld,
  clientId: string,
  action: TAction,
) => { success: boolean; result?: TResult };