# @game/physics2d

2D physics layer for `@game` - a TypeScript game engine. Built on [Rapier](https://rapier.rs/) for deterministic, cross-platform physics.

## Features

- **Deterministic** - Identical results across browsers, Node.js, different machines
- **Raycast-based character controller** - Implements Sebastian Lague's collision pattern
- **Slope handling** - Climb, descend, and slide on slopes
- **One-way platforms** - Drop-through platforms with collision filtering
- **Y-up coordinate system** - Matches physics conventions and Unity

## Installation

```bash
bun add @game/physics2d
# or
npm install @game/physics2d
```

## Quick Start

```typescript
import { PhysicsWorld, CharacterController } from "@game/physics2d";

// Initialize physics (async due to WASM)
const world = await PhysicsWorld.create({ x: 0, y: -20 });

// Add static colliders (platforms, walls)
world.addStaticCollider(
  { x: 0, y: -1 },      // position (center)
  { x: 10, y: 0.5 },    // half-extents
);

// Create a character controller
const controller = new CharacterController(world, {
  position: { x: 0, y: 2 },
  halfSize: { x: 0.5, y: 1 },
});

// In your game loop
function update(deltaTime: number) {
  const velocity = { x: input.moveX * 6, y: controller.velocity.y };
  velocity.y += gravity * deltaTime;
  
  controller.move(velocity, deltaTime);
  
  if (controller.collisions.below) {
    // Grounded - can jump
  }
}
```

## Coordinate System

This package uses **Y-up** coordinates:
- `(0, 0)` is at the bottom-left
- Positive Y is up
- Gravity should be negative (e.g., `{ x: 0, y: -20 }`)

The renderer is responsible for flipping Y when drawing to canvas (which uses Y-down).

## Why Rapier?

[Rapier](https://rapier.rs/) is a Rust physics engine compiled to WebAssembly with:

- **Cross-platform determinism** - Critical for netcode (client and server must match)
- **Battle-tested** - Handles edge cases we'd otherwise discover painfully
- **Full-featured** - Raycasting, collision detection, rigid bodies, joints
- **Active maintenance** - Official `@dimforge/rapier2d` package

## API Reference

### PhysicsWorld

Wrapper around Rapier's physics world.

```typescript
// Create a world with gravity
const world = await PhysicsWorld.create({ x: 0, y: -20 });

// Add a static collider (platform, wall, ground)
const colliderId = world.addStaticCollider(position, halfExtents, { oneWay: true });

// Cast a ray
const hit = world.raycast(origin, direction, maxDistance);
if (hit) {
  console.log(hit.point, hit.normal, hit.distance);
}
```

### CharacterController

Raycast-based character movement with slope handling.

```typescript
const controller = new CharacterController(world, {
  position: { x: 0, y: 2 },
  halfSize: { x: 0.5, y: 1 },
  skinWidth: 0.015,
  maxSlopeAngle: 80,
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
