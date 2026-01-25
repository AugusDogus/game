# Platformer Example

A complete 2D multiplayer platformer demonstrating all features of `@game/netcode`.

## Coordinate System

This example uses **Y-up coordinates** (physics standard):

- **Positive Y points upward** - y=0 is the floor, higher Y is above
- **Gravity is negative** (-800 units/s²) - pulls players downward
- **Jump velocity is positive** (+400 units/s) - pushes players upward
- **Floor is at y=0** - player centers are at y=10 when grounded (half of PLAYER_HEIGHT)

The renderer handles the Y-flip internally, so the game world uses physics coordinates while rendering appears correctly on screen.

## Overview

This example implements:
- 2D physics with gravity, jumping, and collision
- Player-vs-player combat with melee attacks and projectiles
- Multiple level configurations
- Health, respawning, and scoring
- Full client-side prediction and interpolation

## Package

```bash
# This is a workspace package
@game/example-platformer
```

## Usage

Import from the example package to use in your own game or as a reference:

```typescript
import {
  // Simulation
  simulatePlatformer,
  interpolatePlatformer,
  platformerPredictionScope,
  
  // World management
  createPlatformerWorld,
  addPlayerToWorld,
  removePlayerFromWorld,
  
  // Types
  type PlatformerWorld,
  type PlatformerInput,
  type PlatformerPlayer,
} from "@game/example-platformer";
```

## Structure

```
examples/platformer/
├── types.ts           # Type definitions and constants
├── simulation.ts      # Core game physics and simulation
├── interpolation.ts   # Interpolation for smooth rendering
├── prediction.ts      # Client-side prediction scope
├── action-validator.ts # Lag-compensated hit detection
├── levels.ts          # Level configurations
├── player.ts          # Re-exports from @game/platformer
├── test-utils.ts      # Test helpers
├── index.ts           # Public exports
└── app/               # Runnable application
    └── src/
        ├── server.ts        # Game server
        └── client/          # React client app
```

## Types

### PlatformerWorld

```typescript
interface PlatformerWorld {
  tick: number;
  players: Map<string, PlatformerPlayer>;
  projectiles: Map<string, Projectile>;
  level: LevelConfig;
  gameState: GameState;
  matchConfig: MatchConfig;
}
```

### PlatformerPlayer

```typescript
interface PlatformerPlayer {
  id: string;
  position: Vector2;
  velocity: Vector2;
  isGrounded: boolean;
  health: number;
  maxHealth: number;
  kills: number;
  deaths: number;
  respawnTimer: number;
  invulnerabilityTimer: number;
  facingDirection: 1 | -1;
}
```

### PlatformerInput

```typescript
interface PlatformerInput {
  moveX: number;      // -1 to 1 horizontal movement
  moveY: number;      // Reserved for climbing, etc.
  jump: boolean;      // Jump pressed
  attack: boolean;    // Melee attack
  shoot: boolean;     // Ranged attack
  aimX: number;       // Aim direction X
  aimY: number;       // Aim direction Y
  timestamp: number;  // Required by netcode
}
```

## Simulation

The simulation handles:

### Physics
- Gravity acceleration
- Ground collision with floor
- Platform collision (solid platforms)
- Player-player collision (push apart)

### Movement
- Horizontal movement based on `moveX` input
- Jump velocity when grounded and `jump` pressed
- Clamping to world bounds

### Combat
- Melee attacks with radius-based hit detection
- Projectile spawning and movement
- Damage, knockback, and death
- Respawn timers and invulnerability frames

```typescript
import { simulatePlatformer } from "@game/example-platformer";

// Simulate one tick
const nextWorld = simulatePlatformer(world, inputs, deltaTimeMs);
```

## Prediction

The prediction scope extracts only the local player for client-side prediction:

```typescript
import { platformerPredictionScope } from "@game/example-platformer";

// Use with createClient
const client = createClient({
  socket,
  predictionScope: platformerPredictionScope,
  interpolate: interpolatePlatformer,
});
```

The scope:
1. Extracts the local player's state
2. Simulates movement locally for instant feedback
3. Merges prediction with server state during reconciliation

## Interpolation

Smoothly interpolates remote players between server snapshots:

```typescript
import { interpolatePlatformer } from "@game/example-platformer";

// Lerps position, preserves discrete states (isGrounded)
const rendered = interpolatePlatformer(fromWorld, toWorld, alpha);
```

## Levels

Built-in level configurations:

```typescript
import {
  LEVEL_BASIC_ARENA,
  LEVEL_PLATFORMS,
  LEVEL_DANGER_ZONE,
  LEVEL_TOWER,
  getLevel,
  getLevelIds,
} from "@game/example-platformer";

// Get all available levels
const levelIds = getLevelIds(); // ["basic-arena", "platforms", ...]

// Get specific level
const level = getLevel("platforms");
```

### Level Structure

```typescript
interface LevelConfig {
  id: string;
  name: string;
  platforms: Platform[];
  spawnPoints: SpawnPoint[];
  hazards?: Hazard[];
  bounds?: { minX: number; maxX: number; minY: number; maxY: number };
}
```

## Action Validation

Lag-compensated hit detection for attacks:

```typescript
import { validatePlatformerAction } from "@game/example-platformer";

// Use with createServer for lag compensation
const server = createServer({
  io,
  initialWorld,
  game: platformerGame,
  validateAction: validatePlatformerAction,
});
```

## Constants

Key gameplay constants (all can be imported):

```typescript
// Player dimensions
PLAYER_WIDTH = 20
PLAYER_HEIGHT = 20

// Combat
ATTACK_RADIUS = 50
ATTACK_DAMAGE = 20
PROJECTILE_SPEED = 400
PROJECTILE_DAMAGE = 15

// Physics (Y-up coordinate system, from @game/netcode)
DEFAULT_PLAYER_SPEED = 200    // Horizontal movement speed (units/sec)
DEFAULT_GRAVITY = -800        // Negative = pulls downward
DEFAULT_JUMP_VELOCITY = 400   // Positive = pushes upward  
DEFAULT_FLOOR_Y = 0           // Ground level at y=0
```

## Creating a GameDefinition

Combine everything into a `GameDefinition` for easy setup:

```typescript
import type { GameDefinition } from "@game/netcode/types";
import {
  simulatePlatformer,
  interpolatePlatformer,
  platformerPredictionScope,
  addPlayerToWorld,
  removePlayerFromWorld,
  createIdleInput,
  mergePlatformerInputs,
  type PlatformerWorld,
  type PlatformerInput,
} from "@game/example-platformer";

const platformerGame: GameDefinition<PlatformerWorld, PlatformerInput> = {
  simulate: simulatePlatformer,
  interpolate: interpolatePlatformer,
  addPlayer: addPlayerToWorld,
  removePlayer: removePlayerFromWorld,
  createIdleInput,
  mergeInputs: mergePlatformerInputs,
  createPredictionScope: () => platformerPredictionScope,
};

// Then use it
const server = createServer({ io, initialWorld, game: platformerGame });
const client = createClient({ socket, game: platformerGame });
```

## Running the Example

```bash
# From repository root
bun dev    # Development mode (auto-starts game, hot reload)
bun start  # Production mode

# Or from the app directory
cd examples/platformer/app
bun dev
```

This starts both the server and client for local testing. Open http://localhost:3000 in your browser.
