import { DEFAULT_TICK_INTERVAL_MS } from "../constants.js";
import type { Snapshot } from "../core/types.js";
import type { InputBuffer } from "./input-buffer.js";
import type { PredictionScope } from "./prediction-scope.js";
import type { Predictor } from "./prediction.js";

/**
 * Callback invoked during reconciliation replay for each replayed tick.
 * Used by tick-based smoothing to ease-in corrections to buffered positions.
 *
 * @param tick - The tick number being replayed
 * @param state - The predicted state after applying the input for this tick
 */
export type ReconciliationReplayCallback<TWorld> = (tick: number, state: Partial<TWorld>) => void;

/**
 * Handles server reconciliation by syncing server state and replaying unacknowledged inputs.
 * Generic version that works with any world state and input types.
 *
 * Replays inputs using the fixed tick interval to match server simulation exactly.
 * This ensures reconciliation produces the same state as the server,
 * minimizing visible snapping and providing smooth gameplay.
 *
 * The replay callback allows external systems (like TickSmoother) to receive
 * corrected positions during replay for ease-in smoothing.
 */
export class Reconciler<TWorld, TInput extends { timestamp: number }> {
  private inputBuffer: InputBuffer<TInput>;
  private predictor: Predictor<TWorld, TInput>;
  private playerId: string;
  private tickIntervalMs: number;
  private onReplayCallback: ReconciliationReplayCallback<TWorld> | null = null;

  constructor(
    inputBuffer: InputBuffer<TInput>,
    predictor: Predictor<TWorld, TInput>,
    _predictionScope: PredictionScope<TWorld, TInput>, // Kept for API compatibility
    playerId: string,
    tickIntervalMs: number = DEFAULT_TICK_INTERVAL_MS,
  ) {
    this.inputBuffer = inputBuffer;
    this.predictor = predictor;
    this.playerId = playerId;
    this.tickIntervalMs = tickIntervalMs;
  }

  /**
   * Set a callback to be invoked during replay for each tick.
   * Used by tick-based smoothing to ease-in corrections.
   *
   * @param callback - Function called with (tick, state) for each replayed input
   */
  setReplayCallback(callback: ReconciliationReplayCallback<TWorld> | null): void {
    this.onReplayCallback = callback;
  }

  /**
   * Reconcile server state with local prediction.
   *
   * 1. Acknowledges inputs that the server has processed
   * 2. Sets the predictor base state to the server's authoritative state
   * 3. Replays all unacknowledged inputs to rebuild the predicted state
   * 4. Calls the replay callback for each replayed tick (for smoothing)
   *
   * @param snapshot - Server snapshot containing authoritative state and input acks
   */
  reconcile(snapshot: Snapshot<TWorld>): void {
    // Get the last processed sequence number for this player
    const lastProcessedSeq = snapshot.inputAcks.get(this.playerId) ?? -1;

    // Remove acknowledged inputs from buffer
    this.inputBuffer.acknowledge(lastProcessedSeq);

    // Set base state from server's authoritative world state
    this.predictor.setBaseState(snapshot.state, this.playerId);

    // Replay all unacknowledged inputs
    const unacknowledged = this.inputBuffer.getUnacknowledged(lastProcessedSeq);

    // Replay each unacknowledged input with the server's fixed tick delta
    // The server processes each input with a separate simulation call
    // using the fixed tick interval, so reconciliation must match this behavior
    for (const inputMsg of unacknowledged) {
      this.predictor.applyInputWithDelta(inputMsg.input, this.tickIntervalMs);

      // Notify smoother to ease-in the corrected state using input seq
      // (matches the tick-smoother queue indexing for local inputs)
      if (this.onReplayCallback) {
        const currentState = this.predictor.getState();
        if (currentState) {
          this.onReplayCallback(inputMsg.seq, currentState);
        }
      }
    }
  }

  /**
   * Update the player ID (e.g., after reconnection)
   */
  setPlayerId(playerId: string): void {
    this.playerId = playerId;
  }
}
