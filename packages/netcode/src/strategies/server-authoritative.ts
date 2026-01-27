/**
 * Server-authoritative netcode strategy.
 * Server is the source of truth; clients predict locally and reconcile.
 *
 * Uses FishNet-style tick smoothing:
 * - Physics state can snap during reconciliation
 * - Graphical positions smoothly interpolate toward physics
 * - Separate smoothers for local and remote players
 */

import { InputBuffer } from "../client/input-buffer.js";
import type { PredictionScope } from "../client/prediction-scope.js";
import { Predictor } from "../client/prediction.js";
import { Reconciler } from "../client/reconciliation.js";
import { TickSmoother, AdaptiveInterpolationLevel, AdaptiveSmoothingType, type TickSmootherConfig } from "../client/tick-smoother.js";
import { DEFAULT_TICK_INTERVAL_MS } from "../constants.js";
import { SnapshotBuffer } from "../core/snapshot-buffer.js";
import type { InputMerger, Snapshot } from "../core/types.js";
import type { WorldManager } from "../core/world.js";
import { InputQueue } from "../server/input-queue.js";
import {
  processTickInputs,
  type TickProcessorConfig,
} from "../server/tick-processor.js";
import type { ClientStrategy, ServerStrategy } from "./types.js";

const DEFAULT_TARGET_QUEUED_INPUTS = 2;
const CLIENT_TIMING_PERCENT_RANGE = 0.5;
const CLIENT_SPEEDUP_VALUE = 0.035;
const CLIENT_SLOWDOWN_VALUE = 0.02;
const UPDATE_CHANGE_MODIFIER = 0.1;
const TIMING_TOO_FAST_STEP = 0.5;

class ClientTimingManager {
  private readonly tickIntervalMs: number;
  private readonly tickRate: number;
  private readonly targetQueuedInputs: number;
  private readonly clientTimingRange: [number, number];
  private readonly resetAdjustmentThreshold: number;
  private adjustedTickIntervalMs: number;
  private elapsedMs = 0;
  private localTick = 0;
  private estimatedServerTick = 0;
  private lastPacketTick = 0;
  private rttMs = 0;
  private clientTicksSinceUpdate = 0;
  private timingUpdateChange = 0;
  private updateChangeMultiplier = 1;
  private timingTooFastCount = 0;

  constructor(tickIntervalMs: number, targetQueuedInputs: number) {
    this.tickIntervalMs = tickIntervalMs;
    this.tickRate = 1000 / tickIntervalMs;
    this.targetQueuedInputs = Math.max(1, Math.round(targetQueuedInputs));
    this.adjustedTickIntervalMs = tickIntervalMs;
    this.clientTimingRange = [
      tickIntervalMs * (1 - CLIENT_TIMING_PERCENT_RANGE),
      tickIntervalMs * (1 + CLIENT_TIMING_PERCENT_RANGE),
    ];
    this.resetAdjustmentThreshold = Math.max(3, Math.round(this.tickRate / 3));
  }

