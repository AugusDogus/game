import type { WorldState } from "./world-state.js";
import type { InputQueue } from "./input-queue.js";
import type { SnapshotHistory } from "./snapshot-history.js";
import type { WorldSnapshot, PhysicsFunction } from "../types.js";
import { DEFAULT_TICK_INTERVAL_MS } from "../constants.js";

/**
 * Fixed timestep game loop that processes inputs and updates world state
 */
export class GameLoop {
  private worldState: WorldState;
  private inputQueue: InputQueue;
  private snapshotHistory: SnapshotHistory;
  private physicsFunction: PhysicsFunction;
  private tickInterval: number;
  private intervalId: NodeJS.Timeout | null = null;
  private onTickCallback?: (snapshot: WorldSnapshot) => void;

  constructor(
    worldState: WorldState,
    inputQueue: InputQueue,
    snapshotHistory: SnapshotHistory,
    physicsFunction: PhysicsFunction,
    tickIntervalMs: number = DEFAULT_TICK_INTERVAL_MS,
  ) {
    this.worldState = worldState;
    this.inputQueue = inputQueue;
    this.snapshotHistory = snapshotHistory;
    this.physicsFunction = physicsFunction;
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

    // Idle input for players with no pending inputs (still need physics like gravity)
    const idleInput = {
      moveX: 0,
      moveY: 0,
      jump: false,
      timestamp,
    };

    // Process physics for ALL players, not just those with inputs
    const allPlayers = this.worldState.getAllPlayers();
    for (const player of allPlayers) {
      const clientId = player.id;

      // Get all pending inputs for this client
      const inputs = this.inputQueue.getPendingInputs(clientId);

      // Determine the input to use for this tick:
      // - If we have inputs, use the last one (most recent player intent)
      // - Also check if ANY input in the batch had jump pressed (so we don't miss jump inputs)
      // - If no inputs, use idle input
      let inputForTick = idleInput;
      if (inputs.length > 0) {
        const lastInput = inputs[inputs.length - 1]!;
        // Check if any input in the batch had jump pressed
        const anyJump = inputs.some((msg) => msg.input.jump);
        inputForTick = {
          ...lastInput.input,
          jump: anyJump, // Preserve jump if any input had it
        };
        acks[clientId] = lastInput.seq;
        // Acknowledge all processed inputs
        this.inputQueue.acknowledge(clientId, lastInput.seq);
      }

      // Apply physics ONCE per tick with the determined input
      const newState = this.physicsFunction(player, inputForTick, this.tickInterval);

      // Update player state
      this.worldState.updatePlayer(clientId, newState);
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
