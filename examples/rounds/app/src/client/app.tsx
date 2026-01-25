import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { GameClient } from "../game/game-client.js";
import { socket } from "./socket";
import type { Card, CardPickState, GamePhase } from "@game/example-rounds";

const queryClient = new QueryClient();

interface PlayerInfo {
  id: string;
  roundsWon: number;
  health: number;
  cards: string[];
}

interface CardOption {
  id: string;
  name: string;
  description: string;
  rarity: string;
  category: string;
}

interface GameStatusResponse {
  phase: GamePhase;
  roundNumber: number;
  playerCount: number;
  players: PlayerInfo[];
  matchWinner: string | null;
  roundWinner: string | null;
  cardPick: {
    pickingPlayerId: string;
    options: CardOption[];
    ticksRemaining: number;
    selectedIndex: number | null;
  } | null;
  tick: number;
}

interface LevelInfo {
  id: string;
  name: string;
  platformCount: number;
}

interface LevelsResponse {
  levels: LevelInfo[];
  currentLevelId: string;
}

function CardPickOverlay({ cardPick, localPlayerId }: { cardPick: GameStatusResponse["cardPick"]; localPlayerId: string | null }) {
  if (!cardPick) return null;

  const isLocalPicking = cardPick.pickingPlayerId === localPlayerId;
  const timeRemaining = Math.ceil(cardPick.ticksRemaining / 20);

  const rarityColors: Record<string, string> = {
    common: "border-gray-400 bg-gray-800",
    uncommon: "border-green-400 bg-green-900",
    rare: "border-purple-400 bg-purple-900",
  };

  const categoryIcons: Record<string, string> = {
    offense: "⚔️",
    defense: "🛡️",
    mobility: "💨",
    special: "✨",
  };

  return (
    <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-20">
      <div className="bg-slate-900 rounded-xl p-6 max-w-3xl w-full mx-4 border border-slate-700">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-white mb-2">
            {isLocalPicking ? "Choose Your Card!" : "Opponent Picking Card..."}
          </h2>
          <p className="text-slate-400">
            Time remaining: <span className="text-amber-400 font-mono">{timeRemaining}s</span>
          </p>
          {isLocalPicking && (
            <p className="text-slate-500 text-sm mt-1">Press 1, 2, or 3 to select</p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4">
          {cardPick.options.map((card, index) => (
            <div
              key={card.id}
              className={`${rarityColors[card.rarity] || "border-gray-500 bg-gray-800"} 
                border-2 rounded-lg p-4 transition-all
                ${isLocalPicking ? "hover:scale-105 cursor-pointer hover:border-white" : "opacity-70"}
                ${cardPick.selectedIndex === index ? "ring-2 ring-amber-400 scale-105" : ""}
              `}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400 uppercase">{card.rarity}</span>
                <span className="text-lg">{categoryIcons[card.category] || "📦"}</span>
              </div>
              <h3 className="text-lg font-bold text-white mb-2">{card.name}</h3>
              <p className="text-sm text-slate-300">{card.description}</p>
              <div className="mt-3 text-center">
                <span className="inline-block bg-slate-700 text-slate-300 text-xs px-2 py-1 rounded">
                  Press {index + 1}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GameHUD({ gameStatus, localPlayerId }: { gameStatus: GameStatusResponse | undefined; localPlayerId: string | null }) {
  if (!gameStatus) return null;

  const localPlayer = gameStatus.players.find(p => p.id === localPlayerId);
  const opponent = gameStatus.players.find(p => p.id !== localPlayerId);

  return (
    <div className="absolute top-4 left-4 right-4 flex justify-between items-start z-10 pointer-events-none">
      {/* Local player info */}
      <div className="bg-slate-800/90 rounded-lg p-3 backdrop-blur-sm">
        <div className="text-sm text-blue-400 font-bold mb-1">YOU</div>
        {localPlayer && (
          <>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-24 h-3 bg-slate-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${(localPlayer.health / 100) * 100}%` }}
                />
              </div>
              <span className="text-xs text-slate-300">{Math.round(localPlayer.health)}</span>
            </div>
            <div className="text-amber-400 font-bold">
              {"⭐".repeat(localPlayer.roundsWon)}
              {"☆".repeat(3 - localPlayer.roundsWon)}
            </div>
            {localPlayer.cards.length > 0 && (
              <div className="text-xs text-slate-400 mt-1">
                {localPlayer.cards.length} card{localPlayer.cards.length !== 1 ? "s" : ""}
              </div>
            )}
          </>
        )}
      </div>

      {/* Game state */}
      <div className="bg-slate-800/90 rounded-lg px-4 py-2 backdrop-blur-sm text-center">
        <div className="text-xs text-slate-400 uppercase">Round {gameStatus.roundNumber || "-"}</div>
        <div className={`text-lg font-bold ${
          gameStatus.phase === "fighting" ? "text-red-400" :
          gameStatus.phase === "countdown" ? "text-amber-400" :
          gameStatus.phase === "card_pick" ? "text-purple-400" :
          gameStatus.phase === "match_over" ? "text-green-400" :
          "text-slate-300"
        }`}>
          {gameStatus.phase === "waiting" && "Waiting..."}
          {gameStatus.phase === "countdown" && "Get Ready!"}
          {gameStatus.phase === "fighting" && "FIGHT!"}
          {gameStatus.phase === "round_end" && (gameStatus.roundWinner === localPlayerId ? "You Win!" : "You Lose!")}
          {gameStatus.phase === "card_pick" && "Card Pick"}
          {gameStatus.phase === "match_over" && (gameStatus.matchWinner === localPlayerId ? "VICTORY!" : "DEFEAT")}
        </div>
      </div>

      {/* Opponent info */}
      <div className="bg-slate-800/90 rounded-lg p-3 backdrop-blur-sm text-right">
        <div className="text-sm text-red-400 font-bold mb-1">OPPONENT</div>
        {opponent ? (
          <>
            <div className="flex items-center gap-2 mb-1 justify-end">
              <span className="text-xs text-slate-300">{Math.round(opponent.health)}</span>
              <div className="w-24 h-3 bg-slate-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-red-500 transition-all"
                  style={{ width: `${(opponent.health / 100) * 100}%` }}
                />
              </div>
            </div>
            <div className="text-amber-400 font-bold">
              {"☆".repeat(3 - opponent.roundsWon)}
              {"⭐".repeat(opponent.roundsWon)}
            </div>
            {opponent.cards.length > 0 && (
              <div className="text-xs text-slate-400 mt-1">
                {opponent.cards.length} card{opponent.cards.length !== 1 ? "s" : ""}
              </div>
            )}
          </>
        ) : (
          <div className="text-slate-500 text-sm">Waiting...</div>
        )}
      </div>
    </div>
  );
}

function App() {
  const qc = useQueryClient();
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [latency, setLatency] = useState<number | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameClientRef = useRef<GameClient | null>(null);

  const { data: gameStatus } = useQuery<GameStatusResponse>({
    queryKey: ["gameStatus"],
    queryFn: () => fetch("/api/game/status").then(r => r.json()),
    refetchInterval: 200, // Fast refresh for real-time state
  });

  const { data: levelsData } = useQuery<LevelsResponse>({
    queryKey: ["levels"],
    queryFn: () => fetch("/api/levels").then(r => r.json()),
    refetchInterval: 10000,
  });

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

  const resetGameMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/game/reset", { method: "POST" });
      if (!res.ok) throw new Error("Failed to reset");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gameStatus"] }),
  });

  useEffect(() => {
    function onConnect() { setIsConnected(true); }
    function onDisconnect() { setIsConnected(false); setLatency(null); }
    function onPong(data: { timestamp: number; received: { timestamp: number } }) {
      setLatency(Date.now() - data.received.timestamp);
    }
    function onLevelChanged() {
      gameClientRef.current?.resetForLevelChange();
      qc.invalidateQueries({ queryKey: ["levels"] });
      qc.invalidateQueries({ queryKey: ["gameStatus"] });
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("pong", onPong);
    socket.on("level_changed", onLevelChanged);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("pong", onPong);
      socket.off("level_changed", onLevelChanged);
    };
  }, [qc]);

  useEffect(() => {
    socket.connect();
    const pingInterval = setInterval(() => {
      if (socket.connected) socket.emit("ping", { timestamp: Date.now() });
    }, 2000);

    return () => {
      clearInterval(pingInterval);
      gameClientRef.current?.stop();
      gameClientRef.current = null;
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!isConnected || !canvasRef.current) {
      gameClientRef.current?.stop();
      gameClientRef.current = null;
      return;
    }

    const canvas = canvasRef.current;
    let cancelled = false;

    (async () => {
      gameClientRef.current?.stop();
      gameClientRef.current = null;
      const client = await GameClient.create(socket, canvas);
      if (cancelled) { client.stop(); return; }
      gameClientRef.current = client;
    })();

    return () => { cancelled = true; };
  }, [isConnected]);

  const localPlayerId = gameClientRef.current?.getPlayerId() ?? null;

  return (
    <div className="h-screen flex flex-col bg-slate-900 p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-100">ROUNDS</h1>
          <p className="text-sm text-slate-400">A/D to move • Space to jump • Click to shoot • 1/2/3 to pick cards</p>
        </div>
        <div className="flex gap-4">
          <div className="bg-slate-800 rounded-lg p-3">
            <h2 className="text-xs text-slate-400 uppercase">Connection</h2>
            {isConnected ? (
              <>
                <p className="text-green-500 text-sm">● Connected</p>
                <p className="text-slate-500 text-xs">
                  {latency !== null ? `${latency}ms` : "..."}
                </p>
              </>
            ) : (
              <p className="text-red-500 text-sm">● Disconnected</p>
            )}
          </div>
        </div>
      </div>

      {/* Game container */}
      <div className="flex-1 min-h-0 relative border border-slate-700 rounded-lg bg-slate-950 overflow-hidden">
        <canvas ref={canvasRef} className="w-full h-full" style={{ display: "block" }} />
        <GameHUD gameStatus={gameStatus} localPlayerId={localPlayerId} />
        {gameStatus?.cardPick && (
          <CardPickOverlay cardPick={gameStatus.cardPick} localPlayerId={localPlayerId} />
        )}
      </div>

      {/* Debug toggle */}
      <button
        onClick={() => setShowDebug(!showDebug)}
        className="fixed bottom-4 right-4 bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded text-sm"
      >
        {showDebug ? "Hide Debug" : "🔧 Debug"}
      </button>

      {/* Debug panel */}
      {showDebug && (
        <div className="fixed bottom-16 right-4 bg-slate-800 border border-slate-700 rounded-lg p-4 w-72 shadow-xl">
          <h3 className="text-sm font-bold text-slate-200 mb-3 uppercase">Debug</h3>
          <div className="space-y-3">
            {/* Level selector */}
            {levelsData && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">Level</label>
                <select
                  value={levelsData.currentLevelId}
                  onChange={(e) => changeLevelMutation.mutate(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200"
                >
                  {levelsData.levels.map((level) => (
                    <option key={level.id} value={level.id}>{level.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Reset button */}
            <button
              onClick={() => resetGameMutation.mutate()}
              disabled={resetGameMutation.isPending}
              className="w-full bg-red-600 hover:bg-red-500 text-white text-sm px-3 py-1.5 rounded"
            >
              {resetGameMutation.isPending ? "Resetting..." : "Reset Match"}
            </button>

            {/* Game state */}
            {gameStatus && (
              <div className="text-xs text-slate-400 border-t border-slate-700 pt-2">
                <p>Phase: <span className="text-slate-200">{gameStatus.phase}</span></p>
                <p>Round: <span className="text-slate-200">{gameStatus.roundNumber}</span></p>
                <p>Players: <span className="text-slate-200">{gameStatus.playerCount}</span></p>
                <p>Tick: <span className="text-slate-200">{gameStatus.tick}</span></p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}
