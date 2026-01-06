import { describe, it, expect, beforeEach, mock } from "bun:test";
import { NetcodeClient } from "./netcode-client.js";
import type { WorldSnapshot } from "../types.js";

/**
 * Create a mock Socket.IO socket for testing
 */
function createMockSocket(options: { connected?: boolean; id?: string } = {}) {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

  return {
    connected: options.connected ?? true,
    id: options.id ?? "test-player-id",
    on: mock((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) {
        handlers[event] = [];
      }
      handlers[event]!.push(handler);
    }),
    off: mock((_event: string, _handler: (...args: unknown[]) => void) => {}),
    emit: mock((_event: string, _data: unknown) => {}),
    // Helper to trigger events in tests
    _trigger: (event: string, ...args: unknown[]) => {
      const eventHandlers = handlers[event];
      if (eventHandlers) {
        for (const handler of eventHandlers) {
          handler(...args);
        }
      }
    },
    _handlers: handlers,
  };
}

/**
 * Create a test snapshot
 */
function createSnapshot(
  tick: number,
  players: Array<{ id: string; x: number; y: number }>,
  acks: Record<string, number> = {},
): WorldSnapshot {
  return {
    tick,
    timestamp: Date.now(),
    players: players.map((p) => ({
      id: p.id,
      position: { x: p.x, y: p.y },
      velocity: { x: 0, y: 0 },
      tick,
    })),
    acks,
  };
}

