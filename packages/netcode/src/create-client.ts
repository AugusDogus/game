/**
 * High-level client factory for easy setup with Socket.IO.
 *
 * @module create-client
 */

import type { Socket } from "socket.io-client";
import type { PredictionScope } from "./client/prediction-scope.js";
import { DEFAULT_INTERPOLATION_DELAY_MS } from "./constants.js";
import type { ActionResult, GameDefinition, InterpolateFunction, Snapshot } from "./core/types.js";
import { ServerAuthoritativeClient } from "./strategies/server-authoritative.js";

/**
 * Base configuration shared by all client config variants.
 */
interface ClientConfigBase<
  TWorld,
  _TInput extends { timestamp: number },
  TActionResult = unknown,
> {
  /** Socket.IO client socket instance */
  socket: Socket;
  /** How far behind real-time to render other players (default: 100ms). Higher = smoother but more delay. */
  interpolationDelayMs?: number;
  /** Artificial latency for testing netcode behavior (default: 0) */
  simulatedLatency?: number;
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
interface ClientConfigExplicit<
  TWorld,
  TInput extends { timestamp: number },
  TActionResult = unknown,
> extends ClientConfigBase<TWorld, TInput, TActionResult> {
  /** Defines how to predict and merge local player state. See {@link PredictionScope}. */
  predictionScope: PredictionScope<TWorld, TInput>;
  /** Function to interpolate between two world states for smooth rendering of other players */
  interpolate: InterpolateFunction<TWorld>;
  /** Do not provide when using explicit config */
  game?: undefined;
}

/**
 * Client config using a GameDefinition object.
 */
interface ClientConfigWithGame<
  TWorld,
  TInput extends { timestamp: number },
  TActionResult = unknown,
> extends ClientConfigBase<TWorld, TInput, TActionResult> {
  /** Complete game definition providing interpolation and prediction scope */
  game: GameDefinition<TWorld, TInput>;
  /** Do not provide when using game definition */
  predictionScope?: undefined;
  /** Do not provide when using game definition */
  interpolate?: undefined;
}

/**
 * Configuration for creating a netcode client.
 *
 * You can either provide individual functions (predictionScope, interpolate) or
 * a complete GameDefinition via the `game` property.
 *
 * @typeParam TWorld - The type of your game's world state
 * @typeParam TInput - The type of player input (must include timestamp)
 * @typeParam TActionResult - The type of action results (optional)
 */
export type ClientConfig<
  TWorld,
  TInput extends { timestamp: number },
  TActionResult = unknown,
> =
  | ClientConfigExplicit<TWorld, TInput, TActionResult>
  | ClientConfigWithGame<TWorld, TInput, TActionResult>;

/**
 * Handle returned by {@link createClient} to interact with the netcode system.
 *
 * @typeParam TWorld - The type of your game's world state
 * @typeParam TInput - The type of player input (must include timestamp)
 * @typeParam TAction - The type of discrete actions (optional, for lag compensation)
 */
export interface ClientHandle<
  TWorld,
  TInput extends { timestamp: number },
  TAction = unknown,
> {
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
  /** Get the current world state for rendering. Combines predicted local player with interpolated remote players. */
  getStateForRendering(): TWorld | null;
  /** Get the last raw server snapshot (useful for debug visualization) */
  getLastServerSnapshot(): Snapshot<TWorld> | null;
  /** Get the local player's ID (assigned by server on connection) */
  getPlayerId(): string | null;
  /** Set artificial latency in milliseconds for testing */
  setSimulatedLatency(latencyMs: number): void;
  /** Get current artificial latency setting */
  getSimulatedLatency(): number;
  /** Reset all client state (prediction, interpolation, input buffer) */
  reset(): void;
  /** Get the interpolation delay used by this client (for calculating action timestamps) */
  getInterpolationDelayMs(): number;
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
 * - Interpolates other players between past snapshots for smooth rendering
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
 *   interpolate: (from, to, alpha) => { ... },
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
export function createClient<
  TWorld,
  TInput extends { timestamp: number },
  TAction = unknown,
  TActionResult = unknown,
>(
  config: ClientConfig<TWorld, TInput, TActionResult>,
): ClientHandle<TWorld, TInput, TAction> {
  // Extract client logic from either explicit config or GameDefinition
  const predictionScope = config.game?.createPredictionScope?.() ?? config.predictionScope;
  const interpolate = config.game?.interpolate ?? config.interpolate;

  if (!predictionScope) {
    throw new Error("[NetcodeClient] predictionScope is required (provide via config or game.createPredictionScope)");
  }
  if (!interpolate) {
    throw new Error("[NetcodeClient] interpolate function is required (provide via config or game definition)");
  }

  const interpolationDelayMs = config.interpolationDelayMs ?? DEFAULT_INTERPOLATION_DELAY_MS;
  let simulatedLatency = config.simulatedLatency ?? 0;
  let actionSeq = 0;

  // Create client strategy
  const strategy = new ServerAuthoritativeClient<TWorld, TInput>(
    predictionScope,
    interpolate,
    interpolationDelayMs,
  );

  // Handle connection
  const handleConnect = () => {
    if (config.socket.id) {
      strategy.setLocalPlayerId(config.socket.id);
    }
  };

  // Handle snapshot - with superjsonParser, Map/Set/Date are automatically deserialized
  const handleSnapshot = (snapshot: Snapshot<TWorld>) => {
    const applySnapshot = () => {
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
    strategy.reset();
    actionSeq = 0;
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
    // Respond immediately with both timestamps
    // Note: We don't apply simulatedLatency here because clock sync
    // needs to measure actual network conditions, not simulated ones
    const clientTimestamp = Date.now();
    config.socket.emit("netcode:clock_sync_response", {
      serverTimestamp: data.serverTimestamp,
      clientTimestamp,
    });
  };

  // Set up socket handlers
  if (config.socket.connected && config.socket.id) {
    strategy.setLocalPlayerId(config.socket.id);
  }

  config.socket.on("connect", handleConnect);
  config.socket.on("netcode:snapshot", handleSnapshot);
  config.socket.on("netcode:join", handleJoin);
  config.socket.on("netcode:leave", handleLeave);
  config.socket.on("netcode:action_result", handleActionResult);
  config.socket.on("netcode:clock_sync", handleClockSync);
  config.socket.on("disconnect", handleDisconnect);

  return {
    sendInput(inputWithoutTimestamp: Omit<TInput, "timestamp">) {
      if (!config.socket.connected) return;

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
      return strategy.getStateForRendering();
    },

    getLastServerSnapshot() {
      return strategy.getLastServerSnapshot();
    },

    getPlayerId() {
      return strategy.getLocalPlayerId();
    },

    setSimulatedLatency(latencyMs: number) {
      simulatedLatency = Math.max(0, latencyMs);
    },

    getSimulatedLatency() {
      return simulatedLatency;
    },

    reset() {
      strategy.reset();
      actionSeq = 0;
    },

    getInterpolationDelayMs() {
      return interpolationDelayMs;
    },

    destroy() {
      // Remove all socket event listeners to prevent memory leaks
      config.socket.off("connect", handleConnect);
      config.socket.off("netcode:snapshot", handleSnapshot);
      config.socket.off("netcode:join", handleJoin);
      config.socket.off("netcode:leave", handleLeave);
      config.socket.off("netcode:action_result", handleActionResult);
      config.socket.off("netcode:clock_sync", handleClockSync);
      config.socket.off("disconnect", handleDisconnect);

      // Reset internal state
      strategy.reset();
      actionSeq = 0;
    },
  };
}
