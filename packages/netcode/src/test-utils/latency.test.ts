import { describe, expect, test, beforeEach } from "bun:test";
import {
  SeededRandom,
  LatencySimulator,
  createBidirectionalLatency,
  DEFAULT_LATENCY_CONFIG,
  type EventEmitter,
} from "./latency.js";

/**
 * Mock event emitter for testing.
 */
class MockEmitter implements EventEmitter {
  private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();
  public emittedEvents: Array<{ event: string; args: unknown[] }> = [];

  emit(event: string, ...args: unknown[]): void {
    this.emittedEvents.push({ event, args });
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        listener(...args);
      }
    }
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    let eventListeners = this.listeners.get(event);
    if (!eventListeners) {
      eventListeners = new Set();
      this.listeners.set(event, eventListeners);
    }
    eventListeners.add(listener);
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(listener);
    }
  }

  clear(): void {
    this.emittedEvents = [];
  }
}

describe("SeededRandom", () => {
  test("should produce deterministic sequence", () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(42);

    const seq1 = [rng1.next(), rng1.next(), rng1.next()];
    const seq2 = [rng2.next(), rng2.next(), rng2.next()];

    expect(seq1).toEqual(seq2);
  });

  test("should produce values in [0, 1)", () => {
    const rng = new SeededRandom(12345);
    for (let i = 0; i < 100; i++) {
      const val = rng.next();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  test("range should produce values in [min, max]", () => {
    const rng = new SeededRandom(12345);
    for (let i = 0; i < 100; i++) {
      const val = rng.range(10, 20);
      expect(val).toBeGreaterThanOrEqual(10);
      expect(val).toBeLessThanOrEqual(20);
    }
  });

  test("reset should restore original sequence", () => {
    const rng = new SeededRandom(42);
    const first = rng.next();
    rng.next();
    rng.next();

    rng.reset(42); // Reset to same seed
    expect(rng.next()).toBe(first);
  });

  test("different seeds should produce different sequences", () => {
    const rng1 = new SeededRandom(1);
    const rng2 = new SeededRandom(2);

    expect(rng1.next()).not.toBe(rng2.next());
  });
});

describe("LatencySimulator", () => {
  let target: MockEmitter;
  let simulator: LatencySimulator;

  beforeEach(() => {
    target = new MockEmitter();
    simulator = new LatencySimulator(target, {
      meanLatencyMs: 60,
      jitterMs: 0, // No jitter for predictable tests
      seed: 12345,
    });
  });

  test("should delay message delivery", () => {
    simulator.emit("test", { data: 123 });

    // Message should be pending, not delivered
    expect(target.emittedEvents.length).toBe(0);
    expect(simulator.getPendingCount()).toBe(1);

    // Advance time past latency
    simulator.tick(70);

    // Message should now be delivered
    expect(target.emittedEvents.length).toBe(1);
    expect(target.emittedEvents[0]!.event).toBe("test");
    expect(target.emittedEvents[0]!.args[0]).toEqual({ data: 123 });
  });

  test("should not deliver before latency expires", () => {
    simulator.emit("test", { data: 123 });

    // Advance time but not enough
    simulator.tick(50);

    expect(target.emittedEvents.length).toBe(0);
    expect(simulator.getPendingCount()).toBe(1);
  });

  test("should deliver multiple messages in order", () => {
    simulator.emit("msg1", "first");
    simulator.tick(10);
    simulator.emit("msg2", "second");

    // Advance enough for first message
    simulator.tick(55); // Total: 65ms
    expect(target.emittedEvents.length).toBe(1);
    expect(target.emittedEvents[0]!.event).toBe("msg1");

    // Advance enough for second message
    simulator.tick(15); // Total: 80ms
    expect(target.emittedEvents.length).toBe(2);
    expect(target.emittedEvents[1]!.event).toBe("msg2");
  });

  test("should apply jitter deterministically", () => {
    const sim1 = new LatencySimulator(new MockEmitter(), {
      meanLatencyMs: 60,
      jitterMs: 15,
      seed: 42,
    });
    const sim2 = new LatencySimulator(new MockEmitter(), {
      meanLatencyMs: 60,
      jitterMs: 15,
      seed: 42,
    });

    // Both should queue messages at the same internal delivery time
    sim1.emit("test", 1);
    sim2.emit("test", 1);

    // Verify they have the same state
    expect(sim1.getPendingCount()).toBe(sim2.getPendingCount());
  });

  test("should drop packets based on loss probability", () => {
    const lossy = new LatencySimulator(target, {
      meanLatencyMs: 10,
      jitterMs: 0,
      packetLoss: 0.5, // 50% loss
      seed: 12345,
    });

    // Send many messages
    for (let i = 0; i < 20; i++) {
      lossy.emit("msg", i);
    }

    // Deliver all
    lossy.tick(100);

    // Should have lost some (not all, not none with 50% probability)
    expect(target.emittedEvents.length).toBeGreaterThan(0);
    expect(target.emittedEvents.length).toBeLessThan(20);
  });

  test("should drop packets in bursts", () => {
    const bursty = new LatencySimulator(target, {
      meanLatencyMs: 10,
      jitterMs: 0,
      burstLossChance: 1, // Always start a burst
      burstLossLength: 3,
      seed: 12345,
    });

    // First three should drop
    bursty.emit("msg", 1);
    bursty.emit("msg", 2);
    bursty.emit("msg", 3);
    bursty.setConfig({ burstLossChance: 0 }); // Allow next packet through
    bursty.emit("msg", 4);

    bursty.tick(100);

    // Only the 4th should arrive
    expect(target.emittedEvents.length).toBe(1);
    expect(target.emittedEvents[0]!.args[0]).toBe(4);
  });

  test("should optionally reorder packets", () => {
    const reorder = new LatencySimulator(target, {
      meanLatencyMs: 50,
      jitterMs: 0,
      reorderChance: 1, // Always reorder
      reorderWindowMs: 30,
      seed: 12345,
    });

    reorder.emit("msg", 1);
    reorder.emit("msg", 2);
    reorder.tick(60);

    expect(target.emittedEvents.length).toBe(2);
  });

  test("should optionally duplicate packets", () => {
    const duplicator = new LatencySimulator(target, {
      meanLatencyMs: 10,
      jitterMs: 0,
      duplicateChance: 1, // Always duplicate
      seed: 12345,
    });

    duplicator.emit("msg", 1);
    duplicator.tick(50);

    expect(target.emittedEvents.length).toBe(2);
  });

  test("should track current time", () => {
    expect(simulator.getCurrentTime()).toBe(0);
    simulator.tick(50);
    expect(simulator.getCurrentTime()).toBe(50);
    simulator.tick(30);
    expect(simulator.getCurrentTime()).toBe(80);
  });

  test("should clear pending messages", () => {
    simulator.emit("test", 1);
    simulator.emit("test", 2);
    expect(simulator.getPendingCount()).toBe(2);

    simulator.clearPending();
    expect(simulator.getPendingCount()).toBe(0);

    // Messages should not be delivered
    simulator.tick(100);
    expect(target.emittedEvents.length).toBe(0);
  });

  test("should reset state", () => {
    simulator.emit("test", 1);
    simulator.tick(100);

    simulator.reset();

    expect(simulator.getCurrentTime()).toBe(0);
    expect(simulator.getPendingCount()).toBe(0);
  });

  test("should pass through on/off to target", () => {
    const received: unknown[] = [];
    const listener = (data: unknown) => received.push(data);

    simulator.on("test", listener);

    // Emit directly to target (bypassing latency)
    target.emit("test", "direct");
    expect(received).toEqual(["direct"]);

    // Emit through simulator (with latency)
    simulator.emit("test", "delayed");
    simulator.tick(100);
    expect(received).toEqual(["direct", "delayed"]);

    // Remove listener
    simulator.off("test", listener);
    target.emit("test", "after-off");
    expect(received).toEqual(["direct", "delayed"]); // No new entry
  });

  test("tick should return number of delivered messages", () => {
    simulator.emit("msg1", 1);
    simulator.emit("msg2", 2);
    simulator.emit("msg3", 3);

    const delivered1 = simulator.tick(30); // Not enough time
    expect(delivered1).toBe(0);

    const delivered2 = simulator.tick(40); // Enough for all 3
    expect(delivered2).toBe(3);
  });

  test("setConfig should update latency settings", () => {
    simulator.setConfig({ meanLatencyMs: 100 });
    simulator.emit("test", 1);

    simulator.tick(80); // Would have been delivered with 60ms latency
    expect(target.emittedEvents.length).toBe(0);

    simulator.tick(30); // Now enough for 100ms latency
    expect(target.emittedEvents.length).toBe(1);
  });
});

describe("createBidirectionalLatency", () => {
  test("should create paired simulators", () => {
    const client = new MockEmitter();
    const server = new MockEmitter();

    const { clientToServer, serverToClient } = createBidirectionalLatency(
      client,
      server,
      { meanLatencyMs: 50, jitterMs: 0 },
    );

    // Client sends to server
    clientToServer.emit("input", { moveX: 1 });
    clientToServer.tick(60);
    expect(server.emittedEvents.length).toBe(1);
    expect(server.emittedEvents[0]!.event).toBe("input");

    // Server sends to client
    serverToClient.emit("snapshot", { tick: 1 });
    serverToClient.tick(60);
    expect(client.emittedEvents.length).toBe(1);
    expect(client.emittedEvents[0]!.event).toBe("snapshot");
  });

  test("tick helper should advance both simulators", () => {
    const client = new MockEmitter();
    const server = new MockEmitter();

    const { clientToServer, serverToClient, tick } = createBidirectionalLatency(
      client,
      server,
      { meanLatencyMs: 50, jitterMs: 0 },
    );

    clientToServer.emit("input", 1);
    serverToClient.emit("snapshot", 1);

    const result = tick(60);
    expect(result.clientToServer).toBe(1);
    expect(result.serverToClient).toBe(1);
  });

  test("reset helper should reset both simulators", () => {
    const client = new MockEmitter();
    const server = new MockEmitter();

    const { clientToServer, serverToClient, reset, tick } = createBidirectionalLatency(
      client,
      server,
      { meanLatencyMs: 50, jitterMs: 0 },
    );

    clientToServer.emit("input", 1);
    serverToClient.emit("snapshot", 1);
    tick(30);

    reset();

    expect(clientToServer.getCurrentTime()).toBe(0);
    expect(serverToClient.getCurrentTime()).toBe(0);
    expect(clientToServer.getPendingCount()).toBe(0);
    expect(serverToClient.getPendingCount()).toBe(0);
  });

  test("should share RNG for deterministic behavior", () => {
    const client1 = new MockEmitter();
    const server1 = new MockEmitter();
    const client2 = new MockEmitter();
    const server2 = new MockEmitter();

    const pair1 = createBidirectionalLatency(client1, server1, {
      meanLatencyMs: 50,
      jitterMs: 10,
      seed: 42,
    });

    const pair2 = createBidirectionalLatency(client2, server2, {
      meanLatencyMs: 50,
      jitterMs: 10,
      seed: 42,
    });

    // Same operations should produce same results
    pair1.clientToServer.emit("test", 1);
    pair2.clientToServer.emit("test", 1);

    // Both should have same pending count and timing
    expect(pair1.clientToServer.getPendingCount()).toBe(pair2.clientToServer.getPendingCount());
  });
});

describe("DEFAULT_LATENCY_CONFIG", () => {
  test("should have sensible defaults", () => {
    expect(DEFAULT_LATENCY_CONFIG.meanLatencyMs).toBe(60);
    expect(DEFAULT_LATENCY_CONFIG.jitterMs).toBe(15);
    expect(DEFAULT_LATENCY_CONFIG.seed).toBe(12345);
    expect(DEFAULT_LATENCY_CONFIG.packetLoss).toBe(0);
  });
});
