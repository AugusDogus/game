/**
 * Prediction scope configuration for client-side prediction.
 *
 * Client-side prediction makes the local player's movement feel instant by simulating
 * inputs locally before the server confirms them. The prediction scope defines *what*
 * to predict and *how* to simulate it.
 *
 * @module client/prediction-scope
 */

/**
 * Defines what parts of the world state should be predicted client-side.
 *
 * Most games only predict the local player's state. However, you might also predict:
 * - Objects the player is directly manipulating (e.g., a ball being kicked)
 * - Projectiles the player fired
 * - Physics objects the player is pushing
 *
 * The prediction scope separates "what I control" from "what the server controls",
 * allowing the client to show immediate feedback for local actions while still
 * displaying authoritative server state for everything else.
 *
 * @typeParam TWorld - Your game's world state type
 * @typeParam TInput - Your game's input type
 *
 * @example
 * ```ts
 * const myPredictionScope: PredictionScope<MyWorld, MyInput> = {
 *   extractPredictable(world, playerId) {
 *     // Only predict the local player
 *     const player = world.players.get(playerId);
 *     if (!player) return { players: new Map() };
 *     return { players: new Map([[playerId, player]]) };
 *   },
 *
 *   mergePrediction(serverWorld, predicted) {
 *     // Replace server's version of local player with predicted version
 *     const merged = new Map(serverWorld.players);
 *     if (predicted.players) {
 *       for (const [id, player] of predicted.players) {
 *         merged.set(id, player);
 *       }
 *     }
 *     return { ...serverWorld, players: merged };
 *   },
 *
 *   simulatePredicted(state, input, dt) {
 *     // Apply input to predicted player (same physics as server)
 *     // ...
 *   },
 *
 *   createIdleInput() {
 *     return { moveX: 0, moveY: 0, jump: false, timestamp: 0 };
 *   },
 * };
 * ```
 */
export interface PredictionScope<TWorld, TInput> {
  /**
   * Extract the portion of world state that should be predicted locally.
   *
   * Called when a server snapshot arrives to initialize/reset prediction state.
   * Return only the parts of the world that the local player directly controls.
   *
   * @param world - Full authoritative world state from server
   * @param localPlayerId - The local player's ID (from socket connection)
   * @returns Partial world state containing only predictable entities
   */
  extractPredictable(world: TWorld, localPlayerId: string): Partial<TWorld>;

  /**
   * Merge predicted state back into the full world state for rendering.
   *
   * Called every frame to combine:
   * - Server state for remote players (interpolated)
   * - Predicted state for local player
   *
   * @param serverWorld - Authoritative/interpolated world state from server
   * @param predicted - Locally predicted state from {@link extractPredictable}
   * @param localPlayerId - The local player's ID (optional for backwards compatibility)
   * @returns Complete world state ready for rendering
   */
  mergePrediction(serverWorld: TWorld, predicted: Partial<TWorld>, localPlayerId?: string): TWorld;

  /**
   * Simulate the predictable portion of the world with a local input.
   *
   * Called immediately when the player provides input, before sending to server.
   * Must use the **same physics** as the server's simulate function to avoid
   * mispredictions.
   *
   * @param state - Current predicted state
   * @param input - Local player's input
   * @param deltaTime - Time delta in milliseconds since last input
   * @param localPlayerId - The local player's ID (optional for backwards compatibility)
   * @returns Updated predicted state
   */
  simulatePredicted(state: Partial<TWorld>, input: TInput, deltaTime: number, localPlayerId?: string): Partial<TWorld>;

  /**
   * Create a neutral/idle input with no actions.
   *
   * Used during reconciliation when replaying inputs. The timestamp field
   * will be overwritten, so it can be set to any value.
   *
   * @returns An input representing "no action" (e.g., no movement, no buttons pressed)
   */
  createIdleInput(): TInput;

  /**
   * Get the local player's position from the predicted state.
   *
   * Optional method used by visual smoothing to track position changes during
   * reconciliation. If not implemented, visual smoothing will be disabled.
   *
   * @param state - The predicted state (partial world)
   * @param localPlayerId - The local player's ID
   * @returns Player position as {x, y}, or null if player not found
   */
  getLocalPlayerPosition?(state: Partial<TWorld>, localPlayerId: string): { x: number; y: number } | null;

  /**
   * Apply a visual offset to the local player in the world state.
   *
   * Optional method used by visual smoothing to offset the rendered position
   * without affecting physics state. If not implemented, visual smoothing
   * will be disabled.
   *
   * @param world - The world state to modify
   * @param localPlayerId - The local player's ID
   * @param offsetX - X offset to apply
   * @param offsetY - Y offset to apply
   * @returns Modified world state with offset applied
   */
  applyVisualOffset?(world: TWorld, localPlayerId: string, offsetX: number, offsetY: number): TWorld;
}

/**
 * A prediction scope that predicts nothing.
 *
 * Use this for:
 * - Turn-based games where prediction isn't needed
 * - Spectator clients that only watch
 * - Testing server-authoritative behavior without prediction
 *
 * @typeParam TWorld - Your game's world state type
 * @typeParam TInput - Your game's input type
 *
 * @example
 * ```ts
 * const spectatorScope = new NoPredictionScope<MyWorld, MyInput>({
 *   moveX: 0,
 *   moveY: 0,
 *   jump: false,
 *   timestamp: 0,
 * });
 * ```
 */
export class NoPredictionScope<TWorld, TInput> implements PredictionScope<TWorld, TInput> {
  private idleInput: TInput;

  /**
   * Create a no-prediction scope.
   *
   * @param idleInput - The idle input to return from {@link createIdleInput}
   */
  constructor(idleInput: TInput) {
    this.idleInput = idleInput;
  }

  extractPredictable(_world: TWorld, _localPlayerId: string): Partial<TWorld> {
    return {};
  }

  mergePrediction(serverWorld: TWorld, _predicted: Partial<TWorld>): TWorld {
    return serverWorld;
  }

  simulatePredicted(state: Partial<TWorld>, _input: TInput, _deltaTime: number): Partial<TWorld> {
    return state;
  }

  createIdleInput(): TInput {
    return this.idleInput;
  }
}
