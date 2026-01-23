import { Server } from "socket.io";
import { Server as Engine } from "@socket.io/bun-engine";
import {
  createNetcodeServer,
  createPlatformerWorld,
  simulatePlatformer,
  addPlayerToWorld,
  removePlayerFromWorld,
  mergePlatformerInputs,
  createIdleInput,
  superjsonParser,
  setLevelConfig,
  forceStartGame,
  resetGame,
  // Level system
  LEVELS,
  getLevelIds,
  getLevel,
  DEFAULT_MATCH_CONFIG,
  type LevelConfig,
  type PlatformerWorld,
} from "@game/netcode";
import homepage from "./client/index.html";

const startTime = Date.now();

// Create Socket.IO server and Bun engine with superjson parser for Map/Set/Date support
// TODO: Add "webtransport" once Bun supports HTTP/3 (https://github.com/oven-sh/bun/issues/13656)
const io = new Server({
  parser: superjsonParser,
  // Increase timeouts to handle background tab throttling
  // Browsers throttle timers in background tabs, which can cause missed heartbeats
  pingTimeout: 60000, // 60 seconds (default is 20s)
  pingInterval: 25000, // 25 seconds (default)
});
const engine = new Engine({
  path: "/socket.io/",
});

io.bind(engine);

// Current level state
let currentLevelId = "platforms";
let currentLevel = getLevel(currentLevelId) ?? LEVELS["platforms"]!;

/**
 * Create a fresh world with the specified level loaded
 */
function createWorldWithLevel(level: LevelConfig): PlatformerWorld {
  return setLevelConfig(
    createPlatformerWorld(DEFAULT_MATCH_CONFIG),
    level.platforms,
    level.spawnPoints,
    level.hazards,
  );
}

// Create initial world with default level
const initialWorld = createWorldWithLevel(currentLevel);
console.log(`📍 Loaded level: ${currentLevel.name}`);

// Create and start netcode server with platformer game
const netcodeServer = createNetcodeServer({
  io,
  initialWorld,
  simulate: simulatePlatformer,
  addPlayer: addPlayerToWorld,
  removePlayer: removePlayerFromWorld,
  tickRate: 20,
  snapshotHistorySize: 60,
  mergeInputs: mergePlatformerInputs,
  createIdleInput,
});
netcodeServer.start();

// Keep legacy ping/pong for latency measurement
io.on("connection", (socket) => {
  socket.on("ping", (data) => {
    socket.emit("pong", { timestamp: Date.now(), received: data });
  });
});

const { websocket } = engine.handler();

const server = Bun.serve({
  port: 3000,
  // Increase idle timeout to prevent WebSocket disconnects when tabs are in background
  // Background tabs throttle timers, which can make the connection appear idle
  idleTimeout: 120, // 120 seconds (2 minutes)

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

    "/api/info": {
      GET() {
        return Response.json({
          name: "Game WebTransport Server",
          version: "1.0.0",
          features: ["websocket", "realtime", "multiplayer"],
        });
      },
    },

    "/api/levels": {
      GET() {
        // Return all available levels with metadata
        const levels = getLevelIds().map((id) => {
          const level = getLevel(id);
          return {
            id,
            name: level?.name ?? id,
            description: level?.description ?? "",
            platformCount: level?.platforms.length ?? 0,
            hazardCount: level?.hazards.length ?? 0,
            spawnPointCount: level?.spawnPoints.length ?? 0,
          };
        });
        return Response.json({
          levels,
          currentLevelId,
        });
      },
    },

    "/api/levels/current": {
      GET() {
        return Response.json({
          id: currentLevelId,
          name: currentLevel.name,
          description: currentLevel.description,
        });
      },
    },

    "/api/game/status": {
      GET() {
        const world = netcodeServer.getWorldState();
        return Response.json({
          gameState: world.gameState,
          playerCount: world.players.size,
          winner: world.winner,
          tick: netcodeServer.getTick(),
        });
      },
    },

    "/api/game/force-start": {
      POST() {
        const world = netcodeServer.getWorldState();
        if (world.gameState !== "lobby" && world.gameState !== "countdown") {
          return Response.json(
            { error: "Game is already in progress or finished", gameState: world.gameState },
            { status: 400 },
          );
        }

        // Force start the game
        const newWorld = forceStartGame(world);
        netcodeServer.setWorld(newWorld);

        console.log("🎮 Force started game!");

        return Response.json({
          success: true,
          gameState: newWorld.gameState,
        });
      },
    },

    "/api/game/reset": {
      POST() {
        // Reset the game to lobby with current level
        const newWorld = createWorldWithLevel(currentLevel);
        netcodeServer.setWorld(newWorld);

        console.log("🔄 Game reset to lobby");

        return Response.json({
          success: true,
          gameState: "lobby",
        });
      },
    },
  },

  async fetch(req, server) {
    const url = new URL(req.url);

    // Handle level change via POST /api/levels/:levelId
    if (url.pathname.startsWith("/api/levels/") && req.method === "POST") {
      const levelId = url.pathname.split("/").pop();
      if (!levelId || levelId === "current") {
        return Response.json({ error: "Invalid level ID" }, { status: 400 });
      }

      const level = getLevel(levelId);
      if (!level) {
        return Response.json(
          { error: `Level not found: ${levelId}`, available: getLevelIds() },
          { status: 404 },
        );
      }

      // Update current level
      currentLevelId = levelId;
      currentLevel = level;

      // Reset the game world with the new level
      const newWorld = createWorldWithLevel(level);
      netcodeServer.setWorld(newWorld);

      console.log(`📍 Switched to level: ${level.name}`);

      // Notify all clients about the level change
      io.emit("level_changed", {
        id: levelId,
        name: level.name,
      });

      return Response.json({
        success: true,
        level: {
          id: levelId,
          name: level.name,
          description: level.description,
        },
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

console.log(`🎮 Game server running on ${server.url}`);
console.log(`🔌 Socket.IO ready for connections`);
