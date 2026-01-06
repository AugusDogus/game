import type { PlayerState, WorldSnapshot } from "../types.js";
import type { InputBuffer } from "./input-buffer.js";
import type { Predictor } from "./prediction.js";

/**
 * Handles server reconciliation by syncing server state and replaying unacknowledged inputs
 */
export class Reconciler {
  private inputBuffer: InputBuffer;
  private predictor: Predictor;
  private playerId: string;

  constructor(inputBuffer: InputBuffer, predictor: Predictor, playerId: string) {
    this.inputBuffer = inputBuffer;
    this.predictor = predictor;
    this.playerId = playerId;
  }

  /**
   * Reconcile server state with local prediction
   * Returns the reconciled player state
   */
  reconcile(snapshot: WorldSnapshot): PlayerState {
    // Find our player in the snapshot
    const serverState = snapshot.players.find((p) => p.id === this.playerId);
    if (!serverState) {
      // Player not in snapshot, return current predicted state or create default
      const current = this.predictor.getState();
      return current ?? { id: this.playerId, position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, tick: 0 };
    }

    // Get the last processed sequence number for this player
    const lastProcessedSeq = snapshot.acks[this.playerId] ?? -1;

    // Remove acknowledged inputs from buffer
    this.inputBuffer.acknowledge(lastProcessedSeq);

    // Set base state to server's authoritative state
    this.predictor.setBaseState(serverState);

    // Replay all unacknowledged inputs
    const unacknowledged = this.inputBuffer.getUnacknowledged(lastProcessedSeq);
    for (const inputMsg of unacknowledged) {
      this.predictor.applyInput(inputMsg.input);
    }

    // Return the reconciled state
    const reconciled = this.predictor.getState();
    return reconciled ?? serverState;
  }
}
