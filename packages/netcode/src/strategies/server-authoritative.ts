/**
 * Server-authoritative netcode strategy.
 * Server is the source of truth; clients predict locally and reconcile.
 */

import { InputBuffer } from "../client/input-buffer.js";
import { Interpolator } from "../client/interpolation.js";
import type { PredictionScope } from "../client/prediction-scope.js";
import { Predictor } from "../client/prediction.js";
import { Reconciler } from "../client/reconciliation.js";
import { SnapshotBuffer } from "../core/snapshot-buffer.js";
import type { InputMerger, InterpolateFunction, Snapshot } from "../core/types.js";
import type { WorldManager } from "../core/world.js";
import { InputQueue } from "../server/input-queue.js";
import {
  processTickInputs,
  type TickProcessorConfig,
} from "../server/tick-processor.js";
import type { ClientStrategy, ServerStrategy } from "./types.js";

/**
 * Client-side server-authoritative strategy.
 * Handles prediction, reconciliation, and interpolation.
 */
export class ServerAuthoritativeClient<
  TWorld,
  TInput extends { timestamp: number },
> implements ClientStrategy<TWorld, TInput> {
  private inputBuffer: InputBuffer<TInput>;
  private predictor: Predictor<TWorld, TInput>;
  private reconciler: Reconciler<TWorld, TInput> | null = null;
  private interpolator: Interpolator<TWorld>;
  private predictionScope: PredictionScope<TWorld, TInput>;
  private playerId: string | null = null;
  private lastServerState: TWorld | null = null;
  private lastServerSnapshot: Snapshot<TWorld> | null = null;

  constructor(
    predictionScope: PredictionScope<TWorld, TInput>,
    interpolate: InterpolateFunction<TWorld>,
    interpolationDelayMs: number,
  ) {
    this.predictionScope = predictionScope;
    this.inputBuffer = new InputBuffer<TInput>();
    this.predictor = new Predictor<TWorld, TInput>(predictionScope);
    this.interpolator = new Interpolator<TWorld>(interpolate, interpolationDelayMs);
  }

  onLocalInput(input: TInput): void {
    // Add to input buffer (seq returned but not needed here)
    this.inputBuffer.add(input);

    // Apply prediction locally
    this.predictor.applyInput(input);

    // Return seq for sending to server (caller handles network)
  }

  /**
   * Get the sequence number for the last input added.
   * Call this after onLocalInput to get the seq for sending to server.
   */
  getLastInputSeq(): number {
    return this.inputBuffer.getNextSeq() - 1;
  }

  onSnapshot(snapshot: Snapshot<TWorld>): void {
    // Store for interpolation
    this.interpolator.addSnapshot(snapshot);
    this.lastServerState = snapshot.state;
    this.lastServerSnapshot = snapshot;

    // Reconcile if we have a player ID
    if (this.playerId && this.reconciler) {
      this.reconciler.reconcile(snapshot);
    }
  }

  /**
   * Get the last received server snapshot (for debug visualization)
   */
  getLastServerSnapshot(): Snapshot<TWorld> | null {
    return this.lastServerSnapshot;
  }

  getStateForRendering(): TWorld | null {
    // Get interpolated state for other players
    const interpolatedState = this.interpolator.getInterpolatedState();
    if (!interpolatedState) {
      return this.lastServerState;
    }

    // Merge with local prediction
    if (this.predictor.getState()) {
      return this.predictor.mergeWithServer(interpolatedState);
    }

    return interpolatedState;
  }

  getLocalPlayerId(): string | null {
    return this.playerId;
  }

  setLocalPlayerId(playerId: string): void {
    this.playerId = playerId;
    this.predictor.setLocalPlayerId(playerId);
    this.reconciler = new Reconciler<TWorld, TInput>(
      this.inputBuffer,
      this.predictor,
      this.predictionScope,
      playerId,
    );
  }

  reset(): void {
    this.inputBuffer.clear();
    this.predictor.reset();
    this.interpolator.clear();
    this.playerId = null;
    this.reconciler = null;
    this.lastServerState = null;
  }

  /**
   * Get the input buffer (for accessing unacknowledged inputs)
   */
  getInputBuffer(): InputBuffer<TInput> {
    return this.inputBuffer;
  }
}

/**
 * Server-side server-authoritative strategy configuration
 */
export interface ServerAuthoritativeServerConfig<TWorld, TInput> {
  /** Function to simulate the world */
  simulate: (world: TWorld, inputs: Map<string, TInput>, deltaTime: number) => TWorld;
  /** Function to add a new player to the world */
  addPlayerToWorld: (world: TWorld, playerId: string) => TWorld;
  /** Function to remove a player from the world */
  removePlayerFromWorld: (world: TWorld, playerId: string) => TWorld;
  /** Tick interval in milliseconds */
  tickIntervalMs: number;
  /** Snapshot history size */
  snapshotHistorySize: number;
  /** Function to merge multiple inputs per tick (default: use last input) */
  mergeInputs?: InputMerger<TInput>;
  /** Function to create an idle input for clients without inputs */
  createIdleInput: () => TInput;
}

/**
 * Server-side server-authoritative strategy.
 * Processes inputs and simulates the authoritative world state.
 */
export class ServerAuthoritativeServer<
  TWorld,
  TInput extends { timestamp: number },
