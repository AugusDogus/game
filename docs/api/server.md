# Server API Reference

The server module provides everything needed to build an authoritative game server with fixed-timestep simulation and lag compensation.

## Import

```typescript
// Recommended: import from server submodule
import { createServer, GameLoop, LagCompensator } from "@game/netcode/server";

// Or from main package
import { createServer } from "@game/netcode";
```

## createServer

Creates an authoritative game server that runs the simulation, processes inputs, and broadcasts snapshots.

### Signature

```typescript
function createServer<TWorld, TInput, TAction, TActionResult>(
  config: ServerConfig<TWorld, TInput, TAction, TActionResult>
): ServerHandle<TWorld>;
```

### Config Options

```typescript
interface ServerConfig<TWorld, TInput, TAction, TActionResult> {
  /** Socket.IO server instance */
  io: Server;

  /** Initial world state */
  initialWorld: TWorld;

  /** Server tick rate in Hz (default: 20) */
  tickRate?: number;

  /** Callback when world updates (after each tick) */
  onTick?: (world: TWorld, tick: number) => void;

  // Option 1: Pass a GameDefinition
  game?: GameDefinition<TWorld, TInput>;

  // Option 2: Pass functions explicitly
  simulate?: SimulateFunction<TWorld, TInput>;
  addPlayer?: (world: TWorld, playerId: string) => TWorld;
  removePlayer?: (world: TWorld, playerId: string) => TWorld;
  createIdleInput?: () => TInput;
  mergeInputs?: InputMerger<TInput>;

  // For lag compensation (optional)
  validateAction?: ActionValidator<TWorld, TAction, TActionResult>;
}
```

### ServerHandle

```typescript
interface ServerHandle<TWorld> {
  /** Start the server game loop */
  start(): void;

  /** Stop the server game loop */
  stop(): void;

  /** Get current authoritative world state */
  getWorld(): TWorld;

  /** Get current server tick number */
  getTick(): number;

  /** Manually set the world state (use with caution) */
  setWorld(world: TWorld): void;
}
```

### Example

```typescript
import { Server } from "socket.io";
import { createServer, superjsonParser } from "@game/netcode";
import { myGame, createInitialWorld } from "./game";

const io = new Server({
  parser: superjsonParser,
  cors: { origin: "*" },
});

const server = createServer({
  io,
  initialWorld: createInitialWorld(),
  game: myGame,
  tickRate: 20,
  onTick: (world, tick) => {
    // Optional: log or persist game state
    if (tick % 100 === 0) {
      console.log(`Tick ${tick}: ${world.players.size} players`);
    }
  },
});

server.start();
io.listen(3000);
console.log("Server running on port 3000");
```

---

## Server Primitives

For advanced use cases, you can use the lower-level primitives directly.

### GameLoop

Runs the server simulation at a fixed timestep.

```typescript
import { GameLoop } from "@game/netcode/server";

const loop = new GameLoop({
  tickRate: 20,
  onTick: (deltaMs) => {
    // Process inputs and simulate
    world = simulate(world, inputs, deltaMs);
  },
});

loop.start();
// ... later
loop.stop();
```

### InputQueue

Queues and manages inputs from multiple clients.

```typescript
import { InputQueue } from "@game/netcode/server";

const queue = new InputQueue<MyInput>();

// When input arrives from client
queue.enqueue(clientId, seq, input);

// During tick processing
const allInputs = queue.getAllPendingInputs();  // Map<clientId, lastInput>
const batched = queue.getAllPendingInputsBatched();  // Map<clientId, input[]>

// After processing
queue.acknowledge(clientId, lastProcessedSeq);

// When client disconnects
queue.removeClient(clientId);
```

### LagCompensator

Handles lag compensation for hit validation by maintaining snapshot history.

```typescript
import { LagCompensator } from "@game/netcode/server";

const lagComp = new LagCompensator<MyWorld, MyAction, MyResult>({
  historySize: 60,  // Keep 60 ticks of history (3 seconds at 20Hz)
  validateAction: (world, clientId, action) => {
    // Validate hit against historical world state
    const target = world.players.get(action.targetId);
    if (!target) return { success: false };
    
    const dist = distance(action.position, target.position);
    if (dist < ATTACK_RANGE) {
      return { success: true, result: { damage: 10 } };
    }
    return { success: false };
  },
});

// Each tick, record current state
lagComp.recordSnapshot(tick, timestamp, world);

// When client's clock syncs
lagComp.updateClientClock(clientId, { offset, rtt });

// When action arrives
const result = lagComp.validateAction(clientId, actionMessage, currentWorld);
if (result.success) {
  applyDamage(world, result.result);
}
```

### ActionQueue

Queues actions from clients for processing.

```typescript
import { ActionQueue } from "@game/netcode/server";

const actionQueue = new ActionQueue<MyAction>();

// When action arrives
actionQueue.enqueue(clientId, actionMessage);

// During tick processing
const pending = actionQueue.getPendingActions();
for (const { clientId, action } of pending) {
  const result = lagComp.validateAction(clientId, action, world);
  // Send result back to client
}
actionQueue.clear();
```

---

## Socket.IO Events

The server automatically handles these Socket.IO events:

### Incoming (from clients)

| Event | Payload | Description |
|-------|---------|-------------|
| `input` | `InputMessage<TInput>` | Player input with sequence number |
| `action` | `ActionMessage<TAction>` | Discrete action for lag-compensated validation |
| `clockSync` | `{ clientTime: number }` | Clock synchronization request |

### Outgoing (to clients)

| Event | Payload | Description |
|-------|---------|-------------|
| `snapshot` | `Snapshot<TWorld>` | Authoritative world state (broadcast) |
| `actionResult` | `ActionResult<TResult>` | Result of action validation (to sender) |
| `clockSync` | `{ clientTime, serverTime }` | Clock sync response (to sender) |
| `playerId` | `string` | Assigned player ID (on connect) |
