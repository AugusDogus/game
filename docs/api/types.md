# Types Reference

Core type definitions for implementing game logic that integrates with the netcode system.

## Import

```typescript
import type {
  GameDefinition,
  SimulateFunction,
  InterpolateFunction,
  Snapshot,
  InputMessage,
  ActionValidator,
  PredictionScope,
} from "@game/netcode/types";
```

---

## GameDefinition

Complete game definition providing all simulation and rendering logic. Pass this to `createServer` or `createClient` via the `game` config option.

```typescript
interface GameDefinition<TWorld, TInput extends { timestamp: number }> {
  /** Simulate one tick of the game world */
  simulate: SimulateFunction<TWorld, TInput>;

  /** Interpolate between two world states for smooth rendering */
  interpolate: InterpolateFunction<TWorld>;

  /** Add a new player to the world state */
  addPlayer: (world: TWorld, playerId: string) => TWorld;

  /** Remove a player from the world state */
  removePlayer: (world: TWorld, playerId: string) => TWorld;

  /** Create an idle/neutral input for players who sent no input this tick */
  createIdleInput: () => TInput;

  /** Optional: merge multiple inputs that arrive in one tick */
  mergeInputs?: InputMerger<TInput>;

  /** Optional: factory for client-side prediction scope */
  createPredictionScope?: () => PredictionScope<TWorld, TInput>;

  /** Optional: custom binary serialization */
  serialize?: SerializeFunction<TWorld>;

  /** Optional: custom binary deserialization */
  deserialize?: DeserializeFunction<TWorld>;
}
```

### Example

```typescript
const myGame: GameDefinition<MyWorld, MyInput> = {
  simulate: (world, inputs, dt) => {
    // Your game physics/logic here
    return { ...world, tick: world.tick + 1 };
  },

  interpolate: (from, to, alpha) => {
    // Lerp positions for smooth rendering
    return lerpWorld(from, to, alpha);
  },

  addPlayer: (world, playerId) => {
    const players = new Map(world.players);
    players.set(playerId, createPlayer(playerId));
    return { ...world, players };
  },

  removePlayer: (world, playerId) => {
    const players = new Map(world.players);
    players.delete(playerId);
    return { ...world, players };
  },

  createIdleInput: () => ({
    moveX: 0,
    moveY: 0,
    jump: false,
    timestamp: 0,
  }),
};
```

---

## SimulateFunction

Function that simulates one tick of the game world. **Must be deterministic** - the same inputs must always produce the same outputs.

```typescript
type SimulateFunction<TWorld, TInput> = (
  world: TWorld,
  inputs: Map<string, TInput>,
  deltaTime: number,
) => TWorld;
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `world` | `TWorld` | Current world state |
| `inputs` | `Map<string, TInput>` | Player ID → input for this tick |
| `deltaTime` | `number` | Milliseconds since last tick |

### Important

- Must return a **new object**, not mutate the input
- Must be **deterministic** for prediction to work correctly
- Empty inputs map means no players sent input this tick

### Example

```typescript
const simulate: SimulateFunction<MyWorld, MyInput> = (world, inputs, dt) => {
  const players = new Map(world.players);
  const dtSec = dt / 1000;

  for (const [id, input] of inputs) {
    const player = players.get(id);
    if (!player) continue;

    players.set(id, {
      ...player,
      x: player.x + input.moveX * SPEED * dtSec,
      y: player.y + input.moveY * SPEED * dtSec,
      vx: input.moveX * SPEED,
      vy: input.moveY * SPEED,
    });
  }

  return { ...world, tick: world.tick + 1, players };
};
```

---

## InterpolateFunction

Function that interpolates between two world states for smooth rendering of remote entities.

```typescript
type InterpolateFunction<TWorld> = (
  from: TWorld,
  to: TWorld,
  alpha: number,
) => TWorld;
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | `TWorld` | Earlier world state |
| `to` | `TWorld` | Later world state |
| `alpha` | `number` | Interpolation factor (0.0 = from, 1.0 = to) |

### Example