> implements ServerStrategy<TWorld, TInput> {
  private worldManager: WorldManager<TWorld>;
  private inputQueue: InputQueue<TInput>;
  private snapshotBuffer: SnapshotBuffer<TWorld>;
  private simulate: (world: TWorld, inputs: Map<string, TInput>, deltaTime: number) => TWorld;
  private addPlayerToWorld: (world: TWorld, playerId: string) => TWorld;
  private removePlayerFromWorld: (world: TWorld, playerId: string) => TWorld;
  private tickIntervalMs: number;
  private connectedClients: Set<string> = new Set();
  private mergeInputs: InputMerger<TInput>;
  private createIdleInput: () => TInput;
  // Track last processed timestamp per client for delta calculation (persists across ticks)
  private lastInputTimestamps: Map<string, number> = new Map();

  constructor(
    worldManager: WorldManager<TWorld>,
    config: ServerAuthoritativeServerConfig<TWorld, TInput>,
  ) {
    this.worldManager = worldManager;
    this.inputQueue = new InputQueue<TInput>();
    this.snapshotBuffer = new SnapshotBuffer<TWorld>(config.snapshotHistorySize);
    this.simulate = config.simulate;
    this.addPlayerToWorld = config.addPlayerToWorld;
    this.removePlayerFromWorld = config.removePlayerFromWorld;
    this.tickIntervalMs = config.tickIntervalMs;
    // Default: use the last input
    this.mergeInputs =
      config.mergeInputs ??
      ((inputs: TInput[]) => {
        if (inputs.length === 0) {
          throw new Error(
            "mergeInputs called with empty array - provide a custom merger that handles idle inputs",
          );
        }
        // Safe: we just checked length > 0
        return inputs.at(-1) as TInput;
      });
    this.createIdleInput = config.createIdleInput;
  }

  onClientInput(clientId: string, input: TInput, seq: number): void {
    this.inputQueue.enqueue(clientId, {
      seq,
      input,
      timestamp: input.timestamp,
    });
  }

  addClient(clientId: string): void {
    if (this.connectedClients.has(clientId)) {
      return;
    }
    this.connectedClients.add(clientId);
    const newWorld = this.addPlayerToWorld(this.worldManager.getState(), clientId);
    this.worldManager.setState(newWorld);
  }

  removeClient(clientId: string): void {
    if (!this.connectedClients.has(clientId)) {
      return;
    }
    this.connectedClients.delete(clientId);
    this.inputQueue.removeClient(clientId);
    this.lastInputTimestamps.delete(clientId);
    const newWorld = this.removePlayerFromWorld(this.worldManager.getState(), clientId);
    this.worldManager.setState(newWorld);
  }

  tick(): Snapshot<TWorld> {
    const timestamp = Date.now();

    // Collect all pending input messages per client (includes timestamps)
    const batchedInputs = this.inputQueue.getAllPendingInputsBatched();

    // Build acks map
    const inputAcks = new Map<string, number>();
    for (const clientId of this.inputQueue.getClientsWithInputs()) {
      const inputs = this.inputQueue.getPendingInputs(clientId);
      const lastInput = inputs.at(-1);
      if (lastInput) {
        inputAcks.set(clientId, lastInput.seq);
        this.inputQueue.acknowledge(clientId, lastInput.seq);
      }
    }

    // Process inputs using shared tick processor
    const currentWorld = this.worldManager.getState();
    const tickConfig: TickProcessorConfig<TWorld, TInput> = {
      simulate: this.simulate,
      mergeInputs: this.mergeInputs,
      tickIntervalMs: this.tickIntervalMs,
      getConnectedClients: () => this.connectedClients,
      createIdleInput: this.createIdleInput,
    };

    const updatedWorld = processTickInputs(
      currentWorld,
      batchedInputs,
      this.lastInputTimestamps,
      tickConfig,
    );

    this.worldManager.setState(updatedWorld);
    this.worldManager.incrementTick();

    // Create snapshot
    const snapshot: Snapshot<TWorld> = {
      tick: this.worldManager.getTick(),
      timestamp,
      state: updatedWorld,
      inputAcks,
    };
    this.snapshotBuffer.add(snapshot);

    return snapshot;
  }

  getWorldState(): TWorld {
    return this.worldManager.getState();
  }

  setWorldState(world: TWorld): void {
    this.worldManager.setState(world);
    // Clear snapshot buffer since world state changed drastically
    this.snapshotBuffer.clear();
    // Clear input queues since old inputs are no longer valid
    this.inputQueue.clear();
  }

  createSnapshot(): Snapshot<TWorld> {
    const inputAcks = new Map<string, number>();
    for (const clientId of this.connectedClients) {
      inputAcks.set(clientId, this.inputQueue.getLastSeq(clientId));
    }

    return {
      tick: this.worldManager.getTick(),
      timestamp: Date.now(),
      state: this.worldManager.getState(),
      inputAcks,
    };
  }

  getTick(): number {
    return this.worldManager.getTick();
  }

  /**
   * Get snapshot at a specific timestamp (for lag compensation)
   */
  getSnapshotAtTimestamp(timestamp: number): Snapshot<TWorld> | undefined {
    return this.snapshotBuffer.getAtTimestamp(timestamp);
  }

  /**
   * Get connected client IDs
   */
  getConnectedClients(): string[] {
    return Array.from(this.connectedClients);
  }

  /**
   * Get the snapshot buffer (for lag compensation)
   */
  getSnapshotBuffer(): SnapshotBuffer<TWorld> {
    return this.snapshotBuffer;
  }
}
