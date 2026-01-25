/**
 * Server-authoritative netcode strategy.
 * Server is the source of truth; clients predict locally and reconcile.
 */

import { InputBuffer } from "../client/input-buffer.js";
import type { PredictionScope } from "../client/prediction-scope.js";
import { Predictor } from "../client/prediction.js";
import { Reconciler } from "../client/reconciliation.js";
import {
  TickSmoother,
  type TickSmootherConfig,
} from "../client/tick-smoother.js";
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
 * Configuration for tick-based smoothing in the client strategy.
 */
export interface SmoothingConfig {
  /** Interpolation ticks for local player (default: 1) */
  ownerInterpolationTicks?: number;
  /** Interpolation ticks for remote players - not yet used (default: 2) */
  spectatorInterpolationTicks?: number;
  /** Maximum entries over target before discarding (default: 3) */
  maxOverBuffer?: number;
}

/**
 * Client-side server-authoritative strategy.
 * Handles prediction, reconciliation, and FishNet-style tick smoothing.
 *
 * The smoothing approach for the local player:
 * 1. Physics state updates immediately from prediction (instant response)
 * 2. When server snapshot arrives and reconciliation causes a position change,
 *    we track the "correction offset" (difference from before/after reconciliation)
 * 3. The visual position smoothly reduces this offset over time
 *
 * This ensures:
 * - Input response is instant (no input lag from smoothing)
 * - Server corrections are smooth (no visible snapping)
 * - With 0ms latency, there should be no smoothing needed at all
 */
export class ServerAuthoritativeClient<
  TWorld,
  TInput extends { timestamp: number },
