import {
  DEFAULT_FRAME_DELTA_MS,
  MIN_DELTA_MS,
  MAX_DELTA_MS,
} from "../constants.js";
import type { InputMessage, SimulateFunction, InputMerger } from "../core/types.js";

/**
 * Configuration for processing tick inputs
 */
export interface TickProcessorConfig<TWorld, TInput> {
  /** Function to simulate the world */
  simulate: SimulateFunction<TWorld, TInput>;
  /** Function to merge multiple inputs per tick */
  mergeInputs: InputMerger<TInput>;
  /** Tick interval in milliseconds */
  tickIntervalMs: number;
  /** Function to get all connected client IDs */
  getConnectedClients: () => Iterable<string>;
  /** Function to create an idle input for clients without inputs */
  createIdleInput: () => TInput;
}

/**
 * Process tick inputs and return updated world state.
 * Handles input processing with delta times, idle inputs, and client management.
 *
 * @param currentWorld - Current world state
 * @param batchedInputs - Map of client ID to their pending input messages
 * @param lastInputTimestamps - Map tracking last processed timestamp per client
 * @param config - Configuration for processing
 * @returns Updated world state after processing all inputs
 */
export function processTickInputs<TWorld, TInput>(
  currentWorld: TWorld,
  batchedInputs: Map<string, InputMessage<TInput>[]>,
  lastInputTimestamps: Map<string, number>,
  config: TickProcessorConfig<TWorld, TInput>,
): TWorld {
  // Check if any clients have inputs
  let hasInputs = false;
  for (const [, inputMsgs] of batchedInputs) {
    if (inputMsgs.length > 0) {
      hasInputs = true;
      break;
    }
  }

  // Track which clients had inputs this tick
  const clientsWithInputs = new Set<string>();

  if (!hasInputs) {
    // No inputs - simulate with idle inputs for all players using tick interval
    const idleInputs = new Map<string, TInput>();
    return config.simulate(currentWorld, idleInputs, config.tickIntervalMs);
  }

  // Process each client's inputs INDEPENDENTLY (not interleaved)
  // This ensures:
  // 1. Each client's physics matches their local prediction exactly
  // 2. Other clients' physics are NOT affected by this client's simulation steps
  // Per Gabriel Gambetta: "all the unprocessed client input is applied"
  // but we process each client separately to avoid physics multiplication
  let updatedWorld = currentWorld;

  for (const [clientId, inputMsgs] of batchedInputs) {
    if (inputMsgs.length === 0) continue;
    clientsWithInputs.add(clientId);

    // Process this client's inputs with their individual deltas
    for (const inputMsg of inputMsgs) {
      let deltaTime = DEFAULT_FRAME_DELTA_MS;
      const lastTs = lastInputTimestamps.get(clientId);
      if (lastTs != null) {
        const delta = inputMsg.timestamp - lastTs;
        deltaTime = Math.max(MIN_DELTA_MS, Math.min(MAX_DELTA_MS, delta));
      }
      lastInputTimestamps.set(clientId, inputMsg.timestamp);

      // Simulate ONLY this client
      // The simulation function only applies physics to players with inputs
      const singleInput = new Map<string, TInput>();
      singleInput.set(clientId, inputMsg.input);
      updatedWorld = config.simulate(updatedWorld, singleInput, deltaTime);
    }
  }

  // Apply idle physics to connected clients who had NO inputs this tick
  // They still need gravity, etc. for the tick interval
  for (const connectedClient of config.getConnectedClients()) {
    if (!clientsWithInputs.has(connectedClient)) {
      const idleInput = new Map<string, TInput>();
      idleInput.set(connectedClient, config.createIdleInput());
      updatedWorld = config.simulate(updatedWorld, idleInput, config.tickIntervalMs);
    }
  }

  return updatedWorld;
}
