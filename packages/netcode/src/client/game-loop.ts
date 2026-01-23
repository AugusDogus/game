/**
 * Game loop utilities for client-side rendering and input handling.
 *
 * @module client/game-loop
 */

import type { ClientHandle } from "../create-client.js";

/**
 * Configuration for creating a client game loop.
 *
 * @typeParam TWorld - The type of your game's world state
 * @typeParam TInput - The type of player input (must include timestamp)
 */
export interface GameLoopConfig<TWorld, TInput extends { timestamp: number }> {
  /** The netcode client handle */
  client: ClientHandle<TWorld, TInput, unknown>;
  /**
   * Function that returns the current input state.
   * Called at the configured input rate to send inputs to the server.
   * Should return the input WITHOUT the timestamp (it's added automatically).
   */
  getInput: () => Omit<TInput, "timestamp">;
  /**
   * Function to render the current world state.
   * Called every animation frame with the interpolated world state.
   */
  render: (world: TWorld, deltaMs: number) => void;
  /**
   * Rate at which to send inputs to the server in Hz.
   * Default: 60 (60 times per second)
   */
  inputRate?: number;
  /**
   * Called when render is invoked but no world state is available yet.
   * Useful for showing a loading state.
   */
  onNoWorld?: (deltaMs: number) => void;
}

/**
 * Handle returned by createGameLoop to control the loop.
 */
export interface GameLoopHandle {
  /** Start the game loop (both render and input loops) */
  start(): void;
  /** Stop the game loop */
  stop(): void;
  /** Check if the loop is currently running */
  isRunning(): boolean;
}

/**
 * Create a game loop that handles rendering and input sending.
 *
 * This helper sets up two separate loops:
 * 1. Render loop: Uses requestAnimationFrame for smooth rendering
 * 2. Input loop: Uses setInterval at the configured rate for consistent input
 *
 * @example
 * ```ts
 * import { createClient } from "@game/netcode/client";
 * import { createGameLoop } from "@game/netcode/client";
 *
 * const client = createClient({ ... });
 *
 * // Track input state
 * const keys = new Set<string>();
 * window.addEventListener("keydown", (e) => keys.add(e.key));
 * window.addEventListener("keyup", (e) => keys.delete(e.key));
 *
 * const loop = createGameLoop({
 *   client,
 *   getInput: () => ({
 *     moveX: keys.has("d") ? 1 : keys.has("a") ? -1 : 0,
 *     jump: keys.has(" "),
 *   }),
 *   render: (world, deltaMs) => {
 *     // Your rendering code here
 *     ctx.clearRect(0, 0, canvas.width, canvas.height);
 *     for (const player of world.players.values()) {
 *       ctx.fillRect(player.x, player.y, 20, 20);
 *     }
 *   },
 * });
 *
 * loop.start();
 * // Later: loop.stop();
 * ```
 */
export function createGameLoop<TWorld, TInput extends { timestamp: number }>(
  config: GameLoopConfig<TWorld, TInput>,
): GameLoopHandle {
  const inputRate = config.inputRate ?? 60;
  const inputIntervalMs = 1000 / inputRate;

  let animationFrameId: number | null = null;
  let inputIntervalId: ReturnType<typeof setInterval> | null = null;
  let lastRenderTime = 0;
  let running = false;

  // Render loop using requestAnimationFrame
  const renderLoop = (timestamp: number) => {
    if (!running) return;

    const deltaMs = lastRenderTime === 0 ? 16.67 : timestamp - lastRenderTime;
    lastRenderTime = timestamp;

    const world = config.client.getStateForRendering();
    if (world) {
      config.render(world, deltaMs);
    } else {
      config.onNoWorld?.(deltaMs);
    }

    animationFrameId = requestAnimationFrame(renderLoop);
  };

  // Input loop using setInterval
  const inputLoop = () => {
    const input = config.getInput();
    config.client.sendInput(input);
  };

  return {
    start() {
      if (running) return;
      running = true;
      lastRenderTime = 0;

      // Start render loop
      animationFrameId = requestAnimationFrame(renderLoop);

      // Start input loop
      inputIntervalId = setInterval(inputLoop, inputIntervalMs);
    },

    stop() {
      if (!running) return;
      running = false;

      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }

      if (inputIntervalId !== null) {
        clearInterval(inputIntervalId);
        inputIntervalId = null;
      }
    },

    isRunning() {
      return running;
    },
  };
}
