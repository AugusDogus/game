# ROUNDS - 1v1 Platformer Shooter

A multiplayer 1v1 platformer game inspired by [ROUNDS](https://store.steampowered.com/app/1557740/ROUNDS/) by Landfall Games.

## Game Overview

Two players fight in rounds. First to win 3 rounds wins the match. After each round, the **loser** picks a card that modifies their character, creating a catch-up mechanic and emergent gameplay.

## Core Game Loop

1. **Waiting** - Game waits for 2 players to join
2. **Countdown** - 3 second countdown before round starts
3. **Fighting** - Players fight until one is eliminated
4. **Round End** - Brief pause, round winner announced
5. **Card Pick** - Loser picks 1 of 3 cards to power up
6. **Repeat** - Back to countdown for next round
7. **Match Over** - First to 3 round wins takes the match

## Controls

- **A/D** or **Arrow Keys** - Move left/right
- **Space/W/Up** - Jump
- **Click** - Shoot
- **1/2/3** - Select card during card pick phase

## Card System

Cards modify your character in various ways:

### Offense Cards
- **Damage Up** - +50% bullet damage
- **Rapid Fire** - +40% fire rate
- **Big Bullets** - +75% bullet size
- **Scatter Shot** - +2 bullets with spread
- **Bouncy Bullets** - Bullets bounce off walls
- **Explosive** - Bullets explode on impact
- **Life Steal** - Heal 20% of damage dealt

### Defense Cards
- **Health Up** - +50% max health
- **Thick Skin** - +100% health, -15% speed
- **Shield** - +50 damage absorption
- **Quick Reload** - -40% reload time

### Mobility Cards
- **Speed Up** - +30% movement speed
- **Jump Up** - +40% jump height
- **Double Jump** - Extra air jump
- **Dash** - Dash ability
- **Featherweight** - -30% gravity

### Special Cards
- **Glass Cannon** - +100% damage, -50% health
- **Tank** - +150% health, slower
- **Spray and Pray** - Many weak bullets
- **Sniper** - High damage, slow fire rate

## Running the Game

```bash
# From the repository root
cd examples/rounds/app

# Install dependencies
bun install

# Run in dev mode (auto-restarts on changes)
bun dev

# Run in production mode
bun start
```

The server runs on **port 3001** (different from platformer on 3000).

Open http://localhost:3001 in two browser windows to play.

## Technical Architecture

Built on the `@game/netcode` engine:

- **Server-authoritative** - Server runs simulation, clients predict
- **Client-side prediction** - Smooth local movement
- **Entity interpolation** - Smooth remote player rendering
- **Deterministic simulation** - Same code runs on client and server

### File Structure

```
examples/rounds/
├── types.ts          # Type definitions (World, Player, Card, etc.)
├── cards.ts          # Card definitions and stat computation
├── simulation.ts     # Game loop and physics
├── interpolation.ts  # Smooth rendering between snapshots
├── prediction.ts     # Client-side prediction scope
├── levels.ts         # Arena definitions
├── index.ts          # Public exports
└── app/              # Runnable application
    └── src/
        ├── server.ts           # Bun + Socket.IO server
        ├── client/
        │   ├── app.tsx         # React UI
        │   ├── socket.ts       # Socket.IO client
        │   └── renderer/       # PixiJS rendering
        └── game/
            └── game-client.ts  # Netcode client integration
```

## API Endpoints

- `GET /api/health` - Server health check
- `GET /api/game/status` - Current game state
- `POST /api/game/reset` - Reset match
- `GET /api/levels` - List available arenas
- `POST /api/levels/:id` - Change arena

## Arenas

- **Classic Arena** - Simple symmetrical layout
- **Tower** - Vertical platforms
- **The Pit** - Dangerous center gap
- **Pillars** - Vertical cover
- **Bridges** - Multiple crossing paths
