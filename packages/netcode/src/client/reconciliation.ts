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
      return current ?? { id: this.playerId, position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, isGrounded: false, tick: 0 };
    }

    // Get the last processed sequence number for this player
    const lastProcessedSeq = snapshot.acks[this.playerId] ?? -1;

    // Remove acknowledged inputs from buffer
    this.inputBuffer.acknowledge(lastProcessedSeq);

    // Set base state to server's authoritative state
    this.predictor.setBaseState(serverState);

    // Replay all unacknowledged inputs with their actual time deltas
    const unacknowledged = this.inputBuffer.getUnacknowledged(lastProcessedSeq);
    let lastTimestamp: number | null = null;
    
    for (const inputMsg of unacknowledged) {
      // Calculate delta time from previous input
      let deltaTime: number;
      if (lastTimestamp !== null) {
        deltaTime = inputMsg.input.timestamp - lastTimestamp;
        // Clamp to reasonable bounds (1ms to 100ms)
        deltaTime = Math.max(1, Math.min(100, deltaTime));
      } else {
        // First input after server state - use reasonable default (~16.67ms for 60Hz)
        deltaTime = 16.67;
      }
      lastTimestamp = inputMsg.input.timestamp;
      
      this.predictor.applyInputWithDelta(inputMsg.input, deltaTime);
    }

    // Reset the predictor's timestamp tracking since we just reconciled
    this.predictor.resetTimestamp();

    // Return the reconciled state
    const reconciled = this.predictor.getState();
    return reconciled ?? serverState;
  }
}
