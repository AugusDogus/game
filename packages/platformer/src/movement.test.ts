import { describe, expect, it } from "bun:test";
import { CharacterController } from "@game/physics2d";
import { vec2 } from "@game/physics2d";
import type { Collider } from "@game/physics2d";
import {
  createPlayerMovementState,
  updatePlayerMovement,
  derivePhysics,
  DEFAULT_PLAYER_CONFIG,
} from "./movement.js";
import type { PlayerConfig, PreviousCollisions, PlatformerMovementInput } from "./types.js";

// Test helpers
function createTestConfig(overrides: Partial<PlayerConfig> = {}): PlayerConfig {
  return { ...DEFAULT_PLAYER_CONFIG, ...overrides };
}

function createTestInput(overrides: Partial<PlatformerMovementInput> = {}): PlatformerMovementInput {
  return { moveX: 0, moveY: 0, jump: false, jumpPressed: false, jumpReleased: false, ...overrides };
}

function createGroundedCollisions(): PreviousCollisions {
  return { below: true, left: false, right: false };
}

function createAirborneCollisions(): PreviousCollisions {
  return { below: false, left: false, right: false };
}


// Create a simple test setup with a ground platform
function createTestSetup() {
  const colliders: Collider[] = [
    { position: vec2(0, 0), halfExtents: vec2(100, 0.5) }, // Ground
  ];
  const controller = new CharacterController(colliders, {
    position: vec2(0, 10), // Start above ground
    halfSize: vec2(10, 10), // Player size
  });
  const config = createTestConfig();
  const physics = derivePhysics(config);
  return { controller, config, physics, colliders };
}

describe("createPlayerMovementState", () => {
  it("initializes all state fields correctly", () => {
    const state = createPlayerMovementState();

    expect(state.velocity.x).toBe(0);
    expect(state.velocity.y).toBe(0);
    expect(state.velocityXSmoothing).toBe(0);
    expect(state.wallSliding).toBe(false);
    expect(state.wallDirX).toBe(0);
    expect(state.timeToWallUnstick).toBe(0);
    expect(state.jumpHeld).toBe(false);
    expect(state.coyoteTimeCounter).toBe(0);
    expect(state.jumpBufferCounter).toBe(0);
  });
});

describe("Coyote Time", () => {
  it("allows jump shortly after walking off edge", () => {
    const { controller, config, physics } = createTestSetup();
    const deltaTime = 0.016; // ~60fps

    // Start grounded
    let state = createPlayerMovementState();
    let prevCollisions = createGroundedCollisions();

    // Update once while grounded to set coyote time counter
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput(),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    // Coyote counter should be at max
    expect(state.coyoteTimeCounter).toBe(config.coyoteTime);

    // Now "walk off" - simulate airborne but within coyote time
    prevCollisions = createAirborneCollisions();
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput(),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    // Coyote counter should have decreased but still be positive
    expect(state.coyoteTimeCounter).toBeGreaterThan(0);
    expect(state.coyoteTimeCounter).toBeLessThan(config.coyoteTime);

    // Now press jump while in coyote time - should work!
    const velocityBeforeJump = state.velocity.y;
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput({ jump: true, jumpPressed: true }),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    // Should have jumped (velocity increased)
    expect(state.velocity.y).toBeGreaterThan(velocityBeforeJump);
    // Coyote counter should be consumed
    expect(state.coyoteTimeCounter).toBe(0);
  });

  it("expires after configured duration", () => {
    const { controller, config, physics } = createTestSetup();
    const deltaTime = 0.016;

    // Start grounded
    let state = createPlayerMovementState();
    let prevCollisions = createGroundedCollisions();

    // Update once while grounded
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput(),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    // Walk off edge
    prevCollisions = createAirborneCollisions();

    // Simulate time passing beyond coyote time
    const framesNeeded = Math.ceil(config.coyoteTime / deltaTime) + 5;
    for (let i = 0; i < framesNeeded; i++) {
      state = updatePlayerMovement(
        controller,
        state,
        createTestInput(),
        config,
        physics,
        deltaTime,
        prevCollisions,
      );
    }

    // Coyote time should be expired
    expect(state.coyoteTimeCounter).toBe(0);

    // Trying to jump now should NOT work (record velocity before)
    const velocityBeforeJump = state.velocity.y;
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput({ jump: true, jumpPressed: true }),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    // Velocity should continue falling (no jump)
    // Note: gravity is applied, so velocity becomes more negative
    expect(state.velocity.y).toBeLessThanOrEqual(velocityBeforeJump);
  });

  it("does not allow double jump via coyote time", () => {
    const { controller, config, physics } = createTestSetup();
    const deltaTime = 0.016;

    let state = createPlayerMovementState();
    let prevCollisions = createGroundedCollisions();

    // Grounded, build up coyote time
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput(),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    // Jump while grounded
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput({ jump: true, jumpPressed: true }),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    const firstJumpVelocity = state.velocity.y;
    expect(firstJumpVelocity).toBeGreaterThan(0);
    // Coyote time should be consumed by the jump
    expect(state.coyoteTimeCounter).toBe(0);

    // Now airborne, try to jump again immediately
    prevCollisions = createAirborneCollisions();

    // Since edge detection is now in the input (not state), we can simply pass jumpPressed: true
    // The simulation will process it, but since we're airborne with no coyote time or wall,
    // the jump won't trigger (no double-jump without extra jumps)
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput({ jump: true, jumpPressed: true }),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    // Should NOT have double jumped - velocity should be decreasing due to gravity
    expect(state.velocity.y).toBeLessThan(firstJumpVelocity);
  });

  it("resets when landing", () => {
    const { controller, config, physics } = createTestSetup();
    const deltaTime = 0.016;

    let state = createPlayerMovementState();

    // Start airborne with expired coyote time
    let prevCollisions = createAirborneCollisions();
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput(),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );
    expect(state.coyoteTimeCounter).toBe(0);

    // Land
    prevCollisions = createGroundedCollisions();
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput(),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    // Coyote time should be reset
    expect(state.coyoteTimeCounter).toBe(config.coyoteTime);
  });
});