> implements ClientStrategy<TWorld, TInput> {
  private inputBuffer: InputBuffer<TInput>;
  private predictor: Predictor<TWorld, TInput>;
  private reconciler: Reconciler<TWorld, TInput> | null = null;
  private tickSmoother: TickSmoother;
  private predictionScope: PredictionScope<TWorld, TInput>;
  private interpolate: InterpolateFunction<TWorld>;
  private playerId: string | null = null;
  private lastServerState: TWorld | null = null;
  private lastServerSnapshot: Snapshot<TWorld> | null = null;
  private lastSnapshotTick: number = -1;
  private lastLevelId: string | null = null;
  private tickIntervalMs: number;
  private lastRenderTime: number = 0;

  /**
   * Visual offset for smoothing reconciliation corrections.
   * This is the difference between where the player WAS visually
   * and where they ARE after reconciliation.
   */
  private visualOffsetX: number = 0;
  private visualOffsetY: number = 0;

  /** Position before reconciliation (for calculating correction offset) */
  private preReconcileX: number = 0;
  private preReconcileY: number = 0;

  constructor(
    predictionScope: PredictionScope<TWorld, TInput>,
    interpolate: InterpolateFunction<TWorld>,
    tickIntervalMs: number = DEFAULT_TICK_INTERVAL_MS,
    smoothingConfig?: SmoothingConfig,
  ) {
    this.predictionScope = predictionScope;
    this.interpolate = interpolate;
    this.tickIntervalMs = tickIntervalMs;
    this.inputBuffer = new InputBuffer<TInput>();
    this.predictor = new Predictor<TWorld, TInput>(predictionScope, tickIntervalMs);

    // Configure FishNet-style tick smoothing (used for offset decay)
    const smootherConfig: Partial<TickSmootherConfig> = {
      tickIntervalMs,
      ownerInterpolationTicks: smoothingConfig?.ownerInterpolationTicks ?? 1,
      spectatorInterpolationTicks: smoothingConfig?.spectatorInterpolationTicks ?? 2,
      maxOverBuffer: smoothingConfig?.maxOverBuffer ?? 3,
    };
    this.tickSmoother = new TickSmoother(smootherConfig);
  }

  onLocalInput(input: TInput): void {
    // Add to input buffer (seq returned but not needed here)
    this.inputBuffer.add(input);

    // Apply prediction locally - this is instant, no smoothing
    this.predictor.applyInput(input);
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
    const currentLevelId = typeof worldAny.levelId === "string" ? worldAny.levelId : null;
    const levelChanged =
      this.lastLevelId !== null && currentLevelId !== null && currentLevelId !== this.lastLevelId;

    // Also detect world reset by tick going backwards significantly (fallback for games without levelId)
    const tickWentBackwards = this.lastSnapshotTick >= 0 && snapshot.tick < this.lastSnapshotTick - 5;

    if (levelChanged || tickWentBackwards) {
      // World was reset - clear prediction/smoothing state before processing
      this.inputBuffer.clear();
      this.predictor.reset();
      this.tickSmoother.clear();
      this.visualOffsetX = 0;
      this.visualOffsetY = 0;
    }

    this.lastSnapshotTick = snapshot.tick;
    if (currentLevelId !== null) {
      this.lastLevelId = currentLevelId;
    }

    // Store server state
    this.lastServerState = snapshot.state;
    this.lastServerSnapshot = snapshot;

    // Capture position BEFORE reconciliation
    if (this.playerId && this.predictionScope.getLocalPlayerPosition) {
      const predictedState = this.predictor.getState();
      if (predictedState) {
        const posBefore = this.predictionScope.getLocalPlayerPosition(predictedState, this.playerId);
        if (posBefore) {
          this.preReconcileX = posBefore.x + this.visualOffsetX;
          this.preReconcileY = posBefore.y + this.visualOffsetY;
        }
      }
    }

    // Reconcile if we have a player ID
    if (this.playerId && this.reconciler) {
      this.reconciler.reconcile(snapshot);

      // Capture position AFTER reconciliation
      if (this.predictionScope.getLocalPlayerPosition) {
        const predictedState = this.predictor.getState();
        if (predictedState) {
          const posAfter = this.predictionScope.getLocalPlayerPosition(predictedState, this.playerId);
          if (posAfter) {
            // Calculate the correction that reconciliation caused
            const correctionX = this.preReconcileX - posAfter.x;
            const correctionY = this.preReconcileY - posAfter.y;

            // Add to visual offset (this is what we'll smooth out)
            this.visualOffsetX = correctionX;
            this.visualOffsetY = correctionY;
          }
        }
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
    // Calculate frame delta
    const now = performance.now();
    const deltaMs = this.lastRenderTime > 0 ? now - this.lastRenderTime : this.tickIntervalMs;
    this.lastRenderTime = now;

    // If no server state yet, nothing to render
    if (!this.lastServerState) {
      return null;
    }

    // Get the physics state (prediction merged with server state)
    let physicsState: TWorld;
    if (this.predictor.getState()) {
      physicsState = this.predictor.mergeWithServer(this.lastServerState);
    } else {
      physicsState = this.lastServerState;
    }

    // Decay visual offset toward zero (smooth out reconciliation corrections)
    if (Math.abs(this.visualOffsetX) > 0.001 || Math.abs(this.visualOffsetY) > 0.001) {
      // Decay rate: reduce offset by ~90% per tick duration
      // This means corrections are smoothed out over roughly 1-2 ticks
      const decayFactor = Math.pow(0.1, deltaMs / this.tickIntervalMs);
      this.visualOffsetX *= decayFactor;
      this.visualOffsetY *= decayFactor;

      // Snap to zero if very small
      if (Math.abs(this.visualOffsetX) < 0.01) this.visualOffsetX = 0;
      if (Math.abs(this.visualOffsetY) < 0.01) this.visualOffsetY = 0;

      // Apply offset to physics state for rendering
      if (this.playerId && (this.visualOffsetX !== 0 || this.visualOffsetY !== 0)) {
        return this.applyPositionOffset(physicsState, this.playerId, this.visualOffsetX, this.visualOffsetY);
      }
    }

    return physicsState;
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
    this.tickSmoother.setIsOwner(true);
  }

  reset(): void {
    this.inputBuffer.clear();
    this.predictor.reset();
    this.tickSmoother.clear();
    this.visualOffsetX = 0;
    this.visualOffsetY = 0;
    // Note: playerId and reconciler are preserved because they're tied to the
    // socket connection, not the game state. A reset (e.g., level change) should
    // clear prediction/smoothing state but keep the player's identity.
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

  /**
   * Apply a position offset to a player in the world state.
   * Creates a shallow copy of the world with the player's position adjusted.
   */
  private applyPositionOffset(world: TWorld, playerId: string, offsetX: number, offsetY: number): TWorld {
    // This is a generic implementation that works with our standard world structure
    // Games can provide their own implementation via PredictionScope if needed
    const worldAny = world as Record<string, unknown>;

    if (worldAny.players instanceof Map) {
      const players = worldAny.players as Map<string, { position?: { x: number; y: number } }>;
      const player = players.get(playerId);

      if (player?.position) {
        // Create new player with offset position
        const newPlayer = {
          ...player,
          position: {
            x: player.position.x + offsetX,
            y: player.position.y + offsetY,
          },
        };

        // Create new players map
        const newPlayers = new Map(players);
        newPlayers.set(playerId, newPlayer);

        // Return new world with updated players
        return { ...world, players: newPlayers } as TWorld;
      }
    }

    return world;
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

  constructor(worldManager: WorldManager<TWorld>, config: ServerAuthoritativeServerConfig<TWorld, TInput>) {
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
          throw new Error("mergeInputs called with empty array - provide a custom merger that handles idle inputs");
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

    const updatedWorld = processTickInputs(currentWorld, batchedInputs, tickConfig);

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
