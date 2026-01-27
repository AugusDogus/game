import { Server } from "socket.io";
import { Server as Engine } from "@socket.io/bun-engine";
import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "@game/netcode/server";
import { superjsonParser } from "@game/netcode/parser";
import {
  createRoundsWorld,
  simulateRounds,
  addPlayerToWorld,
  removePlayerFromWorld,
  mergeRoundsInputs,
  createIdleInput,
  forceStartGame,
  resetMatch,
  LEVELS,
  DEFAULT_LEVEL,
  getLevel,
  getLevelIds,
  type LevelConfig,
  type RoundsWorld,
} from "@game/example-rounds";
import homepage from "./client/index.html";

// Dev mode: enables development conveniences
const DEV_MODE = process.env.DEV_MODE === "true";

const startTime = Date.now();
const logDir = "logs";
const logFile = join(logDir, "netcode-client.log");

// Create Socket.IO server with superjson parser
const io = new Server({
  parser: superjsonParser,
  pingTimeout: 60000,
  pingInterval: 25000,
});

const engine = new Engine({
  path: "/socket.io/",
});

io.bind(engine);

// Current level state
let currentLevelId = "classic-arena";
let currentLevel: LevelConfig = getLevel(currentLevelId) ?? DEFAULT_LEVEL;

// Create initial world
const initialWorld = createRoundsWorld(currentLevel);
console.log(`📍 Loaded level: ${currentLevel.name}`);

// Create and start netcode server
// Using 60 TPS to align with client input rate (60Hz) for minimal prediction errors
const netcodeServer = createServer({
  io,
  initialWorld,
  simulate: simulateRounds,
  addPlayer: addPlayerToWorld,
  removePlayer: removePlayerFromWorld,
  tickRate: 60,
  snapshotHistorySize: 180, // 3 seconds at 60 TPS
  mergeInputs: mergeRoundsInputs,
  createIdleInput,
  onPlayerJoin: (playerId: string) => {
    console.log(`Player joined: ${playerId}`);
    if (DEV_MODE) {
      const world = netcodeServer.getWorldState();
      // Auto-start when first player joins in dev mode (allows single-player testing)
      if (world.phase === "waiting" && world.players.size >= 1) {
        const newWorld = forceStartGame(world, 1); // Allow single player in dev mode
        netcodeServer.setWorld(newWorld);
        console.log("🎮 Dev mode: Auto-started match for testing!");
      }
    }
  },
  onPlayerLeave: (playerId: string) => {
    console.log(`Player left: ${playerId}`);
  },
});

netcodeServer.start();

// Ping/pong for latency measurement
io.on("connection", (socket) => {
  socket.on("ping", (data) => {
    socket.emit("pong", { timestamp: Date.now(), received: data });
  });
});

const { websocket } = engine.handler();

const server = Bun.serve({
  port: 3000,
  idleTimeout: 120,

  routes: {
    "/": homepage,

    "/api/health": {
      GET() {
        return Response.json({
          status: "ok",
          timestamp: new Date().toISOString(),
          uptime: Date.now() - startTime,
        });
      },
    },

    "/api/logs": {
      async POST(req) {
        try {
          const body = await req.json();
          const logs = Array.isArray(body?.logs) ? body.logs : [body];
          await mkdir(logDir, { recursive: true });
          const lines = logs.map((entry) => `${new Date().toISOString()} ${JSON.stringify(entry)}\n`).join("");
          await appendFile(logFile, lines);
          for (const entry of logs) {
            console.log("[ClientLog]", entry);
          }
          return Response.json({ ok: true, received: logs.length });
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }
      },
      OPTIONS() {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-headers": "content-type",
          },
        });
      },
    },

    "/api/info": {
      GET() {
        return Response.json({
          name: "ROUNDS Game Server",
          version: "1.0.0",
          features: ["websocket", "rounds", "cards", "1v1"],
        });
      },
    },

    "/api/levels": {
      GET() {
        const levels = getLevelIds().map((id: string) => {
          const level = getLevel(id);
          return {
            id,
            name: level?.name ?? id,
            platformCount: level?.platforms.length ?? 0,
          };
        });
        return Response.json({
          levels,
          currentLevelId,
        });
      },
    },

    "/api/game/status": {
      GET() {
        const world = netcodeServer.getWorldState();
        const players = Array.from(world.players.values()).map((p) => ({
          id: p.id,
          roundsWon: p.roundsWon,
          health: p.health,
          cards: p.cards,
        }));

        return Response.json({
          phase: world.phase,
          roundNumber: world.roundNumber,
          playerCount: world.players.size,
          players,
          matchWinner: world.matchWinner,
          roundWinner: world.roundWinner,
          cardPick: world.cardPick
            ? {
                pickingPlayerId: world.cardPick.pickingPlayerId,
                options: world.cardPick.options.map((c: { id: string; name: string; description: string; rarity: string; category: string }) => ({
                  id: c.id,
                  name: c.name,
                  description: c.description,
                  rarity: c.rarity,
                  category: c.category,
                })),
                ticksRemaining: world.cardPick.ticksRemaining,
                selectedIndex: world.cardPick.selectedIndex,
              }
            : null,
          tick: netcodeServer.getTick(),
        });
      },
    },

    "/api/game/force-start": {
      POST() {
        const world = netcodeServer.getWorldState();
        if (world.phase !== "waiting") {
          return Response.json(
            { error: "Game is not in waiting phase", phase: world.phase },
            { status: 400 },
          );
        }

        if (world.players.size < 2) {
          return Response.json(
            { error: "Need at least 2 players to start" },
            { status: 400 },
          );
        }

        const newWorld = forceStartGame(world);
        netcodeServer.setWorld(newWorld);
        console.log("🎮 Force started match!");

        return Response.json({
          success: true,
          phase: newWorld.phase,
        });
      },
    },

    "/api/game/reset": {
      POST() {
        const world = netcodeServer.getWorldState();
        const newWorld = resetMatch(world);
        netcodeServer.setWorld(newWorld);
        console.log("🔄 Match reset");

        return Response.json({
          success: true,
          phase: "waiting",
        });
      },
    },
  },

  async fetch(req, server) {
    const url = new URL(req.url);

    // Handle level change
    if (url.pathname.startsWith("/api/levels/") && req.method === "POST") {
      const levelId = url.pathname.split("/").pop();
      if (!levelId) {
        return Response.json({ error: "Invalid level ID" }, { status: 400 });
      }

      const level = getLevel(levelId);
      if (!level) {
        return Response.json(
          { error: `Level not found: ${levelId}`, available: getLevelIds() },
          { status: 404 },
        );
      }

      currentLevelId = levelId;
      currentLevel = level;

      // Reset the game with new level
      const newWorld = createRoundsWorld(level);
      netcodeServer.setWorld(newWorld);

      console.log(`📍 Switched to level: ${level.name}`);

      io.emit("level_changed", { id: levelId, name: level.name });

      return Response.json({
        success: true,
        level: { id: levelId, name: level.name },
      });
    }

    // Handle Socket.IO
    if (url.pathname.startsWith("/socket.io/")) {
      return engine.handleRequest(req, server);
    }

    return new Response(`Not Found: ${url.pathname}`, { status: 404 });
  },

  websocket,

  development: {
    hmr: true,
    console: true,
  },
});

console.log(`🎮 ROUNDS server running on ${server.url}`);
console.log(`🔌 Socket.IO ready for connections`);
