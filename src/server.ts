import { Server } from "socket.io";
import { Server as Engine } from "@socket.io/bun-engine";
import homepage from "./client/index.html";

const startTime = Date.now();

// Create Socket.IO server and Bun engine
// TODO: Add "webtransport" once Bun supports HTTP/3 (https://github.com/oven-sh/bun/issues/13656)
const io = new Server();
const engine = new Engine({
  path: "/socket.io/",
});

io.bind(engine);

io.on("connection", (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  socket.on("ping", (data) => {
    socket.emit("pong", { timestamp: Date.now(), received: data });
  });

  socket.on("disconnect", () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
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
