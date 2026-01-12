import type { PlatformerPlayer, PlatformerWorld, Platform, GameState, Projectile } from "@game/netcode";
import { DEFAULT_FLOOR_Y, isPlayerAlive, PROJECTILE_RADIUS } from "@game/netcode";

/** Safely get an element from an array, throwing if out of bounds */
function getAt<T>(array: T[], index: number): T {
  if (index < 0 || index >= array.length) {
    throw new Error(`Index ${index} out of bounds for array with length ${array.length}`);
  }
  const value = array[index];
  if (value === undefined) {
    throw new Error(`Unexpected undefined at index ${index}`);
  }
  return value;
}

/** Position history entry for debug visualization */
export interface PositionHistoryEntry {
  x: number;
  y: number;
  timestamp: number;
}

/** Debug data for visualization */
export interface DebugData {
  localPredictedHistory: PositionHistoryEntry[];
  localServerHistory: PositionHistoryEntry[];
  otherPlayersHistory: Map<string, PositionHistoryEntry[]>;
  otherPlayersServerHistory: Map<string, PositionHistoryEntry[]>;
}

/** Kill feed entry */
export interface KillFeedEntry {
  killerId: string;
  victimId: string;
  timestamp: number;
}

/** Render options including debug visualization */
export interface RenderOptions {
  debugData: DebugData | null;
  serverSnapshot: PlatformerWorld | null;
  showTrails: boolean;
  showServerPositions: boolean;
  killFeed?: KillFeedEntry[];
}

/**
 * Simple 2D canvas renderer for the game
 */
