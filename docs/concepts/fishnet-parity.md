# FishNet Parity Matrix (Netcode)

This document captures the behaviors we consider "FishNet aligned" and
maps them to the current implementation. Alignment means:

- Matching the *behavioral contract* (how data flows and is smoothed)
- Guarding against edge cases FishNet handles implicitly
- Covering those behaviors with invariant tests

If a row is marked "Partial" or "Missing", it is a known gap.

## Scope

This covers the server-authoritative strategy and tick smoother:

- `packages/netcode/src/strategies/server-authoritative.ts`
- `packages/netcode/src/client/tick-smoother.ts`
- `packages/netcode/src/client/reconciliation.ts`

## Parity Matrix

| Area | Behavior / Invariant | FishNet Behavior | Status | Where |
| --- | --- | --- | --- | --- |
| Owner smoothing | Owner uses fixed interpolation (1 tick), no adaptive | Fixed 1-tick buffer | Implemented | `TickSmoother.setIsOwner` |
| Spectator smoothing | Adaptive interpolation only for spectators | Adaptive only for remotes | Implemented | `TickSmoother.updateAdaptiveInterpolation` |
| Adaptive smoothing data | Interpolation percent + step tuning | Custom smoothing params | Implemented | `TickSmoother` config |
| Snapshot smoothing | Render uses rate-based queue smoothing, not time lerp | Queue-based smoothing | Implemented | `ServerAuthoritativeClient.getStateForRendering` |
| Reconcile alignment | Owner smoother keys match replay keys | Input seq or prediction tick | Implemented | `Reconciler` + `TickSmoother` tests |
| Stale tick handling | Ignore stale ticks after newer tick applied | Discard late ticks | Implemented | `TickSmoother.onPostTick` |
| Teleport threshold | Large deltas snap instead of smooth | Teleport when threshold exceeded | Implemented | `TickSmoother.moveToTarget` |
| Per-axis position smoothing | X/Y smoothing toggles + axis teleports | NetworkTransform per-axis flags | Implemented | `TickSmoother` config |
| Rotation smoothing | Optional rotation smoothing w/ teleport threshold | NetworkTransform rotation smoothing | Implemented | `TickSmoother` config |
| Scale smoothing | Optional scale smoothing + per-axis controls | NetworkTransform scale smoothing | Implemented | `TickSmoother` config |
| Extrapolation | Spectators extrapolate briefly when queue empty | Optional extrapolation | Implemented | `TickSmoother.extrapolate` |
| Queue clamp | Buffer caps at interpolation + maxOverBuffer | Drop excess entries | Implemented | `TickSmoother.discardExcessiveEntries` |
| Clock sync | RTT/clock offset for tick lag | Clock sync ping + RTT | Implemented | `create-server.ts` + `create-client.ts` |
| Interpolation target | Spectator interp derived from tick lag | Tick lag based buffer | Implemented | `ServerAuthoritativeClient.updateSpectatorInterpolation` |
| Tick source | Remote smoothers use server ticks only | Server tick keys | Implemented | `updateRemotePlayerSmoothers` |
| Tick source | Owner smoothers use prediction tick | Owner uses local prediction tick | Implemented | `onLocalInput` + `setReplayCallback` |
| Desync guards | Ignore snapshots with large backward tick jump | Reset on large regression | Implemented | `ServerAuthoritativeClient.onSnapshot` |
| Packet reordering | Late snapshots do not regress render | Ignore stale tick | Implemented | `TickSmoother.lastProcessedTick` |
| Snapshot interpolation mode | Time-based interpolation between snapshots | FishNet does not use time lerp | Explicitly not used | `getStateForRendering` |

## Known Gaps / Audit Notes

These are areas to watch or extend if strict parity is required:

- **Fine-grained NetworkTransform flags**: FishNet exposes many per-axis and
  per-property smoothing flags. We support per-axis position smoothing and
  rotation/scale toggles, but not all possible combinations.
- **Transport-level packet loss simulation**: We rely on in-process simulation
  (seeded latency/jitter). FishNet does not prescribe a specific test harness.

## How to Keep Parity

1. **Add an invariant test** for any new FishNet behavior.
2. **Update this matrix** with the new behavior and its status.
3. **Avoid "conceptual" alignment** claims without evidence.

