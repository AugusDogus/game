import { createClient, type ClientHandle } from "@game/netcode/client";
import {
  interpolateRounds,
  roundsPredictionScope,
  type RoundsInput,
  type RoundsWorld,
} from "@game/example-rounds";
import type { Socket } from "socket.io-client";
import { Renderer } from "../client/renderer/renderer.js";

/** Input send rate: 60 times per second */
const INPUT_RATE_MS = 1000 / 60;

/**
 * Game client for ROUNDS
 */
export class GameClient {
  private netcodeClient: ClientHandle<RoundsWorld, RoundsInput>;
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

  // Mouse/aim state
  private mouseX: number = 0;
  private mouseY: number = 0;
  private isMouseDown: boolean = false;
  private shootThisFrame: boolean = false;

  // Card selection callback
  private onCardSelectCallback: ((index: 1 | 2 | 3) => void) | null = null;
  private pendingCardSelect: 0 | 1 | 2 | 3 = 0;

  static async create(socket: Socket, canvas: HTMLCanvasElement): Promise<GameClient> {
    const renderer = await Renderer.create(canvas);
    return new GameClient(socket, canvas, renderer);
  }

  private constructor(socket: Socket, canvas: HTMLCanvasElement, renderer: Renderer) {
    this.renderer = renderer;
    this.canvas = canvas;

    this.netcodeClient = createClient<RoundsWorld, RoundsInput>({
      socket,
      predictionScope: roundsPredictionScope,
      interpolate: interpolateRounds,
      interpolationDelayMs: 100,
      onWorldUpdate: (_state: RoundsWorld) => {},
      onPlayerJoin: (playerId: string) => console.log(`Player joined: ${playerId}`),
      onPlayerLeave: (playerId: string) => console.log(`Player left: ${playerId}`),
    });

    // Bind handlers
    this.keydownHandler = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
        e.preventDefault();
      }
      this.keys.add(e.key.toLowerCase());

      // Card selection with 1, 2, 3 keys
      if (e.key === "1") this.pendingCardSelect = 1;
      if (e.key === "2") this.pendingCardSelect = 2;
      if (e.key === "3") this.pendingCardSelect = 3;
    };

    this.keyupHandler = (e: KeyboardEvent) => {
      this.keys.delete(e.key.toLowerCase());
    };

    this.mousedownHandler = (e: MouseEvent) => {
      if (e.button === 0) {
        this.isMouseDown = true;
        this.shootThisFrame = true;
        this.updateMousePosition(e);
      }
    };

    this.mouseupHandler = (e: MouseEvent) => {
      if (e.button === 0) this.isMouseDown = false;
    };

    this.mousemoveHandler = (e: MouseEvent) => {
      this.updateMousePosition(e);
    };

    this.resizeHandler = () => this.handleResize();

    this.setupInputHandling();
    window.addEventListener("resize", this.resizeHandler);
    this.handleResize();
    this.startRenderLoop();
    this.startInputLoop();
  }

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

  private updateMousePosition(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;
    // Convert to world coordinates (Y-up)
    this.mouseX = canvasX - this.canvas.width / 2;
    this.mouseY = -(canvasY - this.canvas.height / 2);
  }

  private setupInputHandling(): void {
    window.addEventListener("keydown", this.keydownHandler);
    window.addEventListener("keyup", this.keyupHandler);
    this.canvas.addEventListener("mousedown", this.mousedownHandler);
    this.canvas.addEventListener("mouseup", this.mouseupHandler);
    this.canvas.addEventListener("mousemove", this.mousemoveHandler);
  }

  private startInputLoop(): void {
    this.inputIntervalId = window.setInterval(() => {
      this.sendCurrentInput();
    }, INPUT_RATE_MS);
  }

  private sendCurrentInput(): void {
    let moveX = 0;
    if (this.keys.has("a") || this.keys.has("arrowleft")) moveX -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) moveX += 1;

    const jump = this.keys.has(" ") || this.keys.has("w") || this.keys.has("arrowup");
    const dash = this.keys.has("shift");
    const shoot = this.shootThisFrame || this.isMouseDown;
    this.shootThisFrame = false;

    const cardSelect = this.pendingCardSelect;
    this.pendingCardSelect = 0;

    this.netcodeClient.sendInput({
      moveX,
      jump,
      shoot,
      aimX: this.mouseX,
      aimY: this.mouseY,
      dash,
      cardSelect,
    });
  }

  private startRenderLoop(): void {
    const render = () => {
      const world = this.netcodeClient.getStateForRendering();
      const localPlayerId = this.netcodeClient.getPlayerId();

      if (world) {
        this.renderer.render(world, localPlayerId, {
          mouseX: this.mouseX,
          mouseY: this.mouseY,
        });
      }

      this.animationFrameId = requestAnimationFrame(render);
    };
    render();
  }

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
    this.renderer.destroy();
  }

  setSimulatedLatency(latencyMs: number): void {
    this.netcodeClient.setSimulatedLatency(latencyMs);
  }

  getSimulatedLatency(): number {
    return this.netcodeClient.getSimulatedLatency();
  }

  getWorld(): RoundsWorld | null {
    return this.netcodeClient.getStateForRendering();
  }

  getPlayerId(): string | null {
    return this.netcodeClient.getPlayerId();
  }

  resetForLevelChange(): void {
    this.netcodeClient.reset();
  }
}
