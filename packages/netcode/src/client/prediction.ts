import { DEFAULT_FRAME_DELTA_MS, MIN_DELTA_MS, MAX_DELTA_MS } from "../constants.js";
import type { PredictionScope } from "./prediction-scope.js";

/**
 * Handles client-side prediction by applying inputs locally.
 * Generic version that works with any world state and input types.
 */
export class Predictor<TWorld, TInput extends { timestamp: number }> {
  private predictedState: Partial<TWorld> | null = null;
  private predictionScope: PredictionScope<TWorld, TInput>;
  private lastInputTimestamp: number | null = null;

  constructor(predictionScope: PredictionScope<TWorld, TInput>) {
    this.predictionScope = predictionScope;
  }

  /**
   * Set the base state from server snapshot.
   * Extracts the predictable portion using the prediction scope.
   */
  setBaseState(world: TWorld, localPlayerId: string): void {
    this.predictedState = this.predictionScope.extractPredictable(world, localPlayerId);
  }

  /**
   * Set the predicted state directly (used during reconciliation)
   */
  setPredictedState(state: Partial<TWorld>): void {
    this.predictedState = state;
  }

  /**
   * Get the current predicted state
   */
  getState(): Partial<TWorld> | null {
    return this.predictedState;
  }

  /**
   * Apply an input to the local state (prediction).
   * Uses the actual time delta between inputs for accurate physics.
   */
  applyInput(input: TInput): void {
    if (!this.predictedState) {
      return;
    }

    // Calculate actual delta time from input timestamps
    let deltaTime: number;
    if (this.lastInputTimestamp !== null) {
      deltaTime = input.timestamp - this.lastInputTimestamp;
      // Clamp to reasonable bounds
      deltaTime = Math.max(MIN_DELTA_MS, Math.min(MAX_DELTA_MS, deltaTime));
    } else {
      // First input - use a reasonable default (~16.67ms for 60Hz)
      deltaTime = DEFAULT_FRAME_DELTA_MS;
    }

    this.lastInputTimestamp = input.timestamp;

    this.predictedState = this.predictionScope.simulatePredicted(
      this.predictedState,
      input,
      deltaTime,
    );
  }

  /**
   * Apply an input with explicit deltaTime (used during reconciliation replay)
   */
  applyInputWithDelta(input: TInput, deltaTime: number): void {
    if (!this.predictedState) {
      return;
    }
    this.predictedState = this.predictionScope.simulatePredicted(
      this.predictedState,
      input,
      deltaTime,
    );
  }

  /**
   * Merge predicted state with server world for rendering
   */
  mergeWithServer(serverWorld: TWorld): TWorld {
    if (!this.predictedState) {
      return serverWorld;
    }
    return this.predictionScope.mergePrediction(serverWorld, this.predictedState);
  }

  /**
   * Reset prediction state
   */
  reset(): void {
    this.predictedState = null;
    this.lastInputTimestamp = null;
  }

  /**
   * Reset the last input timestamp (used after reconciliation)
   */
  resetTimestamp(): void {
    this.lastInputTimestamp = null;
  }

  /**
   * Set the last input timestamp (used after reconciliation replay)
   */
  setLastInputTimestamp(timestamp: number): void {
    this.lastInputTimestamp = timestamp;
  }
}
