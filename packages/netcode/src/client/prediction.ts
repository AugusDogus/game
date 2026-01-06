import type { PlayerState, PlayerInput, PhysicsFunction } from "../types.js";

/**
 * Handles client-side prediction by applying inputs locally
 */
export class Predictor {
  private localState: PlayerState | null = null;
  private physicsFunction: PhysicsFunction;
  private lastInputTimestamp: number | null = null;

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
   * Apply an input to the local state (prediction).
   * Uses the actual time delta between inputs for accurate physics.
   */
  applyInput(input: PlayerInput): void {
    if (!this.localState) {
      return;
    }

    // Calculate actual delta time from input timestamps
    let deltaTime: number;
    if (this.lastInputTimestamp !== null) {
      deltaTime = input.timestamp - this.lastInputTimestamp;
      // Clamp to reasonable bounds (1ms to 100ms)
      deltaTime = Math.max(1, Math.min(100, deltaTime));
    } else {
      // First input - use a reasonable default (~16.67ms for 60Hz)
      deltaTime = 16.67;
    }
    this.lastInputTimestamp = input.timestamp;

    this.localState = this.physicsFunction(this.localState, input, deltaTime);
  }

  /**
   * Apply an input with explicit deltaTime (used during reconciliation replay)
   */
  applyInputWithDelta(input: PlayerInput, deltaTime: number): void {
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
    this.lastInputTimestamp = null;
  }

  /**
   * Reset the last input timestamp (used after reconciliation)
   */
  resetTimestamp(): void {
    this.lastInputTimestamp = null;
  }
}
