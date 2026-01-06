import { NetcodeClient } from "@game/netcode";
import type { Socket } from "socket.io-client";
import type { WorldSnapshot } from "@game/netcode";
import { CanvasRenderer } from "../client/renderer/canvas-renderer.js";

/**
 * Game client that integrates NetcodeClient with rendering
 */
export class GameClient {
  private netcodeClient: NetcodeClient;
  private renderer: CanvasRenderer;
  private animationFrameId: number | null = null;
  private keys: Set<string> = new Set();

  constructor(socket: Socket, canvas: HTMLCanvasElement) {
    // Create renderer
    this.renderer = new CanvasRenderer(canvas);

    // Create netcode client
    this.netcodeClient = new NetcodeClient(socket, {
      interpolationDelay: 100,
      onWorldUpdate: (_snapshot: WorldSnapshot) => {
        // World update handled by render loop
      },
      onPlayerJoin: (playerId: string) => {
        console.log(`Player joined: ${playerId}`);
      },
      onPlayerLeave: (playerId: string) => {
        console.log(`Player left: ${playerId}`);
      },
    });

    // Set up input handling
    this.setupInputHandling();

    // Start render loop
    this.startRenderLoop();
  }

  /**
   * Set up keyboard input handling
   */
  private setupInputHandling(): void {
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.key.toLowerCase());
      this.updateInput();
    });

    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.key.toLowerCase());
      this.updateInput();
    });
  }

  /**
   * Update input based on current key state
   */
  private updateInput(): void {
    let moveX = 0;
    let moveY = 0;

    if (this.keys.has("w") || this.keys.has("arrowup")) {
      moveY -= 1;
    }
    if (this.keys.has("s") || this.keys.has("arrowdown")) {
      moveY += 1;
    }
    if (this.keys.has("a") || this.keys.has("arrowleft")) {
      moveX -= 1;
    }
    if (this.keys.has("d") || this.keys.has("arrowright")) {
      moveX += 1;
    }

    // Normalize diagonal movement
    if (moveX !== 0 && moveY !== 0) {
      moveX *= 0.707; // 1/sqrt(2)
      moveY *= 0.707;
    }

    // Send input to server
    if (moveX !== 0 || moveY !== 0) {
      this.netcodeClient.sendInput({ moveX, moveY });
    }
  }

  /**
   * Start the render loop
   */
  private startRenderLoop(): void {
    const render = () => {
      // Get all player states
      const players = this.netcodeClient.getAllPlayerStates();
      const localPlayerId = this.netcodeClient.getPlayerId();

      // Render
      this.renderer.render(players, localPlayerId);

      // Continue loop
      this.animationFrameId = requestAnimationFrame(render);
    };

    render();
  }

  /**
   * Stop the render loop
   */
  stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
}
