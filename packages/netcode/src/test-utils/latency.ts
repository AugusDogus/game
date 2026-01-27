/**
 * Deterministic latency/jitter simulation for testing netcode behavior.
 *
 * This harness wraps Socket.IO-style event emitters to delay packets
 * with configurable latency and jitter. Uses a seeded RNG for reproducibility.
 *
 * @module test-utils/latency
 */

/**
 * Seeded random number generator for deterministic jitter.
 * Uses a simple linear congruential generator (LCG).
 */
export class SeededRandom {
  private seed: number;

  constructor(seed: number = 12345) {
    this.seed = seed;
  }

  /**
   * Get next random number in [0, 1).
   */
  next(): number {
    // LCG parameters (same as glibc)
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  /**
   * Get random number in [min, max].
   */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Reset to initial seed for reproducibility.
   */
  reset(seed?: number): void {
    this.seed = seed ?? 12345;
  }
}

/**
 * Configuration for latency simulation.
 */
export interface LatencyConfig {
  /** Mean latency in milliseconds (one-way) */
  meanLatencyMs: number;
  /** Jitter range (+/- ms from mean) */
  jitterMs: number;
  /** Seed for deterministic jitter (default: 12345) */
  seed?: number;
  /** Packet loss probability [0, 1] (default: 0) */
  packetLoss?: number;
  /** Probability to drop a burst of packets [0, 1] (default: 0) */
  burstLossChance?: number;
  /** Number of packets to drop in a burst (default: 0) */
  burstLossLength?: number;
  /** Probability to reorder a packet [0, 1] (default: 0) */
  reorderChance?: number;
  /** Maximum negative jitter used for reordering (ms) (default: jitterMs) */
  reorderWindowMs?: number;
  /** Probability to duplicate a packet [0, 1] (default: 0) */
  duplicateChance?: number;
}

/**
 * Default latency config: 60ms mean, 15ms jitter (simulates ~120ms RTT).
 */
export const DEFAULT_LATENCY_CONFIG: LatencyConfig = {
  meanLatencyMs: 60,
  jitterMs: 15,
  seed: 12345,
  packetLoss: 0,
  burstLossChance: 0,
  burstLossLength: 0,
  reorderChance: 0,
  reorderWindowMs: 0,
  duplicateChance: 0,
};

/**
 * A pending message waiting to be delivered.
 */
interface PendingMessage {
  event: string;
  args: unknown[];
  deliveryTime: number;
}

/**
 * Event emitter interface (subset of Socket.IO).
 */
export interface EventEmitter {
  emit(event: string, ...args: unknown[]): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
}

/**
 * Latency simulator that wraps an event emitter.
 *
 * Messages sent via `emit` are delayed by latency + jitter before being
 * delivered to the underlying emitter. Uses a seeded RNG for deterministic
 * behavior across test runs.
 *
 * @example
 * ```ts
 * const rng = new SeededRandom(42);
 * const simulator = new LatencySimulator(socket, { meanLatencyMs: 60, jitterMs: 15 }, rng);
 *
 * // Messages are delayed
 * simulator.emit("netcode:input", { seq: 1, input: {...} });
 *
 * // Advance time to deliver pending messages
 * simulator.tick(100); // Advance 100ms
 * ```
 */
export class LatencySimulator implements EventEmitter {
  private target: EventEmitter;
  private config: Required<LatencyConfig>;
  private rng: SeededRandom;
  private pendingMessages: PendingMessage[] = [];
  private currentTime: number = 0;
  private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();
  private burstLossRemaining: number = 0;

  constructor(
    target: EventEmitter,
    config: Partial<LatencyConfig> = {},
    rng?: SeededRandom,
  ) {
    this.target = target;
    this.config = {
      meanLatencyMs: config.meanLatencyMs ?? DEFAULT_LATENCY_CONFIG.meanLatencyMs,
      jitterMs: config.jitterMs ?? DEFAULT_LATENCY_CONFIG.jitterMs,
      seed: config.seed ?? DEFAULT_LATENCY_CONFIG.seed,
      packetLoss: config.packetLoss ?? DEFAULT_LATENCY_CONFIG.packetLoss,
      burstLossChance: config.burstLossChance ?? DEFAULT_LATENCY_CONFIG.burstLossChance,
      burstLossLength: config.burstLossLength ?? DEFAULT_LATENCY_CONFIG.burstLossLength,
      reorderChance: config.reorderChance ?? DEFAULT_LATENCY_CONFIG.reorderChance,
      reorderWindowMs: config.reorderWindowMs ?? DEFAULT_LATENCY_CONFIG.reorderWindowMs,
      duplicateChance: config.duplicateChance ?? DEFAULT_LATENCY_CONFIG.duplicateChance,
    };
    this.rng = rng ?? new SeededRandom(this.config.seed);
  }

