/**
 * High-level server factory for easy setup with Socket.IO.
 *
 * @module create-server
 */

import type { Server, Socket } from "socket.io";
import { DEFAULT_INTERPOLATION_DELAY_MS, DEFAULT_SNAPSHOT_HISTORY_SIZE, DEFAULT_TICK_RATE } from "./constants.js";
import type { ActionMessage, ActionResult, ActionValidator, InputMerger, SimulateFunction } from "./core/types.js";
import { DefaultWorldManager } from "./core/world.js";
import { ActionQueue } from "./server/action-queue.js";
import { LagCompensator } from "./server/lag-compensator.js";
import {
  ServerAuthoritativeServer,
  type ServerAuthoritativeServerConfig,
} from "./strategies/server-authoritative.js";

/**
 * Configuration for creating a netcode server.
 *
 * @typeParam TWorld - The type of your game's world state
 * @typeParam TInput - The type of player input (must include timestamp)
 * @typeParam TAction - The type of discrete actions (optional, for lag compensation)
 * @typeParam TActionResult - The type of action results (optional)
 */
export interface CreateServerConfig<
  TWorld,
  TInput extends { timestamp: number },
  TAction = unknown,
  TActionResult = unknown,
> {
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
  /**
   * Function to validate actions with lag compensation.
   * If provided, enables the action system. Actions are validated against
   * historical world state based on client timestamps.
   */
  validateAction?: ActionValidator<TWorld, TAction, TActionResult>;
  /**
   * Maximum time in milliseconds the server will rewind for lag compensation.
   * Default: 200ms
   */
  maxRewindMs?: number;
  /**
   * Interpolation delay used by clients (must match client config).
   * Default: DEFAULT_INTERPOLATION_DELAY_MS (100ms)
   */
  interpolationDelayMs?: number;
  /**
   * Called when an action is validated (for logging/debugging).
   * @param clientId - The client who performed the action
   * @param action - The action that was validated
   * @param result - The validation result
   */
  onActionValidated?: (
    clientId: string,
    action: TAction,
    result: ActionResult<TActionResult>,
  ) => void;
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
  /**
   * Update clock synchronization data for a client.
   * Call this when you implement clock sync (ping/pong) with clients.
   *
   * @param clientId - The client's ID
   * @param clockOffset - Estimated offset: serverTime ≈ clientTime + clockOffset
   * @param rtt - Round-trip time in milliseconds
   */
  updateClientClock(clientId: string, clockOffset: number, rtt: number): void;
  /** Get the lag compensator instance (for advanced use cases) */
  getLagCompensator(): LagCompensator<TWorld> | null;
}

/**
 * Create a netcode server with Socket.IO integration.
 *
 * Sets up a server-authoritative game loop that:
 * - Accepts player connections and adds them to the world
 * - Receives input from clients and queues it for processing
 * - Runs a fixed-timestep simulation at the configured tick rate
 * - Broadcasts world snapshots to all connected clients
 * - Validates discrete actions with lag compensation (if validateAction is provided)
 *
 * @typeParam TWorld - The type of your game's world state
 * @typeParam TInput - The type of player input (must include timestamp)
 * @typeParam TAction - The type of discrete actions (optional, for lag compensation)
 * @typeParam TActionResult - The type of action results (optional)
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
 *   // Optional: Enable lag compensation for actions
 *   validateAction: (world, clientId, action) => {
 *     // Validate attack against historical world state
 *     return { success: true, result: { damage: 10 } };
 *   },
 * });
 *
 * server.start();
 * io.listen(3000);
 * ```
 */
export function createNetcodeServer<
  TWorld,
  TInput extends { timestamp: number },
  TAction = unknown,
  TActionResult = unknown,
>(
  config: CreateServerConfig<TWorld, TInput, TAction, TActionResult>,
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
    simulate: config.simulate,
    addPlayerToWorld: config.addPlayer,
    removePlayerFromWorld: config.removePlayer,
    tickIntervalMs,
    snapshotHistorySize,
    mergeInputs: config.mergeInputs,
    createIdleInput: config.createIdleInput,
  };

  const strategy = new ServerAuthoritativeServer<TWorld, TInput>(worldManager, serverConfig);

  // Lag compensation (only if validateAction is provided)
  const lagCompensator = config.validateAction
    ? new LagCompensator<TWorld>(strategy.getSnapshotBuffer(), {
        maxRewindMs: config.maxRewindMs ?? 200,
        interpolationDelayMs: config.interpolationDelayMs ?? DEFAULT_INTERPOLATION_DELAY_MS,
      })
    : null;

  // Action queue (only if validateAction is provided)
  const actionQueue = config.validateAction ? new ActionQueue<TAction>() : null;

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

    // Handle action messages (only if lag compensation is enabled)
    if (actionQueue && config.validateAction) {
      socket.on("netcode:action", (message: unknown) => {
        if (typeof message !== "object" || message === null) return;
        const { seq, action, clientTimestamp } = message as {
          seq?: unknown;
          action?: unknown;
          clientTimestamp?: unknown;
        };
        if (!Number.isInteger(seq) || (seq as number) < 0) return;
        if (typeof clientTimestamp !== "number") return;
        // action can be any type, we trust the validator to handle it

        const actionMessage: ActionMessage<TAction> = {
          seq: seq as number,
          action: action as TAction,
          clientTimestamp: clientTimestamp as number,
        };

        actionQueue.enqueue(clientId, actionMessage);
      });
    }

    // Handle disconnect
    socket.on("disconnect", () => {
      console.log(`[NetcodeServer] Client disconnected: ${clientId}`);
      strategy.removeClient(clientId);
      lagCompensator?.removeClient(clientId);
      actionQueue?.removeClient(clientId);
      config.onPlayerLeave?.(clientId);
      config.io.emit("netcode:leave", { playerId: clientId });
    });
  };

  // Set up Socket.IO handlers
  config.io.on("connection", connectionHandler);

  // Process pending actions with lag compensation
  const processActions = () => {
    if (!actionQueue || !lagCompensator || !config.validateAction) return;

    const pendingActions = actionQueue.dequeueAll();

    for (const { clientId, message } of pendingActions) {
      // Validate action with lag compensation
      const compensationResult = lagCompensator.validateAction(
        clientId,
        message.action,
        message.clientTimestamp,
        config.validateAction,
      );

      // Create action result
      const result: ActionResult<TActionResult> = {
        seq: message.seq,
        success: compensationResult.success,
        result: compensationResult.result,
        serverTimestamp: Date.now(),
      };

      // Send result back to client
      const socket = config.io.sockets.sockets.get(clientId);
      if (socket) {
        socket.emit("netcode:action_result", result);
      }

      // Notify callback
      config.onActionValidated?.(clientId, message.action, result);
    }
  };

  // Game loop tick function
  const tick = () => {
    const snapshot = strategy.tick();
    // With superjsonParser, Map/Set/Date are automatically serialized
    config.io.emit("netcode:snapshot", snapshot);

    // Process actions after tick (so they use the latest snapshot buffer)
    processActions();
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

    updateClientClock(clientId: string, clockOffset: number, rtt: number) {
      lagCompensator?.updateClientClock(clientId, { clockOffset, rtt });
    },

    getLagCompensator() {
      return lagCompensator;
    },
  };
}
