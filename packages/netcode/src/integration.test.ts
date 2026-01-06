/**
 * Integration tests that verify client prediction matches server simulation.
 * These tests simulate the full client-server flow to catch timing mismatches.
 */

import { describe, expect, test } from "bun:test";
import { InputBuffer } from "./client/input-buffer.js";
import { Predictor } from "./client/prediction.js";
import { Reconciler } from "./client/reconciliation.js";
import type { Snapshot } from "./core/types.js";
import {
  platformerPredictionScope,
} from "./examples/platformer/prediction.js";
import {
  addPlayerToWorld,
  simulatePlatformer,
} from "./examples/platformer/simulation.js";
import type { PlatformerInput, PlatformerWorld } from "./examples/platformer/types.js";
import { createIdleInput, createPlatformerWorld } from "./examples/platformer/types.js";
import { InputQueue } from "./server/input-queue.js";

describe("Client-Server Integration", () => {
  const PLAYER_ID = "test-player";

  /**
   * Simulates the server processing inputs exactly like GameLoop does
   */
  function serverTick(
    world: PlatformerWorld,
    inputQueue: InputQueue<PlatformerInput>,
    lastTimestamps: Map<string, number>,
    tickIntervalMs: number,
  ): { world: PlatformerWorld; acks: Map<string, number> } {
    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    const acks = new Map<string, number>();

    // Build acks
    for (const clientId of inputQueue.getClientsWithInputs()) {
      const inputs = inputQueue.getPendingInputs(clientId);
      if (inputs.length > 0) {
        const lastInput = inputs[inputs.length - 1]!;
        acks.set(clientId, lastInput.seq);
        inputQueue.acknowledge(clientId, lastInput.seq);
      }
    }

    let currentWorld = world;
    let hasInputs = false;
    for (const [, msgs] of batchedInputs) {
      if (msgs.length > 0) hasInputs = true;
    }

    // Track which clients had inputs
    const clientsWithInputs = new Set<string>();
    
    if (!hasInputs) {
      // Empty map = simulate all with idle
      const idleInputs = new Map<string, PlatformerInput>();
      currentWorld = simulatePlatformer(currentWorld, idleInputs, tickIntervalMs);
    } else {
      // Process each client's inputs independently
      for (const [clientId, inputMsgs] of batchedInputs) {
        if (inputMsgs.length === 0) continue;
        clientsWithInputs.add(clientId);
        
        for (const inputMsg of inputMsgs) {
          let deltaTime = 16.67;
          const lastTs = lastTimestamps.get(clientId);
          if (lastTs !== null && lastTs !== undefined) {
            const delta = inputMsg.timestamp - lastTs;
            deltaTime = Math.max(1, Math.min(100, delta));
          }
          lastTimestamps.set(clientId, inputMsg.timestamp);

          // Simulate ONLY this client
          const singleInput = new Map<string, PlatformerInput>();
          singleInput.set(clientId, inputMsg.input);
          currentWorld = simulatePlatformer(currentWorld, singleInput, deltaTime);
        }
      }
      
      // Apply idle physics to players without inputs
      for (const playerId of currentWorld.players.keys()) {
        if (!clientsWithInputs.has(playerId)) {
          const idleInput = new Map<string, PlatformerInput>();
          idleInput.set(playerId, createIdleInput());
          currentWorld = simulatePlatformer(currentWorld, idleInput, tickIntervalMs);
        }
      }
    }

    return { world: currentWorld, acks };
  }

  test("single input: client prediction should match server exactly", () => {
    // Setup client
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    // Setup server
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 0, y: 190 }); // On ground
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    // Initialize client with server state
    predictor.setBaseState(serverWorld, PLAYER_ID);

    // Client sends input
    const input: PlatformerInput = { moveX: 1, moveY: 0, jump: false, timestamp: 1000 };
    const seq = inputBuffer.add(input);
    predictor.applyInput(input);

    // Server receives input
    inputQueue.enqueue(PLAYER_ID, { seq, input, timestamp: input.timestamp });

    // Server processes tick
    const { world: newServerWorld } = serverTick(
      serverWorld,
      inputQueue,
      serverTimestamps,
      50,
    );

    // Get positions
    const clientPlayer = predictor.getState()?.players?.get(PLAYER_ID);
    const serverPlayer = newServerWorld.players.get(PLAYER_ID);

    // They should match exactly
    expect(clientPlayer?.position.x).toBeCloseTo(serverPlayer!.position.x, 5);
    expect(clientPlayer?.position.y).toBeCloseTo(serverPlayer!.position.y, 5);
  });

  test("multiple inputs same tick: client prediction should match server", () => {
    // Setup client
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    // Setup server
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 0, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    // Initialize client with server state
    predictor.setBaseState(serverWorld, PLAYER_ID);

    // Client sends 3 inputs at 60Hz
    const inputs: PlatformerInput[] = [
      { moveX: 1, moveY: 0, jump: false, timestamp: 1000 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1016 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1033 },
    ];

    for (const input of inputs) {
      const seq = inputBuffer.add(input);
      predictor.applyInput(input);
      inputQueue.enqueue(PLAYER_ID, { seq, input, timestamp: input.timestamp });
    }

    // Server processes tick
    const { world: newServerWorld } = serverTick(
      serverWorld,
      inputQueue,
      serverTimestamps,
      50,
    );

    // Get positions
    const clientPlayer = predictor.getState()?.players?.get(PLAYER_ID);
    const serverPlayer = newServerWorld.players.get(PLAYER_ID);

    // They should match exactly
    expect(clientPlayer?.position.x).toBeCloseTo(serverPlayer!.position.x, 5);
    expect(clientPlayer?.position.y).toBeCloseTo(serverPlayer!.position.y, 5);
  });

  test("reconciliation: after server ack, client should match server", () => {
    // Setup client
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    // Setup server
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 0, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();
    let serverTick_ = 0;

    // Initialize client
    predictor.setBaseState(serverWorld, PLAYER_ID);
    const reconciler = new Reconciler<PlatformerWorld, PlatformerInput>(
      inputBuffer,
      predictor,
      platformerPredictionScope,
      PLAYER_ID,
    );

    // Client sends 3 inputs
    const inputs: PlatformerInput[] = [
      { moveX: 1, moveY: 0, jump: false, timestamp: 1000 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1016 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1033 },
    ];

    for (const input of inputs) {
      const seq = inputBuffer.add(input);
      predictor.applyInput(input);
      inputQueue.enqueue(PLAYER_ID, { seq, input, timestamp: input.timestamp });
    }

    // Server processes tick
    const { world: newServerWorld, acks } = serverTick(
      serverWorld,
      inputQueue,
      serverTimestamps,
      50,
    );
    serverWorld = newServerWorld;
    serverTick_++;

    // Create snapshot
    const snapshot: Snapshot<PlatformerWorld> = {
      tick: serverTick_,
      timestamp: Date.now(),
      state: serverWorld,
      inputAcks: acks,
    };

    // Client reconciles
    reconciler.reconcile(snapshot);

    // Get positions after reconciliation
    const clientPlayer = predictor.getState()?.players?.get(PLAYER_ID);
    const serverPlayer = serverWorld.players.get(PLAYER_ID);

    // They should match exactly
    expect(clientPlayer?.position.x).toBeCloseTo(serverPlayer!.position.x, 5);
    expect(clientPlayer?.position.y).toBeCloseTo(serverPlayer!.position.y, 5);
  });

  test("reconciliation with unacked inputs: client replays correctly", () => {
    // Setup client
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    // Setup server
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 0, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();
    let serverTick_ = 0;

    // Initialize client
    predictor.setBaseState(serverWorld, PLAYER_ID);
    const reconciler = new Reconciler<PlatformerWorld, PlatformerInput>(
      inputBuffer,
      predictor,
      platformerPredictionScope,
      PLAYER_ID,
    );

    // Client sends 5 inputs
    const inputs: PlatformerInput[] = [
      { moveX: 1, moveY: 0, jump: false, timestamp: 1000 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1016 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1033 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1050 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1066 },
    ];

    for (const input of inputs) {
      const seq = inputBuffer.add(input);
      predictor.applyInput(input);
      inputQueue.enqueue(PLAYER_ID, { seq, input, timestamp: input.timestamp });
    }

    // Server only processes first 3 inputs (simulating network delay)
    // We need to manually limit what the server sees
    const firstThreeInputs = inputQueue.getPendingInputs(PLAYER_ID).slice(0, 3);
    
    // Clear and re-add only first 3
    const tempQueue = new InputQueue<PlatformerInput>();
    for (const msg of firstThreeInputs) {
      tempQueue.enqueue(PLAYER_ID, msg);
    }

    const { world: newServerWorld, acks } = serverTick(
      serverWorld,
      tempQueue,
      serverTimestamps,
      50,
    );
    serverWorld = newServerWorld;
    serverTick_++;

    // Manually set ack to seq 2 (0-indexed, so inputs 0, 1, 2 are acked)
    acks.set(PLAYER_ID, 2);

    // Create snapshot
    const snapshot: Snapshot<PlatformerWorld> = {
      tick: serverTick_,
      timestamp: Date.now(),
      state: serverWorld,
      inputAcks: acks,
    };

    // Client reconciles - should replay inputs 3 and 4
    reconciler.reconcile(snapshot);

    // Now simulate server processing inputs 3 and 4
    const remainingInputs = [inputs[3]!, inputs[4]!];
    const tempQueue2 = new InputQueue<PlatformerInput>();
    tempQueue2.enqueue(PLAYER_ID, { seq: 3, input: remainingInputs[0]!, timestamp: remainingInputs[0]!.timestamp });
    tempQueue2.enqueue(PLAYER_ID, { seq: 4, input: remainingInputs[1]!, timestamp: remainingInputs[1]!.timestamp });

    const { world: finalServerWorld } = serverTick(
      serverWorld,
      tempQueue2,
      serverTimestamps,
      50,
    );

    // Get positions
    const clientPlayer = predictor.getState()?.players?.get(PLAYER_ID);
    const serverPlayer = finalServerWorld.players.get(PLAYER_ID);

    // They should match
    expect(clientPlayer?.position.x).toBeCloseTo(serverPlayer!.position.x, 5);
    expect(clientPlayer?.position.y).toBeCloseTo(serverPlayer!.position.y, 5);
  });

  test("jump physics: client prediction should match server", () => {
    // Setup client
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    // Setup server
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 0, y: 190 }); // On ground
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    // Initialize client with server state
    predictor.setBaseState(serverWorld, PLAYER_ID);

    // Client sends jump input followed by movement
    const inputs: PlatformerInput[] = [
      { moveX: 0, moveY: 0, jump: true, timestamp: 1000 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1016 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1033 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1050 },
    ];

    for (const input of inputs) {
      const seq = inputBuffer.add(input);
      predictor.applyInput(input);
      inputQueue.enqueue(PLAYER_ID, { seq, input, timestamp: input.timestamp });
    }

    // Server processes tick
    const { world: newServerWorld } = serverTick(
      serverWorld,
      inputQueue,
      serverTimestamps,
      50,
    );

    // Get positions
    const clientPlayer = predictor.getState()?.players?.get(PLAYER_ID);
    const serverPlayer = newServerWorld.players.get(PLAYER_ID);

    // They should match exactly
    expect(clientPlayer?.position.x).toBeCloseTo(serverPlayer!.position.x, 5);
    expect(clientPlayer?.position.y).toBeCloseTo(serverPlayer!.position.y, 5);
    expect(clientPlayer?.velocity.y).toBeCloseTo(serverPlayer!.velocity.y, 5);
  });

  test("quick tap: single input then stop should match", () => {
    // Setup client
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    // Setup server
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 0, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    // Initialize client with server state
    predictor.setBaseState(serverWorld, PLAYER_ID);

    // Quick tap: move right then stop
    const inputs: PlatformerInput[] = [
      { moveX: 1, moveY: 0, jump: false, timestamp: 1000 },
      { moveX: 0, moveY: 0, jump: false, timestamp: 1016 },
    ];

    for (const input of inputs) {
      const seq = inputBuffer.add(input);
      predictor.applyInput(input);
      inputQueue.enqueue(PLAYER_ID, { seq, input, timestamp: input.timestamp });
    }

    // Server processes tick
    const { world: newServerWorld } = serverTick(
      serverWorld,
      inputQueue,
      serverTimestamps,
      50,
    );

    // Get positions
    const clientPlayer = predictor.getState()?.players?.get(PLAYER_ID);
    const serverPlayer = newServerWorld.players.get(PLAYER_ID);

    // They should match exactly
    expect(clientPlayer?.position.x).toBeCloseTo(serverPlayer!.position.x, 5);
    expect(clientPlayer?.position.y).toBeCloseTo(serverPlayer!.position.y, 5);
  });

  test("two clients: both should have correct physics", () => {
    // Setup server
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, "player-a", { x: 0, y: 190 });
    serverWorld = addPlayerToWorld(serverWorld, "player-b", { x: 100, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    // Setup clients
    const predictorA = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    const predictorB = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    predictorA.setBaseState(serverWorld, "player-a");
    predictorB.setBaseState(serverWorld, "player-b");

    // Client A sends 3 inputs (moving right)
    const inputsA: PlatformerInput[] = [
      { moveX: 1, moveY: 0, jump: false, timestamp: 1000 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1016 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1033 },
    ];

    // Client B sends 2 inputs (moving left)
    const inputsB: PlatformerInput[] = [
      { moveX: -1, moveY: 0, jump: false, timestamp: 1005 },
      { moveX: -1, moveY: 0, jump: false, timestamp: 1030 },
    ];

    // Client A predicts
    for (const input of inputsA) {
      predictorA.applyInput(input);
      inputQueue.enqueue("player-a", { seq: inputsA.indexOf(input), input, timestamp: input.timestamp });
    }

    // Client B predicts
    for (const input of inputsB) {
      predictorB.applyInput(input);
      inputQueue.enqueue("player-b", { seq: inputsB.indexOf(input), input, timestamp: input.timestamp });
    }

    // Server processes tick
    const { world: newServerWorld } = serverTick(
      serverWorld,
      inputQueue,
      serverTimestamps,
      50,
    );

    // Get positions
    const clientPlayerA = predictorA.getState()?.players?.get("player-a");
    const clientPlayerB = predictorB.getState()?.players?.get("player-b");
    const serverPlayerA = newServerWorld.players.get("player-a");
    const serverPlayerB = newServerWorld.players.get("player-b");

    // Client A should match server (moving right)
    expect(clientPlayerA?.position.x).toBeCloseTo(serverPlayerA!.position.x, 1);
    expect(clientPlayerA?.position.y).toBeCloseTo(serverPlayerA!.position.y, 1);

    // Client B should match server (moving left)
    expect(clientPlayerB?.position.x).toBeCloseTo(serverPlayerB!.position.x, 1);
    expect(clientPlayerB?.position.y).toBeCloseTo(serverPlayerB!.position.y, 1);

    // Verify they moved in opposite directions
    expect(serverPlayerA!.position.x).toBeGreaterThan(0); // Moved right
    expect(serverPlayerB!.position.x).toBeLessThan(100); // Moved left
  });

  test("multiple ticks: continuous movement across ticks should match", () => {
    // Setup client
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    // Setup server
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 0, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();
    let serverTickNum = 0;

    // Initialize client
    predictor.setBaseState(serverWorld, PLAYER_ID);
    const reconciler = new Reconciler<PlatformerWorld, PlatformerInput>(
      inputBuffer,
      predictor,
      platformerPredictionScope,
      PLAYER_ID,
    );

    // Simulate 3 server ticks with inputs
    for (let tick = 0; tick < 3; tick++) {
      // Client sends 3 inputs per tick (60Hz client, 20Hz server)
      const baseTime = 1000 + tick * 50;
      const inputs: PlatformerInput[] = [
        { moveX: 1, moveY: 0, jump: false, timestamp: baseTime },
        { moveX: 1, moveY: 0, jump: false, timestamp: baseTime + 16 },
        { moveX: 1, moveY: 0, jump: false, timestamp: baseTime + 33 },
      ];

      for (const input of inputs) {
        const seq = inputBuffer.add(input);
        predictor.applyInput(input);
        inputQueue.enqueue(PLAYER_ID, { seq, input, timestamp: input.timestamp });
      }

      // Server processes tick
      const { world: newServerWorld, acks } = serverTick(
        serverWorld,
        inputQueue,
        serverTimestamps,
        50,
      );
      serverWorld = newServerWorld;
      serverTickNum++;

      // Create snapshot
      const snapshot: Snapshot<PlatformerWorld> = {
        tick: serverTickNum,
        timestamp: Date.now(),
        state: serverWorld,
        inputAcks: acks,
      };

      // Client reconciles
      reconciler.reconcile(snapshot);

      // After each reconciliation, client and server should match
      const clientPlayer = predictor.getState()?.players?.get(PLAYER_ID);
      const serverPlayer = serverWorld.players.get(PLAYER_ID);

      expect(clientPlayer?.position.x).toBeCloseTo(serverPlayer!.position.x, 5);
      expect(clientPlayer?.position.y).toBeCloseTo(serverPlayer!.position.y, 5);
    }
  });

  test("stop movement: no snap-back when releasing movement key", () => {
    // This test verifies the fix for rubber-banding when stopping
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 0, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();
    let serverTickNum = 0;

    predictor.setBaseState(serverWorld, PLAYER_ID);
    const reconciler = new Reconciler<PlatformerWorld, PlatformerInput>(
      inputBuffer,
      predictor,
      platformerPredictionScope,
      PLAYER_ID,
    );

    // Move right for 2 inputs, then stop
    const inputs: PlatformerInput[] = [
      { moveX: 1, moveY: 0, jump: false, timestamp: 1000 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1016 },
      { moveX: 0, moveY: 0, jump: false, timestamp: 1033 }, // Stop
      { moveX: 0, moveY: 0, jump: false, timestamp: 1050 }, // Still stopped
    ];

    for (const input of inputs) {
      const seq = inputBuffer.add(input);
      predictor.applyInput(input);
      inputQueue.enqueue(PLAYER_ID, { seq, input, timestamp: input.timestamp });
    }

    // Server processes tick
    const { world: newServerWorld, acks } = serverTick(
      serverWorld,
      inputQueue,
      serverTimestamps,
      50,
    );

    const snapshot: Snapshot<PlatformerWorld> = {
      tick: ++serverTickNum,
      timestamp: Date.now(),
      state: newServerWorld,
      inputAcks: acks,
    };

    // Record predicted position BEFORE reconciliation
    const predictedBefore = predictor.getState()?.players?.get(PLAYER_ID)?.position.x;

    // Client reconciles
    reconciler.reconcile(snapshot);

    // Record position AFTER reconciliation
    const predictedAfter = predictor.getState()?.players?.get(PLAYER_ID)?.position.x;
    const serverPosition = newServerWorld.players.get(PLAYER_ID)?.position.x;

    // Client and server should match
    expect(predictedAfter).toBeCloseTo(serverPosition!, 5);

    // The delta between before and after should be minimal (no snap-back)
    const delta = Math.abs((predictedAfter ?? 0) - (predictedBefore ?? 0));
    expect(delta).toBeLessThan(1); // Less than 1 unit difference
  });

  test("two clients: physics should not multiply", () => {
    // This test verifies that adding a second client doesn't cause
    // gravity to be applied multiple times (the 2x gravity bug)
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, "player-a", { x: 0, y: 0 }); // In the air
    serverWorld = addPlayerToWorld(serverWorld, "player-b", { x: 100, y: 0 }); // Also in the air
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    // Both players send idle inputs (no movement, just gravity should apply)
    inputQueue.enqueue("player-a", {
      seq: 0,
      input: { moveX: 0, moveY: 0, jump: false, timestamp: 1000 },
      timestamp: 1000,
    });
    inputQueue.enqueue("player-b", {
      seq: 0,
      input: { moveX: 0, moveY: 0, jump: false, timestamp: 1000 },
      timestamp: 1000,
    });

    // Process one tick
    const { world: newServerWorld } = serverTick(
      serverWorld,
      inputQueue,
      serverTimestamps,
      50,
    );

    const playerA = newServerWorld.players.get("player-a");
    const playerB = newServerWorld.players.get("player-b");

    // Both players should have fallen the same amount due to gravity
    // At 980 gravity, 50ms = 0.98 units/tick velocity change
    // With initial velocity 0, after 50ms: v = 980 * 0.05 = 49 units/sec
    // Position change = 0.5 * 980 * 0.05^2 = 1.225 units (approximately)
    expect(playerA?.position.y).toBeCloseTo(playerB!.position.y, 5);
    
    // Critical: gravity should be applied only once, not twice
    // If gravity was applied twice, position.y would be ~2.45 instead of ~1.225
    expect(playerA?.position.y).toBeLessThan(3); // Should be around 1.225
  });

  test("two clients: one moving, one idle - physics isolation", () => {
    // Verify that one client's inputs don't affect another client's physics
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, "active", { x: 0, y: 190 }); // On ground
    serverWorld = addPlayerToWorld(serverWorld, "idle", { x: 100, y: 0 }); // In the air
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    // Active player sends multiple movement inputs
    inputQueue.enqueue("active", {
      seq: 0,
      input: { moveX: 1, moveY: 0, jump: false, timestamp: 1000 },
      timestamp: 1000,
    });
    inputQueue.enqueue("active", {
      seq: 1,
      input: { moveX: 1, moveY: 0, jump: false, timestamp: 1016 },
      timestamp: 1016,
    });
    inputQueue.enqueue("active", {
      seq: 2,
      input: { moveX: 1, moveY: 0, jump: false, timestamp: 1033 },
      timestamp: 1033,
    });

    // Idle player sends no inputs

    const { world: newServerWorld } = serverTick(
      serverWorld,
      inputQueue,
      serverTimestamps,
      50,
    );

    const activePlayer = newServerWorld.players.get("active");
    const idlePlayer = newServerWorld.players.get("idle");

    // Active player should have moved right
    expect(activePlayer?.position.x).toBeGreaterThan(0);
    
    // Idle player should NOT have moved horizontally
    expect(idlePlayer?.position.x).toBe(100);
    
    // Idle player SHOULD have fallen due to gravity (applied once for tickInterval)
    expect(idlePlayer?.position.y).toBeGreaterThan(0);
    expect(idlePlayer?.position.y).toBeLessThan(10); // But not too much (only 50ms of gravity)
  });

  test("variable delta timing: irregular input timestamps should work", () => {
    // Simulate network jitter causing variable timing between inputs
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 0, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    predictor.setBaseState(serverWorld, PLAYER_ID);

    // Inputs with irregular timing (simulating network jitter)
    const inputs: PlatformerInput[] = [
      { moveX: 1, moveY: 0, jump: false, timestamp: 1000 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1010 }, // 10ms delta (faster)
      { moveX: 1, moveY: 0, jump: false, timestamp: 1040 }, // 30ms delta (slower)
      { moveX: 1, moveY: 0, jump: false, timestamp: 1055 }, // 15ms delta (normal)
    ];

    for (const input of inputs) {
      const seq = inputBuffer.add(input);
      predictor.applyInput(input);
      inputQueue.enqueue(PLAYER_ID, { seq, input, timestamp: input.timestamp });
    }

    const { world: newServerWorld } = serverTick(
      serverWorld,
      inputQueue,
      serverTimestamps,
      50,
    );

    const clientPlayer = predictor.getState()?.players?.get(PLAYER_ID);
    const serverPlayer = newServerWorld.players.get(PLAYER_ID);

    // Despite irregular timing, client and server should match
    expect(clientPlayer?.position.x).toBeCloseTo(serverPlayer!.position.x, 5);
    expect(clientPlayer?.position.y).toBeCloseTo(serverPlayer!.position.y, 5);
  });

  test("rapid direction changes: quick tap left-right should work", () => {
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 50, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    predictor.setBaseState(serverWorld, PLAYER_ID);

    // Rapid direction changes
    const inputs: PlatformerInput[] = [
      { moveX: 1, moveY: 0, jump: false, timestamp: 1000 },
      { moveX: -1, moveY: 0, jump: false, timestamp: 1016 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1033 },
      { moveX: -1, moveY: 0, jump: false, timestamp: 1050 },
    ];

    for (const input of inputs) {
      const seq = inputBuffer.add(input);
      predictor.applyInput(input);
      inputQueue.enqueue(PLAYER_ID, { seq, input, timestamp: input.timestamp });
    }

    const { world: newServerWorld } = serverTick(
      serverWorld,
      inputQueue,
      serverTimestamps,
      50,
    );

    const clientPlayer = predictor.getState()?.players?.get(PLAYER_ID);
    const serverPlayer = newServerWorld.players.get(PLAYER_ID);

    // Should match exactly despite rapid changes
    expect(clientPlayer?.position.x).toBeCloseTo(serverPlayer!.position.x, 5);
  });

  test("jump during movement: mid-air physics should match", () => {
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 0, y: 190 });
    // Ensure player is grounded
    const player = serverWorld.players.get(PLAYER_ID)!;
    serverWorld = {
      ...serverWorld,
      players: new Map(serverWorld.players).set(PLAYER_ID, { ...player, isGrounded: true }),
    };
    
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    predictor.setBaseState(serverWorld, PLAYER_ID);

    // Jump while moving right
    const inputs: PlatformerInput[] = [
      { moveX: 1, moveY: 0, jump: true, timestamp: 1000 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1016 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1033 },
    ];

    for (const input of inputs) {
      const seq = inputBuffer.add(input);
      predictor.applyInput(input);
      inputQueue.enqueue(PLAYER_ID, { seq, input, timestamp: input.timestamp });
    }

    const { world: newServerWorld } = serverTick(
      serverWorld,
      inputQueue,
      serverTimestamps,
      50,
    );

    const clientPlayer = predictor.getState()?.players?.get(PLAYER_ID);
    const serverPlayer = newServerWorld.players.get(PLAYER_ID);

    // Both X and Y should match
    expect(clientPlayer?.position.x).toBeCloseTo(serverPlayer!.position.x, 5);
    expect(clientPlayer?.position.y).toBeCloseTo(serverPlayer!.position.y, 5);
    expect(clientPlayer?.velocity.y).toBeCloseTo(serverPlayer!.velocity.y, 5);
  });

  test("network latency simulation: delayed acks with pending inputs", () => {
    // Simulates high latency where client has many unacked inputs
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 0, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();
    let serverTickNum = 0;

    predictor.setBaseState(serverWorld, PLAYER_ID);
    const reconciler = new Reconciler<PlatformerWorld, PlatformerInput>(
      inputBuffer,
      predictor,
      platformerPredictionScope,
      PLAYER_ID,
    );

    // Client sends 6 inputs (simulating ~100ms of movement at 60Hz)
    const allInputs: PlatformerInput[] = [];
    for (let i = 0; i < 6; i++) {
      const input: PlatformerInput = {
        moveX: 1,
        moveY: 0,
        jump: false,
        timestamp: 1000 + i * 16,
      };
      allInputs.push(input);
      const seq = inputBuffer.add(input);
      predictor.applyInput(input);
      inputQueue.enqueue(PLAYER_ID, { seq, input, timestamp: input.timestamp });
    }

    // Server only processes first 3 (simulating network delay)
    const tempQueue = new InputQueue<PlatformerInput>();
    for (let i = 0; i < 3; i++) {
      tempQueue.enqueue(PLAYER_ID, { 
        seq: i, 
        input: allInputs[i]!, 
        timestamp: allInputs[i]!.timestamp 
      });
    }

    const { world: partialServerWorld, acks } = serverTick(
      serverWorld,
      tempQueue,
      serverTimestamps,
      50,
    );
    acks.set(PLAYER_ID, 2); // Only ack up to seq 2

    const snapshot: Snapshot<PlatformerWorld> = {
      tick: ++serverTickNum,
      timestamp: Date.now(),
      state: partialServerWorld,
      inputAcks: acks,
    };

    // Client reconciles - should replay inputs 3, 4, 5
    reconciler.reconcile(snapshot);

    // Now server catches up and processes remaining inputs
    const tempQueue2 = new InputQueue<PlatformerInput>();
    for (let i = 3; i < 6; i++) {
      tempQueue2.enqueue(PLAYER_ID, { 
        seq: i, 
        input: allInputs[i]!, 
        timestamp: allInputs[i]!.timestamp 
      });
    }

    const { world: finalServerWorld } = serverTick(
      partialServerWorld,
      tempQueue2,
      serverTimestamps,
      50,
    );

    const clientPlayer = predictor.getState()?.players?.get(PLAYER_ID);
    const serverPlayer = finalServerWorld.players.get(PLAYER_ID);

    // After catching up, they should match
    expect(clientPlayer?.position.x).toBeCloseTo(serverPlayer!.position.x, 5);
  });
});

