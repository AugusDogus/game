import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { GameClient } from "../game/game-client.js";
import { socket } from "./socket";
import { initPlatformerPhysics } from "@game/example-platformer";

const queryClient = new QueryClient();

interface LevelInfo {
  id: string;
  name: string;
  description: string;
  platformCount: number;
  hazardCount: number;
  spawnPointCount: number;
}

interface LevelsResponse {
  levels: LevelInfo[];
  currentLevelId: string;
}

interface GameStatusResponse {
  gameState: "lobby" | "countdown" | "playing" | "gameover";
  playerCount: number;
  winner: string | null;
  tick: number;
}

function App() {
  const qc = useQueryClient();
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [latency, setLatency] = useState<number | null>(null);
  const [simulatedLatency, setSimulatedLatency] = useState(0);
  const [showDebug, setShowDebug] = useState(false);
  const [showTrails, setShowTrails] = useState(false);
  const [showServerPositions, setShowServerPositions] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameClientRef = useRef<GameClient | null>(null);

  // Fetch available levels
  const { data: levelsData } = useQuery<LevelsResponse>({
    queryKey: ["levels"],
    queryFn: () => fetch("/api/levels").then((r) => r.json()),
    refetchInterval: 10000, // Refresh periodically
  });

  // Mutation to change level
  const changeLevelMutation = useMutation({
    mutationFn: async (levelId: string) => {
      const res = await fetch(`/api/levels/${levelId}`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to change level");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["levels"] });
      qc.invalidateQueries({ queryKey: ["gameStatus"] });
    },
  });

  // Fetch game status
  const { data: gameStatus } = useQuery<GameStatusResponse>({
    queryKey: ["gameStatus"],
    queryFn: () => fetch("/api/game/status").then((r) => r.json()),
    refetchInterval: 1000, // Refresh every second
  });

  // Mutation to force start game
  const forceStartMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/game/force-start", { method: "POST" });
      if (!res.ok) throw new Error("Failed to force start");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gameStatus"] });
    },
  });

  // Mutation to reset game
  const resetGameMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/game/reset", { method: "POST" });
      if (!res.ok) throw new Error("Failed to reset game");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gameStatus"] });
    },
  });

  const handleSimulatedLatencyChange = useCallback((value: number) => {
    setSimulatedLatency(value);
    if (gameClientRef.current) {
      gameClientRef.current.setSimulatedLatency(value);
    }
  }, []);

  const handleShowTrailsChange = useCallback((value: boolean) => {
    setShowTrails(value);
    if (gameClientRef.current) {
      gameClientRef.current.setDebugOptions({ showTrails: value });
    }
  }, []);

  const handleShowServerPositionsChange = useCallback((value: boolean) => {
    setShowServerPositions(value);
    if (gameClientRef.current) {
      gameClientRef.current.setDebugOptions({ showServerPositions: value });
    }
  }, []);

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
      // Calculate round-trip time (RTT): current time - time when we sent the ping
      const rtt = Date.now() - data.received.timestamp;
      setLatency(rtt);
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

  // Connection and game client lifecycle management
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

  // Create/destroy GameClient when connection state changes
  useEffect(() => {
    if (!isConnected || !canvasRef.current) {
      // Stop game client when disconnected
      if (gameClientRef.current) {
        gameClientRef.current.stop();
        gameClientRef.current = null;
      }
      return;
    }

    // Create fresh GameClient on connect
    if (gameClientRef.current) {
      gameClientRef.current.stop();
    }
    gameClientRef.current = new GameClient(socket, canvasRef.current);
  }, [isConnected]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900">
      <div className="mb-4 text-center space-y-2">
        <h1 className="text-2xl font-bold text-slate-100">Game WebTransport</h1>
        <p className="text-sm text-slate-400">A/D or Arrow Keys to move • Space/W/Up to jump</p>
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

      {/* Debug toggle button */}
      <button
        onClick={() => setShowDebug(!showDebug)}
        className="fixed bottom-4 right-4 bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded text-sm font-mono"
      >
        {showDebug ? "Hide Debug" : "🔧 Debug"}
      </button>

      {/* Debug panel */}
      {showDebug && (
        <div className="fixed bottom-16 right-4 bg-slate-800 border border-slate-700 rounded-lg p-4 w-72 shadow-xl">
          <h3 className="text-sm font-bold text-slate-200 mb-3 uppercase tracking-wide">
            Debug Panel
          </h3>

          <div className="space-y-3">
            <div>
              <label className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Simulated Latency</span>
                <span className="font-mono text-amber-400">{simulatedLatency}ms</span>
              </label>
              <input
                type="range"
                min="0"
                max="500"
                step="10"
                value={simulatedLatency}
                onChange={(e) => handleSimulatedLatencyChange(Number(e.target.value))}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <div className="flex justify-between text-xs text-slate-500 mt-1">
                <span>0ms</span>
                <span>250ms</span>
                <span>500ms</span>
              </div>
            </div>

            {/* Game controls */}
            {gameStatus && (
              <div className="border-t border-slate-700 pt-3">
                <label className="block text-xs text-slate-400 mb-2">Game Controls</label>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-slate-300">State:</span>
                  <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                    gameStatus.gameState === "lobby" ? "bg-slate-600 text-slate-300" :
                    gameStatus.gameState === "countdown" ? "bg-amber-600 text-amber-100" :
                    gameStatus.gameState === "playing" ? "bg-emerald-600 text-emerald-100" :
                    "bg-red-600 text-red-100"
                  }`}>
                    {gameStatus.gameState}
                  </span>
                  <span className="text-xs text-slate-500">
                    ({gameStatus.playerCount} player{gameStatus.playerCount !== 1 ? "s" : ""})
                  </span>
                </div>
                <div className="flex gap-2">
                  {(gameStatus.gameState === "lobby" || gameStatus.gameState === "countdown") && (
                    <button
                      onClick={() => forceStartMutation.mutate()}
                      disabled={forceStartMutation.isPending}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white text-xs px-2 py-1.5 rounded font-medium"
                    >
                      {forceStartMutation.isPending ? "Starting..." : "Force Start"}
                    </button>
                  )}
                  <button
                    onClick={() => resetGameMutation.mutate()}
                    disabled={resetGameMutation.isPending}
                    className="flex-1 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 text-white text-xs px-2 py-1.5 rounded font-medium"
                  >
                    {resetGameMutation.isPending ? "Resetting..." : "Reset Game"}
                  </button>
                </div>
              </div>
            )}

            {/* Level selector */}
            {levelsData && (
              <div className="border-t border-slate-700 pt-3">
                <label className="block text-xs text-slate-400 mb-2">Level</label>
                <select
                  value={levelsData.currentLevelId}
                  onChange={(e) => changeLevelMutation.mutate(e.target.value)}
                  disabled={changeLevelMutation.isPending}
                  className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {levelsData.levels.map((level) => (
                    <option key={level.id} value={level.id}>
                      {level.name}
                    </option>
                  ))}
                </select>
                {levelsData.levels.find(l => l.id === levelsData.currentLevelId)?.description && (
                  <p className="text-xs text-slate-500 mt-1">
                    {levelsData.levels.find(l => l.id === levelsData.currentLevelId)?.description}
                  </p>
                )}
                {changeLevelMutation.isPending && (
                  <p className="text-xs text-amber-400 mt-1">Changing level...</p>
                )}
              </div>
            )}

            {/* Visualization toggles */}
            <div className="border-t border-slate-700 pt-3 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showTrails}
                  onChange={(e) => handleShowTrailsChange(e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-800"
                />
                <span className="text-xs text-slate-300">Show position trails</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showServerPositions}
                  onChange={(e) => handleShowServerPositionsChange(e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-800"
                />
                <span className="text-xs text-slate-300">Show server ghosts</span>
              </label>
            </div>

            <div className="text-xs text-slate-500 border-t border-slate-700 pt-3">
              <p className="mb-1">
                <span className="text-slate-400">Real Ping:</span>{" "}
                <span className="font-mono">{latency !== null ? `${latency}ms` : "—"}</span>
              </p>
              <p>
                <span className="text-slate-400">Total RTT:</span>{" "}
                <span className="font-mono text-amber-400">
                  {latency !== null ? `~${latency + simulatedLatency * 2}ms` : "—"}
                </span>
              </p>
              <p className="mt-2 text-slate-600 italic">
                Simulated latency adds delay to both incoming and outgoing messages.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Initialize physics before rendering (required for client-side prediction)
const rootElement = document.getElementById("root");
if (rootElement) {
  initPlatformerPhysics().then(() => {
    createRoot(rootElement).render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );
  });
}
