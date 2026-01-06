import type { Socket } from "socket.io-client";
import { DEFAULT_INTERPOLATION_DELAY_MS } from "../constants.js";
import type {
  NetcodeClientConfig,
  PlayerState,
  WorldSnapshot,
} from "../types.js";
import { InputBuffer } from "./input-buffer.js";
import { Interpolator } from "./interpolation.js";
import { Predictor } from "./prediction.js";
import { Reconciler } from "./reconciliation.js";

/** Position history entry for debug visualization */
export interface PositionHistoryEntry {
  x: number;
  y: number;
  timestamp: number;
}

/** Debug data for visualization */
export interface DebugData {
  /** Local player's predicted positions (green trail) */
  localPredictedHistory: PositionHistoryEntry[];
  /** Local player's server-confirmed positions (red trail) */
  localServerHistory: PositionHistoryEntry[];
  /** Other players' interpolated positions (blue trail) */
  otherPlayersHistory: Map<string, PositionHistoryEntry[]>;
  /** Other players' raw server positions (orange trail) */
  otherPlayersServerHistory: Map<string, PositionHistoryEntry[]>;
}

const MAX_HISTORY_LENGTH = 60; // ~3 seconds at 20Hz

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
  private simulatedLatency: number;

  // Debug history tracking
  private localPredictedHistory: PositionHistoryEntry[] = [];
  private localServerHistory: PositionHistoryEntry[] = [];
  private otherPlayersHistory: Map<string, PositionHistoryEntry[]> = new Map();
  private otherPlayersServerHistory: Map<string, PositionHistoryEntry[]> = new Map();
  private lastServerSnapshot: WorldSnapshot | null = null;

  constructor(socket: Socket, config: NetcodeClientConfig) {
    if (!config.applyInput) {
      throw new Error("NetcodeClientConfig.applyInput is required");
    }

    this.socket = socket;
    this.simulatedLatency = config.simulatedLatency ?? 0;
    this.config = {
      interpolationDelay: config.interpolationDelay ?? DEFAULT_INTERPOLATION_DELAY_MS,
      simulatedLatency: this.simulatedLatency,
      applyInput: config.applyInput,
      onWorldUpdate: config.onWorldUpdate,
      onPlayerJoin: config.onPlayerJoin,
      onPlayerLeave: config.onPlayerLeave,
    };

    // Initialize primitives
    this.inputBuffer = new InputBuffer();
    this.predictor = new Predictor(config.applyInput);
    this.interpolator = new Interpolator(this.config.interpolationDelay);

    // Set up socket event handlers
    this.setupSocketHandlers();

    // Handle case where socket is already connected
    if (socket.connected && socket.id) {
      this.initializePlayer(socket.id);
    }

    // Get player ID when connected (for future connections/reconnections)
    socket.on("connect", () => {
      if (socket.id) {
        this.initializePlayer(socket.id);
      }
    });
  }

  /**
   * Initialize player state when connected
   */
  private initializePlayer(id: string): void {
    this.playerId = id;
    this.reconciler = new Reconciler(
      this.inputBuffer,
      this.predictor,
      this.playerId,
    );
    // Initialize local player state at origin (will fall to floor due to gravity)
    this.localPlayerState = {
      id: this.playerId,
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      isGrounded: false,
      tick: 0,
    };
  }

  /**
   * Set up Socket.IO event handlers
   */
  private setupSocketHandlers(): void {
    // Handle world snapshots (with simulated latency)
    this.socket.on("netcode:snapshot", (snapshot: WorldSnapshot) => {
      if (this.simulatedLatency > 0) {
        setTimeout(() => this.handleSnapshot(snapshot), this.simulatedLatency);
      } else {
        this.handleSnapshot(snapshot);
      }
    });

    // Handle player join (with simulated latency)
    this.socket.on("netcode:join", (data: { playerId: string; state: PlayerState }) => {
      if (this.simulatedLatency > 0) {
        setTimeout(() => this.config.onPlayerJoin?.(data.playerId, data.state), this.simulatedLatency);
      } else {
        this.config.onPlayerJoin?.(data.playerId, data.state);
      }
    });

    // Handle player leave (with simulated latency)
    this.socket.on("netcode:leave", (data: { playerId: string }) => {
      if (this.simulatedLatency > 0) {
        setTimeout(() => this.config.onPlayerLeave?.(data.playerId), this.simulatedLatency);
      } else {
        this.config.onPlayerLeave?.(data.playerId);
      }
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

    // Store for debug
    this.lastServerSnapshot = snapshot;

    // Track server position for local player (debug)
    const localServerState = snapshot.players.find((p) => p.id === this.playerId);
    if (localServerState) {
      this.addToHistory(this.localServerHistory, {
        x: localServerState.position.x,
        y: localServerState.position.y,
        timestamp: Date.now(),
      });
    }

    // Track server positions for other players (debug)
    for (const player of snapshot.players) {
      if (player.id !== this.playerId) {
        if (!this.otherPlayersServerHistory.has(player.id)) {
          this.otherPlayersServerHistory.set(player.id, []);
        }
        this.addToHistory(this.otherPlayersServerHistory.get(player.id)!, {
          x: player.position.x,
          y: player.position.y,
          timestamp: Date.now(),
        });
      }
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
   * Add entry to history, maintaining max length
   */
  private addToHistory(history: PositionHistoryEntry[], entry: PositionHistoryEntry): void {
    history.push(entry);
    while (history.length > MAX_HISTORY_LENGTH) {
      history.shift();
    }
  }

  /**
   * Send player input to server
   */
  sendInput(input: { moveX: number; moveY: number; jump: boolean }): void {
    if (!this.socket.connected) {
      return;
    }

    const timestamp = Date.now();
    const seq = this.inputBuffer.add({
      moveX: input.moveX,
      moveY: input.moveY,
      jump: input.jump,
      timestamp,
    });

    const inputMessage = {
      seq,
      input: {
        moveX: input.moveX,
        moveY: input.moveY,
        jump: input.jump,
        timestamp,
      },
      timestamp,
    };

    // Send to server (with simulated latency for outgoing messages)
    if (this.simulatedLatency > 0) {
      setTimeout(() => this.socket.emit("netcode:input", inputMessage), this.simulatedLatency);
    } else {
      this.socket.emit("netcode:input", inputMessage);
    }

    // Apply locally for prediction (immediately, no delay - this is the point of prediction!)
    if (this.localPlayerState) {
      this.predictor.setBaseState(this.localPlayerState);
      this.predictor.applyInput({
        moveX: input.moveX,
        moveY: input.moveY,
        jump: input.jump,
        timestamp,
      });
      this.localPlayerState = this.predictor.getState() ?? this.localPlayerState;

      // Track predicted position (debug)
      this.addToHistory(this.localPredictedHistory, {
        x: this.localPlayerState.position.x,
        y: this.localPlayerState.position.y,
        timestamp,
      });
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
    const states = this.interpolator.getInterpolatedStates();

    // Track interpolated positions for debug
    for (const state of states) {
      if (state.id !== this.playerId) {
        if (!this.otherPlayersHistory.has(state.id)) {
          this.otherPlayersHistory.set(state.id, []);
        }
        this.addToHistory(this.otherPlayersHistory.get(state.id)!, {
          x: state.position.x,
          y: state.position.y,
          timestamp: Date.now(),
        });
      }
    }

    return states;
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

  /**
   * Set simulated network latency (for testing)
   */
  setSimulatedLatency(latencyMs: number): void {
    this.simulatedLatency = Math.max(0, latencyMs);
  }

  /**
   * Get current simulated latency
   */
  getSimulatedLatency(): number {
    return this.simulatedLatency;
  }

  /**
   * Get debug data for visualization
   */
  getDebugData(): DebugData {
    return {
      localPredictedHistory: [...this.localPredictedHistory],
      localServerHistory: [...this.localServerHistory],
      otherPlayersHistory: new Map(this.otherPlayersHistory),
      otherPlayersServerHistory: new Map(this.otherPlayersServerHistory),
    };
  }

  /**
   * Get the last raw server snapshot (for debug visualization)
   */
  getLastServerSnapshot(): WorldSnapshot | null {
    return this.lastServerSnapshot;
  }

  /**
   * Clear debug history (useful when toggling debug mode)
   */
  clearDebugHistory(): void {
    this.localPredictedHistory = [];
    this.localServerHistory = [];
    this.otherPlayersHistory.clear();
    this.otherPlayersServerHistory.clear();
  }
}
