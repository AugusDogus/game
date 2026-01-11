import { DEFAULT_FRAME_DELTA_MS, MIN_DELTA_MS, MAX_DELTA_MS } from "../constants.js";
import type { Snapshot } from "../core/types.js";
import type { InputBuffer } from "./input-buffer.js";
import type { PredictionScope } from "./prediction-scope.js";
import type { Predictor } from "./prediction.js";

/**
 * Handles server reconciliation by syncing server state and replaying unacknowledged inputs.
 * Generic version that works with any world state and input types.
 */
export class Reconciler<TWorld, TInput extends { timestamp: number }> {
  private inputBuffer: InputBuffer<TInput>;
  private predictor: Predictor<TWorld, TInput>;
  private predictionScope: PredictionScope<TWorld, TInput>;
  private playerId: string;

  constructor(
    inputBuffer: InputBuffer<TInput>,
    predictor: Predictor<TWorld, TInput>,
    predictionScope: PredictionScope<TWorld, TInput>,
    playerId: string,
  ) {
    this.inputBuffer = inputBuffer;
    this.predictor = predictor;
    this.predictionScope = predictionScope;
    this.playerId = playerId;
  }

  /**
   * Reconcile server state with local prediction.
   * Returns the merged world state for rendering.
   */
  reconcile(snapshot: Snapshot<TWorld>): TWorld {
    // Get the last processed sequence number for this player
    const lastProcessedSeq = snapshot.inputAcks.get(this.playerId) ?? -1;

    // Get the timestamp of the last acknowledged input BEFORE we remove it
    // This is needed to calculate the correct delta for the first unacked input
    const lastAckedInput = lastProcessedSeq >= 0 ? this.inputBuffer.get(lastProcessedSeq) : null;
    const lastAckedTimestamp = lastAckedInput?.timestamp ?? null;

    // Remove acknowledged inputs from buffer
    this.inputBuffer.acknowledge(lastProcessedSeq);

    // Set base state from server's authoritative world state
    this.predictor.setBaseState(snapshot.state, this.playerId);

    // Replay all unacknowledged inputs with their actual time deltas
    const unacknowledged = this.inputBuffer.getUnacknowledged(lastProcessedSeq);
    // Start with the last acked input's timestamp so the first replay uses the correct delta
    let lastTimestamp: number | null = lastAckedTimestamp;

    for (const inputMsg of unacknowledged) {
      // Calculate delta time from previous input
      let deltaTime: number;
      if (lastTimestamp !== null) {
        deltaTime = inputMsg.input.timestamp - lastTimestamp;
        // Clamp to reasonable bounds
        deltaTime = Math.max(MIN_DELTA_MS, Math.min(MAX_DELTA_MS, deltaTime));
      } else {
        // First input ever - use reasonable default (~16.67ms for 60Hz)
        deltaTime = DEFAULT_FRAME_DELTA_MS;
      }
      lastTimestamp = inputMsg.input.timestamp;

      this.predictor.applyInputWithDelta(inputMsg.input, deltaTime);
    }

    // Set the predictor's timestamp to the last replayed input's timestamp
    // so the next predicted input uses the correct delta (matching server behavior)
    const lastReplayedInput = unacknowledged.at(-1);
    if (lastReplayedInput) {
      this.predictor.setLastInputTimestamp(lastReplayedInput.input.timestamp);
    }
    // If no inputs were replayed, don't reset - keep the existing timestamp
    // so the next input calculates delta from the last input we sent

    // Return merged state (server world + local predictions)
    return this.predictor.mergeWithServer(snapshot.state);
  }

  /**
   * Update the player ID (e.g., after reconnection)
   */
  setPlayerId(playerId: string): void {
    this.playerId = playerId;
  }
}
