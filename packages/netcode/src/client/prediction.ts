import type { PlayerState, PlayerInput } from "../types.js";
import { applyInput } from "../physics.js";

/**
 * Handles client-side prediction by applying inputs locally
 */
export class Predictor {
  private localState: PlayerState | null = null;

  /**
   * Set the base state (from server)
   */
  setBaseState(state: PlayerState): void {
    this.localState = { ...state };
  }

  /**
   * Get the current predicted state
   */
  getState(): PlayerState | null {
    return this.localState;
  }

  /**
   * Apply an input to the local state (prediction)
   */
  applyInput(input: PlayerInput): void {
    if (!this.localState) {
      return;
    }

    this.localState = applyInput(this.localState, input);
  }

  /**
   * Reset prediction state
   */
  reset(): void {
    this.localState = null;
  }
}
