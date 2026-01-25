---
name: Fixed Tick Client Prediction
overview: Make client-side prediction use the same fixed tick delta (50ms) as the server to eliminate the delta time mismatch that causes physics glitchiness.
todos:
  - id: modify-predictor
    content: Update Predictor class to use fixed tickIntervalMs instead of variable delta
    status: completed
  - id: modify-reconciler
    content: Update Reconciler class to replay with fixed tickIntervalMs
    status: completed
  - id: modify-strategy
    content: Pass tickIntervalMs through ServerAuthoritativeClient
    status: completed
  - id: modify-create-client
    content: Expose tickIntervalMs in client configuration
    status: completed
  - id: cleanup-logs
    content: Remove debug instrumentation from all files
    status: completed
  - id: run-tests
    content: Run tests to verify fix works correctly
    status: completed
isProject: false
---

# Fixed Tick Client Prediction

## Problem Summary

The logs confirmed that client prediction uses variable frame deltas (~16ms per frame at 60fps), while the server now uses a fixed tick delta (50ms). When the client replays 3-4 inputs with ~16ms each (total ~64ms), but the server processed them with a single 50ms delta, there's a ~14ms physics mismatch per tick causing constant reconciliation corrections.

## Solution

Configure both `Predictor` and `Reconciler` to use a fixed tick delta instead of computing variable deltas from input timestamps.

```
Before: Client predicts 4 inputs x ~16ms = ~64ms of physics
        Server simulates merged inputs x 50ms = 50ms of physics
        = 14ms mismatch per tick

After:  Client predicts 4 inputs, MERGES them, applies 1x 50ms = 50ms
        Server simulates merged inputs x 50ms = 50ms
        = 0ms mismatch (identical)
```

## Files to Modify

### 1. [packages/netcode/src/client/prediction.ts](packages/netcode/src/client/prediction.ts)

Add `tickIntervalMs` configuration to the `Predictor` class:

- Add constructor parameter for `tickIntervalMs` (default: 50ms)
- Change `applyInput()` to always use `tickIntervalMs` instead of computing variable delta
- Remove `lastInputTimestamp` tracking (no longer needed for delta calculation)
- Remove the debug instrumentation

### 2. [packages/netcode/src/client/reconciliation.ts](packages/netcode/src/client/reconciliation.ts)

Update `Reconciler` to use fixed delta during replay:

- Add constructor parameter for `tickIntervalMs`
- Change replay loop to use `tickIntervalMs` for each input instead of computing variable deltas
- Remove the debug instrumentation

### 3. [packages/netcode/src/strategies/server-authoritative.ts](packages/netcode/src/strategies/server-authoritative.ts)

Pass tick interval to client components:

- Import `DEFAULT_TICK_INTERVAL_MS` from constants
- Add optional `tickIntervalMs` parameter to `ServerAuthoritativeClient` constructor
- Pass it to `Predictor` and `Reconciler`

### 4. [packages/netcode/src/create-client.ts](packages/netcode/src/create-client.ts)

Expose tick interval configuration:

- Add optional `tickIntervalMs` to `ClientConfigBase`
- Pass it through to `ServerAuthoritativeClient`

### 5. Clean up debug instrumentation

Remove all `#region agent log` blocks from:

- [packages/netcode/src/server/tick-processor.ts](packages/netcode/src/server/tick-processor.ts)
- [packages/netcode/src/client/prediction.ts](packages/netcode/src/client/prediction.ts)
- [packages/netcode/src/client/reconciliation.ts](packages/netcode/src/client/reconciliation.ts)
- [examples/rounds/simulation.ts](examples/rounds/simulation.ts)
- [examples/rounds/prediction.ts](examples/rounds/prediction.ts)

## Key Design Decision

The client will predict with the **same fixed delta per merged input batch** as the server, not per raw input. This means:

- Client collects inputs during a frame
- When predicting, it uses the fixed tick delta (50ms)
- This matches exactly what the server does

This is the standard approach in engines like Source, Unity Netcode, and Photon Fusion where both client and server operate on the same fixed simulation timestep.

## Testing

After implementing, run `bun test` to verify all existing tests pass with the new fixed-delta behavior.