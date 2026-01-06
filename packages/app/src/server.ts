import { Server } from "socket.io";
import { Server as Engine } from "@socket.io/bun-engine";
import { NetcodeServer } from "@game/netcode";
import homepage from "./client/index.html";

const startTime = Date.now();

// Create Socket.IO server and Bun engine
// TODO: Add "webtransport" once Bun supports HTTP/3 (https://github.com/oven-sh/bun/issues/13656)
const io = new Server();
const engine = new Engine({
  path: "/socket.io/",
});

io.bind(engine);

// Create and start netcode server
const netcodeServer = new NetcodeServer(io, {
  tickRate: 20,
  snapshotHistorySize: 60,
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
  idleTimeout: 30,

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
  },

  fetch(req, server) {
    const url = new URL(req.url);

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