  advance(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
      return;
    }
    const timePerSimulation = this.adjustedTickIntervalMs;
    if (!Number.isFinite(timePerSimulation) || timePerSimulation <= 0) {
      return;
    }
    this.elapsedMs += deltaMs;
    const ticks = Math.floor(this.elapsedMs / timePerSimulation);
    if (ticks <= 0) {
      return;
    }
    this.elapsedMs -= ticks * timePerSimulation;
    this.localTick += ticks;
    this.estimatedServerTick += ticks;
    this.clientTicksSinceUpdate += ticks;
  }

  onPacketTick(tick: number): void {
    if (!Number.isFinite(tick)) {
      return;
    }
    if (tick > this.lastPacketTick) {
      this.lastPacketTick = tick;
    }
  }

  onRttUpdate(rttMs: number): void {
    if (!Number.isFinite(rttMs)) {
      return;
    }
    this.rttMs = Math.max(0, rttMs);
    this.updateEstimatedServerTick();
  }

  onTimingUpdate(queuedInputs: number, intervalMs: number): void {
    if (!Number.isFinite(queuedInputs) || !Number.isFinite(intervalMs) || intervalMs <= 0) {
      return;
    }

    this.updateEstimatedServerTick();

    const expectedClientTicks = Math.max(1, Math.round(intervalMs / this.tickIntervalMs));
    const clientTicks = this.clientTicksSinceUpdate;
    this.clientTicksSinceUpdate = 0;

    const inputsOverTarget =
      queuedInputs > this.targetQueuedInputs ? queuedInputs - this.targetQueuedInputs : 0;

    let tickDifference: number;
    if (inputsOverTarget === 0) {
      if (queuedInputs === 0) {
        tickDifference = clientTicks - expectedClientTicks;
      } else {
        tickDifference = -(this.targetQueuedInputs - queuedInputs);
      }
    } else {
      tickDifference = inputsOverTarget;
    }

    const nextChange = tickDifference === 0 ? 0 : tickDifference > 0 ? 1 : -1;
    if (nextChange !== this.timingUpdateChange) {
      if (this.updateChangeMultiplier > UPDATE_CHANGE_MODIFIER) {
        this.updateChangeMultiplier -= UPDATE_CHANGE_MODIFIER;
      }
    } else if (this.updateChangeMultiplier < 1) {
      this.updateChangeMultiplier += UPDATE_CHANGE_MODIFIER * 0.25;
    }
    this.timingUpdateChange = nextChange;

    tickDifference = Math.trunc(tickDifference * this.updateChangeMultiplier);
    if (Math.abs(tickDifference) >= this.resetAdjustmentThreshold) {
      tickDifference = 0;
    }

    const multiplierValue = tickDifference > 0 ? CLIENT_SLOWDOWN_VALUE : CLIENT_SPEEDUP_VALUE;
    const adjustment = this.tickIntervalMs * (tickDifference * multiplierValue);
    let adjusted = this.tickIntervalMs + adjustment;
    adjusted += this.tickIntervalMs * (CLIENT_SLOWDOWN_VALUE * this.timingTooFastCount);
    adjusted = Math.max(this.clientTimingRange[0], Math.min(this.clientTimingRange[1], adjusted));
    this.adjustedTickIntervalMs = adjusted;

    if (tickDifference > 0) {
      this.timingTooFastCount += TIMING_TOO_FAST_STEP;
    } else if (this.timingTooFastCount >= TIMING_TOO_FAST_STEP) {
      this.timingTooFastCount -= TIMING_TOO_FAST_STEP;
    } else {
      this.timingTooFastCount = 0;
    }
  }

  getEstimatedServerTick(): number | null {
    if (this.lastPacketTick === 0 && this.estimatedServerTick === 0) {
      return null;
    }
    return this.estimatedServerTick;
  }

  getLocalTick(): number {
    return this.localTick;
  }

  reset(): void {
    this.elapsedMs = 0;
    this.localTick = 0;
    this.estimatedServerTick = 0;
    this.lastPacketTick = 0;
    this.rttMs = 0;
    this.clientTicksSinceUpdate = 0;
    this.timingUpdateChange = 0;
    this.updateChangeMultiplier = 1;
    this.timingTooFastCount = 0;
    this.adjustedTickIntervalMs = this.tickIntervalMs;
  }

  private updateEstimatedServerTick(): void {
    if (this.lastPacketTick === 0) {
      return;
    }
    const oneWayMs = this.rttMs * 0.5;
    const rttTicks = Math.max(0, Math.round(oneWayMs / this.tickIntervalMs));
    this.estimatedServerTick = this.lastPacketTick + rttTicks;
  }
}

/**
 * Configuration for FishNet-style tick smoothing in the client strategy.
 */
export interface SmoothingConfig {
  /**
   * Adaptive interpolation level.
   * Higher levels add more buffer to absorb network jitter.
   * @default AdaptiveInterpolationLevel.Low
   */
  adaptiveInterpolation?: AdaptiveInterpolationLevel;

  /**
   * Adaptive smoothing type (FishNet-style).
   * @default AdaptiveSmoothingType.Default
   */
  adaptiveSmoothingType?: AdaptiveSmoothingType;

  /**
   * Interpolation percent applied to tick lag (0-1).
   * @default 1
   */
  interpolationPercent?: number;

