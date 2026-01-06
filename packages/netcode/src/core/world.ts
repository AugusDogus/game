/**
 * World state management interface
 * Games can implement this or use a default implementation
 */

/**
 * Manages world state and tick counter.
 * Games can provide their own implementation or use the default.
 */
export interface WorldManager<TWorld> {
  /** Get current world state */
  getState(): TWorld;

  /** Set world state */
  setState(state: TWorld): void;

  /** Get current tick number */
  getTick(): number;

  /** Increment tick counter */
  incrementTick(): void;
}

/**
 * Simple default implementation of WorldManager
 */
export class DefaultWorldManager<TWorld> implements WorldManager<TWorld> {
  private state: TWorld;
  private currentTick: number;

  constructor(initialState: TWorld, initialTick: number = 0) {
    this.state = initialState;
    this.currentTick = initialTick;
  }

  getState(): TWorld {
    return this.state;
  }

  setState(state: TWorld): void {
    this.state = state;
  }

  getTick(): number {
    return this.currentTick;
  }

  incrementTick(): void {
    this.currentTick++;
  }
}
