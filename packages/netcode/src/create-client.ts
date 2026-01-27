/**
 * High-level client factory for easy setup with Socket.IO.
 *
 * @module create-client
 */

import type { Socket } from "socket.io-client";
import type { PredictionScope } from "./client/prediction-scope.js";
import { DEFAULT_TICK_INTERVAL_MS, TICK_INTERVAL_MISMATCH_TOLERANCE_MS, CONFIG_HANDSHAKE_TIMEOUT_MS } from "./constants.js";
import type { ActionResult, GameDefinition, Snapshot } from "./core/types.js";
import { ServerAuthoritativeClient, type SmoothingConfig } from "./strategies/server-authoritative.js";

/**
 * Base configuration shared by all client config variants.
 */
interface ClientConfigBase<TWorld, _TInput extends { timestamp: number }, TActionResult = unknown> {
  /** Socket.IO client socket instance */
  socket: Socket;
  /** Server tick interval in milliseconds (default: ~16.67ms / 60 TPS). Must match server's tickIntervalMs for accurate prediction. */
  tickIntervalMs?: number;
  /** Artificial latency for testing netcode behavior (default: 0) */
  simulatedLatency?: number;
  /**
   * FishNet-style tick smoothing configuration.
   * Controls how player positions are smoothed for rendering.
   */
  smoothing?: SmoothingConfig;
  /** Called when a new world snapshot is received and processed */
  onWorldUpdate?: (state: TWorld) => void;
  /** Called when another player joins the game */
  onPlayerJoin?: (playerId: string) => void;
  /** Called when another player leaves the game */
  onPlayerLeave?: (playerId: string) => void;
  /** Called when an action result is received from the server */
  onActionResult?: (result: ActionResult<TActionResult>) => void;
}

/**
 * Client config using explicit function properties.
 */
interface ClientConfigExplicit<TWorld, TInput extends { timestamp: number }, TActionResult = unknown>
  extends ClientConfigBase<TWorld, TInput, TActionResult> {
  /** Defines how to predict and merge local player state. See {@link PredictionScope}. */
  predictionScope: PredictionScope<TWorld, TInput>;
  /** Do not provide when using explicit config */
  game?: undefined;
}

/**
 * Client config using a GameDefinition object.
 */
interface ClientConfigWithGame<TWorld, TInput extends { timestamp: number }, TActionResult = unknown>
  extends ClientConfigBase<TWorld, TInput, TActionResult> {
  /** Complete game definition providing prediction scope */
  game: GameDefinition<TWorld, TInput>;
  /** Do not provide when using game definition */
  predictionScope?: undefined;
}

/**
 * Configuration for creating a netcode client.
 *
 * You can either provide a predictionScope directly or
 * a complete GameDefinition via the `game` property.
 *
 * @typeParam TWorld - The type of your game's world state
 * @typeParam TInput - The type of player input (must include timestamp)
 * @typeParam TActionResult - The type of action results (optional)
 */
export type ClientConfig<TWorld, TInput extends { timestamp: number }, TActionResult = unknown> =
  | ClientConfigExplicit<TWorld, TInput, TActionResult>
  | ClientConfigWithGame<TWorld, TInput, TActionResult>;

/**
 * Handle returned by {@link createClient} to interact with the netcode system.
 *
 * @typeParam TWorld - The type of your game's world state
 * @typeParam TInput - The type of player input (must include timestamp)
 * @typeParam TAction - The type of discrete actions (optional, for lag compensation)
 */
export interface ClientHandle<TWorld, TInput extends { timestamp: number }, TAction = unknown> {
  /** Send player input to the server. Timestamp is added automatically. */
  sendInput(input: Omit<TInput, "timestamp">): void;
  /**
   * Send a discrete action to the server (e.g., attack, shoot, use ability).
   * Actions are validated server-side with lag compensation.
   * The client timestamp is added automatically.
   *
   * @param action - The action to send
   * @returns The sequence number assigned to this action
   */
  sendAction(action: TAction): number;
  /** Get the current world state for rendering. Combines predicted local player with smoothed graphical position. */
  getStateForRendering(): TWorld | null;
  /** Get the last raw server snapshot (useful for debug visualization) */
  getLastServerSnapshot(): Snapshot<TWorld> | null;
  /** Get the local player's ID (assigned by server on connection) */
  getPlayerId(): string | null;
  /** Set artificial latency in milliseconds for testing */
  setSimulatedLatency(latencyMs: number): void;
  /** Get current artificial latency setting */
  getSimulatedLatency(): number;
  /** Get smoothing debug info (if supported by strategy) */
  getSmoothingDebug?(): {
    rttMs: number | null;
    serverTick: number;
    localTimeTick: number | null;
    tickLag: number | null;
    remotePlayers: Array<{
      playerId: string;
      interpolation: number;
      queueLength: number;
    }>;
  };
  /** Reset all client state (prediction, smoothing, input buffer) */
  reset(): void;
  /**
   * Clean up all socket event listeners.
   * Call this when unmounting the game or destroying the client to prevent memory leaks.
   */
  destroy(): void;
}

