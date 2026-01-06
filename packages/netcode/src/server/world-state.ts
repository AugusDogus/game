import type { PlayerState, WorldSnapshot } from "../types.js";
import { createPlayerState } from "../physics.js";

/**
 * Manages authoritative world state for all connected players
 */
export class WorldState {
  private players: Map<string, PlayerState> = new Map();
  private currentTick = 0;

  /**
   * Add a new player to the world
   */
  addPlayer(id: string, position: { x: number; y: number }): void {
    if (this.players.has(id)) {
      return;
    }
    this.players.set(id, createPlayerState(id, position));
  }

  /**
   * Remove a player from the world
   */
  removePlayer(id: string): void {
    this.players.delete(id);
  }

  /**
   * Get a player's current state
   */
  getPlayer(id: string): PlayerState | undefined {
    return this.players.get(id);
  }

  /**
   * Update a player's state
   */
  updatePlayer(id: string, state: PlayerState): void {
    this.players.set(id, state);
  }

  /**
   * Get all players
   */
  getAllPlayers(): PlayerState[] {
    return Array.from(this.players.values());
  }

  /**
   * Get current tick number
   */
  getTick(): number {
    return this.currentTick;
  }

  /**
   * Increment tick counter
   */
  incrementTick(): void {
    this.currentTick++;
  }

  /**
   * Create a snapshot of the current world state
   */
  createSnapshot(timestamp: number, acks: Record<string, number>): WorldSnapshot {
    return {
      tick: this.currentTick,
      timestamp,
      players: this.getAllPlayers(),
      acks,
    };
  }

  /**
   * Get number of connected players
   */
  getPlayerCount(): number {
    return this.players.size;
  }
}
