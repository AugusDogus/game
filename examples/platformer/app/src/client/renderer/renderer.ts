import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import { Viewport } from "pixi-viewport";
import type { PlatformerPlayer, PlatformerWorld, Platform, GameState, Projectile } from "@game/example-platformer";
import { isPlayerAlive, PROJECTILE_RADIUS } from "@game/example-platformer";
import { DEFAULT_FLOOR_Y } from "@game/netcode";

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

/** Default world viewport size in world units */
const DEFAULT_WORLD_WIDTH = 800;
const DEFAULT_WORLD_HEIGHT = 600;

/** Colors matching the Canvas renderer */
const COLORS = {
  background: 0x0f172a, // slate-950
  grid: 0x334155, // slate-700
  floor: 0x64748b, // slate-500
  ground: 0x1e293b, // slate-800
  grass: 0x475569, // slate-600
  groundLine: 0x334155, // slate-700
  platform: 0x475569, // slate-600
  platformBorder: 0x64748b, // slate-500
  platformHighlight: 0x94a3b8, // slate-400
  hazard: 0x7f1d1d, // red-900
  hazardSpike: 0xdc2626, // red-600
  hazardBorder: 0x991b1b, // red-800
  playerLocal: 0x10b981, // emerald-500
  playerOther: 0x3b82f6, // blue-500
  playerDead: 0x6b7280, // gray-500
  projectileOwn: 0xfbbf24, // amber-400
  projectileOwnCore: 0xfef3c7, // amber-100
  projectileEnemy: 0xef4444, // red-500
  projectileEnemyCore: 0xfecaca, // red-200
  white: 0xffffff,
  textMuted: 0x94a3b8, // slate-400
  overlay: 0x000000,
  healthGreen: 0x10b981,
  healthYellow: 0xfbbf24,
  healthRed: 0xef4444,
  healthBg: 0x1f2937,
  healthBorder: 0x374151,
  trailPredicted: 0x10b981,
  trailServer: 0xf97316,
  trailInterpolated: 0x3b82f6,
  trailRawServer: 0xa855f7,
  countdown: 0xfbbf24,
  gameover: 0xef4444,
};

// Note: Y-axis is flipped at the container level (worldFlipContainer.scale.y = -1)
// so we can use world coordinates directly without manual conversion.

/**
 * WebGL renderer for the platformer game using PixiJS.
 * Provides hardware-accelerated rendering with a Camera/Viewport system.
 * 
 * Use the static `create()` method to instantiate - constructor is private
 * because initialization is async.
 */
export class Renderer {
  private app: Application;
  private viewport: Viewport;
  
  // Containers for different layers
  private worldContainer: Container;
  private playersContainer: Container;
  private projectilesContainer: Container;
  private debugContainer: Container;
  private uiContainer: Container; // Fixed to screen, not affected by viewport
  
  // Graphics objects (reused each frame)
  private gridGraphics: Graphics;
  private floorGraphics: Graphics;
  private platformsGraphics: Graphics;
  private hazardsGraphics: Graphics;
  
  // Player graphics pool
  private playerGraphics: Map<string, { body: Graphics; label: Text; health: Graphics }> = new Map();
  
  // Projectile graphics pool
  private projectileGraphics: Graphics[] = [];
  private activeProjectileCount: number = 0;
  
  // Debug graphics
  private trailGraphics: Graphics;
  private ghostGraphics: Graphics;
  
  // UI elements
  private overlayGraphics: Graphics;
  private overlayText: Text;
  private overlaySubtext: Text;
  private scoreboardContainer: Container;
  private killFeedContainer: Container;
  private debugLegendContainer: Container;
  
  // Screen dimensions
  private screenWidth: number;
  private screenHeight: number;

