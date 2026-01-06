/**
 * Strategy pattern interfaces for different netcode approaches.
 */

import type { Snapshot } from "../core/types.js";

/**
 * Client-side netcode strategy interface.
 * Implementations handle input processing, snapshot handling, and state management.
 */
export interface ClientStrategy<TWorld, TInput> {
  /**
   * Process a local input from the player.
   * Called when the player provides input.
   */
  onLocalInput(input: TInput): void;

  /**
   * Handle an incoming snapshot from the server (or peer).
   * Called when network data arrives.
   */
  onSnapshot(snapshot: Snapshot<TWorld>): void;

  /**
   * Get the current world state for rendering.
   * May include predictions merged with server state.
   */
  getStateForRendering(): TWorld | null;

  /**
   * Get the local player's ID.
   */
  getLocalPlayerId(): string | null;

  /**
   * Set the local player's ID.
   */
  setLocalPlayerId(playerId: string): void;

  /**
   * Reset all state (e.g., on disconnect).
   */
  reset(): void;
}

/**
 * Server-side netcode strategy interface.
 * Implementations handle input processing and world simulation.
 */
export interface ServerStrategy<TWorld, TInput> {
  /**
   * Handle an input from a client.
   */
  onClientInput(clientId: string, input: TInput, seq: number): void;

  /**
   * Add a new client to the world.
   */
  addClient(clientId: string): void;

  /**
   * Remove a client from the world.
   */
  removeClient(clientId: string): void;

  /**
   * Process one tick and return the new snapshot.
   */
  tick(): Snapshot<TWorld>;

  /**
   * Get the current world state.
   */
  getWorldState(): TWorld;

  /**
   * Get the current tick number.
   */
  getTick(): number;
}

/**
 * Strategy type identifiers
 */
export type StrategyType = "server-authoritative" | "rollback";
