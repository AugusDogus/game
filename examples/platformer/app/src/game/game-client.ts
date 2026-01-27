import { createClient, type ClientHandle } from "@game/netcode/client";
import {
  platformerPredictionScope,
  type PlatformerInput,
  type PlatformerWorld,
} from "@game/example-platformer";
import type { Socket } from "socket.io-client";
import { Renderer, type DebugData, type PositionHistoryEntry } from "../client/renderer/renderer.js";

/** Maximum number of position history entries to keep */
const MAX_HISTORY_SIZE = 60;

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
 * Game client that integrates NetcodeClient with rendering.
 * 
 * Use the static `create()` method to instantiate.
 */
export class GameClient {
  private netcodeClient: ClientHandle<PlatformerWorld, PlatformerInput>;
  private renderer: Renderer;
  private canvas: HTMLCanvasElement;
  private animationFrameId: number | null = null;
  private inputIntervalId: number | null = null;
  private keys: Set<string> = new Set();
  private keydownHandler: (e: KeyboardEvent) => void;
  private keyupHandler: (e: KeyboardEvent) => void;
  private mousedownHandler: (e: MouseEvent) => void;
  private mouseupHandler: (e: MouseEvent) => void;
  private mousemoveHandler: (e: MouseEvent) => void;
  private resizeHandler: () => void;
  private debugOptions: DebugOptions = { showTrails: false, showServerPositions: false };

  // Mouse state for shooting
  private mouseX: number = 0;
  private mouseY: number = 0;
  private isMouseDown: boolean = false;
  private shootThisFrame: boolean = false;

  // Position history for debug visualization
  private localPredictedHistory: PositionHistoryEntry[] = [];
  private localServerHistory: PositionHistoryEntry[] = [];
  private otherPlayersHistory: Map<string, PositionHistoryEntry[]> = new Map();
  private otherPlayersServerHistory: Map<string, PositionHistoryEntry[]> = new Map();

  /**
   * Create a new GameClient. Use this instead of calling constructor directly.
   */
  static async create(socket: Socket, canvas: HTMLCanvasElement): Promise<GameClient> {
    const renderer = await Renderer.create(canvas);
    return new GameClient(socket, canvas, renderer);
  }

