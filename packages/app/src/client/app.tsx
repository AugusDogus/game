import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { socket } from "./socket";
import { GameClient } from "../game/game-client.js";

const queryClient = new QueryClient();

function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [latency, setLatency] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameClientRef = useRef<GameClient | null>(null);

  const { data: healthData, isError } = useQuery({
    queryKey: ["health"],
    queryFn: () => fetch("/api/health").then((r) => r.json()),
    refetchInterval: 5000,
  });

  useEffect(() => {
    function onConnect() {
      setIsConnected(true);
    }

    function onDisconnect() {
      setIsConnected(false);
      setLatency(null);
    }

    function onPong(data: { timestamp: number; received: { timestamp: number } }) {
      setLatency(data.timestamp - data.received.timestamp);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("pong", onPong);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("pong", onPong);
    };
  }, []);

  // Connection management
  useEffect(() => {
    socket.connect();

    const pingInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit("ping", { timestamp: Date.now() });
      }
    }, 2000);

    return () => {
      clearInterval(pingInterval);
      if (gameClientRef.current) {
        gameClientRef.current.stop();
        gameClientRef.current = null;
      }
      socket.disconnect();
    };
  }, []);

  // Initialize game when socket connects and canvas is ready
  useEffect(() => {
    if (isConnected && canvasRef.current && !gameClientRef.current) {
      gameClientRef.current = new GameClient(socket, canvasRef.current);
    }
  }, [isConnected]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900">
      <div className="mb-4 text-center space-y-2">
        <h1 className="text-2xl font-bold text-slate-100">Game WebTransport</h1>
        <p className="text-sm text-slate-400">Use WASD or Arrow Keys to move</p>
      </div>

      <div className="mb-4 flex gap-4">
        <div className="bg-slate-800 rounded-lg p-4 space-y-2">
          <h2 className="text-sm text-slate-400 uppercase tracking-wide">HTTP Status</h2>
          {healthData && !isError ? (
            <>
              <p className="text-green-500">● Connected</p>
              <p className="text-slate-400 text-sm">
                Uptime: {Math.floor(healthData.uptime / 1000)}s
              </p>
            </>
          ) : (
            <p className="text-red-500">● Disconnected</p>
          )}
        </div>

        <div className="bg-slate-800 rounded-lg p-4 space-y-2">
          <h2 className="text-sm text-slate-400 uppercase tracking-wide">Socket.IO</h2>
          {isConnected ? (
            <>
              <p className="text-green-500">● Connected</p>
              <p className="text-slate-400 text-sm">
                {latency !== null ? `Latency: ${latency}ms` : "Measuring..."}
              </p>
              <p className="text-slate-500 text-xs">ID: {socket.id}</p>
            </>
          ) : (
            <p className="text-red-500">● Disconnected</p>
          )}
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className="border border-slate-700 rounded-lg bg-slate-950"
        style={{ display: "block" }}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
