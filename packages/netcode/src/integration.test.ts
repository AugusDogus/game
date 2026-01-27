/**
 * Integration tests that verify client prediction and server simulation work together.
 * 
 * With the fixed-tick architecture:
 * - Server: merges all inputs per tick, simulates ONCE with fixed delta
 * - Client: predicts each input with fixed delta
 * 
 * This means client prediction is "ahead" of server by (N-1)*tickInterval when
 * N inputs arrive in a single tick. Reconciliation corrects this when snapshots arrive.
 */

import { describe, expect, test } from "bun:test";
import { InputBuffer } from "./client/input-buffer.js";
import { Predictor } from "./client/prediction.js";
import { Reconciler } from "./client/reconciliation.js";
import { TickSmoother, AdaptiveInterpolationLevel, AdaptiveSmoothingType } from "./client/tick-smoother.js";
import { DEFAULT_TICK_INTERVAL_MS } from "./constants.js";
import type { Snapshot } from "./core/types.js";
import { getLast } from "./core/utils.js";
import {
  platformerPredictionScope,
  addPlayerToWorld,
  forceStartGame,
  simulatePlatformer,
  createIdleInput,
  createPlatformerWorld,
  getPlayer,
  mergePlatformerInputs,
  type PlatformerInput,
  type PlatformerWorld,
} from "@game/example-platformer";
import { InputQueue } from "./server/input-queue.js";
import {
  SeededRandom,
  LatencySimulator,
  type EventEmitter,
} from "./test-utils/latency.js";

/**
 * Helper to create a world in "playing" state for tests
 */
const createPlayingWorld = (): PlatformerWorld => forceStartGame(createPlatformerWorld());

/**
 * Helper to create test input with all required fields
 */
const createInput = (
  moveX: number,
  moveY: number,
  jump: boolean,
  timestamp: number,
  jumpPressed: boolean = false,
  jumpReleased: boolean = false,
): PlatformerInput => ({
  moveX,
  moveY,
  jump,
  jumpPressed,
  jumpReleased,
  shoot: false,
  shootTargetX: 0,
  shootTargetY: 0,
  timestamp,
});

