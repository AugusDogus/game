# @game

A TypeScript game engine for building fast-paced multiplayer games. Built with a focus on netcode, supporting server-authoritative architecture with client-side prediction, server reconciliation, entity interpolation, and lag compensation.

## Packages

| Package | Description |
|---------|-------------|
| [@game/netcode](packages/netcode/) | Networking layer - client/server sync, prediction, reconciliation, interpolation, lag compensation |

## Features

- **Server-authoritative architecture** - Server is the source of truth, preventing cheating
- **Client-side prediction** - Local player movement feels instant
- **Server reconciliation** - Corrects mispredictions without visible snapping
- **Entity interpolation** - Other players render smoothly between snapshots
- **Lag compensation** - Server rewinds time to validate hits fairly
- **Input helpers** - Keyboard, mouse/touch, and gamepad abstractions
- **Game-agnostic** - Works with any game type (platformer, top-down, 3D, etc.)
- **TypeScript-first** - Full type safety with generics for your world/input types

## Examples

| Example | Description |
|---------|-------------|
| [Platformer](examples/platformer/) | 2D multiplayer platformer with physics, combat, and multiple levels |

Run the platformer example:

```bash
bun start
```

## Documentation

- [Netcode API](packages/netcode/README.md) - Full networking API documentation

### Concepts

The `docs/concepts/` folder contains Gabriel Gambetta's articles explaining the networking techniques used:

- [Client-Server Architecture](docs/concepts/Fast-Paced%20Multiplayer%20(Part%20I)%20-%20Client-Server%20Game%20Architecture.md)
- [Client-Side Prediction and Server Reconciliation](docs/concepts/Fast-Paced%20Multiplayer%20(Part%20II)%20-%20Client-Side%20Prediction%20and%20Server%20Reconciliation.md)
- [Entity Interpolation](docs/concepts/Fast-Paced%20Multiplayer%20(Part%20III)%20-%20Entity%20Interpolation.md)
- [Lag Compensation](docs/concepts/Fast-Paced%20Multiplayer%20(Part%20IV)%20-%20Lag%20Compensation.md)

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
