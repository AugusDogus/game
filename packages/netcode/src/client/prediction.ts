import { DEFAULT_TICK_INTERVAL_MS, MIN_DELTA_MS, MAX_DELTA_MS } from "../constants.js";
import type { PredictionScope } from "./prediction-scope.js";

/**
 * Handles client-side prediction by applying inputs locally.
 * Generic version that works with any world state and input types.
 *
 * Prediction uses actual elapsed time between inputs for smooth 60fps gameplay.
 * Reconciliation replay uses the fixed tick interval to match server simulation.
 */
export class Predictor<TWorld, TInput extends { timestamp: number }> {
  private predictedState: Partial<TWorld> | null = null;
  private predictionScope: PredictionScope<TWorld, TInput>;
  private localPlayerId: string | null = null;
  private tickIntervalMs: number;
  private lastInputTimestamp: number = 0;

  constructor(
    predictionScope: PredictionScope<TWorld, TInput>,
    tickIntervalMs: number = DEFAULT_TICK_INTERVAL_MS,
  ) {
    this.predictionScope = predictionScope;
    this.tickIntervalMs = tickIntervalMs;
  }

  /**
   * Set the local player ID for simulation
   */
  setLocalPlayerId(playerId: string): void {
    this.localPlayerId = playerId;
  }

  /**
   * Set the base state from server snapshot.
   * Extracts the predictable portion using the prediction scope.
   * Resets timestamp tracking since we're starting from server state.
   */
  setBaseState(world: TWorld, localPlayerId: string): void {
    this.localPlayerId = localPlayerId;
    this.predictedState = this.predictionScope.extractPredictable(world, localPlayerId);
    // Reset timestamp since we're starting fresh from server state
    // Reconciliation replay will use applyInputWithDelta, not applyInput
    this.lastInputTimestamp = 0;
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
   * Uses the fixed tick interval to match server simulation exactly.
   * This ensures prediction matches what the server will compute,
   * minimizing reconciliation corrections.
   */
  applyInput(input: TInput): void {
    if (!this.predictedState) {
      return;
    }

    // Use fixed tick interval to match server simulation
    // The server processes each input with this fixed delta,
    // so client prediction must use the same delta for determinism
    const deltaTime = this.tickIntervalMs;
    
    this.lastInputTimestamp = input.timestamp;

    this.predictedState = this.predictionScope.simulatePredicted(
      this.predictedState,
      input,
      deltaTime,
      this.localPlayerId ?? undefined,
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
      this.localPlayerId ?? undefined,
    );
  }

  /**
   * Merge predicted state with server world for rendering
   */
  mergeWithServer(serverWorld: TWorld): TWorld {
    if (!this.predictedState) {
      return serverWorld;
    }
    return this.predictionScope.mergePrediction(
      serverWorld,
      this.predictedState,
      this.localPlayerId ?? undefined,
    );
  }

  /**
   * Reset prediction state
   */
  reset(): void {
    this.predictedState = null;
    this.lastInputTimestamp = 0;
  }
}