  /**
   * Queue a message for delayed delivery.
   */
  emit(event: string, ...args: unknown[]): void {
    if (this.burstLossRemaining > 0) {
      this.burstLossRemaining--;
      return;
    }

    if (this.config.burstLossChance > 0 && this.config.burstLossLength > 0) {
      if (this.rng.next() < this.config.burstLossChance) {
        this.burstLossRemaining = this.config.burstLossLength - 1;
        return;
      }
    }

    // Check for packet loss
    if (this.config.packetLoss > 0 && this.rng.next() < this.config.packetLoss) {
      return; // Packet dropped
    }

    // Calculate delivery time with jitter
    const baseDelay = this.config.meanLatencyMs + this.rng.range(-this.config.jitterMs, this.config.jitterMs);
    let delay = baseDelay;
    if (this.config.reorderChance > 0 && this.rng.next() < this.config.reorderChance) {
      const reorderWindow = this.config.reorderWindowMs > 0 ? this.config.reorderWindowMs : this.config.jitterMs;
      delay = baseDelay - this.rng.range(0, reorderWindow);
    }
    const deliveryTime = this.currentTime + Math.max(0, delay);

    this.pendingMessages.push({ event, args, deliveryTime });

    // Keep sorted by delivery time for efficient processing
    this.pendingMessages.sort((a, b) => a.deliveryTime - b.deliveryTime);

    // Duplicate packet if configured
    if (this.config.duplicateChance > 0 && this.rng.next() < this.config.duplicateChance) {
      const duplicateDelay = deliveryTime + Math.max(0, this.rng.range(0, this.config.jitterMs));
      this.pendingMessages.push({ event, args, deliveryTime: duplicateDelay });
      this.pendingMessages.sort((a, b) => a.deliveryTime - b.deliveryTime);
    }
  }

  /**
   * Register a listener (passes through to target).
   */
  on(event: string, listener: (...args: unknown[]) => void): void {
    let eventListeners = this.listeners.get(event);
    if (!eventListeners) {
      eventListeners = new Set();
      this.listeners.set(event, eventListeners);
    }
    eventListeners.add(listener);
    this.target.on(event, listener);
  }

  /**
   * Remove a listener (passes through to target).
   */
  off(event: string, listener: (...args: unknown[]) => void): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(listener);
    }
    this.target.off(event, listener);
  }

  /**
   * Advance simulated time and deliver pending messages.
   *
   * @param deltaMs - Time to advance in milliseconds
   * @returns Number of messages delivered
   */
  tick(deltaMs: number): number {
    this.currentTime += deltaMs;
    let delivered = 0;

    // Deliver all messages whose delivery time has passed
    while (this.pendingMessages.length > 0) {
      const msg = this.pendingMessages[0]!;
      if (msg.deliveryTime > this.currentTime) {
        break;
      }

      this.pendingMessages.shift();
      this.target.emit(msg.event, ...msg.args);
      delivered++;
    }

    return delivered;
  }

  /**
   * Get current simulated time.
   */
  getCurrentTime(): number {
    return this.currentTime;
  }

  /**
   * Get number of pending messages.
   */
  getPendingCount(): number {
    return this.pendingMessages.length;
  }

  /**
   * Clear all pending messages.
   */
  clearPending(): void {
    this.pendingMessages = [];
  }

  /**
   * Reset simulator state (time, pending messages, RNG).
   */
  reset(seed?: number): void {
    this.currentTime = 0;
    this.pendingMessages = [];
    this.burstLossRemaining = 0;
    this.rng.reset(seed ?? this.config.seed);
  }

  /**
   * Update latency configuration.
   */
  setConfig(config: Partial<LatencyConfig>): void {
    if (config.meanLatencyMs !== undefined) this.config.meanLatencyMs = config.meanLatencyMs;
    if (config.jitterMs !== undefined) this.config.jitterMs = config.jitterMs;
    if (config.packetLoss !== undefined) this.config.packetLoss = config.packetLoss;
    if (config.burstLossChance !== undefined) this.config.burstLossChance = config.burstLossChance;
    if (config.burstLossLength !== undefined) this.config.burstLossLength = config.burstLossLength;
    if (config.reorderChance !== undefined) this.config.reorderChance = config.reorderChance;
    if (config.reorderWindowMs !== undefined) this.config.reorderWindowMs = config.reorderWindowMs;
    if (config.duplicateChance !== undefined) this.config.duplicateChance = config.duplicateChance;
    if (config.seed !== undefined) {
      this.config.seed = config.seed;
      this.rng.reset(config.seed);
    }
  }
}

/**
 * Create a bidirectional latency simulator for client-server communication.
 *
 * Returns two simulators: one for client->server messages, one for server->client.
 * Both share the same RNG for deterministic behavior.
 *
 * @param clientEmitter - Client-side event emitter
 * @param serverEmitter - Server-side event emitter
 * @param config - Latency configuration
 * @returns Object with client and server simulators
 */
export function createBidirectionalLatency(
  clientEmitter: EventEmitter,
  serverEmitter: EventEmitter,
  config: Partial<LatencyConfig> = {},
): {
  clientToServer: LatencySimulator;
  serverToClient: LatencySimulator;
  rng: SeededRandom;
  tick: (deltaMs: number) => { clientToServer: number; serverToClient: number };
  reset: (seed?: number) => void;
} {
  const rng = new SeededRandom(config.seed ?? DEFAULT_LATENCY_CONFIG.seed);
  const clientToServer = new LatencySimulator(serverEmitter, config, rng);
  const serverToClient = new LatencySimulator(clientEmitter, config, rng);

  return {
    clientToServer,
    serverToClient,
    rng,
    tick: (deltaMs: number) => ({
      clientToServer: clientToServer.tick(deltaMs),
      serverToClient: serverToClient.tick(deltaMs),
    }),
    reset: (seed?: number) => {
      clientToServer.reset(seed);
      serverToClient.reset(seed);
    },
  };
}