  /**
   * Create a new Renderer. Use this instead of calling constructor directly.
   */
  static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    const renderer = new Renderer();
    await renderer.init(canvas);
    return renderer;
  }

  private constructor() {
    this.screenWidth = DEFAULT_WORLD_WIDTH;
    this.screenHeight = DEFAULT_WORLD_HEIGHT;
    
    // Create PIXI Application
    this.app = new Application();
    
    // Create containers
    this.worldContainer = new Container();
    this.playersContainer = new Container();
    this.projectilesContainer = new Container();
    this.debugContainer = new Container();
    this.uiContainer = new Container();
    
    // Create graphics objects
    this.gridGraphics = new Graphics();
    this.floorGraphics = new Graphics();
    this.platformsGraphics = new Graphics();
    this.hazardsGraphics = new Graphics();
    this.trailGraphics = new Graphics();
    this.ghostGraphics = new Graphics();
    this.overlayGraphics = new Graphics();
    
    // Create UI text elements with default styles
    const titleStyle = new TextStyle({
      fontFamily: "monospace",
      fontSize: 32,
      fontWeight: "bold",
      fill: COLORS.white,
    });
    const subtextStyle = new TextStyle({
      fontFamily: "monospace",
      fontSize: 16,
      fill: COLORS.textMuted,
    });
    
    this.overlayText = new Text({ text: "", style: titleStyle });
    this.overlaySubtext = new Text({ text: "", style: subtextStyle });
    
    this.scoreboardContainer = new Container();
    this.killFeedContainer = new Container();
    this.debugLegendContainer = new Container();
    
    // Viewport placeholder - will be set in init()
    this.viewport = null as unknown as Viewport;
  }

  private async init(canvas: HTMLCanvasElement): Promise<void> {
    this.screenWidth = canvas.width || DEFAULT_WORLD_WIDTH;
    this.screenHeight = canvas.height || DEFAULT_WORLD_HEIGHT;
    
    // Initialize the application with existing canvas
    await this.app.init({
      canvas,
      antialias: true,
      backgroundColor: COLORS.background,
      width: this.screenWidth,
      height: this.screenHeight,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    
    // Configure viewport
    this.viewport = new Viewport({
      screenWidth: this.screenWidth,
      screenHeight: this.screenHeight,
      worldWidth: DEFAULT_WORLD_WIDTH * 2,
      worldHeight: DEFAULT_WORLD_HEIGHT * 2,
      events: this.app.renderer.events,
    });
    
    // Add viewport to stage
    this.app.stage.addChild(this.viewport);
    
    // Create a container that flips Y axis for world-space rendering
    // This makes the entire game world use Y-up coordinates (like the canvas renderer)
    const worldFlipContainer = new Container();
    worldFlipContainer.scale.y = -1; // Flip Y axis
    
    // Set up world container hierarchy within the flipped container
    this.worldContainer.addChild(this.gridGraphics);
    this.worldContainer.addChild(this.floorGraphics);
    this.worldContainer.addChild(this.platformsGraphics);
    this.worldContainer.addChild(this.hazardsGraphics);
    
    worldFlipContainer.addChild(this.worldContainer);
    worldFlipContainer.addChild(this.debugContainer);
    worldFlipContainer.addChild(this.playersContainer);
    worldFlipContainer.addChild(this.projectilesContainer);
    
    this.viewport.addChild(worldFlipContainer);
    
    // Debug container setup
    this.debugContainer.addChild(this.trailGraphics);
    this.debugContainer.addChild(this.ghostGraphics);
    
    // UI container is added to stage directly (not viewport) so it stays fixed
    this.uiContainer.addChild(this.overlayGraphics);
    this.uiContainer.addChild(this.overlayText);
    this.uiContainer.addChild(this.overlaySubtext);
    this.uiContainer.addChild(this.scoreboardContainer);
    this.uiContainer.addChild(this.killFeedContainer);
    this.uiContainer.addChild(this.debugLegendContainer);
    this.app.stage.addChild(this.uiContainer);
    
    // Center the viewport on world origin
    this.viewport.moveCenter(0, 0);
  }

  /**
   * Resize the renderer
   */
  resize(width: number, height: number): void {
    this.screenWidth = width;
    this.screenHeight = height;
    
    this.app.renderer.resize(width, height);
    this.viewport.resize(width, height);
    this.viewport.moveCenter(0, 0);
  }

  /**
   * Get the application instance (for external access if needed)
   */
  getApp(): Application {
    return this.app;
  }

  /**
   * Destroy the renderer and clean up resources
   */
  destroy(): void {
    this.app.destroy(true, { children: true, texture: true });
  }

  // ============================================================================
  // World Rendering
  // ============================================================================

  private drawGrid(): void {
    this.gridGraphics.clear();
    
    const gridSize = 50;
    const halfWidth = this.screenWidth / 2 + 100;
    const halfHeight = this.screenHeight / 2 + 100;
    
    this.gridGraphics.setStrokeStyle({ width: 1, color: COLORS.grid, alpha: 0.5 });
    
    // Vertical lines
    for (let x = -halfWidth; x <= halfWidth; x += gridSize) {
      this.gridGraphics.moveTo(x, -halfHeight);
      this.gridGraphics.lineTo(x, halfHeight);
    }
    
    // Horizontal lines
    for (let y = -halfHeight; y <= halfHeight; y += gridSize) {
      this.gridGraphics.moveTo(-halfWidth, y);
      this.gridGraphics.lineTo(halfWidth, y);
    }
    
    this.gridGraphics.stroke();
  }

  private drawFloor(): void {
    this.floorGraphics.clear();
    
    const floorY = DEFAULT_FLOOR_Y;
    const halfWidth = this.screenWidth / 2 + 100;
    const groundDepth = this.screenHeight / 2 + 100;
    
    // Ground fill below floor (Y-up: below floor means lower Y values)
    // rect(x, y, w, h) draws from (x,y) with positive width/height
    // In Y-up, we start at floorY and go down (negative direction)
    this.floorGraphics.rect(-halfWidth, floorY - groundDepth, halfWidth * 2, groundDepth);
    this.floorGraphics.fill(COLORS.ground);
    
    // Grass strip at the top of the ground
    const grassHeight = 6;
    this.floorGraphics.rect(-halfWidth, floorY - grassHeight, halfWidth * 2, grassHeight);
    this.floorGraphics.fill(COLORS.grass);
    
    // Floor surface line
    this.floorGraphics.setStrokeStyle({ width: 4, color: COLORS.floor });
    this.floorGraphics.moveTo(-halfWidth, floorY);
    this.floorGraphics.lineTo(halfWidth, floorY);
    this.floorGraphics.stroke();
    
    // Ground texture lines
    this.floorGraphics.setStrokeStyle({ width: 1, color: COLORS.groundLine });
    for (let y = floorY - 20; y > floorY - groundDepth; y -= 30) {
      this.floorGraphics.moveTo(-halfWidth, y);
      this.floorGraphics.lineTo(halfWidth, y);
    }
    this.floorGraphics.stroke();
  }

  private drawPlatforms(platforms: Platform[]): void {
    this.platformsGraphics.clear();
    
    for (const platform of platforms) {
      // Platform position is bottom-left corner in world coords
      const x = platform.position.x;
      const y = platform.position.y;
      const w = platform.width;
      const h = platform.height;
      
      // Platform fill
      this.platformsGraphics.rect(x, y, w, h);
      this.platformsGraphics.fill(COLORS.platform);
      
      // Platform border
      this.platformsGraphics.setStrokeStyle({ width: 2, color: COLORS.platformBorder });
      this.platformsGraphics.rect(x, y, w, h);
      this.platformsGraphics.stroke();
      
      // Top edge highlight (top is at y + h in Y-up coords)
      this.platformsGraphics.setStrokeStyle({ width: 2, color: COLORS.platformHighlight });
      this.platformsGraphics.moveTo(x, y + h);
      this.platformsGraphics.lineTo(x + w, y + h);
      this.platformsGraphics.stroke();
    }
  }

  private drawHazards(hazards: Array<{ position: { x: number; y: number }; width: number; height: number }>): void {
    this.hazardsGraphics.clear();
    
    for (const hazard of hazards) {
      const x = hazard.position.x;
      const y = hazard.position.y;
      const w = hazard.width;
      const h = hazard.height;
      
      // Hazard fill
      this.hazardsGraphics.rect(x, y, w, h);
      this.hazardsGraphics.fill(COLORS.hazard);
      
      // Spike pattern (spikes point up in Y-up coords)
      const spikeWidth = 10;
      const numSpikes = Math.floor(w / spikeWidth);
      for (let i = 0; i < numSpikes; i++) {
        const spikeX = x + i * spikeWidth + spikeWidth / 2;
        // Base of spike at y, tip at y + h
        this.hazardsGraphics.moveTo(spikeX - spikeWidth / 2, y);
        this.hazardsGraphics.lineTo(spikeX, y + h);
        this.hazardsGraphics.lineTo(spikeX + spikeWidth / 2, y);
        this.hazardsGraphics.closePath();
        this.hazardsGraphics.fill(COLORS.hazardSpike);
      }
      
      // Border
      this.hazardsGraphics.setStrokeStyle({ width: 1, color: COLORS.hazardBorder });
      this.hazardsGraphics.rect(x, y, w, h);
      this.hazardsGraphics.stroke();
    }
  }

  // ============================================================================
  // Entity Rendering
  // ============================================================================

  private getOrCreatePlayerGraphics(playerId: string): { body: Graphics; label: Text; health: Graphics } {
    let playerGfx = this.playerGraphics.get(playerId);
    if (!playerGfx) {
      const body = new Graphics();
      const label = new Text({
        text: playerId.substring(0, 8),
        style: new TextStyle({
          fontFamily: "monospace",
          fontSize: 10,
          fill: COLORS.white,
        }),
      });
      label.anchor.set(0.5, 0.5);
      
      const health = new Graphics();
      
      this.playersContainer.addChild(body);
      this.playersContainer.addChild(label);
      this.playersContainer.addChild(health);
      
      playerGfx = { body, label, health };
      this.playerGraphics.set(playerId, playerGfx);
    }
    return playerGfx;
  }

  private drawPlayer(player: PlatformerPlayer, isLocal: boolean): void {
    const gfx = this.getOrCreatePlayerGraphics(player.id);
    const isDead = !isPlayerAlive(player);
    const isRespawning = player.respawnTimer !== null;
    
    const size = 20;
    // Player position is center-bottom, so rect starts at x - size/2, y - size/2
    const x = player.position.x - size / 2;
    const y = player.position.y - size / 2;
    
    // Determine color
    let color = COLORS.playerOther;
    let alpha = 1;
    if (isDead || isRespawning) {
      color = COLORS.playerDead;
      alpha = 0.4;
    } else if (isLocal) {
      color = COLORS.playerLocal;
    }
    
    // Draw body
    gfx.body.clear();
    gfx.body.rect(x, y, size, size);
    gfx.body.fill({ color, alpha });
    
    // Position label above player (above means higher Y in Y-up coords)
    // But text will be upside down due to Y flip, so we need to handle that
    gfx.label.position.set(player.position.x, player.position.y + size / 2 + 15);
    gfx.label.scale.y = -1; // Flip text back right-side up
    gfx.label.visible = true;
    
    // Draw health bar if alive
    gfx.health.clear();
    if (!isDead && !isRespawning) {
      const barWidth = 30;
      const barHeight = 4;
      const barY = player.position.y + size / 2 + 22;
      const barX = player.position.x - barWidth / 2;
      
      // Background
      gfx.health.rect(barX, barY, barWidth, barHeight);
      gfx.health.fill(COLORS.healthBg);
      
      // Health fill
      const healthPercent = player.health / player.maxHealth;
      const healthWidth = barWidth * healthPercent;
      let healthColor = COLORS.healthGreen;
      if (healthPercent <= 0.3) healthColor = COLORS.healthRed;
      else if (healthPercent <= 0.6) healthColor = COLORS.healthYellow;
      
      gfx.health.rect(barX, barY, healthWidth, barHeight);
      gfx.health.fill(healthColor);
      
      // Border
      gfx.health.setStrokeStyle({ width: 1, color: COLORS.healthBorder });
      gfx.health.rect(barX, barY, barWidth, barHeight);
      gfx.health.stroke();
    }
  }

  private drawPlayers(players: PlatformerPlayer[], localPlayerId: string | null): void {
    // Track which players are visible this frame
    const visiblePlayers = new Set<string>();
    
    for (const player of players) {
      const isLocal = player.id === localPlayerId;
      this.drawPlayer(player, isLocal);
      visiblePlayers.add(player.id);
    }
    
    // Hide players that are no longer in the world
    for (const [playerId, gfx] of this.playerGraphics) {
      if (!visiblePlayers.has(playerId)) {
        gfx.body.visible = false;
        gfx.label.visible = false;
        gfx.health.visible = false;
      } else {
        gfx.body.visible = true;
        gfx.label.visible = true;
        gfx.health.visible = true;
      }
    }
  }

  private getOrCreateProjectileGraphics(index: number): Graphics {
    while (this.projectileGraphics.length <= index) {
      const gfx = new Graphics();
      this.projectilesContainer.addChild(gfx);
      this.projectileGraphics.push(gfx);
    }
    // Safe: we just pushed elements to ensure the array has enough items
    return this.projectileGraphics[index] as Graphics;
  }

  private drawProjectile(projectile: Projectile, isOwn: boolean, index: number): void {
    const gfx = this.getOrCreateProjectileGraphics(index);
    gfx.clear();
    gfx.visible = true;
    
    const x = projectile.position.x;
    const y = projectile.position.y;
    const radius = PROJECTILE_RADIUS;
    
    // Glow effect
    const glowColor = isOwn ? COLORS.projectileOwn : COLORS.projectileEnemy;
    gfx.circle(x, y, radius * 2);
    gfx.fill({ color: glowColor, alpha: 0.3 });
    
    // Core
    const coreColor = isOwn ? COLORS.projectileOwnCore : COLORS.projectileEnemyCore;
    gfx.circle(x, y, radius);
    gfx.fill(coreColor);
  }

  private drawProjectiles(projectiles: Projectile[], localPlayerId: string | null): void {
    this.activeProjectileCount = projectiles.length;
    
    for (let i = 0; i < projectiles.length; i++) {
      const projectile = projectiles[i];
      if (!projectile) continue;
      const isOwn = projectile.ownerId === localPlayerId;
      this.drawProjectile(projectile, isOwn, i);
    }
    
    // Hide unused projectile graphics
    for (let i = projectiles.length; i < this.projectileGraphics.length; i++) {
      const gfx = this.projectileGraphics[i];
      if (gfx) gfx.visible = false;
    }
  }

  // ============================================================================
  // UI Rendering
  // ============================================================================

  private drawGameStateOverlay(gameState: GameState, countdownTicks: number | null, winner: string | null): void {
    this.overlayGraphics.clear();
    this.overlayText.text = "";
    this.overlaySubtext.text = "";
    
    if (gameState === "playing") {
      this.overlayGraphics.visible = false;
      this.overlayText.visible = false;
      this.overlaySubtext.visible = false;
      return;
    }
    
    // Draw semi-transparent overlay
    this.overlayGraphics.visible = true;
    this.overlayGraphics.rect(0, 0, this.screenWidth, this.screenHeight);
    this.overlayGraphics.fill({ color: COLORS.overlay, alpha: 0.6 });
    
    this.overlayText.visible = true;
    this.overlaySubtext.visible = true;
    this.overlayText.anchor.set(0.5, 0.5);
    this.overlaySubtext.anchor.set(0.5, 0.5);
    
    const centerX = this.screenWidth / 2;
    const centerY = this.screenHeight / 2;
    
    switch (gameState) {
      case "lobby":
        this.overlayText.text = "WAITING FOR PLAYERS";
        this.overlayText.style.fill = COLORS.white;
        this.overlayText.position.set(centerX, centerY - 20);
        
        this.overlaySubtext.text = "Game will start when enough players join";
        this.overlaySubtext.position.set(centerX, centerY + 20);
        break;
        
      case "countdown":
        const seconds = countdownTicks !== null ? Math.ceil(countdownTicks / 20) : 0;
        this.overlayText.text = seconds.toString();
        this.overlayText.style.fill = COLORS.countdown;
        this.overlayText.style.fontSize = 72;
        this.overlayText.position.set(centerX, centerY);
        
        this.overlaySubtext.text = "GET READY!";
        this.overlaySubtext.position.set(centerX, centerY - 60);
        break;
        
      case "gameover":
        this.overlayText.text = "GAME OVER";
        this.overlayText.style.fill = COLORS.gameover;
        this.overlayText.style.fontSize = 48;
        this.overlayText.position.set(centerX, centerY - 20);
        
        if (winner) {
          this.overlaySubtext.text = `Winner: ${winner.substring(0, 8)}`;
          this.overlaySubtext.style.fill = COLORS.healthGreen;
        } else {
          this.overlaySubtext.text = "Draw - No Winner";
        }
        this.overlaySubtext.position.set(centerX, centerY + 30);
        break;
    }
  }

  private drawScoreboard(players: PlatformerPlayer[]): void {
    // Clear existing scoreboard
    this.scoreboardContainer.removeChildren();
    
    const startX = this.screenWidth - 150;
    const startY = 20;
    
    // Background
    const bg = new Graphics();
    const bgHeight = 25 + players.length * 20;
    bg.rect(startX - 10, startY - 5, 150, bgHeight);
    bg.fill({ color: COLORS.overlay, alpha: 0.7 });
    this.scoreboardContainer.addChild(bg);
    
    // Title
    const title = new Text({
      text: "SCOREBOARD",
      style: new TextStyle({
        fontFamily: "monospace",
        fontSize: 12,
        fontWeight: "bold",
        fill: COLORS.white,
      }),
    });
    title.position.set(startX, startY);
    this.scoreboardContainer.addChild(title);
    
    // Sort players by kills
    const sortedPlayers = [...players].sort((a, b) => b.kills - a.kills);
    
    let y = startY + 20;
    for (const player of sortedPlayers) {
      const isAlive = isPlayerAlive(player);
      const color = isAlive ? COLORS.white : COLORS.playerDead;
      
      const name = new Text({
        text: player.id.substring(0, 8),
        style: new TextStyle({
          fontFamily: "monospace",
          fontSize: 11,
          fill: color,
        }),
      });
      name.position.set(startX, y);
      this.scoreboardContainer.addChild(name);
      
      const stats = new Text({
        text: `K:${player.kills} D:${player.deaths}`,
        style: new TextStyle({
          fontFamily: "monospace",
          fontSize: 11,
          fill: color,
        }),
      });
      stats.anchor.set(1, 0);
      stats.position.set(startX + 140, y);
      this.scoreboardContainer.addChild(stats);
      
      y += 18;
    }
  }

  private drawKillFeed(killFeed: KillFeedEntry[]): void {
    this.killFeedContainer.removeChildren();
    
    if (killFeed.length === 0) return;
    
    const centerX = this.screenWidth / 2;
    const startY = 30;
    const now = Date.now();
    
    const recentKills = killFeed.slice(-5);
    let y = startY;
    
    for (const kill of recentKills) {
      const age = now - kill.timestamp;
      const alpha = Math.max(0, 1 - age / 5000);
      
      if (alpha <= 0) continue;
      
      const killerName = kill.killerId.substring(0, 8);
      const victimName = kill.victimId.substring(0, 8);
      
      const text = new Text({
        text: `${killerName} killed ${victimName}`,
        style: new TextStyle({
          fontFamily: "monospace",
          fontSize: 12,
          fill: COLORS.white,
        }),
      });
      text.anchor.set(0.5, 0);
      text.position.set(centerX, y);
      text.alpha = alpha;
      this.killFeedContainer.addChild(text);
      
      y += 18;
    }
  }

  // ============================================================================
  // Debug Visualization
  // ============================================================================

  private drawTrail(history: PositionHistoryEntry[], color: number, alpha: number): void {
    if (history.length < 2) return;
    
    this.trailGraphics.setStrokeStyle({ width: 2, color, alpha });
    
    const first = history[0];
    if (!first) return;
    this.trailGraphics.moveTo(first.x, first.y);
    
    for (let i = 1; i < history.length; i++) {
      const point = history[i];
      if (!point) continue;
      this.trailGraphics.lineTo(point.x, point.y);
    }
    this.trailGraphics.stroke();
    
    // Draw dots
    for (let i = 0; i < history.length; i++) {
      const point = history[i];
      if (!point) continue;
      const pointAlpha = (i / history.length) * alpha;
      this.trailGraphics.circle(point.x, point.y, 3);
      this.trailGraphics.fill({ color, alpha: pointAlpha });
    }
  }

  private drawGhostPlayer(player: PlatformerPlayer, color: number): void {
    const size = 20;
    const x = player.position.x - size / 2;
    const y = player.position.y - size / 2;
    
    this.ghostGraphics.setStrokeStyle({ width: 2, color, alpha: 0.4 });
    this.ghostGraphics.rect(x, y, size, size);
    this.ghostGraphics.stroke();
  }

  private drawDebug(
    debugData: DebugData,
    serverSnapshot: PlatformerWorld | null,
    localPlayerId: string | null,
    showTrails: boolean,
    showServerPositions: boolean,
  ): void {
    this.trailGraphics.clear();
    this.ghostGraphics.clear();
    
    if (showTrails) {
      // Local player predicted trail
      if (debugData.localPredictedHistory.length > 0) {
        this.drawTrail(debugData.localPredictedHistory, COLORS.trailPredicted, 0.7);
      }
      
      // Local player server trail
      if (debugData.localServerHistory.length > 0) {
        this.drawTrail(debugData.localServerHistory, COLORS.trailServer, 0.5);
      }
      
      // Other players interpolated trails
      for (const [, history] of debugData.otherPlayersHistory) {
        this.drawTrail(history, COLORS.trailInterpolated, 0.6);
      }
      
      // Other players server trails
      for (const [, history] of debugData.otherPlayersServerHistory) {
        this.drawTrail(history, COLORS.trailRawServer, 0.4);
      }
    }
    
    if (showServerPositions && serverSnapshot) {
      for (const [playerId, player] of serverSnapshot.players) {
        if (playerId === localPlayerId) {
          this.drawGhostPlayer(player, COLORS.trailServer);
        } else {
          this.drawGhostPlayer(player, COLORS.trailRawServer);
        }
      }
    }
  }

  private drawDebugLegend(showTrails: boolean, showServerPositions: boolean): void {
    this.debugLegendContainer.removeChildren();
    
    const startX = 10;
    let y = 20;
    const lineHeight = 16;
    
    const addLegendItem = (color: number, label: string, isDashed: boolean = false) => {
      const box = new Graphics();
      if (isDashed) {
        box.setStrokeStyle({ width: 2, color });
        box.rect(startX, y - 4, 12, 12);
        box.stroke();
      } else {
        box.rect(startX, y - 4, 12, 12);
        box.fill(color);
      }
      this.debugLegendContainer.addChild(box);
      
      const text = new Text({
        text: label,
        style: new TextStyle({
          fontFamily: "monospace",
          fontSize: 11,
          fill: COLORS.white,
        }),
      });
      text.position.set(startX + 18, y - 4);
      this.debugLegendContainer.addChild(text);
      
      y += lineHeight;
    };
    
    if (showTrails) {
      addLegendItem(COLORS.trailPredicted, "Predicted (local)");
      addLegendItem(COLORS.trailServer, "Server (local)");
      addLegendItem(COLORS.trailInterpolated, "Interpolated (others)");
      addLegendItem(COLORS.trailRawServer, "Raw server (others)");
    }
    
    if (showServerPositions) {
      addLegendItem(COLORS.trailServer, "Server ghost", true);
    }
  }

  // ============================================================================
  // Main Render
  // ============================================================================

  /**
   * Render a frame with full game state
   */
  render(
    world: PlatformerWorld,
    localPlayerId: string | null,
    options?: RenderOptions,
  ): void {
    // Draw world elements
    this.drawGrid();
    this.drawFloor();
    this.drawPlatforms(world.platforms);
    this.drawHazards(world.hazards);
    
    // Draw debug visualization
    if (options?.debugData && (options.showTrails || options.showServerPositions)) {
      this.drawDebug(
        options.debugData,
        options.serverSnapshot,
        localPlayerId,
        options.showTrails,
        options.showServerPositions,
      );
      this.drawDebugLegend(options.showTrails, options.showServerPositions);
    } else {
      this.trailGraphics.clear();
      this.ghostGraphics.clear();
      this.debugLegendContainer.removeChildren();
    }
    
    // Draw entities
    const players = Array.from(world.players.values());
    this.drawPlayers(players, localPlayerId);
    this.drawProjectiles(world.projectiles, localPlayerId);
    
    // Draw UI
    this.drawScoreboard(players);
    if (options?.killFeed) {
      this.drawKillFeed(options.killFeed);
    }
    this.drawGameStateOverlay(world.gameState, world.countdownTicks, world.winner);
  }
}
