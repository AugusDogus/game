import type { Vector2, PlayerInput, PlayerState } from "./types.js";
import {
  DEFAULT_PLAYER_SPEED,
  DEFAULT_TICK_INTERVAL_MS,
  DEFAULT_GRAVITY,
  DEFAULT_JUMP_VELOCITY,
  DEFAULT_FLOOR_Y,
} from "./constants.js";

import type { PhysicsFunction } from "./types.js";

/**
 * Platformer physics: includes gravity, jumping, and floor collision.
 * Y increases downward. Players fall due to gravity and can jump when grounded.
 */
export const platformerPhysics: PhysicsFunction = (
  state: PlayerState,
  input: PlayerInput,
  deltaTime: number = DEFAULT_TICK_INTERVAL_MS,
): PlayerState => {
  const deltaSeconds = deltaTime / 1000;

  // Start with current velocity
  let velocityX = input.moveX * DEFAULT_PLAYER_SPEED;
  let velocityY = state.velocity.y;

  // Apply gravity (Y increases downward)
  velocityY += DEFAULT_GRAVITY * deltaSeconds;

  // Handle jumping - only if grounded and jump pressed
  if (input.jump && state.isGrounded) {
    velocityY = DEFAULT_JUMP_VELOCITY;
  }

  // Calculate new position
  let newX = state.position.x + velocityX * deltaSeconds;
  let newY = state.position.y + velocityY * deltaSeconds;

  // Check floor collision
  let isGrounded = false;
  const playerHeight = 20; // Half of player size (10 from center to bottom)

  if (newY + playerHeight / 2 >= DEFAULT_FLOOR_Y) {
    newY = DEFAULT_FLOOR_Y - playerHeight / 2;
    velocityY = 0;
    isGrounded = true;
  }

  return {
    ...state,
    position: { x: newX, y: newY },
    velocity: { x: velocityX, y: velocityY },
    isGrounded,
    tick: state.tick + 1,
  };
};

/**
 * Top-down physics: no gravity, direct movement in both X and Y axes.
 * Perfect for top-down games like twin-stick shooters or RTS games.
 */
export const topDownPhysics: PhysicsFunction = (
  state: PlayerState,
  input: PlayerInput,
  deltaTime: number = DEFAULT_TICK_INTERVAL_MS,
): PlayerState => {
  const deltaSeconds = deltaTime / 1000;
  const speed = DEFAULT_PLAYER_SPEED;

  // Calculate velocity from input direction
  const velocityX = input.moveX * speed;
  const velocityY = input.moveY * speed;

  // Calculate position delta
  const positionDeltaX = velocityX * deltaSeconds;
  const positionDeltaY = velocityY * deltaSeconds;

  // Apply movement
  const newPosition = {
    x: state.position.x + positionDeltaX,
    y: state.position.y + positionDeltaY,
  };

  return {
    ...state,
    position: newPosition,
    velocity: { x: velocityX, y: velocityY },
    isGrounded: false, // Not applicable for top-down
    tick: state.tick + 1,
  };
};

/**
 * Create an initial player state at a given position
 */
export function createPlayerState(id: string, position: Vector2): PlayerState {
  return {
    id,
    position,
    velocity: { x: 0, y: 0 },
    isGrounded: false,
    tick: 0,
  };
}
