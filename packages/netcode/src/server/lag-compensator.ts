/**
 * Lag compensation for hit detection and action validation.
 *
 * When a client performs an action (e.g., shoots), they see other players
 * in the past due to interpolation delay. The LagCompensator rewinds
 * server state to validate actions against where targets actually were
 * from the shooter's perspective.
 *
 * @module server/lag-compensator
 */

import type { SnapshotBuffer } from "../core/snapshot-buffer.js";
import type { ActionValidator, Snapshot } from "../core/types.js";

/**
 * Configuration for the lag compensator.
 */
export interface LagCompensatorConfig {
  /**
   * Maximum time in milliseconds the server will rewind for lag compensation.
   * Actions older than this will use the oldest available snapshot.
   * Default: 200ms (reasonable limit to prevent abuse)
   */
  maxRewindMs?: number;

  /**
   * Interpolation delay used by clients in milliseconds.
   * This is subtracted from the rewind calculation since clients
   * see other players this far in the past.
   * Default: ~33ms (2 ticks at 60 TPS)
   */
  interpolationDelayMs?: number;
}

/**
 * Per-client clock synchronization data.
 */
export interface ClientClockInfo {
  /**
   * Estimated offset between client and server clocks in milliseconds.
   * serverTime ≈ clientTime + clockOffset
   */
  clockOffset: number;

  /**
   * Last measured round-trip time in milliseconds.
   * Used as fallback when clock offset isn't available.
   */
  rtt: number;

  /** Timestamp of last clock sync */
  lastSyncTime: number;
}

/**
 * Result of lag compensation validation.
 */
export interface LagCompensationResult<TResult> {
  /** Whether the action was successful */
  success: boolean;

  /** Optional result data from the validator */
  result?: TResult;

  /** The server timestamp that was used for validation (rewound time) */
  rewoundTimestamp: number;

  /** The snapshot tick that was used for validation */
  rewoundTick: number;
}

/**
 * Handles lag compensation for action validation.
 *
 * The compensator maintains clock synchronization data per client and
 * uses the snapshot buffer to rewind world state for hit validation.
 *
 * @typeParam TWorld - Your game's world state type
 *
 * @example
 * ```ts
 * const compensator = new LagCompensator(snapshotBuffer, {
 *   maxRewindMs: 200,
 *   interpolationDelayMs: 100,
 * });
 *
 * // On clock sync ping from client
 * compensator.updateClientClock(clientId, { clockOffset: 50, rtt: 100 });
 *
 * // When validating an action
 * const result = compensator.validateAction(
 *   clientId,
 *   action,
 *   clientTimestamp,
 *   validateAttack
 * );
 * ```
 */
export class LagCompensator<TWorld> {
  private snapshotBuffer: SnapshotBuffer<TWorld>;
  private clientClocks: Map<string, ClientClockInfo> = new Map();
  private maxRewindMs: number;
  private interpolationDelayMs: number;

  constructor(snapshotBuffer: SnapshotBuffer<TWorld>, config: LagCompensatorConfig = {}) {
    this.snapshotBuffer = snapshotBuffer;
    this.maxRewindMs = config.maxRewindMs ?? 200;
    // Default: 2 ticks at 60 TPS = ~33ms
    this.interpolationDelayMs = config.interpolationDelayMs ?? 33;
  }

  /**
   * Update clock synchronization data for a client.
   * Call this when receiving clock sync responses from the client.
   *
   * @param clientId - The client's ID
   * @param info - Clock synchronization data
   */
  updateClientClock(clientId: string, info: Partial<ClientClockInfo>): void {
    const existing = this.clientClocks.get(clientId);
    this.clientClocks.set(clientId, {
      clockOffset: info.clockOffset ?? existing?.clockOffset ?? 0,
      rtt: info.rtt ?? existing?.rtt ?? 0,
      lastSyncTime: Date.now(),
    });
  }

  /**
   * Remove clock data for a disconnected client.
   *
   * @param clientId - The client's ID
   */
  removeClient(clientId: string): void {
    this.clientClocks.delete(clientId);
  }

  /**
   * Calculate the server timestamp to rewind to for a given client action.
   *
   * Uses clock offset if available, otherwise falls back to RTT/2 estimation.
   *
   * @param clientId - The client who performed the action
   * @param clientTimestamp - The client's local timestamp when action occurred
   * @returns The server timestamp to use for validation
   */
  calculateRewindTimestamp(clientId: string, clientTimestamp: number): number {
    const clockInfo = this.clientClocks.get(clientId);
    const now = Date.now();

    let rewoundServerTime: number;

    if (clockInfo !== undefined) {
      // We have clock info for this client
      // Primary method: use clock offset (even if it's 0, that's a valid synchronized offset)
      // serverTime = clientTime + clockOffset
      // Then subtract interpolation delay (client sees past state)
      rewoundServerTime = clientTimestamp + clockInfo.clockOffset - this.interpolationDelayMs;
    } else {
      // No clock info at all: use current time minus interpolation delay
      // This is the least accurate but still provides some compensation
      rewoundServerTime = now - this.interpolationDelayMs;
    }

    // Clamp to maximum rewind time
    const minAllowedTime = now - this.maxRewindMs;
    return Math.max(rewoundServerTime, minAllowedTime);
  }

  /**
   * Get the historical snapshot for a given rewind timestamp.
   *
   * @param rewoundTimestamp - The server timestamp to look up
   * @returns The closest snapshot, or undefined if buffer is empty
   */
  getHistoricalSnapshot(rewoundTimestamp: number): Snapshot<TWorld> | undefined {
    return this.snapshotBuffer.getAtTimestamp(rewoundTimestamp);
  }

  /**
   * Validate an action using lag compensation.
   *
   * This is the main entry point for action validation. It:
   * 1. Calculates the appropriate rewind timestamp
   * 2. Retrieves the historical snapshot
   * 3. Runs the validator against the historical state
   *
   * @typeParam TAction - The action type
   * @typeParam TResult - The result type
   *
   * @param clientId - The client who performed the action
   * @param action - The action to validate
   * @param clientTimestamp - When the client performed the action (client clock)
   * @param validator - Function to validate the action against world state
   * @returns Validation result with success flag and metadata
   */
  validateAction<TAction, TResult>(
    clientId: string,
    action: TAction,
    clientTimestamp: number,
    validator: ActionValidator<TWorld, TAction, TResult>,
  ): LagCompensationResult<TResult> {
    // Calculate rewind time
    const rewoundTimestamp = this.calculateRewindTimestamp(clientId, clientTimestamp);

    // Get historical snapshot
    const snapshot = this.getHistoricalSnapshot(rewoundTimestamp);

    if (!snapshot) {
      // No snapshot available - fail the action
      return {
        success: false,
        rewoundTimestamp,
        rewoundTick: -1,
      };
    }

    // Validate against historical state
    const validationResult = validator(snapshot.state, clientId, action);

    return {
      success: validationResult.success,
      result: validationResult.result,
      rewoundTimestamp,
      rewoundTick: snapshot.tick,
    };
  }

  /**
   * Get clock info for a client (for debugging/monitoring).
   *
   * @param clientId - The client's ID
   * @returns Clock info or undefined if not available
   */
  getClientClockInfo(clientId: string): ClientClockInfo | undefined {
    return this.clientClocks.get(clientId);
  }

  /**
   * Get the maximum rewind time setting.
   */
  getMaxRewindMs(): number {
    return this.maxRewindMs;
  }

  /**
   * Get the interpolation delay setting.
   */
  getInterpolationDelayMs(): number {
    return this.interpolationDelayMs;
  }
}