describe("Client-Server Integration", () => {
  const PLAYER_ID = "test-player";

  /**
   * Simulates the server processing inputs exactly like the new GameLoop does.
   * Uses fixed tick delta and calls simulate once per tick with all merged inputs.
   */
  function serverTick(
    world: PlatformerWorld,
    inputQueue: InputQueue<PlatformerInput>,
    connectedClients: Set<string>,
    tickIntervalMs: number = DEFAULT_TICK_INTERVAL_MS,
  ): { world: PlatformerWorld; acks: Map<string, number> } {
    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    const acks = new Map<string, number>();

    // Build acks
    for (const clientId of inputQueue.getClientsWithInputs()) {
      const inputs = inputQueue.getPendingInputs(clientId);
      if (inputs.length > 0) {
        const lastInput = getLast(inputs, "inputs");
        acks.set(clientId, lastInput.seq);
        inputQueue.acknowledge(clientId, lastInput.seq);
      }
    }

    // Merge all inputs per client (new idiomatic approach)
    const mergedInputs = new Map<string, PlatformerInput>();
    
    for (const [clientId, inputMsgs] of batchedInputs) {
      if (inputMsgs.length > 0) {
        const inputs = inputMsgs.map((m) => m.input);
        mergedInputs.set(clientId, mergePlatformerInputs(inputs));
      }
    }

    // Add idle inputs for connected clients without inputs this tick
    for (const clientId of connectedClients) {
      if (!mergedInputs.has(clientId)) {
        mergedInputs.set(clientId, createIdleInput());
      }
    }

    // Single simulate call with fixed tick delta (new idiomatic approach)
    const currentWorld = simulatePlatformer(world, mergedInputs, tickIntervalMs);

    return { world: currentWorld, acks };
  }

  test("single input: reconciliation aligns client with server", () => {
    // Client predicts with actual frame delta (first input uses MIN_DELTA_MS)
    // Server simulates with full tick delta (50ms)
    // Reconciliation (with all inputs acked) should bring client to server state
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    let serverWorld = createPlayingWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 0, y: 10 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const connectedClients = new Set<string>([PLAYER_ID]);

    predictor.setBaseState(serverWorld, PLAYER_ID);

    // Client sends single input
    const input = createInput(1, 0, false, 1000);
    const seq = inputBuffer.add(input);
    predictor.applyInput(input);

    // Server receives input
    inputQueue.enqueue(PLAYER_ID, { seq, input, timestamp: input.timestamp });

    // Server processes tick
    const { world: newServerWorld, acks } = serverTick(serverWorld, inputQueue, connectedClients);

    // Get positions before reconciliation
    const clientBefore = predictor.getState()?.players?.get(PLAYER_ID);
    const serverPlayer = getPlayer(newServerWorld, PLAYER_ID);

    // Client and server both use fixed tick delta, so they should match
    // (This is the key to deterministic client-side prediction)
    expect(clientBefore?.position.x).toBeCloseTo(serverPlayer.position.x, 5);

    // Reconcile
    const reconciler = new Reconciler<PlatformerWorld, PlatformerInput>(
      inputBuffer,
      predictor,
      platformerPredictionScope,
      PLAYER_ID,
    );
    
    const snapshot: Snapshot<PlatformerWorld> = {
      tick: 1,
      timestamp: Date.now(),
      state: newServerWorld,
      inputAcks: acks,
    };
    
    reconciler.reconcile(snapshot);

    // After reconciliation with input acked, no unacked inputs to replay
    // Client state should match server
    const clientAfter = predictor.getState()?.players?.get(PLAYER_ID);
    expect(clientAfter?.position.x).toBeCloseTo(serverPlayer.position.x, 5);
    expect(clientAfter?.position.y).toBeCloseTo(serverPlayer.position.y, 5);
  });

  test("multiple inputs same tick: reconciliation with all acked matches server", () => {
    // Client predicts each input with actual timestamp deltas (~16ms each)
    // Server merges and simulates once with tick delta (~16.67ms at 60 TPS)
    // With all inputs acked, reconciliation should bring client to server state

    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    let serverWorld = createPlayingWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 0, y: 10 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const connectedClients = new Set<string>([PLAYER_ID]);

    predictor.setBaseState(serverWorld, PLAYER_ID);

    // Client sends 3 inputs at ~16ms intervals
    const inputs = [
      createInput(1, 0, false, 1000),
      createInput(1, 0, false, 1016),
      createInput(1, 0, false, 1033),
    ];

    for (const input of inputs) {
      const seq = inputBuffer.add(input);
      predictor.applyInput(input);
      inputQueue.enqueue(PLAYER_ID, { seq, input, timestamp: input.timestamp });
    }

    // Server processes tick
    const { world: newServerWorld, acks } = serverTick(serverWorld, inputQueue, connectedClients);

    // Get positions before reconciliation
    const clientBefore = predictor.getState()?.players?.get(PLAYER_ID);
    const serverPlayer = getPlayer(newServerWorld, PLAYER_ID);

    // With 60 TPS, client predicted with ~1 + 16 + 17 = ~34ms total
    // Server simulated with ~16.67ms total
    // Client may be ahead or behind depending on timing
    // Both should have moved some distance
    expect(clientBefore?.position.x).toBeGreaterThan(0);
    expect(serverPlayer.position.x).toBeGreaterThan(0);

    // Now reconcile
    const reconciler = new Reconciler<PlatformerWorld, PlatformerInput>(
      inputBuffer,
      predictor,
      platformerPredictionScope,
      PLAYER_ID,
    );
    
    const snapshot: Snapshot<PlatformerWorld> = {
      tick: 1,
      timestamp: Date.now(),
      state: newServerWorld,
      inputAcks: acks,
    };
    
    reconciler.reconcile(snapshot);

    // After reconciliation with all inputs acked, client should match server
    const clientAfter = predictor.getState()?.players?.get(PLAYER_ID);
    expect(clientAfter?.position.x).toBeCloseTo(serverPlayer.position.x, 5);
  });

  test("reconciliation with unacked inputs: replays with fixed delta", () => {
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    let serverWorld = createPlayingWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 0, y: 10 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const connectedClients = new Set<string>([PLAYER_ID]);

    predictor.setBaseState(serverWorld, PLAYER_ID);
    const reconciler = new Reconciler<PlatformerWorld, PlatformerInput>(
      inputBuffer,
      predictor,
      platformerPredictionScope,
      PLAYER_ID,
    );

    // Client sends 5 inputs
    const inputs = [
      createInput(1, 0, false, 1000),
      createInput(1, 0, false, 1016),
      createInput(1, 0, false, 1033),
      createInput(1, 0, false, 1050),
      createInput(1, 0, false, 1066),
    ];

    for (const input of inputs) {
      const seq = inputBuffer.add(input);
      predictor.applyInput(input);
      inputQueue.enqueue(PLAYER_ID, { seq, input, timestamp: input.timestamp });
    }

    // Server only processes first 3 inputs this tick
    const tempQueue = new InputQueue<PlatformerInput>();
    const firstThree = inputQueue.getPendingInputs(PLAYER_ID).slice(0, 3);
    for (const msg of firstThree) {
      tempQueue.enqueue(PLAYER_ID, msg);
    }

    const { world: serverWorld1, acks } = serverTick(serverWorld, tempQueue, connectedClients);
    acks.set(PLAYER_ID, 2); // Ack through seq 2

    const snapshot: Snapshot<PlatformerWorld> = {
      tick: 1,
      timestamp: Date.now(),
      state: serverWorld1,
      inputAcks: acks,
    };

    // Client reconciles - should replay inputs 3 and 4
    reconciler.reconcile(snapshot);
    const clientAfterReplay = predictor.getState()?.players?.get(PLAYER_ID);

    // Now server processes remaining inputs (3 and 4)
    const tempQueue2 = new InputQueue<PlatformerInput>();
    tempQueue2.enqueue(PLAYER_ID, { seq: 3, input: inputs[3]!, timestamp: inputs[3]!.timestamp });
    tempQueue2.enqueue(PLAYER_ID, { seq: 4, input: inputs[4]!, timestamp: inputs[4]!.timestamp });

    const { world: serverWorld2 } = serverTick(serverWorld1, tempQueue2, connectedClients);
    const serverPlayer = getPlayer(serverWorld2, PLAYER_ID);

    // Client replayed 2 inputs with fixed delta, server simulated 2 inputs merged with fixed delta
    // They won't match exactly (client replays individually, server merges)
    // But both should have moved forward from server's first position
    expect(clientAfterReplay?.position.x).toBeGreaterThan(getPlayer(serverWorld1, PLAYER_ID).position.x);
    expect(serverPlayer.position.x).toBeGreaterThan(getPlayer(serverWorld1, PLAYER_ID).position.x);
  });

  test("jump physics: single jump input should match", () => {
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    let serverWorld = createPlayingWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 0, y: 10 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const connectedClients = new Set<string>([PLAYER_ID]);

    // Mark player as grounded
    const player = getPlayer(serverWorld, PLAYER_ID);
    serverWorld = {
      ...serverWorld,
      players: new Map([[PLAYER_ID, { ...player, isGrounded: true }]]),
    };

    predictor.setBaseState(serverWorld, PLAYER_ID);

    // Single jump input with jumpPressed: true
    const input = createInput(0, 0, true, 1000, true);
    predictor.applyInput(input);
    inputQueue.enqueue(PLAYER_ID, { seq: 0, input, timestamp: input.timestamp });

    const { world: newServerWorld } = serverTick(serverWorld, inputQueue, connectedClients);

    const clientPlayer = predictor.getState()?.players?.get(PLAYER_ID);
    const serverPlayer = getPlayer(newServerWorld, PLAYER_ID);

    // Both should have jumped
    expect(clientPlayer?.velocity.y).toBeGreaterThan(0);
    expect(serverPlayer.velocity.y).toBeGreaterThan(0);
    expect(clientPlayer?.velocity.y).toBeCloseTo(serverPlayer.velocity.y, 5);
  });

  test("two clients: physics should not multiply", () => {
    // This test verifies that adding a second client doesn't cause
    // gravity to be applied multiple times
    let serverWorld = createPlayingWorld();
    serverWorld = addPlayerToWorld(serverWorld, "player-a", { x: 0, y: 100 }); // In the air
    serverWorld = addPlayerToWorld(serverWorld, "player-b", { x: 100, y: 100 }); // Also in the air
    const inputQueue = new InputQueue<PlatformerInput>();
    const connectedClients = new Set<string>(["player-a", "player-b"]);

    // Both players send idle inputs
    inputQueue.enqueue("player-a", {
      seq: 0,
      input: createInput(0, 0, false, 1000),
      timestamp: 1000,
    });
    inputQueue.enqueue("player-b", {
      seq: 0,
      input: createInput(0, 0, false, 1000),
      timestamp: 1000,
    });

    // Process one tick
    const { world: newServerWorld } = serverTick(serverWorld, inputQueue, connectedClients);

    const playerA = getPlayer(newServerWorld, "player-a");
    const playerB = getPlayer(newServerWorld, "player-b");

    // Both players should have fallen the same amount due to gravity
    expect(playerA.position.y).toBeCloseTo(playerB.position.y, 5);
    
    // Gravity should be applied only once (should still be near 100)
    expect(playerA.position.y).toBeGreaterThan(97);
    expect(playerA.position.y).toBeLessThan(100);
  });

  test("two clients: one moving, one idle - physics isolation", () => {
    let serverWorld = createPlayingWorld();
    serverWorld = addPlayerToWorld(serverWorld, "active", { x: 0, y: 10 }); // On ground
    serverWorld = addPlayerToWorld(serverWorld, "idle", { x: 100, y: 100 }); // In the air
    const inputQueue = new InputQueue<PlatformerInput>();
    const connectedClients = new Set<string>(["active", "idle"]);

    // Active player moves, idle player does nothing
    inputQueue.enqueue("active", {
      seq: 0,
      input: createInput(1, 0, false, 1000),
      timestamp: 1000,
    });
    // idle player has no input - will get idle input from serverTick

    const { world: newServerWorld } = serverTick(serverWorld, inputQueue, connectedClients);

    const activePlayer = getPlayer(newServerWorld, "active");
    const idlePlayer = getPlayer(newServerWorld, "idle");

    // Active player should have moved right
    expect(activePlayer.position.x).toBeGreaterThan(0);
    
    // Idle player should NOT have moved horizontally
    expect(idlePlayer.position.x).toBe(100);
    
    // Idle player SHOULD have fallen due to gravity
    expect(idlePlayer.position.y).toBeLessThan(100);
    expect(idlePlayer.position.y).toBeGreaterThan(90);
  });

  test("multiple ticks: continuous movement across ticks should be consistent", () => {
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    let serverWorld = createPlayingWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 0, y: 10 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const connectedClients = new Set<string>([PLAYER_ID]);
    let serverTickNum = 0;

    predictor.setBaseState(serverWorld, PLAYER_ID);
    const reconciler = new Reconciler<PlatformerWorld, PlatformerInput>(
      inputBuffer,
      predictor,
      platformerPredictionScope,
      PLAYER_ID,
    );

    // Simulate 3 server ticks with 1 input each (ideal case: 1 input per tick)
    for (let tick = 0; tick < 3; tick++) {
      const input = createInput(1, 0, false, 1000 + tick * 50);
      const seq = inputBuffer.add(input);
      predictor.applyInput(input);
      inputQueue.enqueue(PLAYER_ID, { seq, input, timestamp: input.timestamp });

      const { world: newServerWorld, acks } = serverTick(serverWorld, inputQueue, connectedClients);
      serverWorld = newServerWorld;
      serverTickNum++;

      const snapshot: Snapshot<PlatformerWorld> = {
        tick: serverTickNum,
        timestamp: Date.now(),
        state: serverWorld,
        inputAcks: acks,
      };

      reconciler.reconcile(snapshot);

      // After each reconciliation with 1:1 input:tick ratio, should match
      const clientPlayer = predictor.getState()?.players?.get(PLAYER_ID);
      const serverPlayer = getPlayer(serverWorld, PLAYER_ID);

      expect(clientPlayer?.position.x).toBeCloseTo(serverPlayer.position.x, 5);
    }
  });

  test("input merging: jump preserved when merged with movement", () => {
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    let serverWorld = createPlayingWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 0, y: 10 });
    
    // Mark player as grounded
    const player = getPlayer(serverWorld, PLAYER_ID);
    serverWorld = {
      ...serverWorld,
      players: new Map([[PLAYER_ID, { ...player, isGrounded: true }]]),
    };

    const inputQueue = new InputQueue<PlatformerInput>();
    const connectedClients = new Set<string>([PLAYER_ID]);

    // Multiple inputs including a jump in the middle
    inputQueue.enqueue(PLAYER_ID, { seq: 0, input: createInput(1, 0, false, 1000), timestamp: 1000 });
    inputQueue.enqueue(PLAYER_ID, { seq: 1, input: createInput(1, 0, true, 1016, true), timestamp: 1016 }); // Jump pressed!
    inputQueue.enqueue(PLAYER_ID, { seq: 2, input: createInput(1, 0, false, 1033), timestamp: 1033 });

    const { world: newServerWorld } = serverTick(serverWorld, inputQueue, connectedClients);
    const serverPlayer = getPlayer(newServerWorld, PLAYER_ID);

    // Jump should have been preserved when inputs were merged
    expect(serverPlayer.velocity.y).toBeGreaterThan(0);
    expect(serverPlayer.position.x).toBeGreaterThan(0); // Also moved right
  });
});