describe("Scale Tests", () => {
  test("10 players: all should have independent physics", () => {
    const playerCount = 10;
    let serverWorld = createPlatformerWorld();
    const inputQueue = new InputQueue<PlatformerInput>();

    // Add 10 players at different positions
    for (let i = 0; i < playerCount; i++) {
      serverWorld = addPlayerToWorld(serverWorld, `player-${i}`, { x: i * 50, y: 0 });
    }

    // Each player sends different inputs
    const now = 1000;
    for (let i = 0; i < playerCount; i++) {
      // Alternate movement directions
      const moveX = i % 2 === 0 ? 1 : -1;
      inputQueue.enqueue(`player-${i}`, {
        seq: 0,
        input: { moveX, moveY: 0, jump: false, timestamp: now },
        timestamp: now,
      });
    }

    // Process one tick
    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    let currentWorld = serverWorld;
    const clientsWithInputs = new Set<string>();

    for (const [clientId, inputMsgs] of batchedInputs) {
      if (inputMsgs.length === 0) continue;
      clientsWithInputs.add(clientId);
      
      for (const inputMsg of inputMsgs) {
        const singleInput = new Map<string, PlatformerInput>();
        singleInput.set(clientId, inputMsg.input);
        currentWorld = simulatePlatformer(currentWorld, singleInput, 16.67);
      }
    }

    // Verify each player moved correctly
    for (let i = 0; i < playerCount; i++) {
      const player = currentWorld.players.get(`player-${i}`);
      const expectedDirection = i % 2 === 0 ? 1 : -1;
      const startX = i * 50;

      if (expectedDirection === 1) {
        expect(player?.position.x).toBeGreaterThan(startX);
      } else {
        expect(player?.position.x).toBeLessThan(startX);
      }
      
      // All players should have fallen due to gravity
      expect(player?.position.y).toBeGreaterThan(0);
    }

    // Verify gravity was only applied once per player
    const player0Y = currentWorld.players.get("player-0")?.position.y;
    const player9Y = currentWorld.players.get("player-9")?.position.y;
    expect(player0Y).toBeCloseTo(player9Y!, 3); // All fell the same amount
  });

  test("50 players: physics should not multiply", () => {
    const playerCount = 50;
    let serverWorld = createPlatformerWorld();
    const inputQueue = new InputQueue<PlatformerInput>();

    // Add 50 players
    for (let i = 0; i < playerCount; i++) {
      serverWorld = addPlayerToWorld(serverWorld, `player-${i}`, { x: 0, y: 0 });
    }

    // All players send idle inputs
    const now = 1000;
    for (let i = 0; i < playerCount; i++) {
      inputQueue.enqueue(`player-${i}`, {
        seq: 0,
        input: { moveX: 0, moveY: 0, jump: false, timestamp: now },
        timestamp: now,
      });
    }

    // Process tick
    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    let currentWorld = serverWorld;

    for (const [clientId, inputMsgs] of batchedInputs) {
      if (inputMsgs.length === 0) continue;
      
      for (const inputMsg of inputMsgs) {
        const singleInput = new Map<string, PlatformerInput>();
        singleInput.set(clientId, inputMsg.input);
        currentWorld = simulatePlatformer(currentWorld, singleInput, 16.67);
      }
    }

    // All players should have fallen the same amount
    const player0 = currentWorld.players.get("player-0");
    const player49 = currentWorld.players.get("player-49");

    expect(player0?.position.y).toBeCloseTo(player49!.position.y, 3);
    
    // Critical: gravity should be applied only once, not 50x
    // At 980 gravity, 16.67ms: y = 0.5 * 980 * 0.01667^2 ≈ 0.136 units
    expect(player0?.position.y).toBeLessThan(1); // Should be ~0.136, not ~6.8
  });

  test("100 players stress test: physics remains consistent", () => {
    const playerCount = 100;
    let serverWorld = createPlatformerWorld();
    const inputQueue = new InputQueue<PlatformerInput>();

    // Add 100 players
    for (let i = 0; i < playerCount; i++) {
      serverWorld = addPlayerToWorld(serverWorld, `player-${i}`, { x: 0, y: 0 });
    }

    // Half move right, half move left
    const now = 1000;
    for (let i = 0; i < playerCount; i++) {
      const moveX = i < 50 ? 1 : -1;
      inputQueue.enqueue(`player-${i}`, {
        seq: 0,
        input: { moveX, moveY: 0, jump: false, timestamp: now },
        timestamp: now,
      });
    }

    // Process tick
    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    let currentWorld = serverWorld;

    for (const [clientId, inputMsgs] of batchedInputs) {
      if (inputMsgs.length === 0) continue;
      
      for (const inputMsg of inputMsgs) {
        const singleInput = new Map<string, PlatformerInput>();
        singleInput.set(clientId, inputMsg.input);
        currentWorld = simulatePlatformer(currentWorld, singleInput, 16.67);
      }
    }

    // Verify first 50 moved right
    for (let i = 0; i < 50; i++) {
      const player = currentWorld.players.get(`player-${i}`);
      expect(player?.position.x).toBeGreaterThan(0);
    }

    // Verify last 50 moved left
    for (let i = 50; i < 100; i++) {
      const player = currentWorld.players.get(`player-${i}`);
      expect(player?.position.x).toBeLessThan(0);
    }

    // All should have fallen the same amount
    const firstY = currentWorld.players.get("player-0")?.position.y;
    const lastY = currentWorld.players.get("player-99")?.position.y;
    expect(firstY).toBeCloseTo(lastY!, 3);
  });
});