describe("Jump Buffering", () => {
  it("executes buffered jump on landing", () => {
    const { controller, config, physics } = createTestSetup();
    const deltaTime = 0.016;

    let state = createPlayerMovementState();
    let prevCollisions = createAirborneCollisions();

    // Airborne, press jump (buffer it)
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput({ jump: true, jumpPressed: true }),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    // Jump buffer should be set
    expect(state.jumpBufferCounter).toBe(config.jumpBufferTime);

    // Release jump but buffer persists
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput({ jump: false }),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    // Buffer should still be active (slightly decreased)
    expect(state.jumpBufferCounter).toBeGreaterThan(0);

    // Land - buffer should execute
    prevCollisions = createGroundedCollisions();
    const velocityBeforeLanding = state.velocity.y;

    state = updatePlayerMovement(
      controller,
      state,
      createTestInput({ jump: false }),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    // Should have jumped on landing
    expect(state.velocity.y).toBeGreaterThan(velocityBeforeLanding);
    // Buffer should be consumed
    expect(state.jumpBufferCounter).toBe(0);
  });

  it("expires if not landed in time", () => {
    const { controller, config, physics } = createTestSetup();
    const deltaTime = 0.016;

    let state = createPlayerMovementState();
    let prevCollisions = createAirborneCollisions();

    // Airborne, press jump (buffer it)
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput({ jump: true, jumpPressed: true }),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    expect(state.jumpBufferCounter).toBe(config.jumpBufferTime);

    // Wait for buffer to expire
    const framesNeeded = Math.ceil(config.jumpBufferTime / deltaTime) + 5;
    for (let i = 0; i < framesNeeded; i++) {
      state = updatePlayerMovement(
        controller,
        state,
        createTestInput({ jump: false }),
        config,
        physics,
        deltaTime,
        prevCollisions,
      );
    }

    // Buffer should be expired
    expect(state.jumpBufferCounter).toBe(0);

    // Now land - should NOT jump
    prevCollisions = createGroundedCollisions();

    state = updatePlayerMovement(
      controller,
      state,
      createTestInput({ jump: false }),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    // Should NOT have jumped - buffer was already expired
    expect(state.jumpBufferCounter).toBe(0);
  });

  it("resets buffer on new jump press", () => {
    const { controller, config, physics } = createTestSetup();
    const deltaTime = 0.016;

    let state = createPlayerMovementState();
    let prevCollisions = createAirborneCollisions();

    // Press jump
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput({ jump: true, jumpPressed: true }),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    expect(state.jumpBufferCounter).toBe(config.jumpBufferTime);

    // Wait a bit
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput({ jump: false }),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput({ jump: false }),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    const partiallyDecreased = state.jumpBufferCounter;
    expect(partiallyDecreased).toBeLessThan(config.jumpBufferTime);
    expect(partiallyDecreased).toBeGreaterThan(0);

    // Press jump again - should reset buffer
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput({ jump: true, jumpPressed: true }),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    expect(state.jumpBufferCounter).toBe(config.jumpBufferTime);
  });
});

describe("Coyote Time and Jump Buffer together", () => {
  it("both work in combination", () => {
    const { controller, config, physics } = createTestSetup();
    const deltaTime = 0.016;

    let state = createPlayerMovementState();

    // Start grounded
    let prevCollisions = createGroundedCollisions();
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput(),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    // Walk off edge (go airborne)
    prevCollisions = createAirborneCollisions();
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput(),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    // Both should be active: coyote time from being grounded, no buffer yet
    expect(state.coyoteTimeCounter).toBeGreaterThan(0);
    expect(state.jumpBufferCounter).toBe(0);

    // Press jump while coyote time is active - should use coyote time
    const velocityBeforeJump = state.velocity.y;
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput({ jump: true, jumpPressed: true }),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    // Should have jumped via coyote time
    expect(state.velocity.y).toBeGreaterThan(velocityBeforeJump);
    // Both should be consumed
    expect(state.coyoteTimeCounter).toBe(0);
    expect(state.jumpBufferCounter).toBe(0);
  });

  it("buffer takes precedence when landing with active buffer", () => {
    const { controller, config, physics } = createTestSetup();
    const deltaTime = 0.016;

    let state = createPlayerMovementState();

    // Start airborne, no coyote time
    let prevCollisions = createAirborneCollisions();
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput(),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    expect(state.coyoteTimeCounter).toBe(0);

    // Press jump to buffer it
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput({ jump: true, jumpPressed: true }),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    expect(state.jumpBufferCounter).toBe(config.jumpBufferTime);

    // Release jump
    state = updatePlayerMovement(
      controller,
      state,
      createTestInput({ jump: false }),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    // Land with buffer active
    prevCollisions = createGroundedCollisions();
    const velocityBeforeLanding = state.velocity.y;

    state = updatePlayerMovement(
      controller,
      state,
      createTestInput({ jump: false }),
      config,
      physics,
      deltaTime,
      prevCollisions,
    );

    // Should have jumped from buffer
    expect(state.velocity.y).toBeGreaterThan(velocityBeforeLanding);
    // Buffer consumed
    expect(state.jumpBufferCounter).toBe(0);
  });
});

describe("derivePhysics", () => {
  it("calculates correct gravity from jump height and time", () => {
    const config = createTestConfig({
      maxJumpHeight: 64,
      timeToJumpApex: 0.4,
    });

    const physics = derivePhysics(config);

    // gravity = -(2 * 64) / (0.4)² = -128 / 0.16 = -800
    // Use toBeCloseTo for floating point comparison
    expect(physics.gravity).toBeCloseTo(-800, 10);
  });

  it("calculates correct max jump velocity", () => {
    const config = createTestConfig({
      maxJumpHeight: 64,
      timeToJumpApex: 0.4,
    });

    const physics = derivePhysics(config);

    // maxJumpVelocity = |gravity| * timeToJumpApex = 800 * 0.4 = 320
    expect(physics.maxJumpVelocity).toBeCloseTo(320, 10);
  });

  it("calculates correct min jump velocity", () => {
    const config = createTestConfig({
      maxJumpHeight: 64,
      minJumpHeight: 16,
      timeToJumpApex: 0.4,
    });

    const physics = derivePhysics(config);

    // minJumpVelocity = sqrt(2 * 800 * 16) = sqrt(25600) = 160
    expect(physics.minJumpVelocity).toBeCloseTo(160, 10);
  });
});