describe("Scale Tests", () => {
  const createInput = (
    moveX: number,
    moveY: number,
    jump: boolean,
    timestamp: number,
    jumpPressed: boolean = false,
    jumpReleased: boolean = false,
  ): PlatformerInput => ({
    moveX,
    moveY,
    jump,
    jumpPressed,
    jumpReleased,
    shoot: false,
    shootTargetX: 0,
    shootTargetY: 0,
    timestamp,
  });

  function serverTick(
    world: PlatformerWorld,
    inputQueue: InputQueue<PlatformerInput>,
    connectedClients: Set<string>,
    tickIntervalMs: number = DEFAULT_TICK_INTERVAL_MS,
  ): { world: PlatformerWorld; acks: Map<string, number> } {
    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    const acks = new Map<string, number>();

    for (const clientId of inputQueue.getClientsWithInputs()) {
      const inputs = inputQueue.getPendingInputs(clientId);
      if (inputs.length > 0) {
        const lastInput = getLast(inputs, "inputs");
        acks.set(clientId, lastInput.seq);
        inputQueue.acknowledge(clientId, lastInput.seq);
      }
    }

    const mergedInputs = new Map<string, PlatformerInput>();
    
    for (const [clientId, inputMsgs] of batchedInputs) {
      if (inputMsgs.length > 0) {
        const inputs = inputMsgs.map((m) => m.input);
        mergedInputs.set(clientId, mergePlatformerInputs(inputs));
      }
    }

    for (const clientId of connectedClients) {
      if (!mergedInputs.has(clientId)) {
        mergedInputs.set(clientId, createIdleInput());
      }
    }

    const currentWorld = simulatePlatformer(world, mergedInputs, tickIntervalMs);
    return { world: currentWorld, acks };
  }

  test("10 players: all should have independent physics", () => {
    const playerCount = 10;
    let serverWorld = createPlayingWorld();
    const inputQueue = new InputQueue<PlatformerInput>();
    const connectedClients = new Set<string>();

    for (let i = 0; i < playerCount; i++) {
      serverWorld = addPlayerToWorld(serverWorld, `player-${i}`, { x: i * 50, y: 100 });
      connectedClients.add(`player-${i}`);
    }

    // Each player sends different inputs
    for (let i = 0; i < playerCount; i++) {
      const moveX = i % 2 === 0 ? 1 : -1;
      inputQueue.enqueue(`player-${i}`, {
        seq: 0,
        input: createInput(moveX, 0, false, 1000),
        timestamp: 1000,
      });
    }

    const { world: newWorld } = serverTick(serverWorld, inputQueue, connectedClients);

    // Verify each player moved correctly
    for (let i = 0; i < playerCount; i++) {
      const player = newWorld.players.get(`player-${i}`);
      const expectedDirection = i % 2 === 0 ? 1 : -1;
      const startX = i * 50;

      if (expectedDirection === 1) {
        expect(player?.position.x).toBeGreaterThan(startX);
      } else {
        expect(player?.position.x).toBeLessThan(startX);
      }
      
      // All players should have fallen due to gravity
      expect(player?.position.y).toBeLessThan(100);
    }

    // Verify gravity was only applied once per player
    const player0Y = newWorld.players.get("player-0")?.position.y;
    const player9Y = newWorld.players.get("player-9")?.position.y;
    expect(player0Y).toBeCloseTo(player9Y ?? 0, 3);
  });

  test("50 players: physics should not multiply", () => {
    const playerCount = 50;
    let serverWorld = createPlayingWorld();
    const inputQueue = new InputQueue<PlatformerInput>();
    const connectedClients = new Set<string>();

    for (let i = 0; i < playerCount; i++) {
      serverWorld = addPlayerToWorld(serverWorld, `player-${i}`, { x: i * 50, y: 100 });
      connectedClients.add(`player-${i}`);
    }

    // All players send idle inputs
    for (let i = 0; i < playerCount; i++) {
      inputQueue.enqueue(`player-${i}`, {
        seq: 0,
        input: createInput(0, 0, false, 1000),
        timestamp: 1000,
      });
    }

    const { world: newWorld } = serverTick(serverWorld, inputQueue, connectedClients);

    // All players should have fallen the same amount
    const player0 = getPlayer(newWorld, "player-0");
    const player49 = getPlayer(newWorld, "player-49");

    expect(player0.position.y).toBeCloseTo(player49.position.y, 3);
    
    // Gravity should be applied only once, not 50x
    // With gravity=-800 and 50ms tick: deltaV = -800*0.05 = -40, deltaY = -40*0.05 = -2
    // So from y=100, player should be around y=98 after one tick
    expect(player0.position.y).toBeGreaterThan(97);
    expect(player0.position.y).toBeLessThan(100);
  });
});

