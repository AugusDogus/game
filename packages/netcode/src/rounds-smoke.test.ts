import { describe, expect, test } from "bun:test";
import { createServer as createHttpServer } from "http";
import type { AddressInfo } from "net";
import { Server as SocketIoServer } from "socket.io";
import { io as createSocketClient } from "socket.io-client";
import { createServer as createNetcodeServer } from "./create-server.js";
import { createClient } from "./create-client.js";
import { superjsonParser } from "./parser.js";
import { DEFAULT_TICK_INTERVAL_MS } from "./constants.js";
import {
  addPlayerToWorld,
  createIdleInput,
  createRoundsWorld,
  forceStartGame,
  mergeRoundsInputs,
  roundsPredictionScope,
  simulateRounds,
  removePlayerFromWorld,
  DEFAULT_LEVEL,
  type RoundsInput,
  type RoundsWorld,
} from "@game/example-rounds";

const DEFAULT_TIMEOUT_MS = 10000;
const POLL_INTERVAL_MS = 20;

const waitFor = async (predicate: () => boolean, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("Timeout waiting for condition");
};

const createInput = (moveX: number): Omit<RoundsInput, "timestamp"> => ({
  moveX,
  jump: false,
  jumpPressed: false,
  jumpReleased: false,
  shoot: false,
  aimX: 100,
  aimY: 0,
  dash: false,
  cardSelect: 0,
});

describe("ROUNDS Smoke Test", () => {
  test(
    "connects clients, receives snapshots, and keeps smoothing stable under latency",
    async () => {
      const httpServer = createHttpServer();
      const ioServer = new SocketIoServer(httpServer, { parser: superjsonParser });

      const initialWorld = createRoundsWorld(DEFAULT_LEVEL);
      const netcodeServer = createNetcodeServer<RoundsWorld, RoundsInput>({
        io: ioServer,
        initialWorld,
        simulate: simulateRounds,
        addPlayer: addPlayerToWorld,
        removePlayer: removePlayerFromWorld,
        tickRate: 60,
        snapshotHistorySize: 180,
        mergeInputs: mergeRoundsInputs,
        createIdleInput,
      });

      netcodeServer.start();

      await new Promise<void>((resolve) => httpServer.listen(0, resolve));
      const port = (httpServer.address() as AddressInfo).port;
      const url = `http://localhost:${port}`;

      const socketA = createSocketClient(url, { parser: superjsonParser, transports: ["websocket"] });
      const socketB = createSocketClient(url, { parser: superjsonParser, transports: ["websocket"] });

      const clientA = createClient<RoundsWorld, RoundsInput>({
        socket: socketA,
        predictionScope: roundsPredictionScope,
        simulatedLatency: 60, // ~120ms RTT total
        onWorldUpdate: () => {},
      });

      const clientB = createClient<RoundsWorld, RoundsInput>({
        socket: socketB,
        predictionScope: roundsPredictionScope,
        simulatedLatency: 60,
        onWorldUpdate: () => {},
      });

      try {
        await waitFor(() => clientA.getPlayerId() !== null && clientB.getPlayerId() !== null);

        // Force start once both players connected
        if (netcodeServer.getClientCount() >= 2) {
          const startedWorld = forceStartGame(netcodeServer.getWorldState(), 2);
          netcodeServer.setWorld(startedWorld);
        }

        // Wait for snapshots to arrive
        await waitFor(() => clientA.getLastServerSnapshot() !== null && clientB.getLastServerSnapshot() !== null);

        // Send a small burst of inputs from client A to create movement
        for (let i = 0; i < 20; i++) {
          clientA.sendInput(createInput(1));
          clientB.sendInput(createInput(0));
          await new Promise((resolve) => setTimeout(resolve, 10));
        }

        // Wait for remote smoothing to include the other player
        await waitFor(() => {
          const debug = clientB.getSmoothingDebug?.();
          return (debug?.remotePlayers.length ?? 0) > 0;
        });

        const debug = clientB.getSmoothingDebug?.();
        expect(debug).toBeDefined();
        const remotePlayers = debug?.remotePlayers ?? [];
        expect(remotePlayers.length).toBeGreaterThan(0);

        // Ensure remote smoothing queue doesn't blow past expected bounds
        for (const remote of remotePlayers) {
          const maxExpected = remote.interpolation + 3; // TickSmoother default maxOverBuffer
          expect(remote.queueLength).toBeLessThanOrEqual(maxExpected);
        }

        // Render stability: no large teleports for local player
        const teleportThreshold = 200;
        let lastPos: { x: number; y: number } | null = null;
        for (let i = 0; i < 10; i++) {
          const world = clientA.getStateForRendering();
          const playerId = clientA.getPlayerId();
          const player = world?.players?.get(playerId ?? "");
          if (player?.position) {
            if (lastPos) {
              const dx = player.position.x - lastPos.x;
              const dy = player.position.y - lastPos.y;
              const dist = Math.hypot(dx, dy);
              expect(dist).toBeLessThanOrEqual(teleportThreshold);
            }
            lastPos = { x: player.position.x, y: player.position.y };
          }
          await new Promise((resolve) => setTimeout(resolve, DEFAULT_TICK_INTERVAL_MS));
        }

        // Render stability: remote player under jittery frame times
        const jitterDeltas = [5, 22, 9, 28, 14, 3, 25, 11, 19, 7, 16, 30, 8];
        let lastRemoteX: number | null = null;
        let maxRemoteStep = 0;
        let maxRemoteBacktrack = 0;

        for (let i = 0; i < jitterDeltas.length; i++) {
          clientB.sendInput(createInput(1));
          await new Promise((resolve) => setTimeout(resolve, jitterDeltas[i]!));

          const world = clientA.getStateForRendering();
          const localId = clientA.getPlayerId();
          const remotePlayer = world
            ? Array.from(world.players.values()).find((p) => p.id !== localId)
            : null;

          expect(remotePlayer).toBeDefined();
          if (remotePlayer?.position) {
            if (lastRemoteX !== null) {
              const step = Math.abs(remotePlayer.position.x - lastRemoteX);
              const backtrack = lastRemoteX - remotePlayer.position.x;
              if (step > maxRemoteStep) maxRemoteStep = step;
              if (backtrack > maxRemoteBacktrack) maxRemoteBacktrack = backtrack;
            }
            lastRemoteX = remotePlayer.position.x;
          }
        }

        expect(maxRemoteStep).toBeLessThanOrEqual(200);
        expect(maxRemoteBacktrack).toBeLessThanOrEqual(0.5);
      } finally {
        clientA.destroy();
        clientB.destroy();
        socketA.disconnect();
        socketB.disconnect();
        netcodeServer.stop();
        ioServer.close();
        httpServer.close();
      }
    },
    { timeout: 20000 },
  );
});
