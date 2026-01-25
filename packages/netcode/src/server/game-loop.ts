import { DEFAULT_TICK_INTERVAL_MS } from "../constants.js";
import { SnapshotBuffer } from "../core/snapshot-buffer.js";
import type { SimulateFunction, Snapshot, InputMerger } from "../core/types.js";
import type { WorldManager } from "../core/world.js";
import type { InputQueue } from "./input-queue.js";
import {
  processTickInputs,
  type TickProcessorConfig,
} from "./tick-processor.js";

/**
 * Fixed timestep game loop that processes inputs and updates world state.
 * Generic version that works with any world state and input types.
 * 
 * Follows the idiomatic approach used by real game engines (Photon Fusion, Unity Netcode):
 * - Collect all inputs that arrived since last tick
 * - Merge multiple inputs per client using the InputMerger
 * - Call simulate ONCE with all players' inputs
 * - Use a fixed tick delta (tickIntervalMs)
 * 
 * This ensures shared state (projectiles, timers, etc.) is processed exactly once per tick.
 */
export class GameLoop<TWorld, TInput> {
  private worldManager: WorldManager<TWorld>;
  private inputQueue: InputQueue<TInput>;
  private snapshotBuffer: SnapshotBuffer<TWorld>;
  private simulate: SimulateFunction<TWorld, TInput>;
  private tickInterval: number;
  private intervalId: NodeJS.Timeout | null = null;
  private onTickCallback?: (snapshot: Snapshot<TWorld>) => void;
  private mergeInputs: InputMerger<TInput>;
  private getConnectedClients?: () => Iterable<string>;
  private createIdleInput?: () => TInput;

  constructor(
    worldManager: WorldManager<TWorld>,
    inputQueue: InputQueue<TInput>,
    snapshotBuffer: SnapshotBuffer<TWorld>,
    simulate: SimulateFunction<TWorld, TInput>,
    tickIntervalMs: number = DEFAULT_TICK_INTERVAL_MS,
    mergeInputs?: InputMerger<TInput>,
    getConnectedClients?: () => Iterable<string>,
    createIdleInput?: () => TInput,
  ) {
    this.worldManager = worldManager;
    this.inputQueue = inputQueue;
    this.snapshotBuffer = snapshotBuffer;
    this.simulate = simulate;
    this.tickInterval = tickIntervalMs;
    // Default: use the last input
    this.mergeInputs =
      mergeInputs ??
      ((inputs: TInput[]) => {
        if (inputs.length === 0) {
          throw new Error(
            "mergeInputs called with empty array - provide a custom merger that handles idle inputs",
          );
        }
        // Safe: we just checked length > 0
        return inputs.at(-1) as TInput;
      });
    this.getConnectedClients = getConnectedClients;
    this.createIdleInput = createIdleInput;
  }

  /**
   * Set callback to be called on each tick with the new snapshot
   */
  onTick(callback: (snapshot: Snapshot<TWorld>) => void): void {
    this.onTickCallback = callback;
  }

  /**
   * Process a single game tick
   */
  private tick(): void {
    const timestamp = Date.now();

    // Collect all pending input messages per client (includes timestamps)
    const batchedInputs = this.inputQueue.getAllPendingInputsBatched();

    // Build acks map for all clients that had inputs
    const inputAcks = new Map<string, number>();
    for (const clientId of this.inputQueue.getClientsWithInputs()) {
      const inputs = this.inputQueue.getPendingInputs(clientId);
      const lastInput = inputs.at(-1);
      if (lastInput) {
        inputAcks.set(clientId, lastInput.seq);
        // Acknowledge all processed inputs
        this.inputQueue.acknowledge(clientId, lastInput.seq);
      }
    }

    // Process inputs using the idiomatic batched approach
    const currentWorld = this.worldManager.getState();
    let updatedWorld: TWorld;

    if (this.getConnectedClients && this.createIdleInput) {
      // Use shared tick processor - single simulate call per tick
      const tickConfig: TickProcessorConfig<TWorld, TInput> = {
        simulate: this.simulate,
        mergeInputs: this.mergeInputs,
        tickIntervalMs: this.tickInterval,
        getConnectedClients: this.getConnectedClients,
        createIdleInput: this.createIdleInput,
      };
      updatedWorld = processTickInputs(currentWorld, batchedInputs, tickConfig);
    } else {
      // Legacy fallback: merge inputs manually and call simulate once
      const mergedInputs = new Map<string, TInput>();

      for (const [clientId, inputMsgs] of batchedInputs) {
        if (inputMsgs.length > 0) {
          const inputs = inputMsgs.map((m) => m.input);
          mergedInputs.set(clientId, this.mergeInputs(inputs));
        }
      }

      // Single simulate call with all merged inputs
      updatedWorld = this.simulate(currentWorld, mergedInputs, this.tickInterval);
    }

    this.worldManager.setState(updatedWorld);

    // Increment world tick
    this.worldManager.incrementTick();

    // Create snapshot
    const snapshot: Snapshot<TWorld> = {
      tick: this.worldManager.getTick(),
      timestamp,
      state: updatedWorld,
      inputAcks,
    };
    this.snapshotBuffer.add(snapshot);

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