export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D rendering context");
    }
    this.ctx = ctx;

    // Set canvas size
    this.width = 800;
    this.height = 600;
    canvas.width = this.width;
    canvas.height = this.height;

    // Set up coordinate system (origin at center)
    this.ctx.translate(this.width / 2, this.height / 2);
  }

  /**
   * Clear the canvas
   */
  clear(): void {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.restore();
  }

  /**
   * Draw a player
   */
  drawPlayer(player: PlatformerPlayer, isLocal: boolean = false): void {
    this.ctx.save();

    const isDead = !isPlayerAlive(player);
    const isRespawning = player.respawnTimer !== null;

    // Determine player color based on state
    if (isDead || isRespawning) {
      // Dead/respawning: gray with transparency
      this.ctx.globalAlpha = 0.4;
      this.ctx.fillStyle = "#6b7280";
      this.ctx.strokeStyle = "#4b5563";
    } else if (isLocal) {
      // Local player: green
      this.ctx.fillStyle = "#10b981";
      this.ctx.strokeStyle = "#059669";
    } else {
      // Other players: blue
      this.ctx.fillStyle = "#3b82f6";
      this.ctx.strokeStyle = "#2563eb";
    }
    this.ctx.lineWidth = 2;

    // Draw player as a square
    const size = 20;
    this.ctx.fillRect(player.position.x - size / 2, player.position.y - size / 2, size, size);
    this.ctx.strokeRect(player.position.x - size / 2, player.position.y - size / 2, size, size);

    this.ctx.globalAlpha = 1;

    // Draw player ID above
    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = "10px monospace";
    this.ctx.textAlign = "center";
    this.ctx.fillText(
      player.id.substring(0, 8),
      player.position.x,
      player.position.y - size / 2 - 5,
    );

    // Draw health bar if player is alive
    if (!isDead && !isRespawning) {
      this.drawHealthBar(player);
    }

    // Draw respawn timer if respawning
    if (isRespawning && player.respawnTimer !== null) {
      this.ctx.fillStyle = "#fbbf24";
      this.ctx.font = "12px monospace";
      this.ctx.fillText(
        `${Math.ceil(player.respawnTimer / 20)}s`,
        player.position.x,
        player.position.y + size / 2 + 15,
      );
    }

    this.ctx.restore();
  }

  /**
   * Draw a health bar above a player
   */
  drawHealthBar(player: PlatformerPlayer): void {
    const barWidth = 30;
    const barHeight = 4;
    // Position health bar above the player ID text (which is at y - 15)
    const barY = player.position.y - 28;

    // Background (dark)
    this.ctx.fillStyle = "#1f2937";
    this.ctx.fillRect(player.position.x - barWidth / 2, barY, barWidth, barHeight);

    // Health fill
    const healthPercent = player.health / player.maxHealth;
    const healthWidth = barWidth * healthPercent;

    // Color based on health percentage
    if (healthPercent > 0.6) {
      this.ctx.fillStyle = "#10b981"; // Green
    } else if (healthPercent > 0.3) {
      this.ctx.fillStyle = "#fbbf24"; // Yellow
    } else {
      this.ctx.fillStyle = "#ef4444"; // Red
    }

    this.ctx.fillRect(player.position.x - barWidth / 2, barY, healthWidth, barHeight);

    // Border
    this.ctx.strokeStyle = "#374151";
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(player.position.x - barWidth / 2, barY, barWidth, barHeight);
  }

  /**
   * Draw all players
   */
  drawPlayers(players: PlatformerPlayer[], localPlayerId: string | null): void {
    for (const player of players) {
      const isLocal = player.id === localPlayerId;
      this.drawPlayer(player, isLocal);
    }
  }

  /**
   * Draw a single projectile
   */
  drawProjectile(projectile: Projectile, isOwn: boolean = false): void {
    this.ctx.save();

    const { x, y } = projectile.position;
    const radius = PROJECTILE_RADIUS;

    // Draw projectile glow
    const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, radius * 2);
    if (isOwn) {
      gradient.addColorStop(0, "#fbbf24"); // Yellow core for own projectiles
      gradient.addColorStop(0.5, "#f59e0b");
      gradient.addColorStop(1, "transparent");
    } else {
      gradient.addColorStop(0, "#ef4444"); // Red core for enemy projectiles
      gradient.addColorStop(0.5, "#dc2626");
      gradient.addColorStop(1, "transparent");
    }
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius * 2, 0, Math.PI * 2);
    this.ctx.fill();

    // Draw projectile core
    this.ctx.fillStyle = isOwn ? "#fef3c7" : "#fecaca";
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.restore();
  }

  /**
   * Draw all projectiles
   */
  drawProjectiles(projectiles: Projectile[], localPlayerId: string | null): void {
    for (const projectile of projectiles) {
      const isOwn = projectile.ownerId === localPlayerId;
      this.drawProjectile(projectile, isOwn);
    }
  }

  /**
   * Draw grid background
   */
  drawGrid(): void {
    this.ctx.save();
    this.ctx.strokeStyle = "#334155";
    this.ctx.lineWidth = 1;

    const gridSize = 50;
    const startX = -this.width / 2;
    const startY = -this.height / 2;

    // Vertical lines
    for (let x = startX; x <= this.width / 2; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, startY);
      this.ctx.lineTo(x, this.height / 2);
      this.ctx.stroke();
    }

    // Horizontal lines
    for (let y = startY; y <= this.height / 2; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(startX, y);
      this.ctx.lineTo(this.width / 2, y);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Draw the floor/ground platform
   */
  drawFloor(): void {
    this.ctx.save();

    const floorY = DEFAULT_FLOOR_Y;
    const startX = -this.width / 2;
    const endX = this.width / 2;

    // Draw floor surface (thick line)
    this.ctx.strokeStyle = "#64748b";
    this.ctx.lineWidth = 4;
    this.ctx.beginPath();
    this.ctx.moveTo(startX, floorY);
    this.ctx.lineTo(endX, floorY);
    this.ctx.stroke();

    // Draw ground fill below floor
    this.ctx.fillStyle = "#1e293b";
    this.ctx.fillRect(startX, floorY, this.width, this.height / 2 - floorY);

    // Draw grass/ground pattern on top
    this.ctx.fillStyle = "#475569";
    const grassHeight = 6;
    this.ctx.fillRect(startX, floorY, this.width, grassHeight);

    // Draw some ground texture lines
    this.ctx.strokeStyle = "#334155";
    this.ctx.lineWidth = 1;
    for (let y = floorY + 20; y < this.height / 2; y += 30) {
      this.ctx.beginPath();
      this.ctx.moveTo(startX, y);
      this.ctx.lineTo(endX, y);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Draw a breadcrumb trail
   */
  drawTrail(history: PositionHistoryEntry[], color: string, alpha: number = 0.6): void {
    if (history.length < 2) return;

    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2;
    this.ctx.globalAlpha = alpha;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";

    // Draw line connecting all points
    const first = getAt(history, 0);
    this.ctx.beginPath();
    this.ctx.moveTo(first.x, first.y);
    for (let i = 1; i < history.length; i++) {
      const point = getAt(history, i);
      this.ctx.lineTo(point.x, point.y);
    }
    this.ctx.stroke();

    // Draw dots at each position with fading opacity
    for (let i = 0; i < history.length; i++) {
      const point = getAt(history, i);
      const pointAlpha = (i / history.length) * alpha; // Fade from old to new
      this.ctx.globalAlpha = pointAlpha;
      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  /**
   * Draw a ghost player (server position)
   */
  drawGhostPlayer(player: PlatformerPlayer, color: string): void {
    this.ctx.save();
    this.ctx.globalAlpha = 0.4;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([4, 4]);

    const size = 20;
    this.ctx.strokeRect(player.position.x - size / 2, player.position.y - size / 2, size, size);

    this.ctx.restore();
  }

  /**
   * Draw debug visualization
   */
  drawDebug(
    debugData: DebugData,
    serverSnapshot: PlatformerWorld | null,
    localPlayerId: string | null,
    showTrails: boolean,
    showServerPositions: boolean,
  ): void {
    if (showTrails) {
      // Local player predicted trail (bright green)
      if (debugData.localPredictedHistory.length > 0) {
        this.drawTrail(debugData.localPredictedHistory, "#10b981", 0.7);
      }

      // Local player server trail (red/orange - shows lag)
      if (debugData.localServerHistory.length > 0) {
        this.drawTrail(debugData.localServerHistory, "#f97316", 0.5);
      }

      // Other players interpolated trails (blue)
      for (const [_playerId, history] of debugData.otherPlayersHistory) {
        this.drawTrail(history, "#3b82f6", 0.6);
      }

      // Other players server trails (purple - raw server data)
      for (const [_playerId, history] of debugData.otherPlayersServerHistory) {
        this.drawTrail(history, "#a855f7", 0.4);
      }
    }

    if (showServerPositions && serverSnapshot) {
      // Draw ghost players at server positions
      for (const [playerId, player] of serverSnapshot.players) {
        if (playerId === localPlayerId) {
          // Local player server position (orange ghost)
          this.drawGhostPlayer(player, "#f97316");
        } else {
          // Other players server position (purple ghost)
          this.drawGhostPlayer(player, "#a855f7");
        }
      }
    }
  }

  /**
   * Render a frame
   */
  render(players: PlatformerPlayer[], localPlayerId: string | null, options?: RenderOptions): void {
    this.clear();
    this.drawGrid();
    this.drawFloor();

    // Draw debug visualization first (behind players)
    if (options?.debugData && (options.showTrails || options.showServerPositions)) {
      this.drawDebug(
        options.debugData,
        options.serverSnapshot,
        localPlayerId,
        options.showTrails,
        options.showServerPositions,
      );
    }

    this.drawPlayers(players, localPlayerId);

    // Draw legend if debug mode is active
    if (options?.showTrails || options?.showServerPositions) {
      this.drawDebugLegend(options.showTrails, options.showServerPositions);
    }
  }

  /**
   * Draw debug legend
   */
  drawDebugLegend(showTrails: boolean, showServerPositions: boolean): void {
    this.ctx.save();

    // Position in top-left (accounting for centered coordinate system)
    const startX = -this.width / 2 + 10;
    const startY = -this.height / 2 + 20;

    this.ctx.font = "11px monospace";
    this.ctx.textAlign = "left";

    let y = startY;
    const lineHeight = 16;

    if (showTrails) {
      // Green - predicted
      this.ctx.fillStyle = "#10b981";
      this.ctx.fillRect(startX, y - 8, 12, 12);
      this.ctx.fillStyle = "#ffffff";
      this.ctx.fillText("Predicted (local)", startX + 18, y);
      y += lineHeight;

      // Orange - server confirmed
      this.ctx.fillStyle = "#f97316";
      this.ctx.fillRect(startX, y - 8, 12, 12);
      this.ctx.fillStyle = "#ffffff";
      this.ctx.fillText("Server (local)", startX + 18, y);
      y += lineHeight;

      // Blue - interpolated
      this.ctx.fillStyle = "#3b82f6";
      this.ctx.fillRect(startX, y - 8, 12, 12);
      this.ctx.fillStyle = "#ffffff";
      this.ctx.fillText("Interpolated (others)", startX + 18, y);
      y += lineHeight;

      // Purple - raw server
      this.ctx.fillStyle = "#a855f7";
      this.ctx.fillRect(startX, y - 8, 12, 12);
      this.ctx.fillStyle = "#ffffff";
      this.ctx.fillText("Raw server (others)", startX + 18, y);
      y += lineHeight;
    }

    if (showServerPositions) {
      // Dashed box legend
      this.ctx.strokeStyle = "#f97316";
      this.ctx.setLineDash([2, 2]);
      this.ctx.strokeRect(startX, y - 8, 12, 12);
      this.ctx.setLineDash([]);
      this.ctx.fillStyle = "#ffffff";
      this.ctx.fillText("Server ghost", startX + 18, y);
    }

    this.ctx.restore();
  }

  /**
   * Draw game state overlay (lobby, countdown, gameover)
   */
  drawGameStateOverlay(
    gameState: GameState,
    countdownTicks: number | null,
    winner: string | null,
  ): void {
    this.ctx.save();

    // Semi-transparent overlay for non-playing states
    if (gameState !== "playing") {
      this.ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      this.ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
    }

    this.ctx.textAlign = "center";

    switch (gameState) {
      case "lobby":
        this.drawLobbyOverlay();
        break;
      case "countdown":
        this.drawCountdownOverlay(countdownTicks);
        break;
      case "gameover":
        this.drawGameOverOverlay(winner);
        break;
    }

    this.ctx.restore();
  }

  /**
   * Draw lobby waiting screen
   */
  private drawLobbyOverlay(): void {
    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = "bold 32px monospace";
    this.ctx.fillText("WAITING FOR PLAYERS", 0, -20);

    this.ctx.font = "16px monospace";
    this.ctx.fillStyle = "#94a3b8";
    this.ctx.fillText("Game will start when enough players join", 0, 20);
  }

  /**
   * Draw countdown overlay
   */
  private drawCountdownOverlay(countdownTicks: number | null): void {
    const seconds = countdownTicks !== null ? Math.ceil(countdownTicks / 20) : 0;

    this.ctx.fillStyle = "#fbbf24";
    this.ctx.font = "bold 72px monospace";
    this.ctx.fillText(seconds.toString(), 0, 20);

    this.ctx.font = "18px monospace";
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillText("GET READY!", 0, 60);
  }

  /**
   * Draw game over overlay
   */
  private drawGameOverOverlay(winner: string | null): void {
    this.ctx.fillStyle = "#ef4444";
    this.ctx.font = "bold 48px monospace";
    this.ctx.fillText("GAME OVER", 0, -30);

    this.ctx.font = "24px monospace";
    if (winner) {
      this.ctx.fillStyle = "#10b981";
      this.ctx.fillText(`Winner: ${winner.substring(0, 8)}`, 0, 20);
    } else {
      this.ctx.fillStyle = "#94a3b8";
      this.ctx.fillText("Draw - No Winner", 0, 20);
    }
  }

  /**
   * Draw scoreboard
   */
  drawScoreboard(players: PlatformerPlayer[]): void {
    this.ctx.save();

    // Position in top-right
    const startX = this.width / 2 - 150;
    const startY = -this.height / 2 + 20;

    // Background
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    this.ctx.fillRect(startX - 10, startY - 15, 150, 25 + players.length * 20);

    // Title
    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = "bold 12px monospace";
    this.ctx.textAlign = "left";
    this.ctx.fillText("SCOREBOARD", startX, startY);

    // Sort players by kills (descending)
    const sortedPlayers = [...players].sort((a, b) => b.kills - a.kills);

    // Draw each player
    let y = startY + 20;
    for (const player of sortedPlayers) {
      const isAlive = isPlayerAlive(player);
      this.ctx.fillStyle = isAlive ? "#ffffff" : "#6b7280";
      this.ctx.font = "11px monospace";

      const name = player.id.substring(0, 8);
      const stats = `K:${player.kills} D:${player.deaths}`;

      this.ctx.fillText(name, startX, y);
      this.ctx.textAlign = "right";
      this.ctx.fillText(stats, startX + 140, y);
      this.ctx.textAlign = "left";

      y += 18;
    }

    this.ctx.restore();
  }

  /**
   * Draw kill feed
   */
  drawKillFeed(killFeed: KillFeedEntry[]): void {
    if (killFeed.length === 0) return;

    this.ctx.save();

    // Position in top-center
    const startX = 0;
    const startY = -this.height / 2 + 30;

    // Show last 5 kills
    const recentKills = killFeed.slice(-5);
    const now = Date.now();

    let y = startY;
    for (const kill of recentKills) {
      // Fade out after 5 seconds
      const age = now - kill.timestamp;
      const alpha = Math.max(0, 1 - age / 5000);

      if (alpha <= 0) continue;

      this.ctx.globalAlpha = alpha;
      this.ctx.textAlign = "center";
      this.ctx.font = "12px monospace";

      // Killer name (green)
      const killerName = kill.killerId.substring(0, 8);
      const victimName = kill.victimId.substring(0, 8);

      this.ctx.fillStyle = "#10b981";
      this.ctx.fillText(killerName, startX - 40, y);

      this.ctx.fillStyle = "#94a3b8";
      this.ctx.fillText("killed", startX, y);

      this.ctx.fillStyle = "#ef4444";
      this.ctx.fillText(victimName, startX + 40, y);

      y += 18;
    }

    this.ctx.restore();
  }

  /**
   * Draw platforms
   */
  drawPlatforms(platforms: Platform[]): void {
    this.ctx.save();

    for (const platform of platforms) {
      // Platform surface
      this.ctx.fillStyle = "#475569";
      this.ctx.fillRect(
        platform.position.x,
        platform.position.y,
        platform.width,
        platform.height,
      );

      // Platform border
      this.ctx.strokeStyle = "#64748b";
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(
        platform.position.x,
        platform.position.y,
        platform.width,
        platform.height,
      );

      // Top edge highlight
      this.ctx.strokeStyle = "#94a3b8";
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(platform.position.x, platform.position.y);
      this.ctx.lineTo(platform.position.x + platform.width, platform.position.y);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Render a frame with full game state
   */
  renderWithGameState(
    world: PlatformerWorld,
    localPlayerId: string | null,
    options?: RenderOptions,
  ): void {
    this.clear();
    this.drawGrid();
    this.drawFloor();

    // Draw platforms
    if (world.platforms.length > 0) {
      this.drawPlatforms(world.platforms);
    }

    // Draw debug visualization first (behind players)
    if (options?.debugData && (options.showTrails || options.showServerPositions)) {
      this.drawDebug(
        options.debugData,
        options.serverSnapshot,
        localPlayerId,
        options.showTrails,
        options.showServerPositions,
      );
    }

    // Draw players
    const players = Array.from(world.players.values());
    this.drawPlayers(players, localPlayerId);

    // Draw projectiles
    this.drawProjectiles(world.projectiles, localPlayerId);

    // Draw UI elements
    this.drawScoreboard(players);

    if (options?.killFeed) {
      this.drawKillFeed(options.killFeed);
    }

    // Draw game state overlay
    this.drawGameStateOverlay(world.gameState, world.countdownTicks, world.winner);

    // Draw legend if debug mode is active
    if (options?.showTrails || options?.showServerPositions) {
      this.drawDebugLegend(options.showTrails, options.showServerPositions);
    }
  }
}