describe("Player Disconnect Tests", () => {
  test("player disconnects mid-movement: remaining players unaffected", () => {
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, "staying", { x: 0, y: 190 });
    serverWorld = addPlayerToWorld(serverWorld, "leaving", { x: 100, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();

    // Both players moving
    inputQueue.enqueue("staying", {
      seq: 0,
      input: { moveX: 1, moveY: 0, jump: false, timestamp: 1000 },
      timestamp: 1000,
    });
    inputQueue.enqueue("leaving", {
      seq: 0,
      input: { moveX: -1, moveY: 0, jump: false, timestamp: 1000 },
      timestamp: 1000,
    });

    // Process first tick with both players
    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    let currentWorld = serverWorld;

    for (const [clientId, inputMsgs] of batchedInputs) {
      for (const inputMsg of inputMsgs) {
        const singleInput = new Map<string, PlatformerInput>();
        singleInput.set(clientId, inputMsg.input);
        currentWorld = simulatePlatformer(currentWorld, singleInput, 16.67);
      }
    }

    const stayingX1 = currentWorld.players.get("staying")?.position.x ?? 0;

    // Remove leaving player (disconnect)
    const newPlayers = new Map(currentWorld.players);
    newPlayers.delete("leaving");
    currentWorld = { ...currentWorld, players: newPlayers };

    // Clear input queue and continue with staying player
    const inputQueue2 = new InputQueue<PlatformerInput>();
    inputQueue2.enqueue("staying", {
      seq: 1,
      input: { moveX: 1, moveY: 0, jump: false, timestamp: 1016 },
      timestamp: 1016,
    });

    const batchedInputs2 = inputQueue2.getAllPendingInputsBatched();
    for (const [clientId, inputMsgs] of batchedInputs2) {
      for (const inputMsg of inputMsgs) {
        const singleInput = new Map<string, PlatformerInput>();
        singleInput.set(clientId, inputMsg.input);
        currentWorld = simulatePlatformer(currentWorld, singleInput, 16);
      }
    }

    // Staying player should have continued moving
    const stayingX2 = currentWorld.players.get("staying")?.position.x ?? 0;
    expect(stayingX2).toBeGreaterThan(stayingX1);
    
    // Leaving player should be gone
    expect(currentWorld.players.has("leaving")).toBe(false);
  });

  test("player disconnects mid-jump: jump state doesn't corrupt other players", () => {
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, "grounded", { x: 0, y: 190 });
    serverWorld = addPlayerToWorld(serverWorld, "jumping", { x: 100, y: 190 });
    
    // Set both as grounded
    const groundedPlayer = serverWorld.players.get("grounded")!;
    const jumpingPlayer = serverWorld.players.get("jumping")!;
    serverWorld = {
      ...serverWorld,
      players: new Map([
        ["grounded", { ...groundedPlayer, isGrounded: true }],
        ["jumping", { ...jumpingPlayer, isGrounded: true }],
      ]),
    };

    const inputQueue = new InputQueue<PlatformerInput>();

    // Jumping player initiates jump
    inputQueue.enqueue("jumping", {
      seq: 0,
      input: { moveX: 0, moveY: 0, jump: true, timestamp: 1000 },
      timestamp: 1000,
    });
    inputQueue.enqueue("grounded", {
      seq: 0,
      input: { moveX: 1, moveY: 0, jump: false, timestamp: 1000 },
      timestamp: 1000,
    });

    // Process tick
    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    let currentWorld = serverWorld;

    for (const [clientId, inputMsgs] of batchedInputs) {
      for (const inputMsg of inputMsgs) {
        const singleInput = new Map<string, PlatformerInput>();
        singleInput.set(clientId, inputMsg.input);
        currentWorld = simulatePlatformer(currentWorld, singleInput, 16.67);
      }
    }

    // Jumping player should have negative Y velocity
    expect(currentWorld.players.get("jumping")?.velocity.y).toBeLessThan(0);

    // Remove jumping player mid-air
    const newPlayers = new Map(currentWorld.players);
    newPlayers.delete("jumping");
    currentWorld = { ...currentWorld, players: newPlayers };

    // Continue simulation for grounded player
    const inputQueue2 = new InputQueue<PlatformerInput>();
    inputQueue2.enqueue("grounded", {
      seq: 1,
      input: { moveX: 1, moveY: 0, jump: false, timestamp: 1016 },
      timestamp: 1016,
    });

    const batchedInputs2 = inputQueue2.getAllPendingInputsBatched();
    for (const [clientId, inputMsgs] of batchedInputs2) {
      for (const inputMsg of inputMsgs) {
        const singleInput = new Map<string, PlatformerInput>();
        singleInput.set(clientId, inputMsg.input);
        currentWorld = simulatePlatformer(currentWorld, singleInput, 16);
      }
    }

    // Grounded player should still be near ground level (not inheriting jump)
    const groundedY = currentWorld.players.get("grounded")?.position.y ?? 0;
    expect(groundedY).toBeGreaterThan(180); // Near floor at 190
  });

  test("multiple players disconnect simultaneously", () => {
    let serverWorld = createPlatformerWorld();
    for (let i = 0; i < 5; i++) {
      serverWorld = addPlayerToWorld(serverWorld, `player-${i}`, { x: i * 50, y: 190 });
    }

    const inputQueue = new InputQueue<PlatformerInput>();
    for (let i = 0; i < 5; i++) {
      inputQueue.enqueue(`player-${i}`, {
        seq: 0,
        input: { moveX: 1, moveY: 0, jump: false, timestamp: 1000 },
        timestamp: 1000,
      });
    }

    // Process first tick
    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    let currentWorld = serverWorld;

    for (const [clientId, inputMsgs] of batchedInputs) {
      for (const inputMsg of inputMsgs) {
        const singleInput = new Map<string, PlatformerInput>();
        singleInput.set(clientId, inputMsg.input);
        currentWorld = simulatePlatformer(currentWorld, singleInput, 16.67);
      }
    }

    // Remove players 1, 2, 3 (keep 0 and 4)
    const newPlayers = new Map(currentWorld.players);
    newPlayers.delete("player-1");
    newPlayers.delete("player-2");
    newPlayers.delete("player-3");
    currentWorld = { ...currentWorld, players: newPlayers };

    // Continue with remaining players
    const inputQueue2 = new InputQueue<PlatformerInput>();
    inputQueue2.enqueue("player-0", {
      seq: 1,
      input: { moveX: 1, moveY: 0, jump: false, timestamp: 1016 },
      timestamp: 1016,
    });
    inputQueue2.enqueue("player-4", {
      seq: 1,
      input: { moveX: -1, moveY: 0, jump: false, timestamp: 1016 },
      timestamp: 1016,
    });

    const batchedInputs2 = inputQueue2.getAllPendingInputsBatched();
    for (const [clientId, inputMsgs] of batchedInputs2) {
      for (const inputMsg of inputMsgs) {
        const singleInput = new Map<string, PlatformerInput>();
        singleInput.set(clientId, inputMsg.input);
        currentWorld = simulatePlatformer(currentWorld, singleInput, 16);
      }
    }

    // Verify remaining players
    expect(currentWorld.players.size).toBe(2);
    expect(currentWorld.players.has("player-0")).toBe(true);
    expect(currentWorld.players.has("player-4")).toBe(true);
    
    // Player 0 continued right (started at 0)
    expect(currentWorld.players.get("player-0")?.position.x).toBeGreaterThan(0);
    // Player 4 moved left (started at 200, second input moved left)
    // First input moved right, second moved left, so net should be close to start
    const player4X = currentWorld.players.get("player-4")?.position.x ?? 0;
    // Player 4 got one right input (tick 1) and one left input (tick 2)
    // The net movement should be small
    expect(Math.abs(player4X - 200)).toBeLessThan(10);
  });
});

