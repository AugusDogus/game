import type { PlayerState } from "@game/netcode";

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
  drawPlayer(player: PlayerState, isLocal: boolean = false): void {
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
    this.ctx.fillRect(
      player.position.x - size / 2,
      player.position.y - size / 2,
      size,
      size,
    );
    this.ctx.strokeRect(
      player.position.x - size / 2,
      player.position.y - size / 2,
      size,
      size,
    );

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
  drawPlayers(players: PlayerState[], localPlayerId: string | null): void {
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
   * Render a frame
   */
  render(players: PlayerState[], localPlayerId: string | null): void {
    this.clear();
    this.drawGrid();
    this.drawPlayers(players, localPlayerId);
  }
}
