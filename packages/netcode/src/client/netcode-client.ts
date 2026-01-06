import type { Socket } from "socket.io-client";
import type {
  NetcodeClientConfig,
  WorldSnapshot,
  PlayerState,
} from "../types.js";
import { InputBuffer } from "./input-buffer.js";
import { Predictor } from "./prediction.js";
import { Reconciler } from "./reconciliation.js";
import { Interpolator } from "./interpolation.js";
import { DEFAULT_INTERPOLATION_DELAY_MS } from "../constants.js";

/**
 * High-level client class that orchestrates all client-side netcode primitives
 */
export class NetcodeClient {
  private socket: Socket;
  private inputBuffer: InputBuffer;
  private predictor: Predictor;
  private reconciler: Reconciler | null = null;
  private interpolator: Interpolator;
  private config: NetcodeClientConfig;
  private playerId: string | null = null;
  private localPlayerState: PlayerState | null = null;

  constructor(socket: Socket, config: NetcodeClientConfig = {}) {
    this.socket = socket;
    this.config = {
      interpolationDelay: config.interpolationDelay ?? DEFAULT_INTERPOLATION_DELAY_MS,
      onWorldUpdate: config.onWorldUpdate,
      onPlayerJoin: config.onPlayerJoin,
      onPlayerLeave: config.onPlayerLeave,
    };

    // Initialize primitives
    this.inputBuffer = new InputBuffer();
    this.predictor = new Predictor();
    this.interpolator = new Interpolator(this.config.interpolationDelay);

    // Set up socket event handlers
    this.setupSocketHandlers();

    // Get player ID when connected
    socket.on("connect", () => {
      this.playerId = socket.id ?? null;
      if (this.playerId) {
        this.reconciler = new Reconciler(
          this.inputBuffer,
          this.predictor,
          this.playerId,
        );
      }
    });
  }

  /**
   * Set up Socket.IO event handlers
   */
  private setupSocketHandlers(): void {
    // Handle world snapshots
    this.socket.on("netcode:snapshot", (snapshot: WorldSnapshot) => {
      this.handleSnapshot(snapshot);
    });

    // Handle player join
    this.socket.on("netcode:join", (data: { playerId: string; state: PlayerState }) => {
      this.config.onPlayerJoin?.(data.playerId, data.state);
    });

    // Handle player leave
    this.socket.on("netcode:leave", (data: { playerId: string }) => {
      this.config.onPlayerLeave?.(data.playerId);
    });

    // Handle disconnect
    this.socket.on("disconnect", () => {
      this.playerId = null;
      this.predictor.reset();
      this.inputBuffer.clear();
      this.interpolator.clear();
    });
  }

  /**
   * Handle incoming world snapshot
   */
  private handleSnapshot(snapshot: WorldSnapshot): void {
    if (!this.playerId || !this.reconciler) {
      return;
    }

    // Reconcile local player state
    const reconciledState = this.reconciler.reconcile(snapshot);
    this.localPlayerState = reconciledState;

    // Add snapshot to interpolator for other entities
    this.interpolator.addSnapshot(snapshot);

    // Notify callback
    this.config.onWorldUpdate?.(snapshot);
  }

  /**
   * Send player input to server
   */
  sendInput(input: { moveX: number; moveY: number }): void {
    if (!this.socket.connected) {
      return;
    }

    const timestamp = Date.now();
    const seq = this.inputBuffer.add({
      moveX: input.moveX,
      moveY: input.moveY,
      timestamp,
    });

    // Send to server
    this.socket.emit("netcode:input", {
      seq,
      input: {
        moveX: input.moveX,
        moveY: input.moveY,
        timestamp,
      },
      timestamp,
    });

    // Apply locally for prediction
    if (this.localPlayerState) {
      this.predictor.setBaseState(this.localPlayerState);
      this.predictor.applyInput({
        moveX: input.moveX,
        moveY: input.moveY,
        timestamp,
      });
      this.localPlayerState = this.predictor.getState() ?? this.localPlayerState;
    }
  }

  /**
   * Get the current local player state (with prediction applied)
   */
  getLocalPlayerState(): PlayerState | null {
    return this.localPlayerState;
  }

  /**
   * Get interpolated states for other entities
   */
  getInterpolatedStates(): PlayerState[] {
    return this.interpolator.getInterpolatedStates();
  }

  /**
   * Get all player states (local + interpolated others)
   */
  getAllPlayerStates(): PlayerState[] {
    const states: PlayerState[] = [];
    const local = this.getLocalPlayerState();
    if (local) {
      states.push(local);
    }

    const others = this.getInterpolatedStates();
    for (const other of others) {
      // Don't include local player twice
      if (other.id !== this.playerId) {
        states.push(other);
      }
    }

    return states;
  }

  /**
   * Get player ID
   */
  getPlayerId(): string | null {
    return this.playerId;
  }
}