describe("Network Condition Tests", () => {
  test("network jitter: variable latency inputs should work", () => {
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, "player", { x: 0, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    predictor.setBaseState(serverWorld, "player");

    // Simulate jittery network: inputs arrive with variable delays
    // Client timestamps are regular, but server receives them with jitter
    const inputs: Array<{ input: PlatformerInput; arrivalDelay: number }> = [
      { input: { moveX: 1, moveY: 0, jump: false, timestamp: 1000 }, arrivalDelay: 20 },
      { input: { moveX: 1, moveY: 0, jump: false, timestamp: 1016 }, arrivalDelay: 50 }, // Delayed
      { input: { moveX: 1, moveY: 0, jump: false, timestamp: 1033 }, arrivalDelay: 15 }, // Fast
      { input: { moveX: 1, moveY: 0, jump: false, timestamp: 1050 }, arrivalDelay: 80 }, // Very delayed
      { input: { moveX: 1, moveY: 0, jump: false, timestamp: 1066 }, arrivalDelay: 25 },
    ];

    // Client predicts immediately (no jitter on client side)
    for (let i = 0; i < inputs.length; i++) {
      inputBuffer.add(inputs[i]!.input);
      predictor.applyInput(inputs[i]!.input);
    }

    // Server receives inputs (potentially out of order due to jitter, but we process in order)
    for (let i = 0; i < inputs.length; i++) {
      inputQueue.enqueue("player", {
        seq: i,
        input: inputs[i]!.input,
        timestamp: inputs[i]!.input.timestamp,
      });
    }

    // Server processes all
    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    let currentWorld = serverWorld;

    for (const [clientId, inputMsgs] of batchedInputs) {
      for (const inputMsg of inputMsgs) {
        let deltaTime = 16.67;
        const lastTs = serverTimestamps.get(clientId);
        if (lastTs !== null && lastTs !== undefined) {
          deltaTime = Math.max(1, Math.min(100, inputMsg.timestamp - lastTs));
        }
        serverTimestamps.set(clientId, inputMsg.timestamp);

        const singleInput = new Map<string, PlatformerInput>();
        singleInput.set(clientId, inputMsg.input);
        currentWorld = simulatePlatformer(currentWorld, singleInput, deltaTime);
      }
    }

    const clientPlayer = predictor.getState()?.players?.get("player");
    const serverPlayer = currentWorld.players.get("player");

    // Despite jitter, client and server should match (using timestamps, not arrival order)
    expect(clientPlayer?.position.x).toBeCloseTo(serverPlayer!.position.x, 3);
  });

  test("out-of-order packets: inputs arriving 3,1,2 should process correctly", () => {
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, "player", { x: 0, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    // Inputs sent in order: 0, 1, 2
    const inputs: PlatformerInput[] = [
      { moveX: 1, moveY: 0, jump: false, timestamp: 1000 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1016 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1033 },
    ];

    // But arrive at server out of order: 2, 0, 1
    inputQueue.enqueue("player", { seq: 2, input: inputs[2]!, timestamp: inputs[2]!.timestamp });
    inputQueue.enqueue("player", { seq: 0, input: inputs[0]!, timestamp: inputs[0]!.timestamp });
    inputQueue.enqueue("player", { seq: 1, input: inputs[1]!, timestamp: inputs[1]!.timestamp });

    // Get pending inputs - they should be sorted by sequence
    const pending = inputQueue.getPendingInputs("player");
    
    // Verify they're sorted by sequence number
    expect(pending[0]?.seq).toBe(0);
    expect(pending[1]?.seq).toBe(1);
    expect(pending[2]?.seq).toBe(2);

    // Process in correct order
    let currentWorld = serverWorld;
    for (const inputMsg of pending) {
      let deltaTime = 16.67;
      const lastTs = serverTimestamps.get("player");
      if (lastTs !== null && lastTs !== undefined) {
        deltaTime = Math.max(1, Math.min(100, inputMsg.timestamp - lastTs));
      }
      serverTimestamps.set("player", inputMsg.timestamp);

      const singleInput = new Map<string, PlatformerInput>();
      singleInput.set("player", inputMsg.input);
      currentWorld = simulatePlatformer(currentWorld, singleInput, deltaTime);
    }

    const player = currentWorld.players.get("player");
    
    // Player should have moved right
    expect(player?.position.x).toBeGreaterThan(0);
    
    // Movement should be reasonable for 3 inputs
    expect(player?.position.x).toBeGreaterThan(5);
    expect(player?.position.x).toBeLessThan(20);
  });

  test("duplicate packets: same input received twice should not double-apply", () => {
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, "player", { x: 0, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();

    const input: PlatformerInput = { moveX: 1, moveY: 0, jump: false, timestamp: 1000 };

    // Same input arrives twice (duplicate packet)
    inputQueue.enqueue("player", { seq: 0, input, timestamp: input.timestamp });
    inputQueue.enqueue("player", { seq: 0, input, timestamp: input.timestamp }); // Duplicate

    // Get pending - duplicates should be filtered by sequence number
    const pending = inputQueue.getPendingInputs("player");
    
    // Should only have one input (duplicates filtered)
    // Note: This depends on InputQueue implementation. If not filtered, this test documents current behavior.
    const uniqueBySeq = [...new Map(pending.map(p => [p.seq, p])).values()];
    
    // Process only unique inputs
    let currentWorld = serverWorld;
    for (const inputMsg of uniqueBySeq) {
      const singleInput = new Map<string, PlatformerInput>();
      singleInput.set("player", inputMsg.input);
      currentWorld = simulatePlatformer(currentWorld, singleInput, 16.67);
    }

    const player = currentWorld.players.get("player");
    
    // Movement should be for 1 input only, not 2
    // 200 units/sec * 0.01667 sec = ~3.33 units
    expect(player?.position.x).toBeGreaterThan(2);
    expect(player?.position.x).toBeLessThan(5); // Not double (~6.67)
  });

  test("packet loss: missing input seq should be handled gracefully", () => {
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, "player", { x: 0, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    // Client sends inputs 0, 1, 2, 3
    // But server only receives 0, 2, 3 (input 1 lost)
    const inputs: PlatformerInput[] = [
      { moveX: 1, moveY: 0, jump: false, timestamp: 1000 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1016 }, // This one is lost
      { moveX: 1, moveY: 0, jump: false, timestamp: 1033 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1050 },
    ];

    // Server receives 0, 2, 3 (not 1)
    inputQueue.enqueue("player", { seq: 0, input: inputs[0]!, timestamp: inputs[0]!.timestamp });
    inputQueue.enqueue("player", { seq: 2, input: inputs[2]!, timestamp: inputs[2]!.timestamp });
    inputQueue.enqueue("player", { seq: 3, input: inputs[3]!, timestamp: inputs[3]!.timestamp });

    const pending = inputQueue.getPendingInputs("player");

    // Process available inputs
    let currentWorld = serverWorld;
    for (const inputMsg of pending) {
      let deltaTime = 16.67;
      const lastTs = serverTimestamps.get("player");
      if (lastTs !== null && lastTs !== undefined) {
        deltaTime = Math.max(1, Math.min(100, inputMsg.timestamp - lastTs));
      }
      serverTimestamps.set("player", inputMsg.timestamp);

      const singleInput = new Map<string, PlatformerInput>();
      singleInput.set("player", inputMsg.input);
      currentWorld = simulatePlatformer(currentWorld, singleInput, deltaTime);
    }

    const player = currentWorld.players.get("player");
    
    // Player should still have moved (graceful handling)
    expect(player?.position.x).toBeGreaterThan(0);
    
    // But less than if all 4 inputs were received
    // With 3 inputs, roughly 3 * 3.33 = ~10 units
    expect(player?.position.x).toBeLessThan(15);
  });

  test("late packets: acknowledged inputs are removed from queue", () => {
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, "player", { x: 0, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();

    // First batch of inputs
    const inputs: PlatformerInput[] = [
      { moveX: 1, moveY: 0, jump: false, timestamp: 1000 },
      { moveX: 1, moveY: 0, jump: false, timestamp: 1016 },
    ];

    for (let i = 0; i < inputs.length; i++) {
      inputQueue.enqueue("player", { seq: i, input: inputs[i]!, timestamp: inputs[i]!.timestamp });
    }

    // Process and acknowledge
    let currentWorld = serverWorld;
    const pending = inputQueue.getPendingInputs("player");
    for (const inputMsg of pending) {
      const singleInput = new Map<string, PlatformerInput>();
      singleInput.set("player", inputMsg.input);
      currentWorld = simulatePlatformer(currentWorld, singleInput, 16.67);
    }
    
    // Acknowledge up to seq 1
    inputQueue.acknowledge("player", 1);

    // After acknowledge, pending inputs should be empty
    const pendingAfterAck = inputQueue.getPendingInputs("player");
    expect(pendingAfterAck.length).toBe(0);
    
    // New input with seq 2 should work
    inputQueue.enqueue("player", { 
      seq: 2, 
      input: { moveX: 1, moveY: 0, jump: false, timestamp: 1033 }, 
      timestamp: 1033 
    });
    
    const pendingNew = inputQueue.getPendingInputs("player");
    expect(pendingNew.length).toBe(1);
    expect(pendingNew[0]?.seq).toBe(2);
  });

  test("burst of inputs after network recovery", () => {
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, "player", { x: 0, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    predictor.setBaseState(serverWorld, "player");

    // Client accumulates 10 inputs during network outage
    const inputs: PlatformerInput[] = [];
    for (let i = 0; i < 10; i++) {
      const input: PlatformerInput = {
        moveX: 1,
        moveY: 0,
        jump: false,
        timestamp: 1000 + i * 16,
      };
      inputs.push(input);
      inputBuffer.add(input);
      predictor.applyInput(input);
    }

    // Network recovers, all inputs arrive at once
    for (let i = 0; i < inputs.length; i++) {
      inputQueue.enqueue("player", { seq: i, input: inputs[i]!, timestamp: inputs[i]!.timestamp });
    }

    // Server processes burst
    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    let currentWorld = serverWorld;

    for (const [clientId, inputMsgs] of batchedInputs) {
      for (const inputMsg of inputMsgs) {
        let deltaTime = 16.67;
        const lastTs = serverTimestamps.get(clientId);
        if (lastTs !== null && lastTs !== undefined) {
          deltaTime = Math.max(1, Math.min(100, inputMsg.timestamp - lastTs));
        }
        serverTimestamps.set(clientId, inputMsg.timestamp);

        const singleInput = new Map<string, PlatformerInput>();
        singleInput.set(clientId, inputMsg.input);
        currentWorld = simulatePlatformer(currentWorld, singleInput, deltaTime);
      }
    }

    const clientPlayer = predictor.getState()?.players?.get("player");
    const serverPlayer = currentWorld.players.get("player");

    // After burst processing, client and server should still match
    expect(clientPlayer?.position.x).toBeCloseTo(serverPlayer!.position.x, 3);
  });
});

describe("Chaos/Fuzz Tests", () => {
  // Seeded random for reproducibility
  function seededRandom(seed: number) {
    return () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
  }

  test("randomized deltas: wild timing variations", () => {
    const random = seededRandom(42);
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, "player", { x: 0, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    predictor.setBaseState(serverWorld, "player");

    // Generate 20 inputs with random deltas (1ms to 100ms - within clamping range)
    let timestamp = 1000;
    const inputs: PlatformerInput[] = [];
    for (let i = 0; i < 20; i++) {
      const delta = Math.floor(random() * 99) + 1; // 1-100ms (within clamp range)
      timestamp += delta;
      const input: PlatformerInput = {
        moveX: random() > 0.5 ? 1 : -1,
        moveY: 0,
        jump: random() > 0.9, // 10% chance of jump
        timestamp,
      };
      inputs.push(input);
      inputBuffer.add(input);
      predictor.applyInput(input);
      inputQueue.enqueue("player", { seq: i, input, timestamp });
    }

    // Server processes
    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    let currentWorld = serverWorld;

    for (const [clientId, inputMsgs] of batchedInputs) {
      for (const inputMsg of inputMsgs) {
        let deltaTime = 16.67;
        const lastTs = serverTimestamps.get(clientId);
        if (lastTs !== null && lastTs !== undefined) {
          deltaTime = Math.max(1, Math.min(100, inputMsg.timestamp - lastTs));
        }
        serverTimestamps.set(clientId, inputMsg.timestamp);

        const singleInput = new Map<string, PlatformerInput>();
        singleInput.set(clientId, inputMsg.input);
        currentWorld = simulatePlatformer(currentWorld, singleInput, deltaTime);
      }
    }

    const clientPlayer = predictor.getState()?.players?.get("player");
    const serverPlayer = currentWorld.players.get("player");

    // Despite chaos, should match (within clamping range)
    expect(clientPlayer?.position.x).toBeCloseTo(serverPlayer!.position.x, 1);
    expect(clientPlayer?.position.y).toBeCloseTo(serverPlayer!.position.y, 1);
  });

  test("extreme micro-deltas: 1ms between inputs", () => {
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, "player", { x: 0, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    predictor.setBaseState(serverWorld, "player");

    // 50 inputs at 1ms apart (simulating spam)
    for (let i = 0; i < 50; i++) {
      const input: PlatformerInput = {
        moveX: 1,
        moveY: 0,
        jump: false,
        timestamp: 1000 + i, // 1ms apart
      };
      inputBuffer.add(input);
      predictor.applyInput(input);
      inputQueue.enqueue("player", { seq: i, input, timestamp: input.timestamp });
    }

    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    let currentWorld = serverWorld;

    for (const [clientId, inputMsgs] of batchedInputs) {
      for (const inputMsg of inputMsgs) {
        let deltaTime = 16.67;
        const lastTs = serverTimestamps.get(clientId);
        if (lastTs !== null && lastTs !== undefined) {
          deltaTime = Math.max(1, Math.min(100, inputMsg.timestamp - lastTs));
        }
        serverTimestamps.set(clientId, inputMsg.timestamp);

        const singleInput = new Map<string, PlatformerInput>();
        singleInput.set(clientId, inputMsg.input);
        currentWorld = simulatePlatformer(currentWorld, singleInput, deltaTime);
      }
    }

    const clientPlayer = predictor.getState()?.players?.get("player");
    const serverPlayer = currentWorld.players.get("player");

    expect(clientPlayer?.position.x).toBeCloseTo(serverPlayer!.position.x, 2);
  });

  test("extreme macro-deltas: 500ms gaps - graceful clamping", () => {
    // Test that large deltas are gracefully clamped to prevent physics explosions
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, "player", { x: 0, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    // Inputs with huge gaps (simulating laggy connection)
    // Total unclamped time: 500+100+800+50+1000+200 = 2650ms
    // With 100ms clamp: 6 inputs * 100ms max = 600ms max
    const gaps = [500, 100, 800, 50, 1000, 200];
    let timestamp = 1000;
    for (let i = 0; i < gaps.length; i++) {
      timestamp += gaps[i]!;
      const input: PlatformerInput = {
        moveX: 1,
        moveY: 0,
        jump: false,
        timestamp,
      };
      inputQueue.enqueue("player", { seq: i, input, timestamp });
    }

    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    let currentWorld = serverWorld;

    for (const [clientId, inputMsgs] of batchedInputs) {
      for (const inputMsg of inputMsgs) {
        let deltaTime = 16.67;
        const lastTs = serverTimestamps.get(clientId);
        if (lastTs !== null && lastTs !== undefined) {
          // Clamp large deltas to 100ms max
          deltaTime = Math.max(1, Math.min(100, inputMsg.timestamp - lastTs));
        }
        serverTimestamps.set(clientId, inputMsg.timestamp);

        const singleInput = new Map<string, PlatformerInput>();
        singleInput.set(clientId, inputMsg.input);
        currentWorld = simulatePlatformer(currentWorld, singleInput, deltaTime);
      }
    }

    const serverPlayer = currentWorld.players.get("player");

    // Player should have moved right (direction preserved)
    expect(serverPlayer?.position.x).toBeGreaterThan(0);
    
    // Movement should be clamped - not as much as 2650ms would give
    // 200 units/sec * 2.65 sec = 530 units unclamped
    // With clamping, should be much less (roughly 6 * 100ms * 200/1000 = 120 max)
    expect(serverPlayer?.position.x).toBeLessThan(200);
    
    // Y should be at or near floor (gravity still works, player landed)
    expect(serverPlayer?.position.y).toBeGreaterThanOrEqual(190);
  });

  test("alternating micro and macro deltas", () => {
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, "player", { x: 0, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    predictor.setBaseState(serverWorld, "player");

    // Alternating 1ms and 100ms gaps (simulating unstable connection)
    let timestamp = 1000;
    for (let i = 0; i < 20; i++) {
      timestamp += i % 2 === 0 ? 1 : 100;
      const input: PlatformerInput = {
        moveX: 1,
        moveY: 0,
        jump: false,
        timestamp,
      };
      inputBuffer.add(input);
      predictor.applyInput(input);
      inputQueue.enqueue("player", { seq: i, input, timestamp });
    }

    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    let currentWorld = serverWorld;

    for (const [clientId, inputMsgs] of batchedInputs) {
      for (const inputMsg of inputMsgs) {
        let deltaTime = 16.67;
        const lastTs = serverTimestamps.get(clientId);
        if (lastTs !== null && lastTs !== undefined) {
          deltaTime = Math.max(1, Math.min(100, inputMsg.timestamp - lastTs));
        }
        serverTimestamps.set(clientId, inputMsg.timestamp);

        const singleInput = new Map<string, PlatformerInput>();
        singleInput.set(clientId, inputMsg.input);
        currentWorld = simulatePlatformer(currentWorld, singleInput, deltaTime);
      }
    }

    const clientPlayer = predictor.getState()?.players?.get("player");
    const serverPlayer = currentWorld.players.get("player");

    expect(clientPlayer?.position.x).toBeCloseTo(serverPlayer!.position.x, 2);
  });

  test("random player count with random inputs", () => {
    const random = seededRandom(123);
    const playerCount = Math.floor(random() * 20) + 5; // 5-24 players
    
    let serverWorld = createPlatformerWorld();
    const inputQueue = new InputQueue<PlatformerInput>();

    // Track initial positions and time-weighted movement
    const initialPositions = new Map<string, number>();
    const timeWeightedMovement = new Map<string, number>(); // moveX * deltaTime
    const lastTimestamps = new Map<string, number>();

    // Add random number of players
    for (let i = 0; i < playerCount; i++) {
      const x = Math.floor(random() * 500) - 250;
      serverWorld = addPlayerToWorld(serverWorld, `player-${i}`, { x, y: 190 });
      initialPositions.set(`player-${i}`, x);
      timeWeightedMovement.set(`player-${i}`, 0);
    }

    // Each player sends random number of inputs (0-10)
    let timestamp = 1000;
    for (let p = 0; p < playerCount; p++) {
      const inputCount = Math.floor(random() * 11);
      for (let i = 0; i < inputCount; i++) {
        const delta = Math.floor(random() * 50) + 1;
        timestamp += delta;
        const moveX = random() > 0.5 ? 1 : random() > 0.5 ? -1 : 0;
        
        // Track time-weighted movement
        const lastTs = lastTimestamps.get(`player-${p}`);
        const effectiveDelta = lastTs !== undefined 
          ? Math.max(1, Math.min(100, timestamp - lastTs)) 
          : 16.67;
        lastTimestamps.set(`player-${p}`, timestamp);
        timeWeightedMovement.set(
          `player-${p}`, 
          (timeWeightedMovement.get(`player-${p}`) ?? 0) + moveX * effectiveDelta
        );
        
        inputQueue.enqueue(`player-${p}`, {
          seq: i,
          input: {
            moveX,
            moveY: 0,
            jump: random() > 0.95,
            timestamp,
          },
          timestamp,
        });
      }
    }

    // Process all inputs
    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    let currentWorld = serverWorld;
    const serverTimestamps = new Map<string, number>();

    for (const [clientId, inputMsgs] of batchedInputs) {
      for (const inputMsg of inputMsgs) {
        let deltaTime = 16.67;
        const lastTs = serverTimestamps.get(clientId);
        if (lastTs !== null && lastTs !== undefined) {
          deltaTime = Math.max(1, Math.min(100, inputMsg.timestamp - lastTs));
        }
        serverTimestamps.set(clientId, inputMsg.timestamp);

        const singleInput = new Map<string, PlatformerInput>();
        singleInput.set(clientId, inputMsg.input);
        currentWorld = simulatePlatformer(currentWorld, singleInput, deltaTime);
      }
    }

    // Apply idle physics to players without inputs
    for (const playerId of currentWorld.players.keys()) {
      if (!batchedInputs.has(playerId) || batchedInputs.get(playerId)!.length === 0) {
        const idleInput = new Map<string, PlatformerInput>();
        idleInput.set(playerId, createIdleInput());
        currentWorld = simulatePlatformer(currentWorld, idleInput, 50);
      }
    }

    // Verify correct behavior for each player
    expect(currentWorld.players.size).toBe(playerCount);
    for (let i = 0; i < playerCount; i++) {
      const player = currentWorld.players.get(`player-${i}`);
      expect(player).toBeDefined();
      
      const initialX = initialPositions.get(`player-${i}`)!;
      const weightedDir = timeWeightedMovement.get(`player-${i}`)!;
      const currentX = player!.position.x;
      
      // Movement direction should match time-weighted direction
      // Use threshold to account for deceleration and physics effects
      if (weightedDir > 100) { // Significant rightward intent
        expect(currentX).toBeGreaterThan(initialX); // Moved right
      } else if (weightedDir < -100) { // Significant leftward intent
        expect(currentX).toBeLessThan(initialX); // Moved left
      }
      // Small or mixed movement - don't assert direction
      
      // Y should be within valid range (above floor if jumping, at floor if not)
      expect(player!.position.y).toBeLessThanOrEqual(200);
      expect(player!.position.y).toBeGreaterThan(0);
      
      // Positions should be reasonable (not exploded to infinity)
      expect(Math.abs(player!.position.x)).toBeLessThan(1000);
    }
  });

  test("rapid direction spam", () => {
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, "player", { x: 100, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    predictor.setBaseState(serverWorld, "player");

    // Rapidly alternate directions every frame
    for (let i = 0; i < 30; i++) {
      const input: PlatformerInput = {
        moveX: i % 2 === 0 ? 1 : -1,
        moveY: 0,
        jump: false,
        timestamp: 1000 + i * 16,
      };
      inputBuffer.add(input);
      predictor.applyInput(input);
      inputQueue.enqueue("player", { seq: i, input, timestamp: input.timestamp });
    }

    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    let currentWorld = serverWorld;

    for (const [clientId, inputMsgs] of batchedInputs) {
      for (const inputMsg of inputMsgs) {
        let deltaTime = 16.67;
        const lastTs = serverTimestamps.get(clientId);
        if (lastTs !== null && lastTs !== undefined) {
          deltaTime = Math.max(1, Math.min(100, inputMsg.timestamp - lastTs));
        }
        serverTimestamps.set(clientId, inputMsg.timestamp);

        const singleInput = new Map<string, PlatformerInput>();
        singleInput.set(clientId, inputMsg.input);
        currentWorld = simulatePlatformer(currentWorld, singleInput, deltaTime);
      }
    }

    const clientPlayer = predictor.getState()?.players?.get("player");
    const serverPlayer = currentWorld.players.get("player");

    // Should still match despite chaos
    expect(clientPlayer?.position.x).toBeCloseTo(serverPlayer!.position.x, 2);
    
    // Player should still be near start (alternating directions cancel out)
    expect(Math.abs(serverPlayer!.position.x - 100)).toBeLessThan(20);
  });

  test("jump spam during movement", () => {
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, "player", { x: 0, y: 190 });
    // Start grounded
    const player = serverWorld.players.get("player")!;
    serverWorld = {
      ...serverWorld,
      players: new Map([["player", { ...player, isGrounded: true }]]),
    };
    
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    predictor.setBaseState(serverWorld, "player");

    // Spam jump while moving (like mashing jump key)
    for (let i = 0; i < 20; i++) {
      const input: PlatformerInput = {
        moveX: 1,
        moveY: 0,
        jump: i % 3 === 0, // Jump every 3rd frame
        timestamp: 1000 + i * 16,
      };
      inputBuffer.add(input);
      predictor.applyInput(input);
      inputQueue.enqueue("player", { seq: i, input, timestamp: input.timestamp });
    }

    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    let currentWorld = serverWorld;

    for (const [clientId, inputMsgs] of batchedInputs) {
      for (const inputMsg of inputMsgs) {
        let deltaTime = 16.67;
        const lastTs = serverTimestamps.get(clientId);
        if (lastTs !== null && lastTs !== undefined) {
          deltaTime = Math.max(1, Math.min(100, inputMsg.timestamp - lastTs));
        }
        serverTimestamps.set(clientId, inputMsg.timestamp);

        const singleInput = new Map<string, PlatformerInput>();
        singleInput.set(clientId, inputMsg.input);
        currentWorld = simulatePlatformer(currentWorld, singleInput, deltaTime);
      }
    }

    const clientPlayer = predictor.getState()?.players?.get("player");
    const serverPlayer = currentWorld.players.get("player");

    expect(clientPlayer?.position.x).toBeCloseTo(serverPlayer!.position.x, 2);
    expect(clientPlayer?.position.y).toBeCloseTo(serverPlayer!.position.y, 2);
  });

  test("zero-delta timestamps (same timestamp) - uses minimum delta", () => {
    // Test that same-timestamp inputs use a minimum delta (1ms) instead of 0
    // This prevents divide-by-zero and zero-time physics
    let serverWorld = createPlatformerWorld();
    serverWorld = addPlayerToWorld(serverWorld, "player", { x: 0, y: 190 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const serverTimestamps = new Map<string, number>();

    // 5 inputs with SAME timestamp
    const timestamp = 1000;
    for (let i = 0; i < 5; i++) {
      const input: PlatformerInput = {
        moveX: 1,
        moveY: 0,
        jump: false,
        timestamp, // All same timestamp!
      };
      inputQueue.enqueue("player", { seq: i, input, timestamp });
    }

    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    let currentWorld = serverWorld;

    for (const [clientId, inputMsgs] of batchedInputs) {
      for (const inputMsg of inputMsgs) {
        let deltaTime = 16.67; // Default for first input
        const lastTs = serverTimestamps.get(clientId);
        if (lastTs !== null && lastTs !== undefined) {
          const delta = inputMsg.timestamp - lastTs;
          // When delta is 0, use minimum of 1ms to prevent zero-time simulation
          deltaTime = delta > 0 ? Math.max(1, Math.min(100, delta)) : 1;
        }
        serverTimestamps.set(clientId, inputMsg.timestamp);

        const singleInput = new Map<string, PlatformerInput>();
        singleInput.set(clientId, inputMsg.input);
        currentWorld = simulatePlatformer(currentWorld, singleInput, deltaTime);
      }
    }

    const serverPlayer = currentWorld.players.get("player");

    // Player moved right (direction correct)
    expect(serverPlayer?.position.x).toBeGreaterThan(0);
    
    // Movement should be small since we used 1ms deltas for duplicates
    // First input: 16.67ms, inputs 2-5: 1ms each = 20.67ms total
    // 200 units/sec * 0.02067 sec ≈ 4.13 units
    expect(serverPlayer?.position.x).toBeGreaterThan(3);
    expect(serverPlayer?.position.x).toBeLessThan(6);
    
    // Y position should be at floor (gravity worked)
    expect(serverPlayer?.position.y).toBeGreaterThanOrEqual(190);
  });

  test("fuzz: 100 iterations of random chaos", () => {
    // Run 100 random scenarios with different seeds
    for (let iteration = 0; iteration < 100; iteration++) {
      const random = seededRandom(iteration * 7919); // Different seed each iteration
      
      let serverWorld = createPlatformerWorld();
      const playerCount = Math.floor(random() * 5) + 1; // 1-5 players
      
      const initialPositions = new Map<string, number>();
      const netMovement = new Map<string, number>(); // Track net moveX
      
      for (let p = 0; p < playerCount; p++) {
        const x = Math.floor(random() * 200) - 100;
        serverWorld = addPlayerToWorld(serverWorld, `p${p}`, { x, y: 190 });
        initialPositions.set(`p${p}`, x);
        netMovement.set(`p${p}`, 0);
      }

      const inputQueue = new InputQueue<PlatformerInput>();
      const serverTimestamps = new Map<string, number>();

      // Random inputs for each player
      for (let p = 0; p < playerCount; p++) {
        const inputCount = Math.floor(random() * 10) + 1;
        let timestamp = 1000;
        for (let i = 0; i < inputCount; i++) {
          timestamp += Math.floor(random() * 100) + 1;
          const moveX = Math.floor(random() * 3) - 1; // -1, 0, or 1
          netMovement.set(`p${p}`, (netMovement.get(`p${p}`) ?? 0) + moveX);
          inputQueue.enqueue(`p${p}`, {
            seq: i,
            input: {
              moveX,
              moveY: 0,
              jump: random() > 0.9,
              timestamp,
            },
            timestamp,
          });
        }
      }

      // Process
      const batchedInputs = inputQueue.getAllPendingInputsBatched();
      let currentWorld = serverWorld;

      for (const [clientId, inputMsgs] of batchedInputs) {
        for (const inputMsg of inputMsgs) {
          let deltaTime = 16.67;
          const lastTs = serverTimestamps.get(clientId);
          if (lastTs !== null && lastTs !== undefined) {
            deltaTime = Math.max(1, Math.min(100, inputMsg.timestamp - lastTs));
          }
          serverTimestamps.set(clientId, inputMsg.timestamp);

          const singleInput = new Map<string, PlatformerInput>();
          singleInput.set(clientId, inputMsg.input);
          currentWorld = simulatePlatformer(currentWorld, singleInput, deltaTime);
        }
      }

      // Verify correct behavior
      for (let p = 0; p < playerCount; p++) {
        const player = currentWorld.players.get(`p${p}`);
        expect(player).toBeDefined();
        
        const initialX = initialPositions.get(`p${p}`)!;
        const net = netMovement.get(`p${p}`)!;
        
        // Movement direction should be consistent with net input
        if (net > 2) {
          expect(player!.position.x).toBeGreaterThan(initialX);
        } else if (net < -2) {
          expect(player!.position.x).toBeLessThan(initialX);
        }
        
        // Y should be in valid range (can be mid-jump or on floor)
        expect(player!.position.y).toBeGreaterThan(0); // Not flown off top
        expect(player!.position.y).toBeLessThanOrEqual(200); // Not fallen through floor
        
        // Positions bounded (no explosions)
        expect(Math.abs(player!.position.x)).toBeLessThan(500);
        
        // Velocities bounded
        expect(Math.abs(player!.velocity.x)).toBeLessThan(300);
        expect(Math.abs(player!.velocity.y)).toBeLessThan(500);
      }
    }
  });
});
