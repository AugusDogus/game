/**
 * Integration tests that verify client prediction matches server simulation.
 * These tests simulate the full client-server flow to catch timing mismatches.
 */

import { describe, expect, test } from "bun:test";
import { InputBuffer } from "./client/input-buffer.js";
import { Predictor } from "./client/prediction.js";
import { Reconciler } from "./client/reconciliation.js";
import { SnapshotBuffer } from "./core/snapshot-buffer.js";
import type { InputMessage, Snapshot } from "./core/types.js";
import { DefaultWorldManager } from "./core/world.js";
import {
  platformerPredictionScope,
} from "./examples/platformer/prediction.js";
import {
  addPlayerToWorld,
  simulatePlatformer,
} from "./examples/platformer/simulation.js";
import type { PlatformerInput, PlatformerWorld } from "./examples/platformer/types.js";
import { createPlatformerWorld, createIdleInput } from "./examples/platformer/types.js";
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
    const { world: newServerWorld, acks } = serverTick(
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
    tempQueue2.enqueue(PLAYER_ID, { seq: 3, input: remainingInputs[0], timestamp: remainingInputs[0].timestamp });
    tempQueue2.enqueue(PLAYER_ID, { seq: 4, input: remainingInputs[1], timestamp: remainingInputs[1].timestamp });

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
});