/**
 * Simulated latency tests for netcode behavior under network conditions.
 * 
 * These tests use the deterministic latency harness to verify:
 * - Tick alignment invariants hold under latency
 * - Smoothing queues stay within bounds
 * - Reconciliation works correctly with delayed snapshots
 */
describe("Latency Simulation Tests", () => {
  const PLAYER_ID = "test-player";

  /**
   * Mock event emitter for testing message delays.
   */
  class MockEmitter implements EventEmitter {
    private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();
    public emittedEvents: Array<{ event: string; args: unknown[] }> = [];

    emit(event: string, ...args: unknown[]): void {
      this.emittedEvents.push({ event, args });
      const listeners = this.listeners.get(event);
      if (listeners) {
        for (const listener of listeners) {
          listener(...args);
        }
      }
    }

    on(event: string, listener: (...args: unknown[]) => void): void {
      let eventListeners = this.listeners.get(event);
      if (!eventListeners) {
        eventListeners = new Set();
        this.listeners.set(event, eventListeners);
      }
      eventListeners.add(listener);
    }

    off(event: string, listener: (...args: unknown[]) => void): void {
      const eventListeners = this.listeners.get(event);
      if (eventListeners) {
        eventListeners.delete(listener);
      }
    }

    clear(): void {
      this.emittedEvents = [];
    }
  }

  const createInput = (
    moveX: number,
    moveY: number,
    jump: boolean,
    timestamp: number,
    jumpPressed: boolean = false,
    jumpReleased: boolean = false,
  ): PlatformerInput => ({
    moveX,
    moveY,
    jump,
    jumpPressed,
    jumpReleased,
    shoot: false,
    shootTargetX: 0,
    shootTargetY: 0,
    timestamp,
  });

  const createPlayingWorld = (): PlatformerWorld => forceStartGame(createPlatformerWorld());

  function serverTick(
    world: PlatformerWorld,
    inputQueue: InputQueue<PlatformerInput>,
    connectedClients: Set<string>,
    tickIntervalMs: number = DEFAULT_TICK_INTERVAL_MS,
  ): { world: PlatformerWorld; acks: Map<string, number> } {
    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    const acks = new Map<string, number>();

    for (const clientId of inputQueue.getClientsWithInputs()) {
      const inputs = inputQueue.getPendingInputs(clientId);
      if (inputs.length > 0) {
        const lastInput = getLast(inputs, "inputs");
        acks.set(clientId, lastInput.seq);
        inputQueue.acknowledge(clientId, lastInput.seq);
      }
    }

    const mergedInputs = new Map<string, PlatformerInput>();
    
    for (const [clientId, inputMsgs] of batchedInputs) {
      if (inputMsgs.length > 0) {
        const inputs = inputMsgs.map((m) => m.input);
        mergedInputs.set(clientId, mergePlatformerInputs(inputs));
      }
    }

    for (const clientId of connectedClients) {
      if (!mergedInputs.has(clientId)) {
        mergedInputs.set(clientId, createIdleInput());
      }
    }

    const currentWorld = simulatePlatformer(world, mergedInputs, tickIntervalMs);
    return { world: currentWorld, acks };
  }

  test("owner smoothing corrections apply to queue entries under 120ms RTT", () => {
    // Simulate ~120ms RTT (60ms one-way latency)
    const clientEmitter = new MockEmitter();
    const serverEmitter = new MockEmitter();
    const rng = new SeededRandom(42);
    
    const clientToServer = new LatencySimulator(serverEmitter, {
      meanLatencyMs: 60,
      jitterMs: 15,
    }, rng);
    const serverToClient = new LatencySimulator(clientEmitter, {
      meanLatencyMs: 60,
      jitterMs: 15,
    }, rng);

    // Client-side state
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    const ownerSmoother = new TickSmoother({ tickIntervalMs: DEFAULT_TICK_INTERVAL_MS });
    ownerSmoother.setIsOwner(true);
    let predictionTick = 0;
    const predictionTickBySeq = new Map<number, number>();
    
    let serverWorld = createPlayingWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 0, y: 10 });
    predictor.setBaseState(serverWorld, PLAYER_ID);
    
    const reconciler = new Reconciler<PlatformerWorld, PlatformerInput>(
      inputBuffer,
      predictor,
      platformerPredictionScope,
      PLAYER_ID,
    );

    // Track corrections to verify tick alignment
    const correctionResults: boolean[] = [];
    reconciler.setReplayCallback((seq, state) => {
      const player = state.players?.get(PLAYER_ID);
      if (player) {
        const predTick = predictionTickBySeq.get(seq);
        if (predTick === undefined) {
          return;
        }
        // This is the critical invariant: correction must find its tick in queue
        const applied = ownerSmoother.easeCorrection(predTick, player.position.x, player.position.y);
        correctionResults.push(applied);
      }
    });

    // Server-side state
    const serverInputQueue = new InputQueue<PlatformerInput>();
    const connectedClients = new Set<string>([PLAYER_ID]);
    let serverTickNum = 0;

    // Simulate 10 client frames (~160ms at 60fps)
    // Client sends inputs, server processes, sends snapshots back
    const clientTickMs = 16.67;
    let clientTime = 0;
    const inputsToSend: Array<{ seq: number; input: PlatformerInput }> = [];

    // Client generates inputs
    for (let i = 0; i < 10; i++) {
      const input = createInput(1, 0, false, 1000 + i * clientTickMs);
      const seq = inputBuffer.add(input);
      const predTick = predictionTick++;
      predictionTickBySeq.set(seq, predTick);
      predictor.applyInput(input);
      
      // Add to smoother with prediction tick
      const player = predictor.getState()?.players?.get(PLAYER_ID);
      if (player) {
        ownerSmoother.onPostTick(predTick, player.position.x, player.position.y);
      }
      
      inputsToSend.push({ seq, input });
    }

    // Send all inputs through latency simulator
    for (const { seq, input } of inputsToSend) {
      clientToServer.emit("netcode:input", { seq, input, timestamp: input.timestamp });
    }

    // Advance time for inputs to arrive at server (~60-75ms with jitter)
    clientToServer.tick(80);
    
    // Process server-received inputs
    for (const event of serverEmitter.emittedEvents) {
      if (event.event === "netcode:input") {
        const { seq, input, timestamp } = event.args[0] as { seq: number; input: PlatformerInput; timestamp: number };
        serverInputQueue.enqueue(PLAYER_ID, { seq, input, timestamp });
      }
    }
    serverEmitter.clear();

    // Server processes tick
    const { world: newServerWorld, acks } = serverTick(serverWorld, serverInputQueue, connectedClients);
    serverWorld = newServerWorld;
    serverTickNum++;

    // Force at least one unacked input so reconcile replays and fires callbacks.
    const lastInputSeq = inputsToSend[inputsToSend.length - 1]?.seq;
    if (lastInputSeq !== undefined && lastInputSeq > 0) {
      acks.set(PLAYER_ID, lastInputSeq - 1);
    }

    // Server sends snapshot back through latency
    const snapshot: Snapshot<PlatformerWorld> = {
      tick: serverTickNum,
      timestamp: Date.now(),
      state: serverWorld,
      inputAcks: acks,
    };
    serverToClient.emit("netcode:snapshot", snapshot);

    // Advance time for snapshot to arrive at client (~60-75ms with jitter)
    serverToClient.tick(80);

    // Client receives and reconciles snapshot
    for (const event of clientEmitter.emittedEvents) {
      if (event.event === "netcode:snapshot") {
        const receivedSnapshot = event.args[0] as Snapshot<PlatformerWorld>;
        reconciler.reconcile(receivedSnapshot);
      }
    }

    // CRITICAL INVARIANT: All corrections should have been applied successfully
    // This fails if there's a tick alignment mismatch between reconcile and smoother
    expect(correctionResults.length).toBeGreaterThan(0);
    for (const result of correctionResults) {
      expect(result).toBe(true);
    }
  });

  test("smoother queue stays within bounds under high jitter", () => {
    const ownerSmoother = new TickSmoother({
      tickIntervalMs: DEFAULT_TICK_INTERVAL_MS,
      maxOverBuffer: 5,
    });
    ownerSmoother.setIsOwner(true);

    // Simulate variable input timing (high jitter scenario)
    // Some frames fast, some slow, simulating network-induced timing variance
    const inputTimes = [
      0, 10, 35, 40, 80, 85, 90, 150, 152, 155, // Bursty timing
      200, 250, 300, 310, 320, 330, 340, 350, 360, 370,
    ];

    for (let i = 0; i < inputTimes.length; i++) {
      const x = i * 10; // Position progresses
      ownerSmoother.onPostTick(i, x, 0);
      
      // Consume some entries with getSmoothedPosition to simulate rendering
      if (i > 0 && i % 3 === 0) {
        ownerSmoother.getSmoothedPosition(DEFAULT_TICK_INTERVAL_MS);
      }
    }

    // Queue should never exceed configured max (interpolation + maxOverBuffer)
    // For owner: interpolation=1, maxOverBuffer=5, so max=6
    expect(ownerSmoother.getQueueLength()).toBeLessThanOrEqual(6);
  });

  test("reconciliation works correctly with delayed snapshots", () => {
    const inputBuffer = new InputBuffer<PlatformerInput>();
    const predictor = new Predictor<PlatformerWorld, PlatformerInput>(platformerPredictionScope);
    
    let serverWorld = createPlayingWorld();
    serverWorld = addPlayerToWorld(serverWorld, PLAYER_ID, { x: 0, y: 10 });
    predictor.setBaseState(serverWorld, PLAYER_ID);
    
    const reconciler = new Reconciler<PlatformerWorld, PlatformerInput>(
      inputBuffer,
      predictor,
      platformerPredictionScope,
      PLAYER_ID,
    );

    const serverInputQueue = new InputQueue<PlatformerInput>();
    const connectedClients = new Set<string>([PLAYER_ID]);

    // Client sends 5 inputs rapidly
    const inputs: PlatformerInput[] = [];
    for (let i = 0; i < 5; i++) {
      const input = createInput(1, 0, false, 1000 + i * 16);
      inputs.push(input);
      const seq = inputBuffer.add(input);
      predictor.applyInput(input);
      serverInputQueue.enqueue(PLAYER_ID, { seq, input, timestamp: input.timestamp });
    }

    // Server processes first 2 inputs (simulating network batching)
    const tempQueue1 = new InputQueue<PlatformerInput>();
    const firstBatch = serverInputQueue.getPendingInputs(PLAYER_ID).slice(0, 2);
    for (const msg of firstBatch) {
      tempQueue1.enqueue(PLAYER_ID, msg);
    }
    
    const { world: world1, acks: acks1 } = serverTick(serverWorld, tempQueue1, connectedClients);
    
    // Old snapshot arrives (acks inputs 0-1)
    const snapshot1: Snapshot<PlatformerWorld> = {
      tick: 1,
      timestamp: Date.now(),
      state: world1,
      inputAcks: acks1,
    };
    reconciler.reconcile(snapshot1);

    // Client should have replayed inputs 2-4
    const stateAfterReconcile = predictor.getState()?.players?.get(PLAYER_ID);
    expect(stateAfterReconcile?.position.x).toBeGreaterThan(0);

    // Inputs 0-1 should be removed from buffer
    expect(inputBuffer.get(0)).toBeUndefined();
    expect(inputBuffer.get(1)).toBeUndefined();
    // Inputs 2-4 should still be pending
    expect(inputBuffer.get(2)).toBeDefined();
    expect(inputBuffer.get(3)).toBeDefined();
    expect(inputBuffer.get(4)).toBeDefined();
  });

  test("remote player smoothing uses server ticks only", () => {
    // Remote smoothers should ONLY receive server tick numbers
    // This is critical: remote smoother tick keys must NOT be input seqs
    
    const remoteSmoother = new TickSmoother({
      tickIntervalMs: DEFAULT_TICK_INTERVAL_MS,
    });
    remoteSmoother.setIsOwner(false);

    // Simulate receiving 5 snapshots from server
    const serverTicks = [100, 101, 102, 103, 104]; // Server tick numbers
    
    for (const serverTick of serverTicks) {
      const x = (serverTick - 100) * 50; // Simulate movement
      remoteSmoother.onPostTick(serverTick, x, 0);
    }

    // All server ticks should be in queue (except first which initializes)
    for (let i = 1; i < serverTicks.length; i++) {
      expect(remoteSmoother.hasTickInQueue(serverTicks[i]!)).toBe(true);
    }

    // Client input seqs (0, 1, 2...) should NOT be in queue
    expect(remoteSmoother.hasTickInQueue(0)).toBe(false);
    expect(remoteSmoother.hasTickInQueue(1)).toBe(false);
    expect(remoteSmoother.hasTickInQueue(2)).toBe(false);
  });

  test("custom adaptive smoothing steps adjust interpolation gradually", () => {
    const spectator = new TickSmoother({
      adaptiveInterpolation: AdaptiveInterpolationLevel.Low,
      adaptiveSmoothingType: AdaptiveSmoothingType.Custom,
      interpolationIncreaseStep: 2,
      interpolationDecreaseStep: 1,
    });
    spectator.setIsOwner(false);

    spectator.updateAdaptiveInterpolation(8); // desired ~7
    expect(spectator.getInterpolation()).toBe(3); // 1 -> +2 (min 2)

    spectator.updateAdaptiveInterpolation(8);
    expect(spectator.getInterpolation()).toBe(5); // 3 -> +2

    spectator.updateAdaptiveInterpolation(2); // desired ~2
    expect(spectator.getInterpolation()).toBe(4); // 5 -> -1
  });

  test("tick alignment invariant: owner corrections find queue entries under jitter", () => {
    // This is the most critical invariant test for the previous bug
    // When jitter causes inputs to bunch up, corrections must still find entries
    
    const rng = new SeededRandom(99);
    const ownerSmoother = new TickSmoother({ tickIntervalMs: DEFAULT_TICK_INTERVAL_MS });
    ownerSmoother.setIsOwner(true);
    let predictionTick = 0;
    const predictionTickBySeq = new Map<number, number>();

    // Simulate 20 prediction steps with variable timing (jitter)
    const inputSeqs: number[] = [];
    for (let i = 0; i < 20; i++) {
      const seq = i;
      inputSeqs.push(seq);
      const predTick = predictionTick++;
      predictionTickBySeq.set(seq, predTick);
      const x = i * 10 + rng.range(-5, 5); // Add some position noise
      ownerSmoother.onPostTick(predTick, x, 0);
    }

    // Now simulate reconciliation corrections
    // The key: corrections use the same seq numbers we put in via onPostTick
    const queuedSeqs = inputSeqs.filter((seq) => {
      const predTick = predictionTickBySeq.get(seq);
      return predTick !== undefined && ownerSmoother.hasTickInQueue(predTick);
    });
    expect(queuedSeqs.length).toBeGreaterThan(0);

    for (const seq of queuedSeqs) {
      const newX = seq * 10 + 5; // Slightly different position (server correction)
      const predTick = predictionTickBySeq.get(seq);
      if (predTick === undefined) {
        continue;
      }
      const applied = ownerSmoother.easeCorrection(predTick, newX, 0);
      expect(applied).toBe(true);
    }
    
    // If we had the old bug (using server ticks instead of input seqs),
    // ALL corrections would fail because the queue contains input seqs (0, 1, 2...)
    // not server tick offsets (500, 501, 502...)
    // So having ANY successful corrections proves the alignment is correct
  });
});

