import type { PlatformerPlayer, PlatformerWorld } from "@game/netcode";
import { DEFAULT_FLOOR_Y } from "@game/netcode";

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

/** Render options including debug visualization */
export interface RenderOptions {
  debugData: DebugData | null;
  serverSnapshot: PlatformerWorld | null;
  showTrails: boolean;
  showServerPositions: boolean;
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

    if (isLocal) {
      // Local player: green
      this.ctx.fillStyle = "#10b981";
      this.ctx.strokeStyle = "#059669";
      this.ctx.lineWidth = 2;
    } else {
      // Other players: blue
      this.ctx.fillStyle = "#3b82f6";
      this.ctx.strokeStyle = "#2563eb";
      this.ctx.lineWidth = 2;
    }

    // Draw player as a square
    const size = 20;
    this.ctx.fillRect(player.position.x - size / 2, player.position.y - size / 2, size, size);
    this.ctx.strokeRect(player.position.x - size / 2, player.position.y - size / 2, size, size);

    // Draw player ID above
    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = "10px monospace";
    this.ctx.textAlign = "center";
    this.ctx.fillText(
      player.id.substring(0, 8),
      player.position.x,
      player.position.y - size / 2 - 5,
    );

    this.ctx.restore();
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
}
