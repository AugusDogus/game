/**
 * High-level client factory for easy setup with Socket.IO
 */

import type { Socket } from "socket.io-client";
import type { Snapshot, InterpolateFunction } from "./core/types.js";
import type { PredictionScope } from "./client/prediction-scope.js";
import { ServerAuthoritativeClient } from "./strategies/server-authoritative.js";
import { DEFAULT_INTERPOLATION_DELAY_MS } from "./constants.js";

/**
 * Configuration for creating a netcode client
 */
export interface CreateClientConfig<TWorld, TInput extends { timestamp: number }> {
  /** Socket.IO client socket */
  socket: Socket;
  /** Prediction scope for local player */
  predictionScope: PredictionScope<TWorld, TInput>;
  /** Interpolation function for smooth rendering */
  interpolate: InterpolateFunction<TWorld>;
  /** Interpolation delay in ms (default: 100) */
  interpolationDelayMs?: number;
  /** Simulated network latency for testing (default: 0) */
  simulatedLatency?: number;
  /** Callback when world updates */
  onWorldUpdate?: (state: TWorld) => void;
  /** Callback when a player joins */
  onPlayerJoin?: (playerId: string) => void;
  /** Callback when a player leaves */
  onPlayerLeave?: (playerId: string) => void;
}

/**
 * Netcode client handle
 */
export interface NetcodeClientHandle<TWorld, TInput extends { timestamp: number }> {
  /** Send input to server */
  sendInput(input: Omit<TInput, "timestamp">): void;
  /** Get current world state for rendering */
  getStateForRendering(): TWorld | null;
  /** Get local player ID */
  getPlayerId(): string | null;
  /** Set simulated latency for testing */
  setSimulatedLatency(latencyMs: number): void;
  /** Get current simulated latency */
  getSimulatedLatency(): number;
  /** Reset client state */
  reset(): void;
}

/**
 * Create a netcode client with Socket.IO integration.
 *
 * IMPORTANT: Make sure to use the superjsonParser when creating the Socket.IO client:
 *
 * ```ts
 * import { superjsonParser } from "@game/netcode";
 * const socket = io({ parser: superjsonParser });
 * ```
 */
export function createNetcodeClient<TWorld, TInput extends { timestamp: number }>(
  config: CreateClientConfig<TWorld, TInput>,
): NetcodeClientHandle<TWorld, TInput> {
  const interpolationDelayMs = config.interpolationDelayMs ?? DEFAULT_INTERPOLATION_DELAY_MS;
  let simulatedLatency = config.simulatedLatency ?? 0;

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
  };

  // Set up socket handlers
  if (config.socket.connected && config.socket.id) {
    strategy.setLocalPlayerId(config.socket.id);
  }

  config.socket.on("connect", handleConnect);
  config.socket.on("netcode:snapshot", handleSnapshot);
  config.socket.on("netcode:join", handleJoin);
  config.socket.on("netcode:leave", handleLeave);
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

    getStateForRendering() {
      return strategy.getStateForRendering();
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
    },
  };
}
