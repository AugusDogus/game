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

  /** Callback when another player joins */
  onPlayerJoin?: (playerId: string) => void;

  /** Callback when another player leaves */
  onPlayerLeave?: (playerId: string) => void;

  /** Callback when an action result is received from server */
  onActionResult?: (result: ActionResult<TActionResult>) => void;

  /** Interpolation delay in ms (default: 100). Higher = smoother but more delay */
  interpolationDelayMs?: number;

  /** Artificial latency for testing (default: 0) */
  simulatedLatency?: number;

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
  /** Send player input to the server. Timestamp is added automatically. */
  sendInput(input: Omit<TInput, "timestamp">): void;

  /** Send a discrete action for lag-compensated validation. Returns sequence number. */
  sendAction(action: TAction): number;

  /** Get the current world state for rendering (predicted local + interpolated remote). */
  getStateForRendering(): TWorld | null;

  /** Get the last raw server snapshot (useful for debug visualization). */
  getLastServerSnapshot(): Snapshot<TWorld> | null;

  /** Get local player ID (assigned by server on connect). */
  getPlayerId(): string | null;

  /** Set artificial latency in milliseconds for testing. */
  setSimulatedLatency(latencyMs: number): void;

  /** Get current artificial latency setting. */
  getSimulatedLatency(): number;

  /** Reset all client state (prediction, interpolation, input buffer). */
  reset(): void;

  /** Get the interpolation delay used by this client. */
  getInterpolationDelayMs(): number;

  /** Clean up socket listeners. Call when unmounting/destroying the client. */
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
    // Called when new snapshot arrives and is processed
    renderer.draw(world);
  },
  onActionResult: (result) => {
    if (result.success) {
      playHitSound();
    }
  },
});

// Game loop - note: timestamp is added automatically, don't pass it
function update() {
  const input = gatherInput(); // Returns { moveX, moveY, jump } without timestamp
  client.sendInput(input);
  requestAnimationFrame(update);
}
update();

// When done (e.g., component unmount)
client.destroy();
```

---

## createGameLoop

Convenience helper for running a client-side game loop with separate render and input rates.

### Signature

```typescript
function createGameLoop<TWorld, TInput>(
  config: GameLoopConfig<TWorld, TInput>
): GameLoopHandle;
```

### Config Options

```typescript
interface GameLoopConfig<TWorld, TInput> {
  /** The netcode client handle */
  client: ClientHandle<TWorld, TInput, unknown>;

  /**
   * Function that returns current input state (WITHOUT timestamp).
   * Called at the configured input rate.
   */
  getInput: () => Omit<TInput, "timestamp">;

  /**
   * Function to render the world state.
   * Called every animation frame with interpolated world.
   */
  render: (world: TWorld, deltaMs: number) => void;

  /**
   * Rate at which to send inputs in Hz (default: 60).
   * 60 = 60 times per second, 20 = 20 times per second.
   */
  inputRate?: number;

  /** Called when render is invoked but no world state is available yet. */
  onNoWorld?: (deltaMs: number) => void;
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

// Track input state
const keys = new Set<string>();
window.addEventListener("keydown", (e) => keys.add(e.key));
window.addEventListener("keyup", (e) => keys.delete(e.key));

const loop = createGameLoop({
  client,
  getInput: () => ({
    // Don't include timestamp - it's added automatically
    moveX: keys.has("d") ? 1 : keys.has("a") ? -1 : 0,
    moveY: 0,
    jump: keys.has(" "),
  }),
  render: (world, deltaMs) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const player of world.players.values()) {
      ctx.fillRect(player.x, player.y, 20, 20);
    }
  },
  inputRate: 60, // 60 Hz (60 times per second)
  onNoWorld: () => {
    // Show loading state
    ctx.fillText("Connecting...", 100, 100);
  },
});

loop.start();

// Later, to stop:
loop.stop();
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
