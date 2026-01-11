/**
 * High-level server factory for easy setup with Socket.IO.
 *
 * @module create-server
 */

import type { Server, Socket } from "socket.io";
import { DEFAULT_SNAPSHOT_HISTORY_SIZE, DEFAULT_TICK_RATE } from "./constants.js";
import type { InputMerger, SimulateFunction } from "./core/types.js";
import { DefaultWorldManager } from "./core/world.js";
import {
  ServerAuthoritativeServer,
  type ServerAuthoritativeServerConfig,
} from "./strategies/server-authoritative.js";

/**
 * Configuration for creating a netcode server.
 *
 * @typeParam TWorld - The type of your game's world state
 * @typeParam TInput - The type of player input (must include timestamp)
 */
export interface CreateServerConfig<TWorld, TInput extends { timestamp: number }> {
  /** Socket.IO server instance */
  io: Server;
  /** Initial world state before any players join */
  initialWorld: TWorld;
  /** Function that simulates one tick of the game world. Must be deterministic. */
  simulate: SimulateFunction<TWorld, TInput>;
  /** Function to add a new player to the world state */
  addPlayer: (world: TWorld, playerId: string) => TWorld;
  /** Function to remove a player from the world state */
  removePlayer: (world: TWorld, playerId: string) => TWorld;
  /** Server tick rate in Hz (default: DEFAULT_TICK_RATE). Higher = more responsive but more bandwidth. */
  tickRate?: number;
  /** Number of snapshots to keep for lag compensation (default: DEFAULT_SNAPSHOT_HISTORY_SIZE) */
  snapshotHistorySize?: number;
  /** Function to merge multiple inputs that arrive in one tick (default: use last input) */
  mergeInputs?: InputMerger<TInput>;
  /** Function to create an idle/neutral input for players who sent no input this tick */
  createIdleInput: () => TInput;
  /** Called when a player connects */
  onPlayerJoin?: (playerId: string) => void;
  /** Called when a player disconnects */
  onPlayerLeave?: (playerId: string) => void;
}

/**
 * Handle returned by {@link createNetcodeServer} to control the game loop.
 *
 * @typeParam TWorld - The type of your game's world state
 */
export interface NetcodeServerHandle<TWorld> {
  /** Start the server game loop. Begins processing inputs and broadcasting snapshots. */
  start(): void;
  /** Stop the server game loop. */
  stop(): void;
  /** Check if the game loop is currently running. */
  isRunning(): boolean;
  /** Get the current authoritative world state. */
  getWorldState(): TWorld;
  /** Get the current server tick number. */
  getTick(): number;
  /** Get the number of currently connected clients. */
  getClientCount(): number;
}

/**
 * Create a netcode server with Socket.IO integration.
 *
 * Sets up a server-authoritative game loop that:
 * - Accepts player connections and adds them to the world
 * - Receives input from clients and queues it for processing
 * - Runs a fixed-timestep simulation at the configured tick rate
 * - Broadcasts world snapshots to all connected clients
 *
 * @typeParam TWorld - The type of your game's world state
 * @typeParam TInput - The type of player input (must include timestamp)
 *
 * @param config - Server configuration
 * @returns A handle to control the server game loop
 *
 * @example
 * ```ts
 * import { Server } from "socket.io";
 * import { createNetcodeServer, superjsonParser } from "@game/netcode";
 *
 * const io = new Server({ parser: superjsonParser });
 *
 * const server = createNetcodeServer({
 *   io,
 *   initialWorld: { players: new Map(), tick: 0 },
 *   simulate: (world, inputs, dt) => { ... },
 *   addPlayer: (world, id) => { ... },
 *   removePlayer: (world, id) => { ... },
 *   createIdleInput: () => ({ moveX: 0, moveY: 0, jump: false, timestamp: 0 }),
 * });
 *
 * server.start();
 * io.listen(3000);
 * ```
 */
export function createNetcodeServer<TWorld, TInput extends { timestamp: number }>(
  config: CreateServerConfig<TWorld, TInput>,
): NetcodeServerHandle<TWorld> {
  const tickRate = config.tickRate ?? DEFAULT_TICK_RATE;
  if (!Number.isFinite(tickRate) || tickRate <= 0) {
    throw new Error(`[NetcodeServer] tickRate must be a positive finite number. Got: ${tickRate}`);
  }
  const tickIntervalMs = 1000 / tickRate;
  const snapshotHistorySize = config.snapshotHistorySize ?? DEFAULT_SNAPSHOT_HISTORY_SIZE;
  if (!Number.isInteger(snapshotHistorySize) || snapshotHistorySize <= 0) {
    throw new Error(
      `[NetcodeServer] snapshotHistorySize must be a positive integer. Got: ${snapshotHistorySize}`,
    );
  }

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
    createIdleInput: config.createIdleInput,
  };

  const strategy = new ServerAuthoritativeServer<TWorld, TInput>(worldManager, serverConfig);

  // Game loop state
  let intervalId: NodeJS.Timeout | null = null;

  // Connection handler (extracted for cleanup in stop())
  const connectionHandler = (socket: Socket) => {
    const clientId = socket.id;
    console.log(`[NetcodeServer] Client connected: ${clientId}`);

    // Add player to world
    strategy.addClient(clientId);
    config.onPlayerJoin?.(clientId);

    // Notify other clients
    socket.broadcast.emit("netcode:join", { playerId: clientId });

    // Handle input messages with validation (untrusted client data)
    socket.on("netcode:input", (message: unknown) => {
      if (typeof message !== "object" || message === null) return;
      const { seq, input } = message as { seq?: unknown; input?: unknown };
      if (!Number.isInteger(seq) || (seq as number) < 0) return;
      if (typeof input !== "object" || input === null) return;
      if (typeof (input as { timestamp?: unknown }).timestamp !== "number") return;
      strategy.onClientInput(clientId, input as TInput, seq as number);
    });

    // Handle disconnect
    socket.on("disconnect", () => {
      console.log(`[NetcodeServer] Client disconnected: ${clientId}`);
      strategy.removeClient(clientId);
      config.onPlayerLeave?.(clientId);
      config.io.emit("netcode:leave", { playerId: clientId });
    });
  };

  // Set up Socket.IO handlers
  config.io.on("connection", connectionHandler);

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
        config.io.off("connection", connectionHandler);
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
