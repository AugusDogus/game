/**
 * Prediction scope configuration for client-side prediction.
 * Allows games to specify what parts of the world to predict locally.
 */

/**
 * Defines what parts of the world state should be predicted client-side.
 * Games implement this to control prediction behavior.
 */
export interface PredictionScope<TWorld, TInput> {
  /**
   * Extract the portion of world state that should be predicted locally.
   * Typically this is just the local player, but could include objects
   * the player is directly interacting with (e.g., a ball they're kicking).
   *
   * @param world - Full world state from server
   * @param localPlayerId - The local player's ID
   * @returns Partial world state to predict
   */
  extractPredictable(world: TWorld, localPlayerId: string): Partial<TWorld>;

  /**
   * Merge predicted state back into the full world state.
   * Called when rendering to combine server state with local predictions.
   *
   * @param serverWorld - Authoritative world state from server
   * @param predicted - Locally predicted state
   * @returns Merged world state for rendering
   */
  mergePrediction(serverWorld: TWorld, predicted: Partial<TWorld>): TWorld;

  /**
   * Simulate just the predictable portion of the world.
   * This is called on every local input for immediate feedback.
   *
   * @param state - Current predicted state
   * @param input - Local player input
   * @param deltaTime - Time delta in milliseconds
   * @returns Updated predicted state
   */
  simulatePredicted(state: Partial<TWorld>, input: TInput, deltaTime: number): Partial<TWorld>;

  /**
   * Create an idle/empty input for when no input is provided.
   * Used during reconciliation replay when inputs are missing.
   */
  createIdleInput(): TInput;
}

/**
 * Default prediction scope that predicts nothing.
 * Useful for games that don't need client-side prediction.
 */
export class NoPredictionScope<TWorld, TInput> implements PredictionScope<TWorld, TInput> {
  private idleInput: TInput;

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
