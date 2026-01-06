import type { Server, Socket } from "socket.io";
import type { NetcodeServerConfig, InputMessage, WorldSnapshot } from "../types.js";
import { WorldState } from "./world-state.js";
import { InputQueue } from "./input-queue.js";
import { GameLoop } from "./game-loop.js";
import { SnapshotHistory } from "./snapshot-history.js";
import {
  DEFAULT_TICK_RATE,
  DEFAULT_SNAPSHOT_HISTORY_SIZE,
} from "../constants.js";

/**
 * High-level server class that orchestrates all server-side netcode primitives
 */
export class NetcodeServer {
  private io: Server;
  private worldState: WorldState;
  private inputQueue: InputQueue;
  private snapshotHistory: SnapshotHistory;
  private gameLoop: GameLoop;
  private config: Required<NetcodeServerConfig>;
  private connectedClients: Set<string> = new Set();

  constructor(io: Server, config: NetcodeServerConfig = {}) {
    this.io = io;
    this.config = {
      tickRate: config.tickRate ?? DEFAULT_TICK_RATE,
      snapshotHistorySize: config.snapshotHistorySize ?? DEFAULT_SNAPSHOT_HISTORY_SIZE,
    };

    // Initialize primitives
    this.worldState = new WorldState();
    this.inputQueue = new InputQueue();
    this.snapshotHistory = new SnapshotHistory(this.config.snapshotHistorySize);

    const tickInterval = 1000 / this.config.tickRate;
    this.gameLoop = new GameLoop(
      this.worldState,
      this.inputQueue,
      this.snapshotHistory,
      tickInterval,
    );

    // Set up game loop callback
    this.gameLoop.onTick((snapshot) => {
      this.broadcastSnapshot(snapshot);
    });

    // Set up Socket.IO event handlers
    this.setupSocketHandlers();
  }

  /**
   * Set up Socket.IO event handlers
   */
  private setupSocketHandlers(): void {
    this.io.on("connection", (socket: Socket) => {
      const clientId = socket.id;
      console.log(`[NetcodeServer] Client connected: ${clientId}`);

      // Add player to world at spawn position
      this.worldState.addPlayer(clientId, { x: 0, y: 0 });
      this.connectedClients.add(clientId);

      // Notify other clients about new player
      socket.broadcast.emit("netcode:join", {
        playerId: clientId,
        state: this.worldState.getPlayer(clientId)!,
      });

      // Handle input messages
      socket.on("netcode:input", (message: InputMessage) => {
        this.inputQueue.enqueue(clientId, message);
      });

      // Handle disconnect
      socket.on("disconnect", () => {
        console.log(`[NetcodeServer] Client disconnected: ${clientId}`);
        this.handleDisconnect(clientId);
      });
    });
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(clientId: string): void {
    this.worldState.removePlayer(clientId);
    this.inputQueue.removeClient(clientId);
    this.connectedClients.delete(clientId);

    // Notify other clients
    this.io.emit("netcode:leave", { playerId: clientId });
  }

  /**
   * Broadcast world snapshot to all clients
   */
  private broadcastSnapshot(snapshot: WorldSnapshot): void {
    this.io.emit("netcode:snapshot", snapshot);
  }

  /**
   * Start the game loop
   */
  start(): void {
    this.gameLoop.start();
    console.log(`[NetcodeServer] Started game loop at ${this.config.tickRate} Hz`);
  }

  /**
   * Stop the game loop
   */
  stop(): void {
    this.gameLoop.stop();
    console.log("[NetcodeServer] Stopped game loop");
  }

  /**
   * Get the snapshot history (for lag compensation)
   */
  getSnapshotHistory(): SnapshotHistory {
    return this.snapshotHistory;
  }

  /**
   * Get the world state
   */
  getWorldState(): WorldState {
    return this.worldState;
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.connectedClients.size;
  }

  /**
   * Rewind world state to a specific timestamp for lag compensation
   * Returns a snapshot of the world at that time, or null if not available
   */
  rewindToTimestamp(timestamp: number): WorldSnapshot | null {
    return this.snapshotHistory.getAtTimestamp(timestamp) ?? null;
  }

  /**
   * Validate an action at a past timestamp (for lag compensation)
   * This allows the server to process actions as if they happened in the past
   */
  validateActionAtTimestamp(
    timestamp: number,
    validator: (snapshot: WorldSnapshot) => boolean,
  ): boolean {
    const snapshot = this.rewindToTimestamp(timestamp);
    if (!snapshot) {
      return false;
    }
    return validator(snapshot);
  }
}
