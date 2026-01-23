# Client API Reference

The client module provides everything needed to build a multiplayer game client with prediction, reconciliation, and interpolation.

## Import

```typescript
// Recommended: import from client submodule
import { createClient, createGameLoop, createKeyboardInput } from "@game/netcode/client";

// Or from main package
import { createClient } from "@game/netcode";
```

## createClient

Creates a netcode client that handles server communication, prediction, reconciliation, and interpolation.

### Signature

```typescript
function createClient<TWorld, TInput, TAction, TActionResult>(
  config: ClientConfig<TWorld, TInput, TActionResult>
): ClientHandle<TWorld, TInput, TAction>;
```

### Config Options

```typescript
interface ClientConfig<TWorld, TInput, TActionResult> {
  /** Socket.IO client socket */
  socket: Socket;

  /** Callback when interpolated world state updates (call your render here) */
  onWorldUpdate?: (world: TWorld) => void;

  /** Callback when an action result is received from server */
  onActionResult?: (result: ActionResult<TActionResult>) => void;

  // Option 1: Pass a GameDefinition
  game?: GameDefinition<TWorld, TInput>;

  // Option 2: Pass functions explicitly
  predictionScope?: PredictionScope<TWorld, TInput>;
  interpolate?: InterpolateFunction<TWorld>;
}
```

### ClientHandle

```typescript
interface ClientHandle<TWorld, TInput, TAction> {
  /** Get current interpolated world state (for rendering) */
  getWorld(): TWorld | null;

  /** Get current predicted world state (includes local prediction) */
  getPredictedWorld(): TWorld | null;

  /** Get local player ID (assigned by server on connect) */
  getPlayerId(): string | null;

  /** Send input to server (also applies local prediction) */
  sendInput(input: TInput): void;

  /** Send an action to server for lag-compensated validation */
  sendAction(action: TAction): void;

  /** Clean up and disconnect */
  destroy(): void;
}
```

### Example

```typescript
import { io } from "socket.io-client";
import { createClient, superjsonParser } from "@game/netcode";
import { myGame } from "./game";

const socket = io("http://localhost:3000", { parser: superjsonParser });

const client = createClient({
  socket,
  game: myGame,
  onWorldUpdate: (world) => {
    // Called ~60fps with interpolated world state
    renderer.draw(world);
  },
  onActionResult: (result) => {
    if (result.success) {
      playHitSound();
    }
  },
});

// Game loop
function update() {
  const input = gatherInput();
  client.sendInput(input);
  requestAnimationFrame(update);
}
update();
```

---

## createGameLoop

Convenience helper for running a client-side game loop with separate render and input rates.

### Signature

```typescript
function createGameLoop(config: GameLoopConfig): GameLoopHandle;
```

### Config Options

```typescript
interface GameLoopConfig {
  /** Called every frame for rendering (uses requestAnimationFrame) */
  onRender: (deltaMs: number) => void;

  /** Called at fixed rate for sending input */
  onInput?: () => void;

  /** Input send rate in milliseconds (default: 50ms = 20Hz) */
  inputRateMs?: number;
}
```

### GameLoopHandle

```typescript
interface GameLoopHandle {
  /** Start the game loop */
  start(): void;

  /** Stop the game loop */
  stop(): void;

  /** Check if loop is running */
  isRunning(): boolean;
}
```

### Example

```typescript
import { createClient, createGameLoop } from "@game/netcode/client";

const client = createClient({ ... });

const loop = createGameLoop({
  onRender: (dt) => {
    const world = client.getWorld();
    if (world) renderer.draw(world);
  },
  onInput: () => {
    client.sendInput(gatherInput());
  },
  inputRateMs: 50, // Send input at 20Hz
});

loop.start();
```

---

## Client Primitives

For advanced use cases, you can use the lower-level primitives directly.

### InputBuffer

Stores pending inputs that haven't been acknowledged by the server yet.

```typescript
import { InputBuffer } from "@game/netcode/client";

const buffer = new InputBuffer<MyInput>();

const seq = buffer.add(input);           // Add input, get sequence number
const input = buffer.get(seq);           // Get input by sequence
buffer.acknowledge(lastAckedSeq);        // Remove acknowledged inputs
const pending = buffer.getUnacknowledged(afterSeq);  // Get unacked inputs
```

### Predictor

Handles client-side prediction of the local player.

```typescript
import { Predictor } from "@game/netcode/client";

const predictor = new Predictor<MyWorld, MyInput>(predictionScope);

const predicted = predictor.predict(serverWorld, pendingInputs, playerId, deltaTime);
```

### Reconciler

Handles reconciliation when server state differs from prediction.

```typescript
import { Reconciler } from "@game/netcode/client";

const reconciler = new Reconciler<MyWorld, MyInput>(predictionScope);

const reconciled = reconciler.reconcile(
  serverWorld,
  pendingInputs,
  playerId,
  deltaTime
);
```

### Interpolator

Interpolates between server snapshots for smooth rendering.

```typescript
import { Interpolator } from "@game/netcode/client";

const interpolator = new Interpolator<MyWorld>(interpolateFunction);

interpolator.addSnapshot(snapshot);
const interpolated = interpolator.getInterpolatedState(renderTimestamp);
```

### PredictionScope

Interface for defining what parts of the world to predict. See [Types](types.md#predictionscope) for details.

```typescript
import { NoPredictionScope } from "@game/netcode/client";

// Use this if you don't want client-side prediction
const noPrediction = new NoPredictionScope<MyWorld, MyInput>(createIdleInput);
```
