import { describe, test, expect, beforeEach } from "bun:test";
import { DefaultWorldManager } from "./world.js";

interface TestWorld {
  value: number;
  name: string;
}

describe("DefaultWorldManager", () => {
  let manager: DefaultWorldManager<TestWorld>;
  const initialState: TestWorld = { value: 42, name: "test" };

  beforeEach(() => {
    manager = new DefaultWorldManager<TestWorld>(initialState);
  });

  describe("constructor", () => {
    test("should initialize with provided state", () => {
      expect(manager.getState()).toEqual(initialState);
    });

    test("should initialize tick to 0 by default", () => {
      expect(manager.getTick()).toBe(0);
    });

    test("should accept custom initial tick", () => {
      const customManager = new DefaultWorldManager<TestWorld>(initialState, 100);
      expect(customManager.getTick()).toBe(100);
    });

    test("should accept negative initial tick", () => {
      const customManager = new DefaultWorldManager<TestWorld>(initialState, -5);
      expect(customManager.getTick()).toBe(-5);
    });
  });

  describe("getState", () => {
    test("should return current state", () => {
      expect(manager.getState()).toEqual(initialState);
    });

    test("should return same reference (not a copy)", () => {
      const state1 = manager.getState();
      const state2 = manager.getState();
      expect(state1).toBe(state2);
    });
  });

  describe("setState", () => {
    test("should update state", () => {
      const newState: TestWorld = { value: 100, name: "updated" };
      manager.setState(newState);
      expect(manager.getState()).toEqual(newState);
    });

    test("should replace state entirely", () => {
      const newState: TestWorld = { value: 0, name: "" };
      manager.setState(newState);
      expect(manager.getState().value).toBe(0);
      expect(manager.getState().name).toBe("");
    });

    test("should not affect tick", () => {
      manager.incrementTick();
      manager.incrementTick();
      const tickBefore = manager.getTick();
      
      manager.setState({ value: 999, name: "new" });
      
      expect(manager.getTick()).toBe(tickBefore);
    });
  });

  describe("getTick", () => {
    test("should return current tick", () => {
      expect(manager.getTick()).toBe(0);
    });

    test("should return updated tick after increment", () => {
      manager.incrementTick();
      expect(manager.getTick()).toBe(1);
    });
  });

  describe("incrementTick", () => {
    test("should increment tick by 1", () => {
      manager.incrementTick();
      expect(manager.getTick()).toBe(1);
    });

    test("should increment multiple times correctly", () => {
      manager.incrementTick();
      manager.incrementTick();
      manager.incrementTick();
      expect(manager.getTick()).toBe(3);
    });

    test("should not affect state", () => {
      const stateBefore = manager.getState();
      manager.incrementTick();
      expect(manager.getState()).toBe(stateBefore);
    });

    test("should handle many increments", () => {
      for (let i = 0; i < 1000; i++) {
        manager.incrementTick();
      }
      expect(manager.getTick()).toBe(1000);
    });
  });

  describe("complex world states", () => {
    interface ComplexWorld {
      players: Map<string, { x: number; y: number }>;
      items: Set<string>;
      metadata: { tick: number; timestamp: Date };
    }

    test("should work with Map in state", () => {
      const players = new Map([["p1", { x: 10, y: 20 }]]);
      const complexManager = new DefaultWorldManager<ComplexWorld>({
        players,
        items: new Set(),
        metadata: { tick: 0, timestamp: new Date() },
      });

      expect(complexManager.getState().players.get("p1")).toEqual({ x: 10, y: 20 });
    });

    test("should work with Set in state", () => {
      const items = new Set(["sword", "shield"]);
      const complexManager = new DefaultWorldManager<ComplexWorld>({
        players: new Map(),
        items,
        metadata: { tick: 0, timestamp: new Date() },
      });

      expect(complexManager.getState().items.has("sword")).toBe(true);
    });

    test("should preserve reference when updating partial state", () => {
      const players = new Map([["p1", { x: 0, y: 0 }]]);
      const complexManager = new DefaultWorldManager<ComplexWorld>({
        players,
        items: new Set(),
        metadata: { tick: 0, timestamp: new Date() },
      });

      // Get state and modify it
      const state = complexManager.getState();
      state.players.set("p2", { x: 50, y: 50 });

      // Since getState returns the reference, modification should reflect
      expect(complexManager.getState().players.has("p2")).toBe(true);
    });
  });

  describe("edge cases", () => {
    test("should handle null-like initial state", () => {
      const nullableManager = new DefaultWorldManager<TestWorld | null>(null);
      expect(nullableManager.getState()).toBeNull();
    });

    test("should handle setting state to same value", () => {
      manager.setState(initialState);
      expect(manager.getState()).toEqual(initialState);
    });

    test("should handle very large tick numbers", () => {
      const largeTickManager = new DefaultWorldManager<TestWorld>(initialState, 999999999);
      largeTickManager.incrementTick();
      expect(largeTickManager.getTick()).toBe(1000000000);
    });
  });
});
