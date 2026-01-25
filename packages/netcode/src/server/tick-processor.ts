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
 *
 * This function processes inputs one-at-a-time to maintain determinism with
 * client-side prediction. Each input from a client results in one simulation
 * call, ensuring the server state matches what the client predicted.
 *
 * For multiple players, we interleave inputs by processing each client's
 * oldest input per simulation step, which approximates fair ordering.
 *
 * @param currentWorld - Current world state
 * @param batchedInputs - Map of client ID to their pending input messages
 * @param config - Configuration for processing
 * @returns Updated world state after processing all inputs
 */
export function processTickInputs<TWorld, TInput>(
  currentWorld: TWorld,
  batchedInputs: Map<string, InputMessage<TInput>[]>,
  config: TickProcessorConfig<TWorld, TInput>,
): TWorld {
  let world = currentWorld;
  
  // Find the maximum number of inputs any client has
  let maxInputs = 0;
  for (const [, msgs] of batchedInputs) {
    maxInputs = Math.max(maxInputs, msgs.length);
  }
  
  // If no inputs at all, simulate once with idle inputs for all clients
  if (maxInputs === 0) {
    const idleInputs = new Map<string, TInput>();
    for (const clientId of config.getConnectedClients()) {
      idleInputs.set(clientId, config.createIdleInput());
    }
    return config.simulate(world, idleInputs, config.tickIntervalMs);
  }
  
  // Process inputs round-robin style: one input per client per simulation step
  // This ensures each input gets its own simulation, matching client prediction
  for (let i = 0; i < maxInputs; i++) {
    const inputsThisStep = new Map<string, TInput>();
    
    // Gather the i-th input from each client (or idle if they don't have one)
    for (const clientId of config.getConnectedClients()) {
      const clientInputs = batchedInputs.get(clientId);
      if (clientInputs && i < clientInputs.length) {
        inputsThisStep.set(clientId, clientInputs[i].input);
      } else {
        inputsThisStep.set(clientId, config.createIdleInput());
      }
    }
    
    // Simulate this step
    world = config.simulate(world, inputsThisStep, config.tickIntervalMs);
  }
  
  return world;
}
