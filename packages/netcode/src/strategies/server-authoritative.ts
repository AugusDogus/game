/**
 * Server-authoritative netcode strategy.
 * Server is the source of truth; clients predict locally and reconcile.
 */

import { InputBuffer } from "../client/input-buffer.js";
import { Interpolator } from "../client/interpolation.js";
import type { PredictionScope } from "../client/prediction-scope.js";
import { Predictor } from "../client/prediction.js";
import { Reconciler } from "../client/reconciliation.js";
import {
  VisualSmoother,
  type VisualSmootherConfig,
  DEFAULT_VISUAL_SMOOTHER_CONFIG,
} from "../client/visual-smoother.js";
import { DEFAULT_TICK_INTERVAL_MS } from "../constants.js";
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
 * Configuration for visual smoothing in the client strategy.
 */
export interface VisualSmoothingConfig {
  /** Enable visual smoothing (default: true) */
  enabled: boolean;
  /** Smoothing factor (default: 0.9) */
  smoothFactor?: number;
  /** Snap threshold for large corrections (default: 50) */
  snapThreshold?: number;
}

/**
 * Client-side server-authoritative strategy.
 * Handles prediction, reconciliation, interpolation, and visual smoothing.
 *
 * Uses a fixed tick interval for prediction and reconciliation to match
 * server simulation exactly, ensuring smooth gameplay with minimal corrections.
 * Visual smoothing blends any remaining corrections over multiple frames.
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
  private visualSmoother: VisualSmoother;
  private visualSmoothingEnabled: boolean;
  private playerId: string | null = null;
  private lastServerState: TWorld | null = null;
  private lastServerSnapshot: Snapshot<TWorld> | null = null;
  private lastSnapshotTick: number = -1;
  private lastLevelId: string | null = null;
  private tickIntervalMs: number;
  private lastRenderTime: number = 0;

  constructor(
    predictionScope: PredictionScope<TWorld, TInput>,
    interpolate: InterpolateFunction<TWorld>,
    interpolationDelayMs: number,
    tickIntervalMs: number = DEFAULT_TICK_INTERVAL_MS,
    visualSmoothing?: VisualSmoothingConfig,
  ) {
    this.predictionScope = predictionScope;
    this.tickIntervalMs = tickIntervalMs;
    this.inputBuffer = new InputBuffer<TInput>();
    this.predictor = new Predictor<TWorld, TInput>(predictionScope, tickIntervalMs);
    this.interpolator = new Interpolator<TWorld>(interpolate, interpolationDelayMs);

    // Visual smoothing configuration
    // Only enable if the prediction scope supports position extraction
    const canSmooth = !!predictionScope.getLocalPlayerPosition && !!predictionScope.applyVisualOffset;
    this.visualSmoothingEnabled = canSmooth && (visualSmoothing?.enabled ?? true);
    
    const smootherConfig: Partial<VisualSmootherConfig> = {};
    if (visualSmoothing?.smoothFactor !== undefined) {
      smootherConfig.smoothFactor = visualSmoothing.smoothFactor;
    }
    if (visualSmoothing?.snapThreshold !== undefined) {
      smootherConfig.snapThreshold = visualSmoothing.snapThreshold;
    }
    this.visualSmoother = new VisualSmoother(smootherConfig);
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
    // Detect world reset by checking for level ID change (more reliable than tick detection)
    const worldAny = snapshot.state as Record<string, unknown>;
    const currentLevelId = typeof worldAny.levelId === 'string' ? worldAny.levelId : null;
    const levelChanged = this.lastLevelId !== null && currentLevelId !== null && currentLevelId !== this.lastLevelId;
    
    // Also detect world reset by tick going backwards significantly (fallback for games without levelId)
    const tickWentBackwards = this.lastSnapshotTick >= 0 && snapshot.tick < this.lastSnapshotTick - 5;
    
    
    if (levelChanged || tickWentBackwards) {
      // World was reset - clear prediction/interpolation state before processing
      // This prevents replaying old inputs from the previous world onto the new world
      this.inputBuffer.clear();
      this.predictor.reset();
      this.interpolator.clear();
    }
    
    this.lastSnapshotTick = snapshot.tick;
    if (currentLevelId !== null) {
      this.lastLevelId = currentLevelId;
    }

    // Store for interpolation
    this.interpolator.addSnapshot(snapshot);
    this.lastServerState = snapshot.state;
    this.lastServerSnapshot = snapshot;

    // Reconcile if we have a player ID
    if (this.playerId && this.reconciler) {
      const result = this.reconciler.reconcile(snapshot);
      
      // Feed position delta to visual smoother
      if (this.visualSmoothingEnabled && result.positionDelta) {
        this.visualSmoother.onReconciliationSnap(
          result.positionDelta.x,
          result.positionDelta.y,
        );
      }
    }
  }

  /**
   * Get the last received server snapshot (for debug visualization)
   */
  getLastServerSnapshot(): Snapshot<TWorld> | null {
    return this.lastServerSnapshot;
  }

  getStateForRendering(): TWorld | null {
    // Update visual smoother with frame delta
    const now = performance.now();
    if (this.lastRenderTime > 0) {
      const deltaMs = now - this.lastRenderTime;
      this.visualSmoother.update(deltaMs);
    }
    this.lastRenderTime = now;

    // Get interpolated state for other players
    const interpolatedState = this.interpolator.getInterpolatedState();
    if (!interpolatedState) {
      return this.lastServerState;
    }

    // Merge with local prediction
    let result: TWorld;
    if (this.predictor.getState()) {
      result = this.predictor.mergeWithServer(interpolatedState);
    } else {
      result = interpolatedState;
    }

    // Apply visual smoothing offset to local player
    if (
      this.visualSmoothingEnabled &&
      this.playerId &&
      this.visualSmoother.hasOffset() &&
      this.predictionScope.applyVisualOffset
    ) {
      const offset = this.visualSmoother.getOffset();
      result = this.predictionScope.applyVisualOffset(result, this.playerId, offset.x, offset.y);
    }

    return result;
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
      this.tickIntervalMs,
    );
  }

  reset(): void {
    this.inputBuffer.clear();
    this.predictor.reset();
    this.interpolator.clear();
    this.visualSmoother.reset();
    // Note: playerId and reconciler are preserved because they're tied to the 
    // socket connection, not the game state. A reset (e.g., level change) should
    // clear prediction/interpolation state but keep the player's identity.
    this.lastServerState = null;
    this.lastSnapshotTick = -1;
    this.lastLevelId = null;
    this.lastRenderTime = 0;
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
    // Start with the new world state
    let newWorld = world;
    
    // Re-add all connected players to the new world
    // This ensures players persist across level changes
    for (const clientId of this.connectedClients) {
      newWorld = this.addPlayerToWorld(newWorld, clientId);
    }
    
    this.worldManager.setState(newWorld);
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
