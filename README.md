# @game/netcode

A TypeScript netcode library for building fast-paced multiplayer games. Implements server-authoritative architecture with client-side prediction, server reconciliation, entity interpolation, and lag compensation.

## Features

- **Server-authoritative architecture** - Server is the source of truth, preventing cheating
- **Client-side prediction** - Local player movement feels instant
- **Server reconciliation** - Corrects mispredictions without visible snapping
- **Entity interpolation** - Other players render smoothly between snapshots
- **Lag compensation** - Server rewinds time to validate hits fairly
- **Input helpers** - Keyboard, mouse/touch, and gamepad abstractions
- **Game-agnostic** - Works with any game type (platformer, top-down, 3D, etc.)
- **TypeScript-first** - Full type safety with generics for your world/input types

## Installation

```bash
bun add @game/netcode
# or
npm install @game/netcode
```

## Quick Start

### Define Your Game

```typescript
import type { GameDefinition } from "@game/netcode/types";

interface MyWorld {
  tick: number;
  players: Map<string, { x: number; y: number; vx: number; vy: number }>;
}

interface MyInput {
  moveX: number;
  moveY: number;
  timestamp: number; // Required in type, but added automatically by sendInput()
}

const myGame: GameDefinition<MyWorld, MyInput> = {
  simulate: (world, inputs, dt) => {
    const players = new Map(world.players);
    for (const [id, input] of inputs) {
      const player = players.get(id);
      if (player) {
        players.set(id, {
          ...player,
          x: player.x + input.moveX * 200 * (dt / 1000),
          y: player.y + input.moveY * 200 * (dt / 1000),
        });
      }
    }
    return { ...world, tick: world.tick + 1, players };
  },

  interpolate: (from, to, alpha) => {
    const players = new Map();
    for (const [id, toPlayer] of to.players) {
      const fromPlayer = from.players.get(id);
      players.set(id, fromPlayer ? {
        ...toPlayer,
        x: fromPlayer.x + (toPlayer.x - fromPlayer.x) * alpha,
        y: fromPlayer.y + (toPlayer.y - fromPlayer.y) * alpha,
      } : toPlayer);
    }
    return { ...to, players };
  },

  addPlayer: (world, playerId) => {
    const players = new Map(world.players);
    players.set(playerId, { x: 0, y: 0, vx: 0, vy: 0 });
    return { ...world, players };
  },

  removePlayer: (world, playerId) => {
    const players = new Map(world.players);
    players.delete(playerId);
    return { ...world, players };
  },

  // timestamp: 0 is a placeholder - the engine replaces it with actual timestamps
  createIdleInput: () => ({ moveX: 0, moveY: 0, timestamp: 0 }),
};
```

### Server

```typescript
import { Server } from "socket.io";
import { createServer, superjsonParser } from "@game/netcode";

const io = new Server({ parser: superjsonParser });

const server = createServer({
  io,
  initialWorld: { tick: 0, players: new Map() },
  game: myGame,
  tickRate: 20,
});

server.start();
io.listen(3000);
```

### Client

```typescript
import { io } from "socket.io-client";
import { createClient, superjsonParser } from "@game/netcode";

const socket = io("http://localhost:3000", { parser: superjsonParser });

const client = createClient({
  socket,
  game: myGame,
  onWorldUpdate: (world) => render(world),
});

// Send input
function gameLoop() {
  const input = getPlayerInput();
  client.sendInput(input);
  requestAnimationFrame(gameLoop);
}
gameLoop();
```

## Module Structure

The library uses deep imports for tree-shaking and clear organization:

```typescript
// High-level API (most users need only this)
import { createClient, createServer, superjsonParser } from "@game/netcode";

// Client-specific imports
import { createClient, createGameLoop, createKeyboardInput } from "@game/netcode/client";

// Server-specific imports
import { createServer, GameLoop, InputQueue } from "@game/netcode/server";

// Type definitions
import type { GameDefinition, SimulateFunction, Snapshot } from "@game/netcode/types";

// Input helpers (also exported from @game/netcode/client)
import { createKeyboardInput, createPointerInput, createGamepadInput } from "@game/netcode/client/input";

// Constants
import { DEFAULT_TICK_RATE, DEFAULT_INTERPOLATION_DELAY_MS } from "@game/netcode/constants";

// Socket.IO parser
import { superjsonParser } from "@game/netcode/parser";
```

## Input Helpers

Built-in input abstractions for common input devices:

```typescript
import {
  createKeyboardInput,
  createPointerInput,
  createGamepadInput,
  MouseButton,
} from "@game/netcode/client";

// Keyboard with configurable bindings
const keyboard = createKeyboardInput({
  bindings: {
    up: ["w", "ArrowUp"],
    down: ["s", "ArrowDown"],
    left: ["a", "ArrowLeft"],
    right: ["d", "ArrowRight"],
    jump: [" "],
    interact: ["e"],
  },
});

// Mouse/touch with world coordinate conversion
const pointer = createPointerInput({
  target: canvas,
  toWorldCoords: (x, y, w, h) => ({ x: x - w / 2, y: y - h / 2 }),
});

// Gamepad with deadzone handling
const gamepad = createGamepadInput({ deadzone: 0.15 });

// In your game loop
function update() {
  const keys = keyboard.getState();
  const mouse = pointer.getState();
  const pad = gamepad.getState();

  // Combine inputs however you want
  const moveX = keys.right ? 1 : keys.left ? -1 : pad.leftStick.x;
  const moveY = keys.down ? 1 : keys.up ? -1 : pad.leftStick.y;

  // Note: timestamp is added automatically by sendInput
  client.sendInput({ moveX, moveY });

  pointer.clearJustPressed();
}
```

## Documentation

- [Client API](docs/api/client.md) - `createClient`, input helpers, game loop
- [Server API](docs/api/server.md) - `createServer`, game loop, lag compensation
- [Types](docs/api/types.md) - `GameDefinition`, `SimulateFunction`, `Snapshot`, etc.
- [Input Helpers](docs/api/input.md) - Keyboard, pointer, and gamepad input

### Concepts

The `docs/concepts/` folder contains Gabriel Gambetta's articles explaining the networking techniques:

- [Client-Server Architecture](docs/concepts/Fast-Paced%20Multiplayer%20(Part%20I)%20-%20Client-Server%20Game%20Architecture.md)
- [Client-Side Prediction and Server Reconciliation](docs/concepts/Fast-Paced%20Multiplayer%20(Part%20II)%20-%20Client-Side%20Prediction%20and%20Server%20Reconciliation.md)
- [Entity Interpolation](docs/concepts/Fast-Paced%20Multiplayer%20(Part%20III)%20-%20Entity%20Interpolation.md)
- [Lag Compensation](docs/concepts/Fast-Paced%20Multiplayer%20(Part%20IV)%20-%20Lag%20Compensation.md)

## Packages

- `packages/netcode` - Core netcode library (`@game/netcode`)
- `packages/app` - Example application using the library
- `examples/platformer` - Complete platformer game example (`@game/example-platformer`)

## Development

```bash
bun install      # Install dependencies
bun start        # Run example app
bun test         # Run tests
bun run tsc      # Type checking
bun lint         # Linting
```

## License

MIT