/**
 * Create a netcode client with Socket.IO integration.
 *
 * Sets up a client that:
 * - Predicts local player movement immediately for responsive gameplay
 * - Sends inputs to the server with timestamps
 * - Receives world snapshots and reconciles any mispredictions
 * - Uses FishNet-style tick smoothing for smooth graphical rendering
 * - Sends discrete actions for lag-compensated validation
 *
 * @typeParam TWorld - The type of your game's world state
 * @typeParam TInput - The type of player input (must include timestamp)
 * @typeParam TAction - The type of discrete actions (optional, for lag compensation)
 * @typeParam TActionResult - The type of action results (optional)
 *
 * @param config - Client configuration
 * @returns A handle to send input/actions and get world state for rendering
 *
 * @example
 * ```ts
 * import { io } from "socket.io-client";
 * import { createClient } from "@game/netcode/client";
 * import { superjsonParser } from "@game/netcode/parser";
 *
 * const socket = io("http://localhost:3000", { parser: superjsonParser });
 *
 * const client = createClient({
 *   socket,
 *   predictionScope: myPredictionScope,
 *   onWorldUpdate: (world) => render(world),
 *   onActionResult: (result) => {
 *     if (result.success) console.log('Hit!', result.result);
 *   },
 * });
 *
 * // In your game loop:
 * client.sendInput({ moveX: 1, moveY: 0, jump: false });
 * const worldToRender = client.getStateForRendering();
 *
 * // When player attacks:
 * client.sendAction({ type: 'attack', targetX: 100, targetY: 50 });
 * ```
 */
