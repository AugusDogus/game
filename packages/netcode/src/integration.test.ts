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
