/**
 * High-level server factory for easy setup with Socket.IO.
 *
 * @module create-server
 */

import type { Server, Socket } from "socket.io";
import { DEFAULT_INTERPOLATION_TICKS, DEFAULT_SNAPSHOT_HISTORY_SIZE, DEFAULT_TICK_RATE, DEFAULT_TICK_INTERVAL_MS } from "./constants.js";
import type { ActionMessage, ActionResult, ActionValidator, GameDefinition, InputMerger, SimulateFunction } from "./core/types.js";
import { DefaultWorldManager } from "./core/world.js";
import { ActionQueue } from "./server/action-queue.js";
import { LagCompensator } from "./server/lag-compensator.js";
import {
  ServerAuthoritativeServer,
  type ServerAuthoritativeServerConfig,
} from "./strategies/server-authoritative.js";

/** Default interval for clock sync pings (5 seconds) */
const DEFAULT_CLOCK_SYNC_INTERVAL_MS = 5000;

/**
 * Base configuration shared by all server config variants.
 */
interface ServerConfigBase<
  TWorld,
  _TInput extends { timestamp: number },
  TAction = unknown,
  TActionResult = unknown,
> {
  /** Socket.IO server instance */
  io: Server;
  /** Initial world state before any players join */
  initialWorld: TWorld;
  /** Server tick rate in Hz (default: DEFAULT_TICK_RATE). Higher = more responsive but more bandwidth. */
  tickRate?: number;
  /** Number of snapshots to keep for lag compensation (default: DEFAULT_SNAPSHOT_HISTORY_SIZE) */
  snapshotHistorySize?: number;
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
   * Interpolation ticks used by clients (must match client config).
   * Used for lag compensation calculations.
   * Default: DEFAULT_INTERPOLATION_TICKS (2 ticks)
   */
  interpolationTicks?: number;
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
  /**
   * Interval in milliseconds between clock sync pings to clients.
   * Set to 0 to disable automatic clock sync.
   * Default: 5000ms (5 seconds)
   */
  clockSyncIntervalMs?: number;
}

/**
 * Server config using explicit function properties.
 */
interface ServerConfigExplicit<
  TWorld,
  TInput extends { timestamp: number },
  TAction = unknown,
  TActionResult = unknown,
> extends ServerConfigBase<TWorld, TInput, TAction, TActionResult> {
  /** Function that simulates one tick of the game world. Must be deterministic. */
  simulate: SimulateFunction<TWorld, TInput>;
  /** Function to add a new player to the world state */
  addPlayer: (world: TWorld, playerId: string) => TWorld;
  /** Function to remove a player from the world state */
  removePlayer: (world: TWorld, playerId: string) => TWorld;
  /** Function to create an idle/neutral input for players who sent no input this tick */
  createIdleInput: () => TInput;
  /** Function to merge multiple inputs that arrive in one tick (default: use last input) */
  mergeInputs?: InputMerger<TInput>;
  /** Do not provide when using explicit config */
  game?: undefined;
}

/**
 * Server config using a GameDefinition object.
 */
interface ServerConfigWithGame<
  TWorld,
  TInput extends { timestamp: number },
  TAction = unknown,
  TActionResult = unknown,
> extends ServerConfigBase<TWorld, TInput, TAction, TActionResult> {
  /** Complete game definition providing simulation and player management */
  game: GameDefinition<TWorld, TInput>;
  /** Do not provide when using game definition */
  simulate?: undefined;
  /** Do not provide when using game definition */
  addPlayer?: undefined;
  /** Do not provide when using game definition */
  removePlayer?: undefined;
  /** Do not provide when using game definition */
  createIdleInput?: undefined;
  /** Do not provide when using game definition */
  mergeInputs?: undefined;
}

/**
 * Configuration for creating a netcode server.
 *
 * You can either provide individual functions (simulate, addPlayer, etc.) or
 * a complete GameDefinition via the `game` property.
 *
 * @typeParam TWorld - The type of your game's world state
 * @typeParam TInput - The type of player input (must include timestamp)
 * @typeParam TAction - The type of discrete actions (optional, for lag compensation)
 * @typeParam TActionResult - The type of action results (optional)
 */
export type ServerConfig<
  TWorld,
  TInput extends { timestamp: number },
  TAction = unknown,
  TActionResult = unknown,
> =
  | ServerConfigExplicit<TWorld, TInput, TAction, TActionResult>
  | ServerConfigWithGame<TWorld, TInput, TAction, TActionResult>;

/**
 * Handle returned by {@link createServer} to control the game loop.
 *
 * @typeParam TWorld - The type of your game's world state
 */