describe("NetcodeClient", () => {
  describe("simulated latency", () => {
    it("should initialize with zero latency by default", () => {
      const socket = createMockSocket();
      const client = new NetcodeClient(socket as never);

      expect(client.getSimulatedLatency()).toBe(0);
    });

    it("should initialize with configured latency", () => {
      const socket = createMockSocket();
      const client = new NetcodeClient(socket as never, {
        simulatedLatency: 100,
      });

      expect(client.getSimulatedLatency()).toBe(100);
    });

    it("should allow setting latency at runtime", () => {
      const socket = createMockSocket();
      const client = new NetcodeClient(socket as never);

      client.setSimulatedLatency(150);
      expect(client.getSimulatedLatency()).toBe(150);

      client.setSimulatedLatency(0);
      expect(client.getSimulatedLatency()).toBe(0);
    });

    it("should clamp negative latency to zero", () => {
      const socket = createMockSocket();
      const client = new NetcodeClient(socket as never);

      client.setSimulatedLatency(-50);
      expect(client.getSimulatedLatency()).toBe(0);
    });
  });

  describe("debug data", () => {
    let socket: ReturnType<typeof createMockSocket>;
    let client: NetcodeClient;

    beforeEach(() => {
      socket = createMockSocket({ connected: true, id: "local-player" });
      client = new NetcodeClient(socket as never);
    });

    it("should return empty debug data initially", () => {
      const debugData = client.getDebugData();

      expect(debugData.localPredictedHistory).toEqual([]);
      expect(debugData.localServerHistory).toEqual([]);
      expect(debugData.otherPlayersHistory.size).toBe(0);
      expect(debugData.otherPlayersServerHistory.size).toBe(0);
    });

    it("should track local predicted positions when sending input", () => {
      client.sendInput({ moveX: 1, moveY: 0 });
      client.sendInput({ moveX: 1, moveY: 0 });

      const debugData = client.getDebugData();
      expect(debugData.localPredictedHistory.length).toBe(2);
      expect(debugData.localPredictedHistory[0]!.x).toBeGreaterThan(0);
    });

    it("should track local server positions from snapshots", () => {
      const snapshot = createSnapshot(1, [{ id: "local-player", x: 100, y: 50 }]);

      // Trigger the snapshot handler
      socket._trigger("netcode:snapshot", snapshot);

      const debugData = client.getDebugData();
      expect(debugData.localServerHistory.length).toBe(1);
      expect(debugData.localServerHistory[0]!.x).toBe(100);
      expect(debugData.localServerHistory[0]!.y).toBe(50);
    });

    it("should track other players server positions from snapshots", () => {
      const snapshot = createSnapshot(1, [
        { id: "local-player", x: 0, y: 0 },
        { id: "other-player", x: 200, y: 150 },
      ]);

      socket._trigger("netcode:snapshot", snapshot);

      const debugData = client.getDebugData();
      expect(debugData.otherPlayersServerHistory.has("other-player")).toBe(true);
      const otherHistory = debugData.otherPlayersServerHistory.get("other-player")!;
      expect(otherHistory.length).toBe(1);
      expect(otherHistory[0]!.x).toBe(200);
      expect(otherHistory[0]!.y).toBe(150);
    });

    it("should track other players interpolated positions", () => {
      // Add multiple snapshots for interpolation
      const snapshot1 = createSnapshot(1, [
        { id: "local-player", x: 0, y: 0 },
        { id: "other-player", x: 100, y: 100 },
      ]);
      const snapshot2 = createSnapshot(2, [
        { id: "local-player", x: 0, y: 0 },
        { id: "other-player", x: 150, y: 150 },
      ]);

      socket._trigger("netcode:snapshot", snapshot1);
      socket._trigger("netcode:snapshot", snapshot2);

      // Getting interpolated states should track positions
      client.getInterpolatedStates();

      const debugData = client.getDebugData();
      expect(debugData.otherPlayersHistory.has("other-player")).toBe(true);
    });

    it("should clear debug history", () => {
      // Add some data
      client.sendInput({ moveX: 1, moveY: 0 });
      const snapshot = createSnapshot(1, [
        { id: "local-player", x: 100, y: 50 },
        { id: "other-player", x: 200, y: 150 },
      ]);
      socket._trigger("netcode:snapshot", snapshot);
      client.getInterpolatedStates();

      // Verify data exists
      let debugData = client.getDebugData();
      expect(debugData.localPredictedHistory.length).toBeGreaterThan(0);
      expect(debugData.localServerHistory.length).toBeGreaterThan(0);

      // Clear
      client.clearDebugHistory();

      // Verify cleared
      debugData = client.getDebugData();
      expect(debugData.localPredictedHistory).toEqual([]);
      expect(debugData.localServerHistory).toEqual([]);
      expect(debugData.otherPlayersHistory.size).toBe(0);
      expect(debugData.otherPlayersServerHistory.size).toBe(0);
    });

    it("should limit history length", () => {
      // Send more inputs than MAX_HISTORY_LENGTH (60)
      for (let i = 0; i < 70; i++) {
        client.sendInput({ moveX: 1, moveY: 0 });
      }

      const debugData = client.getDebugData();
      expect(debugData.localPredictedHistory.length).toBeLessThanOrEqual(60);
    });
  });

  describe("server snapshot tracking", () => {
    it("should return null initially for last server snapshot", () => {
      const socket = createMockSocket();
      const client = new NetcodeClient(socket as never);

      expect(client.getLastServerSnapshot()).toBeNull();
    });

    it("should store the last server snapshot", () => {
      const socket = createMockSocket({ connected: true, id: "local-player" });
      const client = new NetcodeClient(socket as never);

      const snapshot = createSnapshot(5, [{ id: "local-player", x: 100, y: 200 }]);
      socket._trigger("netcode:snapshot", snapshot);

      const lastSnapshot = client.getLastServerSnapshot();
      expect(lastSnapshot).not.toBeNull();
      expect(lastSnapshot!.tick).toBe(5);
      expect(lastSnapshot!.players[0]!.position.x).toBe(100);
    });

    it("should update to the most recent snapshot", () => {
      const socket = createMockSocket({ connected: true, id: "local-player" });
      const client = new NetcodeClient(socket as never);

      socket._trigger(
        "netcode:snapshot",
        createSnapshot(1, [{ id: "local-player", x: 10, y: 10 }]),
      );
      socket._trigger(
        "netcode:snapshot",
        createSnapshot(2, [{ id: "local-player", x: 20, y: 20 }]),
      );
      socket._trigger(
        "netcode:snapshot",
        createSnapshot(3, [{ id: "local-player", x: 30, y: 30 }]),
      );

      const lastSnapshot = client.getLastServerSnapshot();
      expect(lastSnapshot!.tick).toBe(3);
      expect(lastSnapshot!.players[0]!.position.x).toBe(30);
    });
  });

  describe("player ID", () => {
    it("should initialize player ID from connected socket", () => {
      const socket = createMockSocket({ connected: true, id: "my-player-id" });
      const client = new NetcodeClient(socket as never);

      expect(client.getPlayerId()).toBe("my-player-id");
    });

    it("should return null when socket not connected", () => {
      const socket = createMockSocket({ connected: false, id: undefined });
      const client = new NetcodeClient(socket as never);

      expect(client.getPlayerId()).toBeNull();
    });
  });
});
