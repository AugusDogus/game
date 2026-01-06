import type { PlayerState, PlayerInput, PhysicsFunction } from "../types.js";
import { DEFAULT_TICK_INTERVAL_MS } from "../constants.js";

/**
 * Handles client-side prediction by applying inputs locally
 */
export class Predictor {
  private localState: PlayerState | null = null;
  private physicsFunction: PhysicsFunction;

  constructor(physicsFunction: PhysicsFunction) {
    this.physicsFunction = physicsFunction;
  }

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
  applyInput(input: PlayerInput, deltaTime: number = DEFAULT_TICK_INTERVAL_MS): void {
    if (!this.localState) {
      return;
    }

    this.localState = this.physicsFunction(this.localState, input, deltaTime);
  }

  /**
   * Reset prediction state
   */
  reset(): void {
    this.localState = null;
  }
}
