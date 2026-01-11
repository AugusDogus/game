import {
  DEFAULT_TICK_INTERVAL_MS,
  DEFAULT_FRAME_DELTA_MS,
  MIN_DELTA_MS,
  MAX_DELTA_MS,
} from "../constants.js";
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
 * Processes each input with its actual timestamp delta to match client-side
 * prediction exactly (as per Gabriel Gambetta's fast-paced multiplayer docs).
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
  // Track last processed timestamp per client for delta calculation (persists across ticks)
  private lastInputTimestamps: Map<string, number> = new Map();

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
        return inputs[inputs.length - 1]!;
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
      if (inputs.length > 0) {
        const lastInput = inputs[inputs.length - 1]!;
        inputAcks.set(clientId, lastInput.seq);
        // Acknowledge all processed inputs
        this.inputQueue.acknowledge(clientId, lastInput.seq);
      }
    }

    // Process inputs using shared tick processor if getConnectedClients and createIdleInput are provided
    // Otherwise, use legacy logic (for backward compatibility)
    const currentWorld = this.worldManager.getState();
    let updatedWorld: TWorld;

    if (this.getConnectedClients && this.createIdleInput) {
      // Use shared tick processor (removes type assertion)
      const tickConfig: TickProcessorConfig<TWorld, TInput> = {
        simulate: this.simulate,
        mergeInputs: this.mergeInputs,
        tickIntervalMs: this.tickInterval,
        getConnectedClients: this.getConnectedClients,
        createIdleInput: this.createIdleInput,
      };
      updatedWorld = processTickInputs(
        currentWorld,
        batchedInputs,
        this.lastInputTimestamps,
        tickConfig,
      );
    } else {
      // Legacy logic (for backward compatibility with tests)
      // Find the maximum number of inputs from any client
      let maxInputs = 0;
      for (const [, inputMsgs] of batchedInputs) {
        maxInputs = Math.max(maxInputs, inputMsgs.length);
      }

      // Track which clients had inputs this tick
      const clientsWithInputs = new Set<string>();

      if (maxInputs === 0) {
        // No inputs - simulate with idle inputs for all players using tick interval
        // Empty map triggers "simulate all with idle" behavior in simulation function
        const idleInputs = new Map<string, TInput>();
        updatedWorld = this.simulate(currentWorld, idleInputs, this.tickInterval);
      } else {
        // Process each client's inputs INDEPENDENTLY (not interleaved)
        // This ensures each client's physics matches their local prediction exactly
        updatedWorld = currentWorld;
        for (const [clientId, inputMsgs] of batchedInputs) {
          if (inputMsgs.length === 0) continue;
          clientsWithInputs.add(clientId);

          // Process this client's inputs with their individual deltas
          for (const inputMsg of inputMsgs) {
            let deltaTime = DEFAULT_FRAME_DELTA_MS;
            const lastTs = this.lastInputTimestamps.get(clientId);
            if (lastTs != null) {
              const delta = inputMsg.timestamp - lastTs;
              deltaTime = Math.max(MIN_DELTA_MS, Math.min(MAX_DELTA_MS, delta));
            }
            this.lastInputTimestamps.set(clientId, inputMsg.timestamp);

            // Simulate ONLY this client
            const singleInput = new Map<string, TInput>();
            singleInput.set(clientId, inputMsg.input);
            updatedWorld = this.simulate(updatedWorld, singleInput, deltaTime);
          }
        }

        // Apply idle physics to players who had NO inputs this tick
        // Legacy: use type assertion if getConnectedClients not provided
        const worldState = updatedWorld as { players?: Map<string, unknown> };
        if (worldState.players) {
          for (const playerId of worldState.players.keys()) {
            if (!clientsWithInputs.has(playerId)) {
              // Skip - can't create idle input without createIdleInput function
              // This maintains backward compatibility but may miss idle physics
            }
          }
        }
      }
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
