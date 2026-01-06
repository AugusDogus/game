import type { Vector2, PlayerInput, PlayerState } from "./types.js";
import { DEFAULT_PLAYER_SPEED, DEFAULT_TICK_INTERVAL_MS } from "./constants.js";

/**
 * Deterministic physics function that applies player input to state.
 * This function MUST be identical on both client and server for prediction to work.
 *
 * @param state - Current player state
 * @param input - Player input to apply
 * @param deltaTime - Time delta in milliseconds (defaults to tick interval)
 * @returns New player state after applying input
 */
export function applyInput(
  state: PlayerState,
  input: PlayerInput,
  deltaTime: number = DEFAULT_TICK_INTERVAL_MS,
): PlayerState {
  // Calculate velocity from input direction
  const speed = DEFAULT_PLAYER_SPEED;
  const velocity: Vector2 = {
    x: input.moveX * speed,
    y: input.moveY * speed,
  };

  // Calculate position delta (convert from units/second to units per tick)
  const deltaSeconds = deltaTime / 1000;
  const positionDelta: Vector2 = {
    x: velocity.x * deltaSeconds,
    y: velocity.y * deltaSeconds,
  };

  // Apply movement
  const newPosition: Vector2 = {
    x: state.position.x + positionDelta.x,
    y: state.position.y + positionDelta.y,
  };

  return {
    ...state,
    position: newPosition,
    velocity,
    tick: state.tick + 1,
  };
}

/**
 * Create an initial player state at a given position
 */
export function createPlayerState(id: string, position: Vector2): PlayerState {
  return {
    id,
    position,
    velocity: { x: 0, y: 0 },
    tick: 0,
  };
}