```typescript
const interpolate: InterpolateFunction<MyWorld> = (from, to, alpha) => {
  const players = new Map();

  for (const [id, toPlayer] of to.players) {
    const fromPlayer = from.players.get(id);

    if (fromPlayer) {
      // Lerp position
      players.set(id, {
        ...toPlayer,
        x: fromPlayer.x + (toPlayer.x - fromPlayer.x) * alpha,
        y: fromPlayer.y + (toPlayer.y - fromPlayer.y) * alpha,
      });
    } else {
      // New player, use target state
      players.set(id, toPlayer);
    }
  }

  return { ...to, players };
};
```

---

## Snapshot

A snapshot of the world state at a specific server tick.

```typescript
interface Snapshot<TWorld> {
  /** Server tick number (monotonically increasing) */
  tick: number;

  /** Server timestamp when created (Date.now()) */
  timestamp: number;

  /** Complete authoritative world state */
  state: TWorld;

  /** Last processed input sequence per player (for reconciliation) */
  inputAcks: Map<string, number>;
}
```

---

## InputMessage

Input message sent from client to server.

```typescript
interface InputMessage<TInput> {
  /** Client-assigned sequence number */
  seq: number;

  /** The actual input data */
  input: TInput;

  /** Client timestamp when captured */
  timestamp: number;
}
```

---

## InputMerger

Function to merge multiple inputs when several arrive in one tick.

```typescript
type InputMerger<TInput> = (inputs: TInput[]) => TInput;
```

### Example

```typescript
// Preserve jump if ANY input had it (prevents missed jumps)
const mergeInputs: InputMerger<MyInput> = (inputs) => {
  const last = inputs[inputs.length - 1];
  const anyJump = inputs.some((i) => i.jump);
  return { ...last, jump: anyJump };
};
```

---

## PredictionScope

Interface for defining what parts of the world to predict client-side.

```typescript
interface PredictionScope<TWorld, TInput> {
  /** Extract the portion of world that should be predicted */
  extractPredictable(world: TWorld, localPlayerId: string): Partial<TWorld>;

  /** Merge predicted state back into full world */
  mergePrediction(
    serverWorld: TWorld,
    predicted: Partial<TWorld>,
    localPlayerId?: string
  ): TWorld;

  /** Simulate the predicted portion */
  simulatePredicted(
    state: Partial<TWorld>,
    input: TInput,
    deltaTime: number,
    localPlayerId?: string
  ): Partial<TWorld>;

  /** Create idle input for simulating other players */
  createIdleInput(): TInput;
}
```

### Why PredictionScope?

Not everything should be predicted - only the local player's movement typically needs prediction. Other players are interpolated from server snapshots.

The scope lets you:
1. Extract just the local player for prediction
2. Simulate only what's needed
3. Merge the prediction back while keeping server state for everything else

---

## ActionMessage

Action message for discrete events (attacks, abilities) that need lag compensation.

```typescript
interface ActionMessage<TAction> {
  /** Client-assigned sequence number */
  seq: number;

  /** The action data */
  action: TAction;

  /** Client timestamp when action occurred */
  clientTimestamp: number;
}
```

---

## ActionResult

Result of an action after server validation.

```typescript
interface ActionResult<TResult> {
  /** Sequence number of the corresponding action */
  seq: number;

  /** Whether the action succeeded */
  success: boolean;

  /** Optional result data (e.g., damage dealt) */
  result?: TResult;

  /** Server timestamp when processed */
  serverTimestamp: number;
}
```

---

## ActionValidator

Function to validate an action against historical world state (lag compensation).

```typescript
type ActionValidator<TWorld, TAction, TResult> = (
  world: TWorld,
  clientId: string,
  action: TAction,
) => { success: boolean; result?: TResult };
```

### Example

```typescript
const validateAttack: ActionValidator<MyWorld, AttackAction, DamageResult> = (
  world,
  clientId,
  action
) => {
  const attacker = world.players.get(clientId);
  if (!attacker) return { success: false };

  for (const [id, target] of world.players) {
    if (id === clientId) continue;

    const dist = distance(attacker, target);
    if (dist < ATTACK_RANGE) {
      return {
        success: true,
        result: { targetId: id, damage: ATTACK_DAMAGE },
      };
    }
  }

  return { success: false };
};
```
