import type { NetcodeClientHandle, PlatformerInput, PlatformerWorld } from "@game/netcode";
import {
  createNetcodeClient,
  interpolatePlatformer,
  platformerPredictionScope,
} from "@game/netcode";
import type { Socket } from "socket.io-client";
import { CanvasRenderer } from "../client/renderer/canvas-renderer.js";

/** Debug rendering options */
export interface DebugOptions {
  /** Show breadcrumb trails */
  showTrails: boolean;
  /** Show server positions (ghost) */
  showServerPositions: boolean;
}

/** Input send rate: 60 times per second */
const INPUT_RATE_MS = 1000 / 60;

/**
 * Game client that integrates NetcodeClient with rendering
 */
export class GameClient {
  private netcodeClient: NetcodeClientHandle<PlatformerWorld, PlatformerInput>;
  private renderer: CanvasRenderer;
  private animationFrameId: number | null = null;
  private inputIntervalId: number | null = null;
  private keys: Set<string> = new Set();
  private keydownHandler: (e: KeyboardEvent) => void;
  private keyupHandler: (e: KeyboardEvent) => void;
  private debugOptions: DebugOptions = { showTrails: false, showServerPositions: false };

  constructor(socket: Socket, canvas: HTMLCanvasElement) {
    // Create renderer
    this.renderer = new CanvasRenderer(canvas);

    // Create netcode client
    this.netcodeClient = createNetcodeClient<PlatformerWorld, PlatformerInput>({
      socket,
      predictionScope: platformerPredictionScope,
      interpolate: interpolatePlatformer,
      interpolationDelayMs: 100,
      onWorldUpdate: (_state: PlatformerWorld) => {
        // World update handled by render loop
      },
      onPlayerJoin: (playerId: string) => {
        console.log(`Player joined: ${playerId}`);
      },
      onPlayerLeave: (playerId: string) => {
        console.log(`Player left: ${playerId}`);
      },
    });

    // Bind handlers so we can remove them later
    this.keydownHandler = (e: KeyboardEvent) => {
      // Prevent default for arrow keys and space to avoid scrolling
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
        e.preventDefault();
      }
      this.keys.add(e.key.toLowerCase());
    };
    this.keyupHandler = (e: KeyboardEvent) => {
      this.keys.delete(e.key.toLowerCase());
    };

    // Set up input handling
    this.setupInputHandling();

    // Start render loop
    this.startRenderLoop();

    // Start input loop (separate from render for consistent input rate)
    this.startInputLoop();
  }

  /**
   * Set up keyboard input handling
   */
  private setupInputHandling(): void {
    window.addEventListener("keydown", this.keydownHandler);
    window.addEventListener("keyup", this.keyupHandler);
  }

  /**
   * Start the input loop - sends input at a fixed rate while keys are held
   */
  private startInputLoop(): void {
    this.inputIntervalId = window.setInterval(() => {
      this.sendCurrentInput();
    }, INPUT_RATE_MS);
  }

  /**
   * Send input based on current key state
   */
  private sendCurrentInput(): void {
    let moveX = 0;

    // Horizontal movement (A/D or Left/Right arrows)
    if (this.keys.has("a") || this.keys.has("arrowleft")) {
      moveX -= 1;
    }
    if (this.keys.has("d") || this.keys.has("arrowright")) {
      moveX += 1;
    }

    // Jump (Space, W, or Up arrow)
    const jump = this.keys.has(" ") || this.keys.has("w") || this.keys.has("arrowup");

    // Always send input so gravity/physics can be applied
    this.netcodeClient.sendInput({ moveX, moveY: 0, jump });
  }

  /**
   * Start the render loop
   */
  private startRenderLoop(): void {
    const render = () => {
      // Get world state for rendering
      const world = this.netcodeClient.getStateForRendering();
      const localPlayerId = this.netcodeClient.getPlayerId();

      // Convert to array for renderer
      const players = world ? Array.from(world.players.values()) : [];

      // Render (debug visualization temporarily disabled - needs refactoring)
      this.renderer.render(players, localPlayerId, {
        debugData: null,
        serverSnapshot: null,
        showTrails: false,
        showServerPositions: false,
      });

      // Continue loop
      this.animationFrameId = requestAnimationFrame(render);
    };

    render();
  }

  /**
   * Stop the game client
   */
  stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.inputIntervalId !== null) {
      clearInterval(this.inputIntervalId);
      this.inputIntervalId = null;
    }
    window.removeEventListener("keydown", this.keydownHandler);
    window.removeEventListener("keyup", this.keyupHandler);
  }

  /**
   * Set simulated network latency (for testing)
   */
  setSimulatedLatency(latencyMs: number): void {
    this.netcodeClient.setSimulatedLatency(latencyMs);
  }

  /**
   * Get current simulated latency
   */
  getSimulatedLatency(): number {
    return this.netcodeClient.getSimulatedLatency();
  }

  /**
   * Set debug options
   */
  setDebugOptions(options: Partial<DebugOptions>): void {
    this.debugOptions = { ...this.debugOptions, ...options };
  }

  /**
   * Get current debug options
   */
  getDebugOptions(): DebugOptions {
    return { ...this.debugOptions };
  }
}