export interface ServerHandle<TWorld> {
  /** Start the server game loop. Begins processing inputs and broadcasting snapshots. */
  start(): void;
  /** Stop the server game loop. */
  stop(): void;
  /** Check if the game loop is currently running. */
  isRunning(): boolean;
  /** Get the current authoritative world state. */
  getWorldState(): TWorld;
  /**
   * Replace the entire world state.
   * Useful for level changes, game resets, or loading saved states.
   * The new world is immediately broadcast to all clients.
   *
   * @param world - The new world state
   */
  setWorld(world: TWorld): void;
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
 * import { createServer } from "@game/netcode/server";
 * import { superjsonParser } from "@game/netcode/parser";
 *
 * const io = new Server({ parser: superjsonParser });
 *
 * const server = createServer({
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
export function createServer<
  TWorld,
  TInput extends { timestamp: number },
  TAction = unknown,
  TActionResult = unknown,
>(
  config: ServerConfig<TWorld, TInput, TAction, TActionResult>,
): ServerHandle<TWorld> {
  // Extract game logic from either explicit config or GameDefinition
  const simulate = config.game?.simulate ?? config.simulate;
  const addPlayer = config.game?.addPlayer ?? config.addPlayer;
  const removePlayer = config.game?.removePlayer ?? config.removePlayer;
  const createIdleInput = config.game?.createIdleInput ?? config.createIdleInput;
  const mergeInputs = config.game?.mergeInputs ?? config.mergeInputs;

  if (!simulate) {
    throw new Error("[NetcodeServer] simulate function is required (provide via config or game definition)");
  }
  if (!addPlayer) {
    throw new Error("[NetcodeServer] addPlayer function is required (provide via config or game definition)");
  }
  if (!removePlayer) {
    throw new Error("[NetcodeServer] removePlayer function is required (provide via config or game definition)");
  }
  if (!createIdleInput) {
    throw new Error("[NetcodeServer] createIdleInput function is required (provide via config or game definition)");
  }

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
    simulate,
    addPlayerToWorld: addPlayer,
    removePlayerFromWorld: removePlayer,
    tickIntervalMs,
    snapshotHistorySize,
    mergeInputs,
    createIdleInput,
  };

  const strategy = new ServerAuthoritativeServer<TWorld, TInput>(worldManager, serverConfig);

  // Lag compensation (only if validateAction is provided)
  // Convert interpolation ticks to milliseconds for lag compensation
  const interpolationTicks = config.interpolationTicks ?? DEFAULT_INTERPOLATION_TICKS;
  const interpolationDelayMs = interpolationTicks * tickIntervalMs;
  
  const lagCompensator = config.validateAction
    ? new LagCompensator<TWorld>(strategy.getSnapshotBuffer(), {
        maxRewindMs: config.maxRewindMs ?? 200,
        interpolationDelayMs,
      })
    : null;

  // Action queue (only if validateAction is provided)
  const actionQueue = config.validateAction ? new ActionQueue<TAction>() : null;

  // Game loop state
  let intervalId: NodeJS.Timeout | null = null;

  // Clock sync state
  const clockSyncIntervalMs = config.clockSyncIntervalMs ?? DEFAULT_CLOCK_SYNC_INTERVAL_MS;
  const pendingClockSyncs: Map<string, number> = new Map(); // clientId -> serverSendTime

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

    // Handle clock sync response (for lag compensation accuracy)
    socket.on("netcode:clock_sync_response", (message: unknown) => {
      if (!lagCompensator) return;
      if (typeof message !== "object" || message === null) return;

      const { serverTimestamp, clientTimestamp } = message as {
        serverTimestamp?: unknown;
        clientTimestamp?: unknown;
      };
      if (typeof serverTimestamp !== "number" || typeof clientTimestamp !== "number") return;

      const serverSendTime = pendingClockSyncs.get(clientId);
      if (serverSendTime === undefined) return;
      pendingClockSyncs.delete(clientId);

      const serverReceiveTime = Date.now();
      const rtt = serverReceiveTime - serverSendTime;

      // Calculate clock offset: serverTime ≈ clientTime + clockOffset
      // At the moment the client captured clientTimestamp, the server time was approximately:
      // serverSendTime + (rtt / 2)
      // So: serverSendTime + (rtt / 2) ≈ clientTimestamp + clockOffset
      // clockOffset ≈ serverSendTime + (rtt / 2) - clientTimestamp
      const clockOffset = serverSendTime + rtt / 2 - clientTimestamp;

      lagCompensator.updateClientClock(clientId, { clockOffset, rtt });
    });

    // Send initial clock sync ping
    if (lagCompensator && clockSyncIntervalMs > 0) {
      const serverTimestamp = Date.now();
      pendingClockSyncs.set(clientId, serverTimestamp);
      socket.emit("netcode:clock_sync", { serverTimestamp });
    }

    // Handle disconnect
    socket.on("disconnect", () => {
      console.log(`[NetcodeServer] Client disconnected: ${clientId}`);
      strategy.removeClient(clientId);
      lagCompensator?.removeClient(clientId);
      actionQueue?.removeClient(clientId);
      pendingClockSyncs.delete(clientId);
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

  // Clock sync interval
  let clockSyncIntervalId: NodeJS.Timeout | null = null;

  const sendClockSyncToAll = () => {
    if (!lagCompensator) return;

    const serverTimestamp = Date.now();
    for (const [, socket] of config.io.sockets.sockets) {
      pendingClockSyncs.set(socket.id, serverTimestamp);
      socket.emit("netcode:clock_sync", { serverTimestamp });
    }
  };

  return {
    start() {
      if (intervalId !== null) return;
      intervalId = setInterval(tick, tickIntervalMs);
      console.log(`[NetcodeServer] Started game loop at ${tickRate} Hz`);

      // Start periodic clock sync if enabled
      if (lagCompensator && clockSyncIntervalMs > 0) {
        clockSyncIntervalId = setInterval(sendClockSyncToAll, clockSyncIntervalMs);
      }
    },

    stop() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
        config.io.off("connection", connectionHandler);
        console.log("[NetcodeServer] Stopped game loop");
      }
      if (clockSyncIntervalId !== null) {
        clearInterval(clockSyncIntervalId);
        clockSyncIntervalId = null;
      }
      pendingClockSyncs.clear();
    },

    isRunning() {
      return intervalId !== null;
    },

    getWorldState() {
      return strategy.getWorldState();
    },

    setWorld(world: TWorld) {
      strategy.setWorldState(world);
      // Immediately broadcast the new world to all clients
      const snapshot = strategy.createSnapshot();
      config.io.emit("netcode:snapshot", snapshot);
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