  private constructor(socket: Socket, canvas: HTMLCanvasElement, renderer: Renderer) {
    this.renderer = renderer;

    // Create netcode client
    this.netcodeClient = createClient<PlatformerWorld, PlatformerInput>({
      socket,
      predictionScope: platformerPredictionScope,
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

    // Store canvas reference for mouse coordinate conversion
    this.canvas = canvas;

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
    this.mousedownHandler = (e: MouseEvent) => {
      if (e.button === 0) { // Left click
        this.isMouseDown = true;
        this.shootThisFrame = true;
        this.updateMousePosition(e);
      }
    };
    this.mouseupHandler = (e: MouseEvent) => {
      if (e.button === 0) {
        this.isMouseDown = false;
      }
    };
    this.mousemoveHandler = (e: MouseEvent) => {
      this.updateMousePosition(e);
    };
    this.resizeHandler = () => {
      this.handleResize();
    };

    // Set up input handling
    this.setupInputHandling();
    
    // Set up resize handling
    window.addEventListener("resize", this.resizeHandler);
    // Initial resize to match container
    this.handleResize();

    // Start render loop
    this.startRenderLoop();

    // Start input loop (separate from render for consistent input rate)
    this.startInputLoop();
  }

  /**
   * Handle window resize - update canvas and renderer dimensions
   */
  private handleResize(): void {
    const parent = this.canvas.parentElement;
    if (parent) {
      const rect = parent.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      
      if (width > 0 && height > 0) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.renderer.resize(width, height);
      }
    }
  }

  /**
   * Convert mouse event coordinates to world coordinates.
   * Y-up coordinate system: screen Y increases down, world Y increases up.
   */
  private updateMousePosition(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    
    // Get canvas-relative position (screen coords: Y-down)
    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;
    
    // Convert to world coordinates:
    // - Canvas center is world origin
    // - Flip Y because world uses Y-up, screen uses Y-down
    this.mouseX = canvasX - this.canvas.width / 2;
    this.mouseY = -(canvasY - this.canvas.height / 2); // Flip Y
  }

  /**
   * Set up keyboard and mouse input handling
   */
  private setupInputHandling(): void {
    window.addEventListener("keydown", this.keydownHandler);
    window.addEventListener("keyup", this.keyupHandler);
    this.canvas.addEventListener("mousedown", this.mousedownHandler);
    this.canvas.addEventListener("mouseup", this.mouseupHandler);
    this.canvas.addEventListener("mousemove", this.mousemoveHandler);
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

    // Shooting (mouse click)
    const shoot = this.shootThisFrame;
    this.shootThisFrame = false; // Reset after reading

    // Always send input so gravity/physics can be applied
    this.netcodeClient.sendInput({
      moveX,
      moveY: 0,
      jump,
      shoot,
      shootTargetX: this.mouseX,
      shootTargetY: this.mouseY,
    });
  }

  /**
   * Add a position to history, maintaining max size
   */
  private addToHistory(history: PositionHistoryEntry[], entry: PositionHistoryEntry): void {
    history.push(entry);
    if (history.length > MAX_HISTORY_SIZE) {
      history.shift();
    }
  }

  /**
   * Update position histories for debug visualization
   */
  private updatePositionHistories(
    world: PlatformerWorld,
    localPlayerId: string | null,
  ): void {
    const now = Date.now();

    // Update local player predicted position
    if (localPlayerId) {
      const localPlayer = world.players.get(localPlayerId);
      if (localPlayer) {
        this.addToHistory(this.localPredictedHistory, {
          x: localPlayer.position.x,
          y: localPlayer.position.y,
          timestamp: now,
        });
      }
    }

    // Update other players' interpolated positions
    for (const [playerId, player] of world.players) {
      if (playerId !== localPlayerId) {
        if (!this.otherPlayersHistory.has(playerId)) {
          this.otherPlayersHistory.set(playerId, []);
        }
        const history = this.otherPlayersHistory.get(playerId);
        if (history) {
          this.addToHistory(history, {
            x: player.position.x,
            y: player.position.y,
            timestamp: now,
          });
        }
      }
    }

    // Update server position histories from raw snapshot
    const serverSnapshot = this.netcodeClient.getLastServerSnapshot();
    if (serverSnapshot) {
      const serverWorld = serverSnapshot.state as PlatformerWorld;
      
      // Local player server position
      if (localPlayerId) {
        const serverLocalPlayer = serverWorld.players.get(localPlayerId);
        if (serverLocalPlayer) {
          this.addToHistory(this.localServerHistory, {
            x: serverLocalPlayer.position.x,
            y: serverLocalPlayer.position.y,
            timestamp: now,
          });
        }
      }

      // Other players' raw server positions
      for (const [playerId, player] of serverWorld.players) {
        if (playerId !== localPlayerId) {
          if (!this.otherPlayersServerHistory.has(playerId)) {
            this.otherPlayersServerHistory.set(playerId, []);
          }
          const history = this.otherPlayersServerHistory.get(playerId);
          if (history) {
            this.addToHistory(history, {
              x: player.position.x,
              y: player.position.y,
              timestamp: now,
            });
          }
        }
      }
    }

    // Clean up histories for disconnected players
    for (const playerId of this.otherPlayersHistory.keys()) {
      if (!world.players.has(playerId)) {
        this.otherPlayersHistory.delete(playerId);
        this.otherPlayersServerHistory.delete(playerId);
      }
    }
  }

  /**
   * Build debug data for renderer
   */
  private buildDebugData(): DebugData {
    return {
      localPredictedHistory: this.localPredictedHistory,
      localServerHistory: this.localServerHistory,
      otherPlayersHistory: this.otherPlayersHistory,
      otherPlayersServerHistory: this.otherPlayersServerHistory,
    };
  }
  
  /**
   * Start the render loop
   */
  private startRenderLoop(): void {
    const render = () => {
      // Get world state for rendering
      const world = this.netcodeClient.getStateForRendering();
      const localPlayerId = this.netcodeClient.getPlayerId();

      // Update position histories if debug visualization is enabled
      if (world && (this.debugOptions.showTrails || this.debugOptions.showServerPositions)) {
        this.updatePositionHistories(world, localPlayerId);
      }

      // Get server snapshot for ghost rendering
      const serverSnapshot = this.netcodeClient.getLastServerSnapshot();
      const serverWorld = serverSnapshot?.state as PlatformerWorld | null;

      // Render the game state
      if (world) {
        this.renderer.render(world, localPlayerId, {
          debugData: this.buildDebugData(),
          serverSnapshot: serverWorld ?? null,
          showTrails: this.debugOptions.showTrails,
          showServerPositions: this.debugOptions.showServerPositions,
        });
      }
      // If no world state yet, just clear and wait

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
    window.removeEventListener("resize", this.resizeHandler);
    this.canvas.removeEventListener("mousedown", this.mousedownHandler);
    this.canvas.removeEventListener("mouseup", this.mouseupHandler);
    this.canvas.removeEventListener("mousemove", this.mousemoveHandler);
    
    // Destroy the renderer
    this.renderer.destroy();
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

  /**
   * Clear all position history arrays
   */
  clearHistory(): void {
    this.localPredictedHistory = [];
    this.localServerHistory = [];
    this.otherPlayersHistory.clear();
    this.otherPlayersServerHistory.clear();
  }

  /**
   * Reset all client state for a level change.
   * Clears netcode state and position histories.
   */
  resetForLevelChange(): void {
    this.netcodeClient.reset();
    this.clearHistory();
  }
}
