---
name: FishNet tick smoother fix
overview: Properly separate physics and render positions using FishNet-style tick smoothing, remove all dead code and half-measures.
todos:
  - id: remove-pretick-dead-code
    content: Remove unused preTickX/preTickY/hasPreTickPosition and onPreTick method from TickSmoother
    status: completed
  - id: remove-interpolate-function
    content: Remove unused interpolate function from ServerAuthoritativeClient constructor
    status: completed
  - id: add-ismoving-state
    content: Add _isMoving state tracking to prevent restart-stutter when buffer oscillates
    status: completed
  - id: fix-example-configs
    content: Remove invalid interpolationDelayMs from platformer and rounds examples
    status: completed
  - id: update-create-client
    content: Remove interpolate requirement from ClientConfig and createClient
    status: completed
  - id: update-game-definition
    content: Remove interpolate from GameDefinition (now optional in types)
    status: completed
  - id: remove-deprecated-constant
    content: Remove DEFAULT_INTERPOLATION_TICKS from constants.test.ts
    status: completed
  - id: update-tests
    content: Remove onReconciliationReplay tests since method was removed
    status: completed
  - id: fix-create-server
    content: Update create-server.ts to use DEFAULT_SPECTATOR_INTERPOLATION_TICKS instead of removed constant
    status: completed
  - id: verify-all-tests-pass
    content: Run all netcode tests to verify changes
    status: completed
isProject: false
---

# FishNet Tick Smoother Implementation - COMPLETED

## Summary of Changes Made

### 1. TickSmoother Cleanup

**Removed dead code:**

- `preTickX`, `preTickY`, `hasPreTickPosition` fields (were saved but never used)
- `onPreTick()` method (was called but saved values never read)
- `onReconciliationReplay()` method (never called from ServerAuthoritativeClient)

**Added FishNet `_isMoving` state:**

- Prevents restart-stutter when buffer oscillates around interpolation threshold
- Movement only starts when buffer reaches interpolation level
- Once started, continues even if buffer dips below (until critically low at -4)

### 2. ServerAuthoritativeClient Cleanup

**Removed unused `interpolate` function:**

- Was stored in constructor but never called
- Player smoothing handled by TickSmoother
- Non-player entity interpolation is game-specific (user responsibility)

**Simplified constructor:**

```typescript
constructor(
  predictionScope: PredictionScope<TWorld, TInput>,
  tickIntervalMs: number = DEFAULT_TICK_INTERVAL_MS,
  smoothingConfig?: SmoothingConfig,
)
```

### 3. createClient API Simplified

**Removed `interpolate` requirement:**

- `ClientConfig` no longer requires `interpolate` function
- `GameDefinition.interpolate` is now optional (removed from interface)

### 4. Fixed Example Files

**Removed invalid config:**

- `examples/platformer/app/src/game/game-client.ts`: Removed `interpolationDelayMs: 100`
- `examples/rounds/app/src/game/game-client.ts`: Removed `interpolationDelayMs: 100`
- Removed unused `interpolatePlatformer` and `interpolateRounds` imports

### 5. Test Updates

**Updated tests:**

- Removed `onReconciliationReplay` tests from tick-smoother.test.ts
- Removed `DEFAULT_INTERPOLATION_TICKS` import from constants.test.ts

### 6. create-server.ts Fix

**Fixed deprecated constant reference:**

- Line 285 referenced `DEFAULT_INTERPOLATION_TICKS` which was removed
- Changed to `DEFAULT_SPECTATOR_INTERPOLATION_TICKS` (for server-side lag compensation)

## Architecture After Changes

### What Remains (Correct FishNet Behavior)

1. **TickSmoother** with:

   - `onPostTick(tick, x, y)` - Add physics position to queue
   - `getSmoothedPosition(deltaMs)` - Get render position
   - `_isMoving` state tracking
   - Movement multiplier for buffer management (0.95 - 1.05)
   - Teleport threshold handling
   - `teleportedTick` tracking

2. **ServerAuthoritativeClient** with:

   - `localTick` counter for local player
   - `localPlayerSmoother` for local player render smoothing
   - `remotePlayerSmoothers` Map for per-remote-player smoothing
   - Reconciliation replay callback connected to smoother

3. **Flow:**

   - Input → Predictor → Physics position → TickSmoother queue
   - Reconciliation replay → TickSmoother queue (via callback)
   - Render → TickSmoother.getSmoothedPosition() → Render position

## What's NOT Implemented (Intentional Differences)

1. **No pre-tick/post-tick graphical reset:**

   - FishNet resets graphical to pre-tick position in OnPostTick
   - We don't need this since we're working with position data, not Unity transforms
   - The smoother queue achieves the same smooth catch-up effect

2. **No ease-in correction during reconciliation:**

   - FishNet's `ModifyTransformProperties` uses ease-in based on queue position
   - Our approach: just add new positions to queue via `onPostTick`
   - The natural queue progression provides smoothing

3. **No InterpolateFunction:**

   - FishNet has separate concept for non-smoothed properties
   - We only smooth x/y position
   - Non-player entity interpolation is game-specific

## Test Results

All 318 tests passing across 19 files.