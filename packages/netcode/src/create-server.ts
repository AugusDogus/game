/**
 * High-level server factory for easy setup with Socket.IO
 */

import type { Server, Socket } from "socket.io";
import type { SimulateFunction } from "./core/types.js";
import { DefaultWorldManager } from "./core/world.js";
import {
  ServerAuthoritativeServer,
  type ServerAuthoritativeServerConfig,
} from "./strategies/server-authoritative.js";
import { DEFAULT_TICK_RATE, DEFAULT_SNAPSHOT_HISTORY_SIZE } from "./constants.js";

/**
 * Function to merge multiple inputs into one for a tick.
 */
export type InputMerger<TInput> = (inputs: TInput[]) => TInput;

/**
 * Configuration for creating a netcode server
 */
export interface CreateServerConfig<TWorld, TInput extends { timestamp: number }> {
  /** Socket.IO server instance */
  io: Server;
  /** Initial world state */
  initialWorld: TWorld;
  /** Simulation function */
  simulate: SimulateFunction<TWorld, TInput>;
  /** Function to add a player to the world */
  addPlayer: (world: TWorld, playerId: string) => TWorld;
  /** Function to remove a player from the world */
  removePlayer: (world: TWorld, playerId: string) => TWorld;
  /** Server tick rate in Hz (default: 20) */
  tickRate?: number;
  /** Snapshot history size (default: 60) */
  snapshotHistorySize?: number;
  /** Function to merge multiple inputs per tick (default: use last input) */
  mergeInputs?: InputMerger<TInput>;
  /** Callback when a player joins */
  onPlayerJoin?: (playerId: string) => void;
  /** Callback when a player leaves */
  onPlayerLeave?: (playerId: string) => void;
}

/**
 * Netcode server handle
 */
export interface NetcodeServerHandle<TWorld> {
  /** Start the game loop */
  start(): void;
  /** Stop the game loop */
  stop(): void;
  /** Check if running */
  isRunning(): boolean;
  /** Get current world state */
  getWorldState(): TWorld;
  /** Get current tick */
  getTick(): number;
  /** Get connected client count */
  getClientCount(): number;
}

/**
 * Create a netcode server with Socket.IO integration.
 *
 * IMPORTANT: Make sure to use the superjsonParser when creating the Socket.IO server:
 *
 * ```ts
 * import { superjsonParser } from "@game/netcode";
 * const io = new Server({ parser: superjsonParser });
 * ```
 */
export function createNetcodeServer<TWorld, TInput extends { timestamp: number }>(
  config: CreateServerConfig<TWorld, TInput>,
): NetcodeServerHandle<TWorld> {
  const tickRate = config.tickRate ?? DEFAULT_TICK_RATE;
  const tickIntervalMs = 1000 / tickRate;
  const snapshotHistorySize = config.snapshotHistorySize ?? DEFAULT_SNAPSHOT_HISTORY_SIZE;

  // Create world manager
  const worldManager = new DefaultWorldManager<TWorld>(config.initialWorld);

  // Create server strategy
  const serverConfig: ServerAuthoritativeServerConfig<TWorld, TInput> = {
    initialWorld: config.initialWorld,
    simulate: config.simulate,
    addPlayerToWorld: config.addPlayer,
    removePlayerFromWorld: config.removePlayer,
    tickIntervalMs,
    snapshotHistorySize,
    mergeInputs: config.mergeInputs,
  };

  const strategy = new ServerAuthoritativeServer<TWorld, TInput>(worldManager, serverConfig);

  // Game loop state
  let intervalId: NodeJS.Timeout | null = null;

  // Set up Socket.IO handlers
  config.io.on("connection", (socket: Socket) => {
    const clientId = socket.id;
    console.log(`[NetcodeServer] Client connected: ${clientId}`);

    // Add player to world
    strategy.addClient(clientId);
    config.onPlayerJoin?.(clientId);

    // Notify other clients
    socket.broadcast.emit("netcode:join", { playerId: clientId });

    // Handle input messages
    socket.on("netcode:input", (message: { seq: number; input: TInput; timestamp: number }) => {
      strategy.onClientInput(clientId, message.input, message.seq);
    });

    // Handle disconnect
    socket.on("disconnect", () => {
      console.log(`[NetcodeServer] Client disconnected: ${clientId}`);
      strategy.removeClient(clientId);
      config.onPlayerLeave?.(clientId);
      config.io.emit("netcode:leave", { playerId: clientId });
    });
  });

  // Game loop tick function
  const tick = () => {
    const snapshot = strategy.tick();
    // With superjsonParser, Map/Set/Date are automatically serialized
    config.io.emit("netcode:snapshot", snapshot);
  };

  return {
    start() {
      if (intervalId !== null) return;
      intervalId = setInterval(tick, tickIntervalMs);
      console.log(`[NetcodeServer] Started game loop at ${tickRate} Hz`);
    },

    stop() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
        console.log("[NetcodeServer] Stopped game loop");
      }
    },

    isRunning() {
      return intervalId !== null;
    },

    getWorldState() {
      return strategy.getWorldState();
    },

    getTick() {
      return strategy.getTick();
    },

    getClientCount() {
      return strategy.getConnectedClients().length;
    },
  };
}
