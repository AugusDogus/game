import { serve } from "bun";
import homepage from "./client/index.html";

const startTime = Date.now();

const server = serve({
  port: 3000,

  routes: {
    // Frontend routes
    "/": homepage,

    // API routes
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
          features: ["webtransport", "realtime", "multiplayer"],
        });
      },
    },
  },

  // Development mode with HMR
  development: {
    hmr: true,
    console: true,
  },

  // Fallback for unmatched routes
  fetch(req) {
    const url = new URL(req.url);
    return new Response(`Not Found: ${url.pathname}`, { status: 404 });
  },
});

console.log(`🎮 Game WebTransport server running on ${server.url}`);