  /**
   * Collision interpolation percent applied to reconciliation corrections (0-1).
   * @default 1
   */
  collisionInterpolationPercent?: number;

  /**
   * Interpolation decrease step when using Custom adaptive smoothing.
   * @default 1
   */
  interpolationDecreaseStep?: number;

  /**
   * Interpolation increase step when using Custom adaptive smoothing.
   * @default 1
   */
  interpolationIncreaseStep?: number;

  /**
   * Distance threshold for teleporting instead of smoothing.
   * If position change exceeds this, snap instantly.
   * @default 200
   */
  teleportThreshold?: number;

  /**
   * Axis-specific teleport threshold for X position (optional).
   */
  teleportThresholdX?: number;

  /**
   * Axis-specific teleport threshold for Y position (optional).
   */
  teleportThresholdY?: number;

  /**
   * Whether to smooth X position (otherwise snap to target).
   * @default true
   */
  smoothPositionX?: boolean;

  /**
   * Whether to smooth Y position (otherwise snap to target).
   * @default true
   */
  smoothPositionY?: boolean;

  /**
   * Maximum snapshots to buffer (for snapshot history).
   * @default 30
   */
  snapshotBufferSize?: number;

  /**
   * Whether to smooth rotation (2D angle in radians).
   * @default false
   */
  smoothRotation?: boolean;

  /**
   * Whether to smooth scale (scaleX/scaleY).
   * @default false
   */
  smoothScale?: boolean;

  /**
   * Whether to smooth scale X (otherwise snap to target).
   * @default true
   */
  smoothScaleX?: boolean;

  /**
   * Whether to smooth scale Y (otherwise snap to target).
   * @default true
   */
  smoothScaleY?: boolean;

  /**
   * Rotation threshold for teleporting instead of smoothing (in radians).
   * @default Math.PI (180 degrees)
   */
  rotationTeleportThreshold?: number;

  /**
   * Axis-specific teleport threshold for scale X (optional).
   */
  scaleTeleportThresholdX?: number;

  /**
   * Axis-specific teleport threshold for scale Y (optional).
   */
  scaleTeleportThresholdY?: number;

  /**
   * Whether to enable extrapolation when queue runs out (spectators only).
   * Uses last known velocity to predict forward motion for a short time.
   * @default true
   */
  enableExtrapolation?: boolean;

  /**
   * Maximum time to extrapolate in milliseconds (when queue is empty).
   * Extrapolation is clamped to prevent runaway drift.
   * @default 2 ticks worth of time
   */
  maxExtrapolationMs?: number;

  /**
   * Target number of queued inputs (FishNet PredictionManager.QueuedInputs).
   * Used to keep client timing aligned with the server tick loop.
   * @default 2
   */
  targetQueuedInputs?: number;
}

/**
 * Client-side server-authoritative strategy.
 * Handles prediction, reconciliation, and FishNet-style tick smoothing.
 *
 * ## Architecture: Physics vs Render Position
 * - Physics position: What prediction/reconciliation operates on (can snap)
 * - Render position: What gets drawn (smoothly interpolates via TickSmoother)
 *
 * ## Local Player (Owner)
 * - Uses client-side prediction for instant physics response
 * - Reconciles with server snapshots when they arrive
 * - TickSmoother smooths the graphical position toward physics
 * - Uses input sequence numbers for smoother indexing
 *
 * ## Remote Players (Spectators)
 * - Each remote player has their own TickSmoother
 * - Fed with server tick numbers from snapshots
 * - 2-tick buffer by default for jitter absorption
 */
export class ServerAuthoritativeClient<
  TWorld,
  TInput extends { timestamp: number },
