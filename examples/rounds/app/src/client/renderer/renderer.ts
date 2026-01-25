/**
 * ROUNDS game renderer using PixiJS
 */

import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import { Viewport } from "pixi-viewport";
import type {
  RoundsWorld,
  RoundsPlayer,
  Projectile,
  Platform,
} from "@game/example-rounds";
import {
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
} from "@game/example-rounds";
import { DEFAULT_FLOOR_Y } from "@game/netcode";

export interface RenderOptions {
  mouseX: number;
  mouseY: number;
}

export class Renderer {
  private app: Application;
  private viewport: Viewport;
  private worldContainer: Container;
  private uiContainer: Container;

  // Graphics objects (reused for performance)
  private platformGraphics: Graphics;
  private floorGraphics: Graphics;
  private playerGraphics: Map<string, Graphics> = new Map();
  private projectileGraphics: Map<string, Graphics> = new Map();
  private aimLineGraphics: Graphics;
  private crosshairGraphics: Graphics;

  static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    const app = new Application();
    await app.init({
      canvas,
      width: canvas.width || 800,
      height: canvas.height || 600,
      backgroundColor: 0x1a1a2e,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    return new Renderer(app, canvas);
  }

  private constructor(app: Application, canvas: HTMLCanvasElement) {
    this.app = app;

    // Create viewport for camera control
    this.viewport = new Viewport({
      screenWidth: canvas.width,
      screenHeight: canvas.height,
      worldWidth: 1000,
      worldHeight: 800,
      events: app.renderer.events,
    });

    this.app.stage.addChild(this.viewport);

    // World container (for game objects)
    this.worldContainer = new Container();
    this.viewport.addChild(this.worldContainer);

    // UI container (screen-space, not affected by camera)
    this.uiContainer = new Container();
    this.app.stage.addChild(this.uiContainer);

    // Initialize graphics objects
    this.platformGraphics = new Graphics();
    this.floorGraphics = new Graphics();
    this.aimLineGraphics = new Graphics();
    this.crosshairGraphics = new Graphics();

    this.worldContainer.addChild(this.platformGraphics);
    this.worldContainer.addChild(this.floorGraphics);
    this.worldContainer.addChild(this.aimLineGraphics);
    this.worldContainer.addChild(this.crosshairGraphics);

    // Center the viewport
    this.viewport.moveCenter(0, 100);
  }

  resize(width: number, height: number): void {
    this.app.renderer.resize(width, height);
    this.viewport.resize(width, height);
  }

  render(world: RoundsWorld, localPlayerId: string | null, options: RenderOptions): void {
    // Clear all graphics
    this.platformGraphics.clear();
    this.floorGraphics.clear();
    this.aimLineGraphics.clear();
    this.crosshairGraphics.clear();

    // Draw floor
    this.drawFloor(world);

    // Draw platforms
    this.drawPlatforms(world.level.platforms);

    // Draw projectiles
    this.drawProjectiles(world.projectiles);

    // Draw players
    this.drawPlayers(world, localPlayerId);

    // Draw aim line for local player
    if (localPlayerId) {
      const localPlayer = world.players.get(localPlayerId);
      if (localPlayer) {
        this.drawAimLine(localPlayer, options.mouseX, options.mouseY);
        this.drawCrosshair(options.mouseX, options.mouseY);
      }
    }

    // Center camera on action (midpoint between players or local player)
    this.updateCamera(world, localPlayerId);
  }

  private drawFloor(world: RoundsWorld): void {
    // Draw a thin floor line at the floor level
    const floorWidth = world.level.bounds.width * 2;
    const floorThickness = 4;
    const floorY = this.toScreenY(DEFAULT_FLOOR_Y);

    this.floorGraphics.rect(
      -floorWidth / 2,
      floorY,
      floorWidth,
      floorThickness,
    );
    this.floorGraphics.fill({ color: 0x4a5568 });
  }

  private drawPlatforms(platforms: Platform[]): void {
    for (const platform of platforms) {
      const screenX = platform.position.x;
      const screenY = this.toScreenY(platform.position.y + platform.height);

      this.platformGraphics.rect(screenX, screenY, platform.width, platform.height);
      this.platformGraphics.fill({ color: 0x4a5568 });

      // Platform edge highlight
      this.platformGraphics.rect(screenX, screenY, platform.width, 3);
      this.platformGraphics.fill({ color: 0x718096 });
    }
  }

  private drawPlayers(world: RoundsWorld, localPlayerId: string | null): void {
    const activePlayers = new Set<string>();

    for (const [playerId, player] of world.players) {
      activePlayers.add(playerId);
      this.drawPlayer(player, playerId === localPlayerId);
    }

    // Remove graphics for players that left
    for (const [playerId, graphics] of this.playerGraphics) {
      if (!activePlayers.has(playerId)) {
        this.worldContainer.removeChild(graphics);
        graphics.destroy();
        this.playerGraphics.delete(playerId);
      }
    }
  }

  private drawPlayer(player: RoundsPlayer, isLocal: boolean): void {
    let graphics = this.playerGraphics.get(player.id);
    if (!graphics) {
      graphics = new Graphics();
      this.worldContainer.addChild(graphics);
      this.playerGraphics.set(player.id, graphics);
    }

    graphics.clear();

    const screenX = player.position.x;
    const screenY = this.toScreenY(player.position.y);

    // Player body
    const bodyColor = isLocal ? 0x4299e1 : 0xe53e3e;
    const alpha = player.invulnerabilityTicks > 0 ? 0.5 : 1.0;

    // Shadow
    graphics.ellipse(screenX, screenY + PLAYER_HEIGHT / 2 - 2, PLAYER_WIDTH / 2.5, 4);
    graphics.fill({ color: 0x000000, alpha: 0.3 });

    // Body
    graphics.roundRect(
      screenX - PLAYER_WIDTH / 2,
      screenY - PLAYER_HEIGHT / 2,
      PLAYER_WIDTH,
      PLAYER_HEIGHT,
      4,
    );
    graphics.fill({ color: bodyColor, alpha });

    // Health bar background
    const healthBarWidth = PLAYER_WIDTH + 10;
    const healthBarHeight = 4;
    const healthBarY = screenY - PLAYER_HEIGHT / 2 - 12;

    graphics.rect(
      screenX - healthBarWidth / 2,
      healthBarY,
      healthBarWidth,
      healthBarHeight,
    );
    graphics.fill({ color: 0x1a202c });

    // Health bar fill
    const healthPercent = player.health / player.stats.maxHealth;
    const healthColor = healthPercent > 0.5 ? 0x48bb78 : healthPercent > 0.25 ? 0xecc94b : 0xfc8181;

    graphics.rect(
      screenX - healthBarWidth / 2,
      healthBarY,
      healthBarWidth * healthPercent,
      healthBarHeight,
    );
    graphics.fill({ color: healthColor });

    // Shield bar (if any)
    if (player.shieldHealth > 0) {
      const shieldPercent = player.shieldHealth / 50; // Assume max shield is 50
      graphics.rect(
        screenX - healthBarWidth / 2,
        healthBarY - 5,
        healthBarWidth * Math.min(1, shieldPercent),
        3,
      );
      graphics.fill({ color: 0x63b3ed });
    }

    // Ammo dots
    const ammoCount = player.ammo;
    const maxAmmo = player.stats.ammoCapacity;
    const dotSize = 3;
    const dotSpacing = 5;
    const totalDotsWidth = maxAmmo * dotSpacing;
    const dotsStartX = screenX - totalDotsWidth / 2 + dotSpacing / 2;

    for (let i = 0; i < maxAmmo; i++) {
      const dotX = dotsStartX + i * dotSpacing;
      const dotY = screenY + PLAYER_HEIGHT / 2 + 8;
      graphics.circle(dotX, dotY, dotSize / 2);
      graphics.fill({ color: i < ammoCount ? 0xfbbf24 : 0x374151 });
    }

    // Reload indicator
    if (player.reloadTimer !== null) {
      const reloadProgress = 1 - player.reloadTimer / (40 * player.stats.reloadTime);
      graphics.rect(
        screenX - healthBarWidth / 2,
        screenY + PLAYER_HEIGHT / 2 + 14,
        healthBarWidth * reloadProgress,
        2,
      );
      graphics.fill({ color: 0xfbbf24 });
    }

    // Card count indicator
    if (player.cards.length > 0) {
      const cardIndicatorY = screenY - PLAYER_HEIGHT / 2 - 20;
      for (let i = 0; i < Math.min(player.cards.length, 5); i++) {
        graphics.circle(screenX - 8 + i * 4, cardIndicatorY, 2);
        graphics.fill({ color: 0xa78bfa });
      }
    }
  }

  private drawProjectiles(projectiles: Projectile[]): void {
    const activeProjectiles = new Set<string>();

    for (const proj of projectiles) {
      activeProjectiles.add(proj.id);
      this.drawProjectile(proj);
    }

    // Remove graphics for projectiles that expired
    for (const [projId, graphics] of this.projectileGraphics) {
      if (!activeProjectiles.has(projId)) {
        this.worldContainer.removeChild(graphics);
        graphics.destroy();
        this.projectileGraphics.delete(projId);
      }
    }
  }

  private drawProjectile(proj: Projectile): void {
    let graphics = this.projectileGraphics.get(proj.id);
    if (!graphics) {
      graphics = new Graphics();
      this.worldContainer.addChild(graphics);
      this.projectileGraphics.set(proj.id, graphics);
    }

    graphics.clear();

    const screenX = proj.position.x;
    const screenY = this.toScreenY(proj.position.y);
    // proj.size is already the final size (PROJECTILE_BASE_SIZE * bulletSize multiplier)
    const size = proj.size;

    // Glow effect
    graphics.circle(screenX, screenY, size * 1.5);
    graphics.fill({ color: 0xfbbf24, alpha: 0.3 });

    // Core
    graphics.circle(screenX, screenY, size);
    graphics.fill({ color: 0xfbbf24 });

    // Highlight
    graphics.circle(screenX - size * 0.3, screenY - size * 0.3, size * 0.3);
    graphics.fill({ color: 0xfef3c7 });
  }

  private drawAimLine(player: RoundsPlayer, mouseX: number, mouseY: number): void {
    const screenX = player.position.x;
    const screenY = this.toScreenY(player.position.y);
    const targetScreenY = this.toScreenY(mouseY);

    // Dotted aim line
    const dx = mouseX - screenX;
    const dy = targetScreenY - screenY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.min(20, Math.floor(distance / 10));

    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const x = screenX + dx * t;
      const y = screenY + dy * t;
      this.aimLineGraphics.circle(x, y, 1.5);
      this.aimLineGraphics.fill({ color: 0xffffff, alpha: 0.3 * (1 - t) });
    }
  }