describe("Player Disconnect Tests", () => {
  const createInput = (
    moveX: number,
    moveY: number,
    jump: boolean,
    timestamp: number,
  ): PlatformerInput => ({
    moveX,
    moveY,
    jump,
    jumpPressed: false,
    jumpReleased: false,
    shoot: false,
    shootTargetX: 0,
    shootTargetY: 0,
    timestamp,
  });

  function serverTick(
    world: PlatformerWorld,
    inputQueue: InputQueue<PlatformerInput>,
    connectedClients: Set<string>,
    tickIntervalMs: number = DEFAULT_TICK_INTERVAL_MS,
  ): { world: PlatformerWorld; acks: Map<string, number> } {
    const batchedInputs = inputQueue.getAllPendingInputsBatched();
    const acks = new Map<string, number>();

    for (const clientId of inputQueue.getClientsWithInputs()) {
      const inputs = inputQueue.getPendingInputs(clientId);
      if (inputs.length > 0) {
        const lastInput = getLast(inputs, "inputs");
        acks.set(clientId, lastInput.seq);
        inputQueue.acknowledge(clientId, lastInput.seq);
      }
    }

    const mergedInputs = new Map<string, PlatformerInput>();
    
    for (const [clientId, inputMsgs] of batchedInputs) {
      if (inputMsgs.length > 0) {
        const inputs = inputMsgs.map((m) => m.input);
        mergedInputs.set(clientId, mergePlatformerInputs(inputs));
      }
    }

    for (const clientId of connectedClients) {
      if (!mergedInputs.has(clientId)) {
        mergedInputs.set(clientId, createIdleInput());
      }
    }

    const currentWorld = simulatePlatformer(world, mergedInputs, tickIntervalMs);
    return { world: currentWorld, acks };
  }

  test("player disconnects mid-movement: remaining players unaffected", () => {
    let serverWorld = createPlayingWorld();
    serverWorld = addPlayerToWorld(serverWorld, "staying", { x: 0, y: 10 });
    serverWorld = addPlayerToWorld(serverWorld, "leaving", { x: 100, y: 10 });
    const inputQueue = new InputQueue<PlatformerInput>();
    const connectedClients = new Set<string>(["staying", "leaving"]);

    // Both players moving
    inputQueue.enqueue("staying", {
      seq: 0,
      input: createInput(1, 0, false, 1000),
      timestamp: 1000,
    });
    inputQueue.enqueue("leaving", {
      seq: 0,
      input: createInput(-1, 0, false, 1000),
      timestamp: 1000,
    });

    // Process first tick with both players
    const { world: world1 } = serverTick(serverWorld, inputQueue, connectedClients);
    const stayingX1 = world1.players.get("staying")?.position.x ?? 0;

    // Remove leaving player (disconnect)
    const newPlayers = new Map(world1.players);
    newPlayers.delete("leaving");
    const world2 = { ...world1, players: newPlayers };
    connectedClients.delete("leaving");

    // Continue with staying player
    const inputQueue2 = new InputQueue<PlatformerInput>();
    inputQueue2.enqueue("staying", {
      seq: 1,
      input: createInput(1, 0, false, 1016),
      timestamp: 1016,
    });

    const { world: world3 } = serverTick(world2, inputQueue2, connectedClients);

    // Staying player should have continued moving
    const stayingX2 = world3.players.get("staying")?.position.x ?? 0;
    expect(stayingX2).toBeGreaterThan(stayingX1);
    
    // Leaving player should be gone
    expect(world3.players.has("leaving")).toBe(false);
  });

  test("multiple players disconnect simultaneously", () => {
    let serverWorld = createPlayingWorld();
    const connectedClients = new Set<string>();
    
    for (let i = 0; i < 5; i++) {
      serverWorld = addPlayerToWorld(serverWorld, `player-${i}`, { x: i * 50, y: 10 });
      connectedClients.add(`player-${i}`);
    }

    const inputQueue = new InputQueue<PlatformerInput>();
    for (let i = 0; i < 5; i++) {
      inputQueue.enqueue(`player-${i}`, {
        seq: 0,
        input: createInput(1, 0, false, 1000),
        timestamp: 1000,
      });
    }

    // Process first tick
    const { world: world1 } = serverTick(serverWorld, inputQueue, connectedClients);

    // Remove players 1, 2, 3 (keep 0 and 4)
    const newPlayers = new Map(world1.players);
    newPlayers.delete("player-1");
    newPlayers.delete("player-2");
    newPlayers.delete("player-3");
    const world2 = { ...world1, players: newPlayers };
    connectedClients.delete("player-1");
    connectedClients.delete("player-2");
    connectedClients.delete("player-3");

    // Continue with remaining players
    const inputQueue2 = new InputQueue<PlatformerInput>();
    inputQueue2.enqueue("player-0", {
      seq: 1,
      input: createInput(1, 0, false, 1016),
      timestamp: 1016,
    });
    inputQueue2.enqueue("player-4", {
      seq: 1,
      input: createInput(-1, 0, false, 1016),
      timestamp: 1016,
    });

    const { world: world3 } = serverTick(world2, inputQueue2, connectedClients);

    // Verify remaining players
    expect(world3.players.size).toBe(2);
    expect(world3.players.has("player-0")).toBe(true);
    expect(world3.players.has("player-4")).toBe(true);
    
    // Player 0 continued right
    expect(world3.players.get("player-0")?.position.x).toBeGreaterThan(0);
  });
});
