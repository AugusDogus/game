import { DEFAULT_TICK_INTERVAL_MS } from "../constants.js";
import type { Snapshot } from "../core/types.js";
import type { InputBuffer } from "./input-buffer.js";
import type { PredictionScope } from "./prediction-scope.js";
import type { Predictor } from "./prediction.js";

/**
 * Result of a reconciliation operation, including position delta for visual smoothing.
 */
export interface ReconciliationResult<TWorld> {
  /** The merged world state for rendering */
  world: TWorld;
  /** Position delta (oldPos - newPos) for visual smoothing, null if position tracking unavailable */
  positionDelta: { x: number; y: number } | null;
}

/**
 * Handles server reconciliation by syncing server state and replaying unacknowledged inputs.
 * Generic version that works with any world state and input types.
 *
 * Replays inputs using the fixed tick interval to match server simulation exactly.
 * This ensures reconciliation produces the same state as the server,
 * minimizing visible snapping and providing smooth gameplay.
 */
export class Reconciler<TWorld, TInput extends { timestamp: number }> {
  private inputBuffer: InputBuffer<TInput>;
  private predictor: Predictor<TWorld, TInput>;
  private predictionScope: PredictionScope<TWorld, TInput>;
  private playerId: string;
  private tickIntervalMs: number;

  constructor(
    inputBuffer: InputBuffer<TInput>,
    predictor: Predictor<TWorld, TInput>,
    predictionScope: PredictionScope<TWorld, TInput>,
    playerId: string,
    tickIntervalMs: number = DEFAULT_TICK_INTERVAL_MS,
  ) {
    this.inputBuffer = inputBuffer;
    this.predictor = predictor;
    this.predictionScope = predictionScope;
    this.playerId = playerId;
    this.tickIntervalMs = tickIntervalMs;
  }

  /**
   * Reconcile server state with local prediction.
   * Returns the merged world state for rendering and position delta for visual smoothing.
   */
  reconcile(snapshot: Snapshot<TWorld>): ReconciliationResult<TWorld> {
    // Get the last processed sequence number for this player
    const lastProcessedSeq = snapshot.inputAcks.get(this.playerId) ?? -1;

    // Remove acknowledged inputs from buffer
    this.inputBuffer.acknowledge(lastProcessedSeq);

    // Capture position BEFORE reconciliation (for visual smoothing)
    let positionBefore: { x: number; y: number } | null = null;
    const predictedState = this.predictor.getState();
    if (predictedState && this.predictionScope.getLocalPlayerPosition) {
      positionBefore = this.predictionScope.getLocalPlayerPosition(predictedState, this.playerId);
    }

    // Set base state from server's authoritative world state
    this.predictor.setBaseState(snapshot.state, this.playerId);

    // Replay all unacknowledged inputs with their original timestamp deltas
    // This ensures reconciliation produces the same state as prediction did
    const unacknowledged = this.inputBuffer.getUnacknowledged(lastProcessedSeq);

    // Replay each unacknowledged input with the server's fixed tick delta
    // The server processes each input with a separate simulation call
    // using the fixed tick interval, so reconciliation must match this behavior
    for (const inputMsg of unacknowledged) {
      this.predictor.applyInputWithDelta(inputMsg.input, this.tickIntervalMs);
    }

    // Capture position AFTER reconciliation
    let positionDelta: { x: number; y: number } | null = null;
    const newPredictedState = this.predictor.getState();
    if (positionBefore && newPredictedState && this.predictionScope.getLocalPlayerPosition) {
      const positionAfter = this.predictionScope.getLocalPlayerPosition(newPredictedState, this.playerId);
      if (positionAfter) {
        // Delta = old position - new position (vector from new back to old)
        positionDelta = {
          x: positionBefore.x - positionAfter.x,
          y: positionBefore.y - positionAfter.y,
        };
      }
    }

    // Return merged state (server world + local predictions) and position delta
    return {
      world: this.predictor.mergeWithServer(snapshot.state),
      positionDelta,
    };
  }

  /**
   * Update the player ID (e.g., after reconnection)
   */
  setPlayerId(playerId: string): void {
    this.playerId = playerId;
  }
}
