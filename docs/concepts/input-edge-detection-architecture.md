# Input Edge Detection in Client-Side Prediction Architecture

## Problem Statement

When implementing client-side prediction with server reconciliation, **input edge detection** (detecting press/release events) creates a fundamental architectural challenge.

### The Symptoms

- Player holds jump key continuously
- After landing, player unexpectedly jumps again without releasing the key
- This happens after a delay (when reconciliation occurs)

### Root Cause Analysis

#### How Edge Detection Currently Works

The simulation computes edges from previous frame state:

```typescript
// In movement.ts
const jumpPressed = input.jump && !state.jumpWasPressedLastFrame;
const jumpReleased = !input.jump && state.jumpWasPressedLastFrame;
```

This makes edge detection **stateful** - it depends on `jumpWasPressedLastFrame` which is part of the simulation state.

#### Why This Breaks During Reconciliation

1. **Client sends inputs** with `jump: true` (keyboard is held)
2. **Client predicts** - correctly tracks `jumpWasPressedLastFrame: true`, `jumpConsumedWhileHeld: true`
3. **Server sends snapshot** - server's state may have different `jumpWasPressedLastFrame` because it processed inputs at different times
4. **Reconciliation replays inputs** - If ANY historical input had `jump: false`:
   - Simulation sees `jumpReleased: true`
   - Resets `jumpConsumedWhileHeld = false`
5. **After replay** - State has `jumpWasPressedLastFrame: false`, `jumpConsumedWhileHeld: false`
6. **Next input** - Sees `wasPressed: false`, current `input.jump: true`, computes `jumpPressed: true`
7. **Unwanted jump triggers**

#### Evidence from Debug Logs

The raw keyboard state (`game-client.ts:sendCurrentInput`) consistently shows `jump: true` with only ONE `keyup` event at the very end. The keyboard is NOT releasing.

However, `movement.ts:jump-edge` logs show `jumpReleased: true` events mid-session - these come from **replayed inputs** during reconciliation that happened to have `jump: false` (sent before the player pressed space, or due to timing).

## The Fundamental Architectural Mismatch

`jumpWasPressedLastFrame` is trying to serve two incompatible purposes:

1. **Edge detection for physics** - "Did the player JUST press jump this simulation step?" (needed for variable jump height, coyote time, etc.)
2. **Input state continuity** - "Is this a continuation of the same physical key press?"

These are fundamentally different concerns:
- Purpose 1 needs to work correctly during **deterministic replay**
- Purpose 2 needs to track the **REAL keyboard state**, independent of simulation

## The Correct Solution: Client-Side Edge Detection

### Principle

Edge detection should happen **once, at input sampling time**, not during simulation. The client is the ONLY entity that truly knows "this is a new press" vs "this is a continuation of a held key."

### Implementation

```typescript
// Client input sampling (game-client.ts)
private lastSentJumpState: boolean = false;

private sendCurrentInput(): void {
  const jump = this.keys.has(" ") || this.keys.has("w") || this.keys.has("arrowup");
  
  // Edge detection happens HERE, at the source
  const jumpPressed = jump && !this.lastSentJumpState;
  const jumpReleased = !jump && this.lastSentJumpState;
  this.lastSentJumpState = jump;

  this.netcodeClient.sendInput({
    moveX,
    jump,           // Current state
    jumpPressed,    // Rising edge (just pressed)
    jumpReleased,   // Falling edge (just released)
    // ... other fields
  });
}
```

### Input Type Changes

```typescript
interface RoundsInput {
  moveX: number;
  jump: boolean;        // Is jump currently held?
  jumpPressed: boolean; // Was jump JUST pressed this sample?
  jumpReleased: boolean; // Was jump JUST released this sample?
  // ... other fields
}
```

### Simulation Changes

```typescript
// In movement.ts - NO MORE edge computation from history
// Just use the input directly:

if (input.jumpPressed) {
  // Handle new jump press
  jumpBufferCounter = config.jumpBufferTime;
}

if (input.jumpReleased && velocity.y > physics.minJumpVelocity) {
  // Variable jump height - cut velocity on release
  velocity.y = physics.minJumpVelocity;
}
```

### What Gets Removed

- `jumpWasPressedLastFrame` from `PlayerMovementState` (no longer needed)
- `jumpConsumedWhileHeld` from `PlayerMovementState` (handled at input layer)
- Edge computation logic in `updatePlayerMovement`
- All the `preserveClientState` / reconciliation preservation code

## Benefits of This Approach

1. **Fully Deterministic** - Given the same inputs, client and server produce identical results
2. **Fully Replayable** - Reconciliation works correctly because edges are encoded in inputs
3. **Simpler Simulation** - No stateful edge detection logic
4. **No Preservation Needed** - No special handling during reconciliation
5. **Matches Industry Practice** - How professional games handle this

## Migration Path

1. Add `jumpPressed` and `jumpReleased` to input types
2. Implement client-side edge detection in `game-client.ts`
3. Update `updatePlayerMovement` to use `input.jumpPressed` / `input.jumpReleased`
4. Remove `jumpWasPressedLastFrame` and `jumpConsumedWhileHeld` from player state
5. Remove all `preserveClientState` reconciliation code
6. Update tests

## Related Concepts

### Jump Buffering

With this architecture, jump buffering still works:

```typescript
// When jumpPressed is true, start the buffer timer
if (input.jumpPressed) {
  jumpBufferCounter = config.jumpBufferTime;
}

// Buffer decrements each frame
jumpBufferCounter = Math.max(0, jumpBufferCounter - deltaTime);

// Jump can trigger from buffer OR fresh press
const shouldJump = (input.jumpPressed || jumpBufferCounter > 0) && canJump;
```

### Coyote Time

Coyote time is unaffected - it's about "time since leaving ground", not input edges.

### Variable Jump Height

Works by checking `input.jumpReleased`:

```typescript
if (input.jumpReleased && velocity.y > physics.minJumpVelocity) {
  velocity.y = physics.minJumpVelocity;
}
```

### Multi-Jump Prevention

Handled at the input layer:

```typescript
// Client-side
private jumpConsumedThisPress: boolean = false;

private sendCurrentInput(): void {
  const jump = this.keys.has(" ");
  const jumpPressed = jump && !this.lastSentJumpState && !this.jumpConsumedThisPress;
  const jumpReleased = !jump && this.lastSentJumpState;
  
  if (jumpReleased) {
    this.jumpConsumedThisPress = false; // Reset on release
  }
  
  this.lastSentJumpState = jump;
  // ... send input
}

// When we know a jump was consumed (from server or prediction)
onJumpConsumed(): void {
  this.jumpConsumedThisPress = true;
}
```

## References

- Gabriel Gambetta's [Fast-Paced Multiplayer](https://www.gabrielgambetta.com/client-server-game-architecture.html) series
- Valve's [Latency Compensating Methods](https://developer.valvesoftware.com/wiki/Latency_Compensating_Methods_in_Client/Server_In-game_Protocol_Design_and_Optimization)
