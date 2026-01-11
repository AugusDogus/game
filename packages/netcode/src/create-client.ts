/**
 * High-level client factory for easy setup with Socket.IO.
 *
 * @module create-client
 */

import type { Socket } from "socket.io-client";
import type { PredictionScope } from "./client/prediction-scope.js";
import { DEFAULT_INTERPOLATION_DELAY_MS } from "./constants.js";
import type { ActionResult, InterpolateFunction, Snapshot } from "./core/types.js";
import { ServerAuthoritativeClient } from "./strategies/server-authoritative.js";

/**
 * Configuration for creating a netcode client.
 *
 * @typeParam TWorld - The type of your game's world state
 * @typeParam TInput - The type of player input (must include timestamp)
 * @typeParam TActionResult - The type of action results (optional)
 */
export interface CreateClientConfig<
  TWorld,
  TInput extends { timestamp: number },
  TActionResult = unknown,
> {
  /** Socket.IO client socket instance */
  socket: Socket;
  /** Defines how to predict and merge local player state. See {@link PredictionScope}. */
  predictionScope: PredictionScope<TWorld, TInput>;
  /** Function to interpolate between two world states for smooth rendering of other players */
  interpolate: InterpolateFunction<TWorld>;
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
 * Handle returned by {@link createNetcodeClient} to interact with the netcode system.
 *
 * @typeParam TWorld - The type of your game's world state
 * @typeParam TInput - The type of player input (must include timestamp)
 * @typeParam TAction - The type of discrete actions (optional, for lag compensation)
 */
export interface NetcodeClientHandle<
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
 * import { createNetcodeClient, superjsonParser } from "@game/netcode";
 *
 * const socket = io("http://localhost:3000", { parser: superjsonParser });
 *
 * const client = createNetcodeClient({
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
export function createNetcodeClient<
  TWorld,
  TInput extends { timestamp: number },
  TAction = unknown,
  TActionResult = unknown,
>(
  config: CreateClientConfig<TWorld, TInput, TActionResult>,
): NetcodeClientHandle<TWorld, TInput, TAction> {
  const interpolationDelayMs = config.interpolationDelayMs ?? DEFAULT_INTERPOLATION_DELAY_MS;
  let simulatedLatency = config.simulatedLatency ?? 0;
  let actionSeq = 0;

  // Create client strategy
  const strategy = new ServerAuthoritativeClient<TWorld, TInput>(
    config.predictionScope,
    config.interpolate,
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

  // Set up socket handlers
  if (config.socket.connected && config.socket.id) {
    strategy.setLocalPlayerId(config.socket.id);
  }

  config.socket.on("connect", handleConnect);
  config.socket.on("netcode:snapshot", handleSnapshot);
  config.socket.on("netcode:join", handleJoin);
  config.socket.on("netcode:leave", handleLeave);
  config.socket.on("netcode:action_result", handleActionResult);
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
  };
}
