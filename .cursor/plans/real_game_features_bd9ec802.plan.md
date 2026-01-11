---
name: Real Game Features
overview: Extend the platformer example into an actual playable game with collision detection, combat mechanics, health/damage, and game modes.
todos:
  - id: player-collision
    content: Add AABB collision detection between players
    status: pending
  - id: health-system
    content: Add health, damage, death, and respawn to player state
    status: pending
  - id: game-state
    content: Implement game state machine (lobby, playing, gameover)
    status: pending
  - id: level-system
    content: Add platform and spawn point definitions
    status: pending
  - id: game-ui
    content: Add health bars, kill feed, and game state UI to renderer
    status: pending
---

# Real Game Features

## Overview

Transform the platformer tech demo into an actual playable game with player-vs-player interactions, game state management, and win/lose conditions.

## Feature Areas

### 1. Player Collision Detection

- AABB collision between players
- Push-out resolution (players can't overlap)
- Add to [`simulatePlatformer`](packages/netcode/src/examples/platformer/simulation.ts)

### 2. Combat System

- Health per player (add to `PlatformerPlayer` in [`types.ts`](packages/netcode/src/examples/platformer/types.ts))
- Attack action with hitbox (ties into Lag Compensation plan)
- Damage calculation and knockback
- Death and respawn logic
```mermaid
stateDiagram-v2
    [*] --> Alive
    Alive --> TakingDamage: Hit by attack
    TakingDamage --> Alive: Health > 0
    TakingDamage --> Dead: Health <= 0
    Dead --> Respawning: Respawn timer
    Respawning --> Alive: Spawn at safe location
```


### 3. Game State Machine

- Lobby (waiting for players)
- Countdown (game starting)
- Playing (active game)
- GameOver (winner determined)
- Add `GameState` to `PlatformerWorld`

### 4. Win Conditions

- Last player standing
- Most kills in time limit
- First to X kills

**Configuration**: Win condition is set via `MatchConfig` passed to server on game start:

```typescript
interface MatchConfig {
  winCondition: 'last_standing' | 'most_kills' | 'first_to_x';
  killTarget?: number;    // For 'first_to_x'
  timeLimitMs?: number;   // For 'most_kills'
}
```

**Detection**: Server checks win condition in `tick()` after processing combat. When triggered, sets `gameState: 'gameover'` and `winner` field, then broadcasts final snapshot.

### 5. Level Design

- Platform definitions (position, size)
- Spawn points
- Hazards (spikes, pits)
- Load from JSON config

### 6. UI/UX in App

- Health bars above players
- Kill feed
- Scoreboard
- Game state overlay (countdown, winner)
- Update [`canvas-renderer.ts`](packages/app/src/client/renderer/canvas-renderer.ts)

## World State Changes

```typescript
interface PlatformerPlayer {
  // existing fields...
  health: number;          // Current health, clamped to [0, maxHealth]
  maxHealth: number;       // Maximum health (no overheal)
  deaths: number;
  kills: number;           // Incremented for final blow only (no assists)
  lastHitBy: string | null;
  respawnTimer: number | null;  // When non-null, player is invulnerable and cannot act
}

interface PlatformerWorld {
  // existing fields...
  gameState: 'lobby' | 'countdown' | 'playing' | 'gameover';
  platforms: Platform[];
  winner: string | null;
  matchConfig: MatchConfig;
}
```

**Guardrails**:

- Health is clamped: `health = Math.max(0, Math.min(maxHealth, newHealth))`
- Respawn invulnerability: While `respawnTimer !== null`, player cannot take damage
- Kill attribution: Only the `lastHitBy` player gets the kill when `health <= 0`