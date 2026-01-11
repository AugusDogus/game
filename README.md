# @game/netcode

A TypeScript netcode library for fast-paced multiplayer games. Implements server-authoritative architecture with client-side prediction, server reconciliation, and entity interpolation.

The server maintains the authoritative game state while clients predict their own movement locally for responsive gameplay. When server snapshots arrive, clients reconcile any mispredictions by replaying unacknowledged inputs. Other players are rendered using interpolation between past snapshots for smooth visuals.

## Features

- **Server-authoritative architecture** - Server is the source of truth, preventing cheating
- **Client-side prediction** - Local player movement feels instant
- **Server reconciliation** - Corrects mispredictions without visible snapping
- **Entity interpolation** - Other players render smoothly between snapshots
- **Rollback netcode** - GGPO-style alternative for fighting games (basic implementation)
- **Generic world state** - Works with any game type, not just platformers
- **Socket.IO integration** - Easy setup with automatic Map/Set serialization

## Quick Start

### Server

```typescript
import { Server } from "socket.io";
import {
  createNetcodeServer,
  superjsonParser,
  simulatePlatformer,
  createPlatformerWorld,
  createIdleInput,
  addPlayerToWorld,
  removePlayerFromWorld,
} from "@game/netcode";

const io = new Server({ parser: superjsonParser });

const server = createNetcodeServer({
  io,
  initialWorld: createPlatformerWorld(),
  simulate: simulatePlatformer,
  addPlayer: addPlayerToWorld,
  removePlayer: removePlayerFromWorld,
  createIdleInput,
  tickRate: 20, // 20 Hz server tick rate
});

server.start();
io.listen(3000);
```

### Client

```typescript
import { io } from "socket.io-client";
import {
  createNetcodeClient,
  superjsonParser,
  interpolatePlatformer,
  platformerPredictionScope,
} from "@game/netcode";

const socket = io("http://localhost:3000", { parser: superjsonParser });

const client = createNetcodeClient({
  socket,
  predictionScope: platformerPredictionScope,
  interpolate: interpolatePlatformer,
  onWorldUpdate: (world) => render(world),
});

// Send input every frame
function gameLoop() {
  client.sendInput({ moveX: getHorizontalInput(), moveY: 0, jump: isJumpPressed() });
  requestAnimationFrame(gameLoop);
}
```

## Packages

- `packages/netcode` - Core netcode library (`@game/netcode`)
- `packages/app` - Example platformer demonstrating the library

## Development

```bash
bun install
bun start      # Run example app
bun test       # Run tests
bun typecheck  # Type checking
bun lint       # Linting
```

## Concepts

The `/docs` folder contains Gabriel Gambetta's articles on fast-paced multiplayer networking:

- [Part I: Client-Server Architecture](docs/Fast-Paced%20Multiplayer%20(Part%20I)%20-%20Client-Server%20Game%20Architecture.md)
- [Part II: Client-Side Prediction and Server Reconciliation](docs/Fast-Paced%20Multiplayer%20(Part%20II)%20-%20Client-Side%20Prediction%20and%20Server%20Reconciliation.md)
- [Part III: Entity Interpolation](docs/Fast-Paced%20Multiplayer%20(Part%20III)%20-%20Entity%20Interpolation.md)
- [Part IV: Lag Compensation](docs/Fast-Paced%20Multiplayer%20(Part%20IV)%20-%20Lag%20Compensation.md)