> implements ClientStrategy<TWorld, TInput> {
  private inputBuffer: InputBuffer<TInput>;
  private predictor: Predictor<TWorld, TInput>;
  private reconciler: Reconciler<TWorld, TInput> | null = null;
  private predictionScope: PredictionScope<TWorld, TInput>;
  private playerId: string | null = null;
  private tickIntervalMs: number;
  private lastRenderTime: number = 0;

  // Snapshot buffer for storing server snapshots
  private snapshotBuffer: SnapshotBuffer<TWorld>;

  // World reset detection
  private lastSnapshotTick: number = -1;
  private lastLevelId: string | null = null;

  // FishNet-style tick smoothing

  /** Smoother for local player's graphical position */
  private localPlayerSmoother: TickSmoother;

  /** Per-player smoothers for remote players (keyed by playerId) */
  private remotePlayerSmoothers: Map<string, TickSmoother> = new Map();

  /** Smoothing configuration */
  private smoothingConfig: Required<SmoothingConfig>;

  /** Dedicated prediction tick for owner smoothing (FishNet-style) */
  private predictionTick: number = 0;
  /** Map input seq -> prediction tick for smoothing corrections */
  private predictionTickBySeq: Map<number, number> = new Map();
  /** Last acknowledged input seq for cleanup */
  private lastAckedSeq: number = -1;

  constructor(
    predictionScope: PredictionScope<TWorld, TInput>,
    tickIntervalMs: number = DEFAULT_TICK_INTERVAL_MS,
    smoothingConfig?: SmoothingConfig,
  ) {
    this.predictionScope = predictionScope;
    this.tickIntervalMs = tickIntervalMs;
    this.inputBuffer = new InputBuffer<TInput>();
    this.predictor = new Predictor<TWorld, TInput>(predictionScope, tickIntervalMs);

    // Store smoothing config with defaults
    this.smoothingConfig = {
      // FishNet default is VeryLow for spectators.
      adaptiveInterpolation: smoothingConfig?.adaptiveInterpolation ?? AdaptiveInterpolationLevel.VeryLow,
      adaptiveSmoothingType: smoothingConfig?.adaptiveSmoothingType ?? AdaptiveSmoothingType.Default,
      interpolationPercent: smoothingConfig?.interpolationPercent ?? 1,
      collisionInterpolationPercent: smoothingConfig?.collisionInterpolationPercent ?? 1,
      interpolationDecreaseStep: smoothingConfig?.interpolationDecreaseStep ?? 1,
      interpolationIncreaseStep: smoothingConfig?.interpolationIncreaseStep ?? 1,
      teleportThreshold: smoothingConfig?.teleportThreshold ?? 200,
      teleportThresholdX: smoothingConfig?.teleportThresholdX,
      teleportThresholdY: smoothingConfig?.teleportThresholdY,
      smoothPositionX: smoothingConfig?.smoothPositionX ?? true,
      smoothPositionY: smoothingConfig?.smoothPositionY ?? true,
      snapshotBufferSize: smoothingConfig?.snapshotBufferSize ?? 30,
      smoothRotation: smoothingConfig?.smoothRotation ?? false,
      smoothScale: smoothingConfig?.smoothScale ?? false,
      smoothScaleX: smoothingConfig?.smoothScaleX ?? true,
      smoothScaleY: smoothingConfig?.smoothScaleY ?? true,
      rotationTeleportThreshold: smoothingConfig?.rotationTeleportThreshold ?? Math.PI,
      scaleTeleportThresholdX: smoothingConfig?.scaleTeleportThresholdX,
      scaleTeleportThresholdY: smoothingConfig?.scaleTeleportThresholdY,
      enableExtrapolation: smoothingConfig?.enableExtrapolation ?? true,
      maxExtrapolationMs: smoothingConfig?.maxExtrapolationMs ?? tickIntervalMs * 2,
    };

    // Create snapshot buffer
    this.snapshotBuffer = new SnapshotBuffer<TWorld>(this.smoothingConfig.snapshotBufferSize);

    // Create local player smoother (owner mode = responsive, fixed interpolation)
    this.localPlayerSmoother = this.createSmoother(true);

    const targetQueuedInputs =
      this.smoothingConfig.targetQueuedInputs ?? DEFAULT_TARGET_QUEUED_INPUTS;
    this.timingManager = new ClientTimingManager(this.tickIntervalMs, targetQueuedInputs);
  }

  /** Last known server tick (for calculating tick lag) */
  private lastServerTick: number = 0;
  /** Last measured round-trip time in milliseconds (if available) */
  private lastRttMs: number | null = null;
  /** Last computed spectator tick lag */
  private lastSpectatorTickLag: number | null = null;
  /** Last computed local time tick */
  private lastLocalTimeTick: number | null = null;
  /** Client-side timing manager (FishNet TimeManager-style) */
  private timingManager: ClientTimingManager;
  /** Last update time for timing manager */
  private timingLastUpdateMs: number = 0;

  /**
   * Create a TickSmoother with appropriate configuration.
   * @param isOwner - Whether this smoother is for the local player
   */
  private createSmoother(isOwner: boolean): TickSmoother {
    const config: Partial<TickSmootherConfig> = {
      tickIntervalMs: this.tickIntervalMs,
      adaptiveInterpolation: this.smoothingConfig.adaptiveInterpolation,
      adaptiveSmoothingType: this.smoothingConfig.adaptiveSmoothingType,
      interpolationPercent: this.smoothingConfig.interpolationPercent,
      collisionInterpolationPercent: this.smoothingConfig.collisionInterpolationPercent,
      interpolationDecreaseStep: this.smoothingConfig.interpolationDecreaseStep,
      interpolationIncreaseStep: this.smoothingConfig.interpolationIncreaseStep,
      teleportThreshold: this.smoothingConfig.teleportThreshold,
      teleportThresholdX: this.smoothingConfig.teleportThresholdX,
      teleportThresholdY: this.smoothingConfig.teleportThresholdY,
      smoothPositionX: this.smoothingConfig.smoothPositionX,
      smoothPositionY: this.smoothingConfig.smoothPositionY,
      smoothRotation: this.smoothingConfig.smoothRotation,
      smoothScale: this.smoothingConfig.smoothScale,
      smoothScaleX: this.smoothingConfig.smoothScaleX,
      smoothScaleY: this.smoothingConfig.smoothScaleY,
      rotationTeleportThreshold: this.smoothingConfig.rotationTeleportThreshold,
      scaleTeleportThresholdX: this.smoothingConfig.scaleTeleportThresholdX,
      scaleTeleportThresholdY: this.smoothingConfig.scaleTeleportThresholdY,
      enableExtrapolation: this.smoothingConfig.enableExtrapolation,
      maxExtrapolationMs: this.smoothingConfig.maxExtrapolationMs,
    };
    const smoother = new TickSmoother(config);
    smoother.setIsOwner(isOwner);
    return smoother;
  }

  /**
   * Update adaptive interpolation for spectators based on tick lag.
   * FishNet only applies adaptive interpolation to spectators, NOT owners.
   * The local player always uses fixed 1-tick interpolation for responsiveness.
   *
   * @param snapshot - The latest server snapshot
   */
  private updateSpectatorInterpolation(snapshot: Snapshot<TWorld>): void {
    // FishNet: interpolation = (LocalTick - clientStateTick) * multiplier.
    //
    // Our client doesn't have a perfectly server-synced LocalTick; using the timing-adjusted
    // "estimatedServerTick" here can drift and inflate tickLag (making spectators feel very laggy).
    //
    // Instead, derive tickLag from one-way latency in ticks, anchored to the latest snapshot tick.
    // This matches the intent (buffer enough to cover transit time) without runaway lag.
    const oneWayMs = (this.lastRttMs ?? 0) * 0.5;
    const oneWayTicks =
      oneWayMs > 0 ? Math.max(1, Math.round(oneWayMs / this.tickIntervalMs)) : 1;
    const tickLag = oneWayTicks;

    // Keep these for debugging/telemetry.
    this.lastLocalTimeTick = this.getLocalTimeTick();
    this.lastSpectatorTickLag = tickLag;

    for (const smoother of this.remotePlayerSmoothers.values()) {
      smoother.updateAdaptiveInterpolation(tickLag);
    }
  }

  private getLocalTimeTick(): number | null {
    return this.timingManager.getEstimatedServerTick();
  }

  /**
   * Update RTT for logging/debugging purposes.
   * Note: FishNet uses tick lag, not RTT, for adaptive interpolation.
   */
  onRttUpdate(rttMs: number): void {
    if (!Number.isFinite(rttMs)) {
      return;
    }
    this.lastRttMs = Math.max(0, rttMs);
    this.timingManager.onRttUpdate(this.lastRttMs);
  }

  onClockSyncPing(serverTimestamp: number, clientReceiveTimeMs: number): void {
    void serverTimestamp;
    void clientReceiveTimeMs;
  }

  onTimingUpdate(queuedInputs: number, intervalMs: number): void {
    this.timingManager.onTimingUpdate(queuedInputs, intervalMs);
  }

  private advanceTiming(now: number = performance.now()): void {
    const deltaMs = this.timingLastUpdateMs > 0 ? now - this.timingLastUpdateMs : 0;
    this.timingLastUpdateMs = now;
    this.timingManager.advance(deltaMs);
  }

  onLocalInput(input: TInput): void {
    // 1. Add to input buffer
    const seq = this.inputBuffer.add(input);
    const predictionTick = this.predictionTick++;
    this.predictionTickBySeq.set(seq, predictionTick);

    // 2. Physics simulation (prediction)
    this.predictor.applyInput(input);

    // 3. Post-tick: add physics position to smoother queue
    if (this.playerId && this.predictionScope.getLocalPlayerPosition) {
      const predictedState = this.predictor.getState();
      if (predictedState) {
        const physicsPos = this.predictionScope.getLocalPlayerPosition(predictedState, this.playerId);
        if (physicsPos) {
          this.localPlayerSmoother.onPostTick(predictionTick, physicsPos.x, physicsPos.y);
        }
      }
    }
  }

  /**
   * Get the sequence number for the last input added.
   * Call this after onLocalInput to get the seq for sending to server.
   */
  getLastInputSeq(): number {
    return this.inputBuffer.getNextSeq() - 1;
  }

  onSnapshot(snapshot: Snapshot<TWorld>): void {
    this.advanceTiming();
    // Detect world reset by checking for level ID change
    const worldAny = snapshot.state as Record<string, unknown>;
    const currentLevelId = typeof worldAny.levelId === "string" ? worldAny.levelId : null;
    const levelChanged =
      this.lastLevelId !== null && currentLevelId !== null && currentLevelId !== this.lastLevelId;

    // Also detect world reset by tick going backwards significantly
    const tickWentBackwards = this.lastSnapshotTick >= 0 && snapshot.tick < this.lastSnapshotTick - 5;

    if (levelChanged || tickWentBackwards) {
      // World was reset - clear all state
      this.inputBuffer.clear();
      this.predictor.reset();
      this.snapshotBuffer.clear();
      this.localPlayerSmoother.reset();
      this.predictionTick = 0;
      this.predictionTickBySeq.clear();
      this.lastAckedSeq = -1;
      // Clear remote player smoothers
      for (const smoother of this.remotePlayerSmoothers.values()) {
        smoother.reset();
      }
      this.remotePlayerSmoothers.clear();
    }

    this.lastSnapshotTick = snapshot.tick;
    this.lastServerTick = snapshot.tick;
    this.timingManager.onPacketTick(snapshot.tick);
    if (currentLevelId !== null) {
      this.lastLevelId = currentLevelId;
    }

    // Add to snapshot buffer
    this.snapshotBuffer.add(snapshot);

    // Prune prediction ticks for acknowledged inputs
    if (this.playerId) {
      const lastProcessedSeq = snapshot.inputAcks.get(this.playerId) ?? -1;
      if (lastProcessedSeq > this.lastAckedSeq) {
        for (let seq = this.lastAckedSeq + 1; seq <= lastProcessedSeq; seq++) {
          this.predictionTickBySeq.delete(seq);
        }
        this.lastAckedSeq = lastProcessedSeq;
      }
    }

    // Reconcile local player if we have a player ID
    if (this.playerId && this.reconciler) {
      this.reconciler.reconcile(snapshot);
    }

    // Update remote player smoothers
    this.updateRemotePlayerSmoothers(snapshot);

    // Update spectator interpolation based on tick lag
    this.updateSpectatorInterpolation(snapshot);

  }

  /**
   * Update remote player smoothers with positions from the snapshot.
   */
  private updateRemotePlayerSmoothers(snapshot: Snapshot<TWorld>): void {
    const worldAny = snapshot.state as Record<string, unknown>;

    if (!(worldAny.players instanceof Map)) {
      return;
    }

    const players = worldAny.players as Map<string, { position?: { x: number; y: number } }>;
    const activePlayerIds = new Set<string>();

    for (const [playerId, player] of players) {
      // Skip local player - handled by localPlayerSmoother
      if (playerId === this.playerId) {
        continue;
      }

      activePlayerIds.add(playerId);

      if (!player.position) {
        continue;
      }

      // Get or create smoother for this remote player (spectator mode = adaptive)
      let smoother = this.remotePlayerSmoothers.get(playerId);
      if (!smoother) {
        smoother = this.createSmoother(false);
        this.remotePlayerSmoothers.set(playerId, smoother);
      }

      // Feed position with server tick number
      smoother.onPostTick(snapshot.tick, player.position.x, player.position.y);
    }

    // Clean up smoothers for disconnected players
    for (const playerId of this.remotePlayerSmoothers.keys()) {
      if (!activePlayerIds.has(playerId)) {
        this.remotePlayerSmoothers.delete(playerId);
      }
    }
  }

  /**
   * Get the last received server snapshot (for debug visualization)
   */
  getLastServerSnapshot(): Snapshot<TWorld> | null {
    return this.snapshotBuffer.getLatest() ?? null;
  }

  getStateForRendering(): TWorld | null {
    // Calculate frame delta
    const now = performance.now();
    this.advanceTiming(now);
    const deltaMs = this.lastRenderTime > 0 ? now - this.lastRenderTime : this.tickIntervalMs;
    this.lastRenderTime = now;

    // Get base state from latest snapshot
    const latestSnapshot = this.snapshotBuffer.getLatest();
    if (!latestSnapshot) {
      return null;
    }

    // Always use tick-smoother for all players (FishNet-style rate-based smoothing)
    // The tick-smoother buffers positions and moves toward them at calculated rates,
    // which is how FishNet's NetworkTransform works. Time-based bracketing (lerp between
    // two snapshots) causes jitter due to clock sync instability and non-uniform arrival.
    return this.getStateForRenderingWithTickSmoother(deltaMs, latestSnapshot);
  }

  /**
   * Render with tick-smoother for all players (legacy/default behavior)
   */
  private getStateForRenderingWithTickSmoother(deltaMs: number, latestSnapshot: Snapshot<TWorld>): TWorld {
    // Start with the latest server state as base
    let renderState = latestSnapshot.state;

    // Apply smoothed local player position
    if (this.playerId) {
      const predictedState = this.predictor.getState();
      if (predictedState) {
        // First merge predicted physics state
        renderState = this.predictionScope.mergePrediction(renderState, predictedState, this.playerId);
      }

      // Then apply smoothed render position
      const localRenderPos = this.localPlayerSmoother.getSmoothedPosition(deltaMs);
      renderState = this.applyRenderPosition(renderState, this.playerId, localRenderPos);
    }

    // Apply smoothed remote player positions
    for (const [playerId, smoother] of this.remotePlayerSmoothers) {
      const renderPos = smoother.getSmoothedPosition(deltaMs);
      renderState = this.applyRenderPosition(renderState, playerId, renderPos);
    }

    return renderState;
  }

  /**
   * Apply a render position to a player in the world state.
   * Creates a shallow copy of the world with the player's position replaced.
   */
  private applyRenderPosition(world: TWorld, playerId: string, pos: { x: number; y: number }): TWorld {
    const worldAny = world as Record<string, unknown>;

    if (worldAny.players instanceof Map) {
      const players = worldAny.players as Map<string, { position?: { x: number; y: number } }>;
      const player = players.get(playerId);

      if (player) {
        const newPlayer = {
          ...player,
          position: {
            x: pos.x,
            y: pos.y,
          },
        };

        const newPlayers = new Map(players);
        newPlayers.set(playerId, newPlayer);

        return { ...world, players: newPlayers } as TWorld;
      }
    }

    return world;
  }

  getLocalPlayerId(): string | null {
    return this.playerId;
  }

  getSmoothingDebug(): {
    rttMs: number | null;
    serverTick: number;
    localTimeTick: number | null;
    tickLag: number | null;
    remotePlayers: Array<{
      playerId: string;
      interpolation: number;
      queueLength: number;
    }>;
  } {
    const remotePlayers = Array.from(this.remotePlayerSmoothers.entries()).map(([playerId, smoother]) => ({
      playerId,
      interpolation: smoother.getInterpolation(),
      queueLength: smoother.getQueueLength(),
    }));
    return {
      rttMs: this.lastRttMs,
      serverTick: this.lastServerTick,
      localTimeTick: this.lastLocalTimeTick,
      tickLag: this.lastSpectatorTickLag,
      remotePlayers,
    };
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

    // Connect reconciliation replay callback to ease corrections into smoother
    // FishNet's approach: modify existing queue entries with exponential easing
    this.reconciler.setReplayCallback((tick, state) => {
      if (this.predictionScope.getLocalPlayerPosition) {
        const pos = this.predictionScope.getLocalPlayerPosition(state, playerId);
        if (pos) {
          const predictionTick = this.predictionTickBySeq.get(tick);
          if (predictionTick === undefined) {
            return;
          }
          // Ease the correction into the existing queue entry (if present)
          // This smooths out server corrections instead of causing visual pops
          this.localPlayerSmoother.easeCorrection(predictionTick, pos.x, pos.y);
        }
      }
    });
  }

  reset(): void {
    this.inputBuffer.clear();
    this.predictor.reset();
    this.snapshotBuffer.clear();
    this.localPlayerSmoother.reset();
    this.predictionTick = 0;
    this.predictionTickBySeq.clear();
    this.lastAckedSeq = -1;
    this.lastSnapshotTick = -1;
    this.lastLevelId = null;
    this.lastRenderTime = 0;
    this.lastRttMs = null;
    this.lastSpectatorTickLag = null;
    this.lastLocalTimeTick = null;
    this.timingLastUpdateMs = 0;
    this.timingManager.reset();

    // Clear remote player smoothers
    for (const smoother of this.remotePlayerSmoothers.values()) {
      smoother.reset();
    }
    this.remotePlayerSmoothers.clear();
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

  constructor(worldManager: WorldManager<TWorld>, config: ServerAuthoritativeServerConfig<TWorld, TInput>) {
    this.worldManager = worldManager;
    this.inputQueue = new InputQueue<TInput>();
    this.snapshotBuffer = new SnapshotBuffer<TWorld>(config.snapshotHistorySize);
    this.simulate = config.simulate;
    this.addPlayerToWorld = config.addPlayerToWorld;
    this.removePlayerFromWorld = config.removePlayerFromWorld;
    this.tickIntervalMs = config.tickIntervalMs;
    this.mergeInputs =
      config.mergeInputs ??
      ((inputs: TInput[]) => {
        if (inputs.length === 0) {
          throw new Error("mergeInputs called with empty array - provide a custom merger that handles idle inputs");
        }
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

    const batchedInputs = this.inputQueue.getAllPendingInputsBatched();

    const inputAcks = new Map<string, number>();
    for (const clientId of this.inputQueue.getClientsWithInputs()) {
      const inputs = this.inputQueue.getPendingInputs(clientId);
      const lastInput = inputs.at(-1);
      if (lastInput) {
        inputAcks.set(clientId, lastInput.seq);
        this.inputQueue.acknowledge(clientId, lastInput.seq);
      }
    }

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
    let newWorld = world;

    for (const clientId of this.connectedClients) {
      newWorld = this.addPlayerToWorld(newWorld, clientId);
    }

    this.worldManager.setState(newWorld);
    this.snapshotBuffer.clear();
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

  getSnapshotAtTimestamp(timestamp: number): Snapshot<TWorld> | undefined {
    return this.snapshotBuffer.getAtTimestamp(timestamp);
  }

  getConnectedClients(): string[] {
    return Array.from(this.connectedClients);
  }

  getSnapshotBuffer(): SnapshotBuffer<TWorld> {
    return this.snapshotBuffer;
  }

  /**
   * Get current queued input count for a client.
   */
  getQueuedInputCount(clientId: string): number {
    return this.inputQueue.getQueueLength(clientId);
  }
}
