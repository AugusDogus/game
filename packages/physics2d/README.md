# @game/physics2d

Stateless 2D physics layer for `@game` - a TypeScript game engine. Implements raycast-based collision detection for character controllers.

## Features

- **Stateless** - No world object, no async initialization, perfect for netcode
- **Deterministic** - Pure functions, identical results every time
- **Raycast-based character controller** - Implements Sebastian Lague's collision pattern
- **Slope handling** - Climb, descend, and slide on slopes
- **One-way platforms** - Drop-through platforms with collision filtering
- **Y-up coordinate system** - Matches physics conventions

## Installation

```bash
bun add @game/physics2d
# or
npm install @game/physics2d
```

## Quick Start

```typescript
import { CharacterController, raycast, vec2 } from "@game/physics2d";
import type { Collider } from "@game/physics2d";

// Define static colliders (platforms, walls)
const colliders: Collider[] = [
  { position: vec2(0, 0), halfExtents: vec2(10, 0.5) }, // Ground
  { position: vec2(5, 3), halfExtents: vec2(2, 0.25), oneWay: true }, // Platform
];

// Create a character controller
const controller = new CharacterController(colliders, {
  position: vec2(0, 2),
  halfSize: vec2(0.5, 1),
});

// In your game loop
function update(deltaTime: number, velocity: { x: number; y: number }) {
  controller.move(velocity, deltaTime);
  
  if (controller.collisions.below) {
    // Grounded - can jump
  }
}

// Or use raycasting directly
const hit = raycast(
  vec2(0, 10),     // origin
  vec2(0, -1),     // direction (down)
  20,              // max distance
  colliders        // colliders to test
);
if (hit) {
  console.log(`Hit at ${hit.point.y}, distance ${hit.distance}`);
}
```

## Coordinate System

This package uses **Y-up** coordinates:
- `(0, 0)` is at the bottom-left
- Positive Y is up
- Gravity should be negative (e.g., `velocity.y -= 20 * deltaTime`)

The renderer is responsible for flipping Y when drawing to canvas (which uses Y-down).

## Why Stateless?

For server-authoritative netcode, the simulation must be deterministic and stateless:

1. **No WASM initialization** - No async `await initPhysics()` required
2. **Pure functions** - Same inputs always produce same outputs
3. **Easy serialization** - Collider arrays are plain objects
4. **Simple rollback** - No physics world state to manage

## API Reference

### Raycasting

```typescript
import { raycast, raycastAll, vec2 } from "@game/physics2d";
import type { Collider } from "@game/physics2d";

const colliders: Collider[] = [
  { position: vec2(0, 0), halfExtents: vec2(5, 0.5), tag: "ground" },
  { position: vec2(0, 5), halfExtents: vec2(3, 0.25), oneWay: true },
];

// Cast a ray and get the first hit
const hit = raycast(origin, direction, maxDistance, colliders);
if (hit) {
  console.log(hit.point, hit.normal, hit.distance, hit.colliderIndex);
}

// Cast a ray and get all hits (sorted by distance)
const hits = raycastAll(origin, direction, maxDistance, colliders);
for (const hit of hits) {
  console.log(`Hit collider ${hit.colliderIndex} at distance ${hit.distance}`);
}
```

### CharacterController

Raycast-based character movement with slope handling.

```typescript
import { CharacterController, vec2 } from "@game/physics2d";

const controller = new CharacterController(colliders, {
  position: vec2(0, 2),
  halfSize: vec2(0.5, 1),
  config: {
    skinWidth: 0.015,
    maxSlopeAngle: 80,
    horizontalRayCount: 4,
    verticalRayCount: 4,
  },
});

// Move the character
controller.move(velocity, deltaTime);

// Check collision state
if (controller.collisions.below) { /* grounded */ }
if (controller.collisions.left || controller.collisions.right) { /* wall */ }
if (controller.collisions.climbingSlope) { /* on slope */ }
```

## License

MIT
