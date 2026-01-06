import { describe, test, expect, beforeEach } from "bun:test";
import { WorldState } from "./world-state.js";

describe("WorldState", () => {
  let worldState: WorldState;

  beforeEach(() => {
    worldState = new WorldState();
  });

  describe("addPlayer", () => {
    test("should add a new player", () => {
      worldState.addPlayer("player-1", { x: 100, y: 200 });

      const player = worldState.getPlayer("player-1");
      expect(player).toBeDefined();
      expect(player?.id).toBe("player-1");
      expect(player?.position.x).toBe(100);
      expect(player?.position.y).toBe(200);
    });

    test("should not overwrite existing player", () => {
      worldState.addPlayer("player-1", { x: 0, y: 0 });
      worldState.addPlayer("player-1", { x: 999, y: 999 });

      const player = worldState.getPlayer("player-1");
      expect(player?.position.x).toBe(0);
      expect(player?.position.y).toBe(0);
    });

    test("should add multiple players", () => {
      worldState.addPlayer("p1", { x: 0, y: 0 });
      worldState.addPlayer("p2", { x: 50, y: 50 });
      worldState.addPlayer("p3", { x: 100, y: 100 });

      expect(worldState.getPlayerCount()).toBe(3);
    });
  });

  describe("removePlayer", () => {
    test("should remove an existing player", () => {
      worldState.addPlayer("player-1", { x: 0, y: 0 });
      worldState.removePlayer("player-1");

      expect(worldState.getPlayer("player-1")).toBeUndefined();
      expect(worldState.getPlayerCount()).toBe(0);
    });

    test("should handle removing non-existent player", () => {
      worldState.removePlayer("non-existent");
      expect(worldState.getPlayerCount()).toBe(0);
    });
  });

  describe("updatePlayer", () => {
    test("should update player state", () => {
      worldState.addPlayer("player-1", { x: 0, y: 0 });

      worldState.updatePlayer("player-1", {
        id: "player-1",
        position: { x: 100, y: 200 },
        velocity: { x: 10, y: 20 },
        tick: 5,
      });

      const player = worldState.getPlayer("player-1");
      expect(player?.position.x).toBe(100);
      expect(player?.position.y).toBe(200);
      expect(player?.velocity.x).toBe(10);
      expect(player?.tick).toBe(5);
    });
  });

  describe("getAllPlayers", () => {
    test("should return empty array when no players", () => {
      const players = worldState.getAllPlayers();
      expect(players).toHaveLength(0);
    });

    test("should return all players", () => {
      worldState.addPlayer("p1", { x: 0, y: 0 });
      worldState.addPlayer("p2", { x: 10, y: 10 });

      const players = worldState.getAllPlayers();
      expect(players).toHaveLength(2);
      expect(players.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
    });
  });

  describe("tick management", () => {
    test("should start at tick 0", () => {
      expect(worldState.getTick()).toBe(0);
    });

    test("should increment tick", () => {
      worldState.incrementTick();
      expect(worldState.getTick()).toBe(1);

      worldState.incrementTick();
      worldState.incrementTick();
      expect(worldState.getTick()).toBe(3);
    });
  });

  describe("createSnapshot", () => {
    test("should create a snapshot of current state", () => {
      worldState.addPlayer("p1", { x: 10, y: 20 });
      worldState.addPlayer("p2", { x: 30, y: 40 });
      worldState.incrementTick();
      worldState.incrementTick();

      const timestamp = Date.now();
      const acks = { p1: 5, p2: 3 };
      const snapshot = worldState.createSnapshot(timestamp, acks);

      expect(snapshot.tick).toBe(2);
      expect(snapshot.timestamp).toBe(timestamp);
      expect(snapshot.players).toHaveLength(2);
      expect(snapshot.acks).toEqual(acks);
    });

    test("should create empty snapshot when no players", () => {
      const snapshot = worldState.createSnapshot(Date.now(), {});

      expect(snapshot.players).toHaveLength(0);
      expect(snapshot.tick).toBe(0);
    });
  });
});