  private drawCrosshair(mouseX: number, mouseY: number): void {
    const screenY = this.toScreenY(mouseY);
    const size = 8;

    this.crosshairGraphics.moveTo(mouseX - size, screenY);
    this.crosshairGraphics.lineTo(mouseX + size, screenY);
    this.crosshairGraphics.moveTo(mouseX, screenY - size);
    this.crosshairGraphics.lineTo(mouseX, screenY + size);
    this.crosshairGraphics.stroke({ color: 0xffffff, alpha: 0.7, width: 2 });

    // Circle
    this.crosshairGraphics.circle(mouseX, screenY, size * 1.5);
    this.crosshairGraphics.stroke({ color: 0xffffff, alpha: 0.5, width: 1 });
  }

  private updateCamera(world: RoundsWorld, localPlayerId: string | null): void {
    const players = Array.from(world.players.values());
    if (players.length === 0) {
      this.viewport.moveCenter(0, 100);
      return;
    }

    let centerX = 0;
    let centerY = 0;

    if (players.length === 1) {
      const p = players[0];
      if (p) {
        centerX = p.position.x;
        centerY = this.toScreenY(p.position.y);
      }
    } else {
      // Center between all players
      for (const p of players) {
        centerX += p.position.x;
        centerY += this.toScreenY(p.position.y);
      }
      centerX /= players.length;
      centerY /= players.length;
    }

    // Smooth camera movement
    const currentCenter = this.viewport.center;
    const lerpFactor = 0.1;
    const newX = currentCenter.x + (centerX - currentCenter.x) * lerpFactor;
    const newY = currentCenter.y + (centerY - currentCenter.y) * lerpFactor;

    this.viewport.moveCenter(newX, newY);
  }

  /**
   * Convert Y-up world coordinate to Y-down screen coordinate
   */
  private toScreenY(worldY: number): number {
    return -worldY;
  }

  destroy(): void {
    // Clean up player graphics
    for (const graphics of this.playerGraphics.values()) {
      graphics.destroy();
    }
    this.playerGraphics.clear();

    // Clean up projectile graphics
    for (const graphics of this.projectileGraphics.values()) {
      graphics.destroy();
    }
    this.projectileGraphics.clear();

    // Destroy other graphics
    this.platformGraphics.destroy();
    this.floorGraphics.destroy();
    this.aimLineGraphics.destroy();
    this.crosshairGraphics.destroy();

    // Destroy containers and app
    this.worldContainer.destroy();
    this.uiContainer.destroy();
    this.viewport.destroy();
    this.app.destroy();
  }
}
