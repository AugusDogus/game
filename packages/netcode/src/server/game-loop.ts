import type { WorldState } from "./world-state.js";
import type { InputQueue } from "./input-queue.js";
import type { SnapshotHistory } from "./snapshot-history.js";
import type { WorldSnapshot } from "../types.js";
import { applyInput } from "../physics.js";
import { DEFAULT_TICK_INTERVAL_MS } from "../constants.js";

/**
 * Fixed timestep game loop that processes inputs and updates world state
 */
export class GameLoop {
  private worldState: WorldState;
  private inputQueue: InputQueue;
  private snapshotHistory: SnapshotHistory;
  private tickInterval: number;
  private intervalId: NodeJS.Timeout | null = null;
  private onTickCallback?: (snapshot: WorldSnapshot) => void;

  constructor(
    worldState: WorldState,
    inputQueue: InputQueue,
    snapshotHistory: SnapshotHistory,
    tickIntervalMs: number = DEFAULT_TICK_INTERVAL_MS,
  ) {
    this.worldState = worldState;
    this.inputQueue = inputQueue;
    this.snapshotHistory = snapshotHistory;
    this.tickInterval = tickIntervalMs;
  }

  /**
   * Set callback to be called on each tick with the new snapshot
   */
  onTick(callback: (snapshot: WorldSnapshot) => void): void {
    this.onTickCallback = callback;
  }

  /**
   * Process a single game tick
   */
  private tick(): void {
    const timestamp = Date.now();
    const acks: Record<string, number> = {};

    // Process inputs for all clients
    const clientsWithInputs = this.inputQueue.getClientsWithInputs();
    for (const clientId of clientsWithInputs) {
      const player = this.worldState.getPlayer(clientId);
      if (!player) {
        continue;
      }

      // Get all pending inputs for this client
      const inputs = this.inputQueue.getPendingInputs(clientId);
      if (inputs.length === 0) {
        continue;
      }

      // Apply each input sequentially
      let currentState = player;
      for (const inputMsg of inputs) {
        currentState = applyInput(currentState, inputMsg.input);
        acks[clientId] = inputMsg.seq;
      }

      // Update player state
      this.worldState.updatePlayer(clientId, currentState);

      // Acknowledge processed inputs
      if (acks[clientId] !== undefined) {
        this.inputQueue.acknowledge(clientId, acks[clientId]!);
      }
    }

    // Increment world tick
    this.worldState.incrementTick();

    // Create snapshot
    const snapshot = this.worldState.createSnapshot(timestamp, acks);
    this.snapshotHistory.add(snapshot);

    // Notify callback
    if (this.onTickCallback) {
      this.onTickCallback(snapshot);
    }
  }

  /**
   * Start the game loop
   */
  start(): void {
    if (this.intervalId !== null) {
      return; // Already running
    }

    this.intervalId = setInterval(() => {
      this.tick();
    }, this.tickInterval);
  }

  /**
   * Stop the game loop
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Check if the loop is running
   */
  isRunning(): boolean {
    return this.intervalId !== null;
  }
}
