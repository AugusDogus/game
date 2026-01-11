/**
 * Rollback netcode strategy (GGPO-style).
 * All clients simulate the full game state; late inputs trigger rollback and resimulation.
 *
 * Note: This is a basic implementation. Production rollback netcode would need:
 * - Input prediction for remote players
 * - Checksum validation for desync detection
 * - More sophisticated input delay management
 */

import { SnapshotBuffer } from "../core/snapshot-buffer.js";
import type { SimulateFunction, Snapshot } from "../core/types.js";
import { getOrSet } from "../core/utils.js";
import type { ClientStrategy } from "./types.js";

/**
 * Rollback client strategy.
 * Simulates the full game state locally and rolls back when late inputs arrive.
 */
export class RollbackClient<TWorld, TInput extends { timestamp: number }> implements ClientStrategy<
  TWorld,
  TInput
> {
  private stateHistory: SnapshotBuffer<TWorld>;
  private localInputHistory: Map<number, TInput> = new Map();
  private remoteInputHistory: Map<string, Map<number, TInput>> = new Map();
  private simulate: SimulateFunction<TWorld, TInput>;
  private currentFrame: number = 0;
  private confirmedFrame: number = -1;
  private playerId: string | null = null;
  private currentState: TWorld;
  private inputDelay: number;
  private idleInput: TInput;

  constructor(
    simulate: SimulateFunction<TWorld, TInput>,
    initialState: TWorld,
    idleInput: TInput,
    options: {
      historySize?: number;
      inputDelay?: number;
    } = {},
  ) {
    this.simulate = simulate;
    this.currentState = initialState;
    this.idleInput = idleInput;
    this.stateHistory = new SnapshotBuffer<TWorld>(options.historySize ?? 60);
    this.inputDelay = options.inputDelay ?? 2; // Default 2 frame input delay

    // Store initial state
    this.stateHistory.add({
      tick: 0,
      timestamp: Date.now(),
      state: initialState,
      inputAcks: new Map(),
    });
  }

  onLocalInput(input: TInput): void {
    // Store input for the frame it will be applied (current + input delay)
    const targetFrame = this.currentFrame + this.inputDelay;
    this.localInputHistory.set(targetFrame, input);
  }

  /**
   * Receive a remote player's input.
   * If it's for a past frame, trigger rollback.
   */
  onRemoteInput(playerId: string, input: TInput, frame: number): void {
    const playerHistory = getOrSet(this.remoteInputHistory, playerId, () => new Map());
    playerHistory.set(frame, input);

    // If this input is for a frame we've already simulated, rollback
    if (frame < this.currentFrame) {
      this.rollbackAndResimulate(frame);
    }
  }

  onSnapshot(snapshot: Snapshot<TWorld>): void {
    // In rollback netcode, snapshots are typically used for:
    // 1. Initial state sync
    // 2. Desync recovery
    // For now, just update confirmed frame
    this.confirmedFrame = snapshot.tick;
  }

  /**
   * Advance the simulation by one frame.
   * Call this at a fixed rate (e.g., 60Hz).
   */
  advanceFrame(): void {
    // Collect inputs for this frame
    const inputs = this.collectInputsForFrame(this.currentFrame);

    // Simulate
    this.currentState = this.simulate(this.currentState, inputs, 1000 / 60); // Assuming 60Hz
    this.currentFrame++;

    // Store state for potential rollback
    this.stateHistory.add({
      tick: this.currentFrame,
      timestamp: Date.now(),
      state: this.currentState,
      inputAcks: new Map(),
    });

    // Clean up old history
    this.cleanupHistory();
  }

  private collectInputsForFrame(frame: number): Map<string, TInput> {
    const inputs = new Map<string, TInput>();

    // Local player input
    if (this.playerId) {
      const localInput = this.localInputHistory.get(frame) ?? this.idleInput;
      inputs.set(this.playerId, localInput);
    }

    // Remote player inputs
    for (const [playerId, history] of this.remoteInputHistory) {
      const input = history.get(frame) ?? this.predictInput(playerId, frame);
      inputs.set(playerId, input);
    }

    return inputs;
  }

  /**
   * Predict a remote player's input when we don't have it yet.
   * Simple prediction: use their last known input.
   */
  private predictInput(playerId: string, frame: number): TInput {
    const history = this.remoteInputHistory.get(playerId);
    if (!history) {
      return this.idleInput;
    }

    // Find the most recent input before this frame
    let latestInput: TInput | undefined;
    let latestFrame = -1;
    for (const [f, input] of history) {
      if (f < frame && f > latestFrame) {
        latestFrame = f;
        latestInput = input;
      }
    }

    return latestInput ?? this.idleInput;
  }

  private rollbackAndResimulate(toFrame: number): void {
    // Get state at the rollback frame
    const snapshot = this.stateHistory.getAtTick(toFrame);
    if (!snapshot) {
      console.warn(`Cannot rollback to frame ${toFrame}: no snapshot found`);
      return;
    }

    // Restore state
    this.currentState = snapshot.state;

    // Resimulate from rollback frame to current frame
    for (let frame = toFrame; frame < this.currentFrame; frame++) {
      const inputs = this.collectInputsForFrame(frame);
      this.currentState = this.simulate(this.currentState, inputs, 1000 / 60);

      // Update state history with corrected state
      this.stateHistory.add({
        tick: frame + 1,
        timestamp: Date.now(),
        state: this.currentState,
        inputAcks: new Map(),
      });
    }
  }

  private cleanupHistory(): void {
    // Keep inputs for frames we might need to rollback to
    const minFrame = Math.max(0, this.confirmedFrame - 10);

    // Clean local inputs
    for (const frame of this.localInputHistory.keys()) {
      if (frame < minFrame) {
        this.localInputHistory.delete(frame);
      }
    }

    // Clean remote inputs
    for (const history of this.remoteInputHistory.values()) {
      for (const frame of history.keys()) {
        if (frame < minFrame) {
          history.delete(frame);
        }
      }
    }
  }

  getStateForRendering(): TWorld | null {
    return this.currentState;
  }

  getLocalPlayerId(): string | null {
    return this.playerId;
  }

  setLocalPlayerId(playerId: string): void {
    this.playerId = playerId;
  }

  reset(): void {
    this.localInputHistory.clear();
    this.remoteInputHistory.clear();
    this.stateHistory.clear();
    this.currentFrame = 0;
    this.confirmedFrame = -1;
    this.playerId = null;
  }

  /**
   * Get current frame number
   */
  getCurrentFrame(): number {
    return this.currentFrame;
  }

  /**
   * Get the input delay (in frames)
   */
  getInputDelay(): number {
    return this.inputDelay;
  }

  /**
   * Set input delay (useful for adapting to network conditions)
   */
  setInputDelay(frames: number): void {
    this.inputDelay = Math.max(0, frames);
  }

  /**
   * Add a remote player
   */
  addRemotePlayer(playerId: string): void {
    if (!this.remoteInputHistory.has(playerId)) {
      this.remoteInputHistory.set(playerId, new Map());
    }
  }

  /**
   * Remove a remote player
   */
  removeRemotePlayer(playerId: string): void {
    this.remoteInputHistory.delete(playerId);
  }
}
