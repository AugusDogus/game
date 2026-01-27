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

  /**
   * Server tick interval in milliseconds (default: ~16.67ms / 60 TPS).
   * 
   * IMPORTANT: This value is validated against the server's tickIntervalMs
   * received in the handshake. If there's a mismatch beyond 1ms tolerance,
   * the client will throw an error. The safest approach is to omit this
   * and let the client use the server-authoritative value.
   */
  tickIntervalMs?: number;

  /** Callback when interpolated world state updates (call your render here) */
  onWorldUpdate?: (world: TWorld) => void;

  /** Callback when another player joins */
  onPlayerJoin?: (playerId: string) => void;

  /** Callback when another player leaves */
  onPlayerLeave?: (playerId: string) => void;

  /** Callback when an action result is received from server */
  onActionResult?: (result: ActionResult<TActionResult>) => void;

  /** Artificial latency for testing (default: 0) */
  simulatedLatency?: number;

  /**
   * FishNet-style tick smoothing configuration.
   * Controls how player positions/transforms are smoothed for rendering.
   */
  smoothing?: SmoothingConfig;

  // Option 1: Pass a GameDefinition
  game?: GameDefinition<TWorld, TInput>;

  // Option 2: Pass functions explicitly
  predictionScope?: PredictionScope<TWorld, TInput>;
}

interface SmoothingConfig {
  /** Adaptive interpolation level (default: Low) */
  adaptiveInterpolation?: AdaptiveInterpolationLevel;

  /** Adaptive smoothing type (default: Default) */
  adaptiveSmoothingType?: AdaptiveSmoothingType;

  /** Interpolation percent applied to tick lag (0-1, default: 1) */
  interpolationPercent?: number;

  /** Collision interpolation percent applied to corrections (0-1, default: 1) */
  collisionInterpolationPercent?: number;

  /** Interpolation decrease step for Custom smoothing (default: 1) */
  interpolationDecreaseStep?: number;

  /** Interpolation increase step for Custom smoothing (default: 1) */
  interpolationIncreaseStep?: number;

  /** Distance threshold for teleporting instead of smoothing (default: 200) */
  teleportThreshold?: number;

  /** Axis-specific teleport threshold for X (optional) */
  teleportThresholdX?: number;

  /** Axis-specific teleport threshold for Y (optional) */
  teleportThresholdY?: number;

  /** Smooth X position (default: true) */
  smoothPositionX?: boolean;

  /** Smooth Y position (default: true) */
  smoothPositionY?: boolean;

  /** Maximum snapshots to buffer (default: 30) */
  snapshotBufferSize?: number;

  /** Enable rotation smoothing for 2D angles (default: false) */
  smoothRotation?: boolean;

  /** Enable scale smoothing (default: false) */
  smoothScale?: boolean;

  /** Smooth scale X (default: true) */
  smoothScaleX?: boolean;

  /** Smooth scale Y (default: true) */
  smoothScaleY?: boolean;

  /** Rotation threshold for teleporting in radians (default: Math.PI) */
  rotationTeleportThreshold?: number;

  /** Axis-specific teleport threshold for scale X (optional) */
  scaleTeleportThresholdX?: number;

  /** Axis-specific teleport threshold for scale Y (optional) */
  scaleTeleportThresholdY?: number;

  /** Enable extrapolation for spectators when queue is empty (default: true) */
  enableExtrapolation?: boolean;

  /** Maximum extrapolation time in ms (default: 2 ticks) */
  maxExtrapolationMs?: number;
}
```

### Server-Authoritative Tick Contract

The netcode uses a server-authoritative tick contract. When a client connects, the server sends a `netcode:config` handshake containing the tick rate. The client validates this against any locally configured `tickIntervalMs`.

- If the client specifies `tickIntervalMs` and it differs from the server's by more than 1ms, the client throws an error.
- Recommendation: Omit `tickIntervalMs` from client config to use the server's authoritative value.

### Automated Latency Testing

For automated latency and jitter testing, use `simulatedLatency` in `createClient` and the deterministic latency harness in `packages/netcode/src/test-utils/latency.ts`.

- Run all netcode tests: `bun test packages/netcode`
- Run only the ROUNDS smoke test: `bun test packages/netcode/src/rounds-smoke.test.ts`

### FishNet Parity

Behavioral alignment with FishNet is tracked in `docs/concepts/fishnet-parity.md`.

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