export function createClient<TWorld, TInput extends { timestamp: number }, TAction = unknown, TActionResult = unknown>(
  config: ClientConfig<TWorld, TInput, TActionResult>,
): ClientHandle<TWorld, TInput, TAction> {
  // Extract client logic from either explicit config or GameDefinition
  const predictionScope = config.game?.createPredictionScope?.() ?? config.predictionScope;

  if (!predictionScope) {
    throw new Error("[NetcodeClient] predictionScope is required (provide via config or game.createPredictionScope)");
  }

  // Client-configured tick interval (used for validation against server)
  const configTickIntervalMs = config.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  let simulatedLatency = config.simulatedLatency ?? 0;
  let actionSeq = 0;

  // Server-authoritative tick interval (set by handshake)
  let serverTickIntervalMs: number | null = null;
  let handshakeReceived = false;
  let handshakeTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Strategy is created lazily after handshake validates tick interval
  let strategy: ServerAuthoritativeClient<TWorld, TInput> | null = null;

  // Queue snapshots received before handshake completes
  const pendingSnapshots: Snapshot<TWorld>[] = [];

  // Handle server config handshake (required)
  const handleConfig = (data: { tickIntervalMs: number; tickRate?: number }) => {
    if (handshakeReceived) return; // Ignore duplicate

    if (typeof data.tickIntervalMs !== "number" || !Number.isFinite(data.tickIntervalMs) || data.tickIntervalMs <= 0) {
      throw new Error(`[NetcodeClient] Invalid tickIntervalMs from server: ${data.tickIntervalMs}`);
    }

    serverTickIntervalMs = data.tickIntervalMs;

    // Validate against client config if provided
    const mismatch = Math.abs(serverTickIntervalMs - configTickIntervalMs);
    if (mismatch > TICK_INTERVAL_MISMATCH_TOLERANCE_MS) {
      throw new Error(
        `[NetcodeClient] Tick interval mismatch: server=${serverTickIntervalMs}ms, client config=${configTickIntervalMs}ms. ` +
        `Difference of ${mismatch.toFixed(2)}ms exceeds tolerance of ${TICK_INTERVAL_MISMATCH_TOLERANCE_MS}ms. ` +
        `Remove tickIntervalMs from client config to use server-authoritative value.`
      );
    }

    // Create strategy with server-authoritative tick interval
    strategy = new ServerAuthoritativeClient<TWorld, TInput>(
      predictionScope,
      serverTickIntervalMs,
      config.smoothing,
    );

    // Set player ID if already connected
    if (config.socket.id) {
      strategy.setLocalPlayerId(config.socket.id);
    }

    handshakeReceived = true;

    // Clear handshake timeout
    if (handshakeTimeoutId !== null) {
      clearTimeout(handshakeTimeoutId);
      handshakeTimeoutId = null;
    }

    // Process any pending snapshots
    for (const snapshot of pendingSnapshots) {
      strategy.onSnapshot(snapshot);
      config.onWorldUpdate?.(snapshot.state);
    }
    pendingSnapshots.length = 0;

    console.log(`[NetcodeClient] Handshake complete: tickIntervalMs=${serverTickIntervalMs}ms`);
  };

  // Handle connection
  const handleConnect = () => {
    if (config.socket.id && strategy) {
      strategy.setLocalPlayerId(config.socket.id);
    }

    // Start handshake timeout
    if (!handshakeReceived && handshakeTimeoutId === null) {
      handshakeTimeoutId = setTimeout(() => {
        if (!handshakeReceived) {
          throw new Error(
            `[NetcodeClient] Server config handshake timeout after ${CONFIG_HANDSHAKE_TIMEOUT_MS}ms. ` +
            `Server must emit 'netcode:config' with tickIntervalMs.`
          );
        }
      }, CONFIG_HANDSHAKE_TIMEOUT_MS);
    }
  };

  // Handle snapshot - with superjsonParser, Map/Set/Date are automatically deserialized
  const handleSnapshot = (snapshot: Snapshot<TWorld>) => {
    const applySnapshot = () => {
      if (!strategy) {
        // Queue snapshot until handshake completes
        pendingSnapshots.push(snapshot);
        return;
      }
      strategy.onSnapshot(snapshot);
      config.onWorldUpdate?.(snapshot.state);
    };

    if (simulatedLatency > 0) {
      setTimeout(applySnapshot, simulatedLatency);
    } else {
      applySnapshot();
    }
  };

  // Handle player join
  const handleJoin = (data: { playerId: string }) => {
    const apply = () => config.onPlayerJoin?.(data.playerId);
    if (simulatedLatency > 0) {
      setTimeout(apply, simulatedLatency);
    } else {
      apply();
    }
  };

  // Handle player leave
  const handleLeave = (data: { playerId: string }) => {
    const apply = () => config.onPlayerLeave?.(data.playerId);
    if (simulatedLatency > 0) {
      setTimeout(apply, simulatedLatency);
    } else {
      apply();
    }
  };

  // Handle disconnect
  const handleDisconnect = () => {
    strategy?.reset();
    actionSeq = 0;
    handshakeReceived = false;
    serverTickIntervalMs = null;
    pendingSnapshots.length = 0;
    if (handshakeTimeoutId !== null) {
      clearTimeout(handshakeTimeoutId);
      handshakeTimeoutId = null;
    }
  };

  // Handle action result
  const handleActionResult = (result: ActionResult<TActionResult>) => {
    const apply = () => config.onActionResult?.(result);
    if (simulatedLatency > 0) {
      setTimeout(apply, simulatedLatency);
    } else {
      apply();
    }
  };

  // Handle clock sync ping from server
  const handleClockSync = (data: { serverTimestamp: number }) => {
    const clientReceiveTime = Date.now();
    // Respond immediately with both timestamps
    // Note: We don't apply simulatedLatency here because clock sync
    // needs to measure actual network conditions, not simulated ones
    const clientTimestamp = Date.now();
    config.socket.emit("netcode:clock_sync_response", {
      serverTimestamp: data.serverTimestamp,
      clientTimestamp,
    });
    if (strategy) {
      const strategyWithClockSync = strategy as {
        onClockSyncPing?: (serverTimestamp: number, clientReceiveTimeMs: number) => void;
      };
      strategyWithClockSync.onClockSyncPing?.(data.serverTimestamp, clientReceiveTime);
    }
  };

  // Handle RTT update from server for adaptive interpolation
  const handleRttUpdate = (data: { rtt: number }) => {
    // Update adaptive interpolation based on measured RTT
    // This adjusts the smoother buffer size to absorb network jitter
    strategy?.onRttUpdate(data.rtt);
  };

  const handleTimingUpdate = (data: { queuedInputs: number; intervalMs: number }) => {
    const strategyWithTimingUpdate = strategy as {
      onTimingUpdate?: (queuedInputs: number, intervalMs: number) => void;
    };
    strategyWithTimingUpdate.onTimingUpdate?.(data.queuedInputs, data.intervalMs);
  };

  // Set up socket handlers
  if (config.socket.connected && config.socket.id && strategy) {
    strategy.setLocalPlayerId(config.socket.id);
  }

  config.socket.on("connect", handleConnect);
  config.socket.on("netcode:config", handleConfig);
  config.socket.on("netcode:snapshot", handleSnapshot);
  config.socket.on("netcode:join", handleJoin);
  config.socket.on("netcode:leave", handleLeave);
  config.socket.on("netcode:action_result", handleActionResult);
  config.socket.on("netcode:clock_sync", handleClockSync);
  config.socket.on("netcode:rtt_update", handleRttUpdate);
  config.socket.on("netcode:timing_update", handleTimingUpdate);
  config.socket.on("disconnect", handleDisconnect);

  // If already connected, request config (we may have missed the initial netcode:config event)
  if (config.socket.connected) {
    handleConnect();
    // Request config in case we missed it (client created after socket connected)
    config.socket.emit("netcode:request_config");
  }

  return {
    sendInput(inputWithoutTimestamp: Omit<TInput, "timestamp">) {
      if (!config.socket.connected || !strategy) return;

      const timestamp = Date.now();
      const input = { ...inputWithoutTimestamp, timestamp } as TInput;

      // Apply locally for prediction
      strategy.onLocalInput(input);

      // Get sequence number
      const seq = strategy.getLastInputSeq();

      // Create message
      const message = { seq, input, timestamp };

      // Send to server
      if (simulatedLatency > 0) {
        setTimeout(() => config.socket.emit("netcode:input", message), simulatedLatency);
      } else {
        config.socket.emit("netcode:input", message);
      }
    },

    sendAction(action: TAction): number {
      // Guard: don't send if not connected (consistent with sendInput behavior)
      if (!config.socket.connected) return -1;

      const seq = ++actionSeq;
      const clientTimestamp = Date.now();

      // Create action message
      const message = { seq, action, clientTimestamp };

      // Send to server (actions use reliable transport)
      if (simulatedLatency > 0) {
        setTimeout(() => config.socket.emit("netcode:action", message), simulatedLatency);
      } else {
        config.socket.emit("netcode:action", message);
      }

      return seq;
    },

    getStateForRendering() {
      return strategy?.getStateForRendering() ?? null;
    },

    getLastServerSnapshot() {
      return strategy?.getLastServerSnapshot() ?? null;
    },

    getPlayerId() {
      return strategy?.getLocalPlayerId() ?? null;
    },

    setSimulatedLatency(latencyMs: number) {
      simulatedLatency = Math.max(0, latencyMs);
    },

    getSimulatedLatency() {
      return simulatedLatency;
    },

    getSmoothingDebug() {
      if (!strategy) return undefined;
      const strategyWithDebug = strategy as {
        getSmoothingDebug?: () => {
          rttMs: number | null;
          serverTick: number;
          localTimeTick: number | null;
          tickLag: number | null;
          remotePlayers: Array<{
            playerId: string;
            interpolation: number;
            queueLength: number;
          }>;
        };
      };
      return strategyWithDebug.getSmoothingDebug?.();
    },

    reset() {
      strategy?.reset();
      actionSeq = 0;
    },

    destroy() {
      // Clear handshake timeout
      if (handshakeTimeoutId !== null) {
        clearTimeout(handshakeTimeoutId);
        handshakeTimeoutId = null;
      }

      // Remove all socket event listeners to prevent memory leaks
      config.socket.off("connect", handleConnect);
      config.socket.off("netcode:config", handleConfig);
      config.socket.off("netcode:snapshot", handleSnapshot);
      config.socket.off("netcode:join", handleJoin);
      config.socket.off("netcode:leave", handleLeave);
      config.socket.off("netcode:action_result", handleActionResult);
      config.socket.off("netcode:clock_sync", handleClockSync);
      config.socket.off("netcode:rtt_update", handleRttUpdate);
      config.socket.off("netcode:timing_update", handleTimingUpdate);
      config.socket.off("disconnect", handleDisconnect);

      // Reset internal state
      strategy?.reset();
      actionSeq = 0;
      handshakeReceived = false;
      serverTickIntervalMs = null;
      pendingSnapshots.length = 0;
    },
  };
}
