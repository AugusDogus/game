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
import type { InterpolateFunction, Snapshot } from "../core/types.js";
import type { WorldManager } from "../core/world.js";
import { InputQueue } from "../server/input-queue.js";
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
    // Add to input buffer and get sequence number
    const seq = this.inputBuffer.add(input);

    // Apply prediction locally
    this.predictor.applyInput(input);

    // Return seq for sending to server (caller handles network)
    // Store it on the input for the caller to access
    (input as TInput & { _seq?: number })._seq = seq;
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

    // Reconcile if we have a player ID
    if (this.playerId && this.reconciler) {
      this.reconciler.reconcile(snapshot);
    }
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
 * Function to merge multiple inputs into one for a tick.
 */
export type InputMerger<TInput> = (inputs: TInput[]) => TInput;

/**
 * Server-side server-authoritative strategy configuration
 */
export interface ServerAuthoritativeServerConfig<TWorld, TInput> {
  /** Initial world state */
  initialWorld: TWorld;
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
    this.mergeInputs = config.mergeInputs ?? ((inputs: TInput[]) => inputs[inputs.length - 1]!);
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
      if (inputs.length > 0) {
        const lastInput = inputs[inputs.length - 1]!;
        inputAcks.set(clientId, lastInput.seq);
        this.inputQueue.acknowledge(clientId, lastInput.seq);
      }
    }

    // Process each input with its actual timestamp delta
    // This matches client-side prediction exactly (as per Gabriel Gambetta's docs)
    let currentWorld = this.worldManager.getState();

    // Check if any clients have inputs
    let hasInputs = false;
    for (const [, inputMsgs] of batchedInputs) {
      if (inputMsgs.length > 0) {
        hasInputs = true;
        break;
      }
    }

    // Track which clients had inputs this tick
    const clientsWithInputs = new Set<string>();
    
    if (!hasInputs) {
      // No inputs - simulate with idle inputs for all players using tick interval
      const idleInputs = new Map<string, TInput>();
      currentWorld = this.simulate(currentWorld, idleInputs, this.tickIntervalMs);
    } else {
      // Process each client's inputs INDEPENDENTLY (not interleaved)
      // This ensures:
      // 1. Each client's physics matches their local prediction exactly
      // 2. Other clients' physics are NOT affected by this client's simulation steps
      // Per Gabriel Gambetta: "all the unprocessed client input is applied"
      // but we process each client separately to avoid physics multiplication
      for (const [clientId, inputMsgs] of batchedInputs) {
        if (inputMsgs.length === 0) continue;
        clientsWithInputs.add(clientId);
        
        // Process this client's inputs with their individual deltas
        for (const inputMsg of inputMsgs) {
          let deltaTime = 16.67;
          const lastTs = this.lastInputTimestamps.get(clientId);
          if (lastTs !== null && lastTs !== undefined) {
            const delta = inputMsg.timestamp - lastTs;
            deltaTime = Math.max(1, Math.min(100, delta));
          }
          this.lastInputTimestamps.set(clientId, inputMsg.timestamp);

          // Simulate ONLY this client
          // The simulation function only applies physics to players with inputs
          const singleInput = new Map<string, TInput>();
          singleInput.set(clientId, inputMsg.input);
          currentWorld = this.simulate(currentWorld, singleInput, deltaTime);
        }
      }
      
      // Apply idle physics to connected clients who had NO inputs this tick
      // They still need gravity, etc. for the tick interval
      for (const connectedClient of this.connectedClients) {
        if (!clientsWithInputs.has(connectedClient)) {
          const idleInput = new Map<string, TInput>();
          idleInput.set(connectedClient, this.mergeInputs([])); // Get idle input
          currentWorld = this.simulate(currentWorld, idleInput, this.tickIntervalMs);
        }
      }
    }

    this.worldManager.setState(currentWorld);
    this.worldManager.incrementTick();

    // Create snapshot
    const snapshot: Snapshot<TWorld> = {
      tick: this.worldManager.getTick(),
      timestamp,
      state: currentWorld,
      inputAcks,
    };
    this.snapshotBuffer.add(snapshot);

    return snapshot;
  }

  getWorldState(): TWorld {
    return this.worldManager.getState();
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
}
