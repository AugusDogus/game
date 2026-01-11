import { describe, it, expect, beforeEach } from "bun:test";
import { ActionQueue } from "./action-queue.js";
import type { ActionMessage } from "../core/types.js";

interface TestAction {
  type: string;
  value: number;
}

describe("ActionQueue", () => {
  let queue: ActionQueue<TestAction>;

  beforeEach(() => {
    queue = new ActionQueue<TestAction>();
  });

  describe("enqueue", () => {
    it("should add action to queue", () => {
      const message: ActionMessage<TestAction> = {
        seq: 1,
        action: { type: "attack", value: 10 },
        clientTimestamp: Date.now(),
      };

      const result = queue.enqueue("client1", message);

      expect(result).toBe(true);
      expect(queue.size()).toBe(1);
    });

    it("should reject duplicate seq numbers", () => {
      const message: ActionMessage<TestAction> = {
        seq: 1,
        action: { type: "attack", value: 10 },
        clientTimestamp: Date.now(),
      };

      queue.enqueue("client1", message);
      const result = queue.enqueue("client1", message);

      expect(result).toBe(false);
      expect(queue.size()).toBe(1);
    });

    it("should allow same seq from different clients", () => {
      const message: ActionMessage<TestAction> = {
        seq: 1,
        action: { type: "attack", value: 10 },
        clientTimestamp: Date.now(),
      };

      queue.enqueue("client1", message);
      queue.enqueue("client2", message);

      expect(queue.size()).toBe(2);
    });
  });

  describe("getPending", () => {
    it("should return pending actions for a client", () => {
      const message1: ActionMessage<TestAction> = {
        seq: 1,
        action: { type: "attack", value: 10 },
        clientTimestamp: Date.now(),
      };
      const message2: ActionMessage<TestAction> = {
        seq: 2,
        action: { type: "attack", value: 20 },
        clientTimestamp: Date.now(),
      };

      queue.enqueue("client1", message1);
      queue.enqueue("client1", message2);

      const pending = queue.getPending("client1");
      expect(pending).toHaveLength(2);
      expect(pending[0]?.seq).toBe(1);
      expect(pending[1]?.seq).toBe(2);
    });

    it("should return empty array for unknown client", () => {
      expect(queue.getPending("unknown")).toEqual([]);
    });
  });

  describe("dequeueAll", () => {
    it("should return all pending actions", () => {
      queue.enqueue("client1", {
        seq: 1,
        action: { type: "attack", value: 10 },
        clientTimestamp: 1000,
      });
      queue.enqueue("client2", {
        seq: 1,
        action: { type: "attack", value: 20 },
        clientTimestamp: 2000,
      });

      const actions = queue.dequeueAll();

      expect(actions).toHaveLength(2);
      expect(actions[0]?.clientId).toBe("client1");
      expect(actions[1]?.clientId).toBe("client2");
    });

    it("should clear queues after dequeue", () => {
      queue.enqueue("client1", {
        seq: 1,
        action: { type: "attack", value: 10 },
        clientTimestamp: Date.now(),
      });

      queue.dequeueAll();

      expect(queue.size()).toBe(0);
    });

    it("should mark actions as processed for deduplication", () => {
      const message: ActionMessage<TestAction> = {
        seq: 1,
        action: { type: "attack", value: 10 },
        clientTimestamp: Date.now(),
      };

      queue.enqueue("client1", message);
      queue.dequeueAll();

      // Try to re-add same action
      const result = queue.enqueue("client1", message);
      expect(result).toBe(false);
    });
  });

  describe("dequeueClient", () => {
    it("should return actions for specific client", () => {
      queue.enqueue("client1", {
        seq: 1,
        action: { type: "attack", value: 10 },
        clientTimestamp: Date.now(),
      });
      queue.enqueue("client2", {
        seq: 1,
        action: { type: "attack", value: 20 },
        clientTimestamp: Date.now(),
      });

      const actions = queue.dequeueClient("client1");

      expect(actions).toHaveLength(1);
      expect(actions[0]?.action.value).toBe(10);
      expect(queue.size()).toBe(1); // client2's action remains
    });
  });

  describe("isProcessed", () => {
    it("should return false for unprocessed action", () => {
      expect(queue.isProcessed("client1", 1)).toBe(false);
    });

    it("should return true after action is dequeued", () => {
      queue.enqueue("client1", {
        seq: 1,
        action: { type: "attack", value: 10 },
        clientTimestamp: Date.now(),
      });
      queue.dequeueAll();

      expect(queue.isProcessed("client1", 1)).toBe(true);
    });
  });

  describe("removeClient", () => {
    it("should remove all data for a client", () => {
      queue.enqueue("client1", {
        seq: 1,
        action: { type: "attack", value: 10 },
        clientTimestamp: Date.now(),
      });
      queue.dequeueAll();

      queue.removeClient("client1");

      // Should be able to add same seq again
      const result = queue.enqueue("client1", {
        seq: 1,
        action: { type: "attack", value: 10 },
        clientTimestamp: Date.now(),
      });
      expect(result).toBe(true);
    });
  });

  describe("clear", () => {
    it("should clear all queues and processed history", () => {
      queue.enqueue("client1", {
        seq: 1,
        action: { type: "attack", value: 10 },
        clientTimestamp: Date.now(),
      });
      queue.dequeueAll();

      queue.clear();

      expect(queue.size()).toBe(0);
      expect(queue.isProcessed("client1", 1)).toBe(false);
    });
  });

  describe("processed history trimming", () => {
    it("should trim old processed entries when limit exceeded", () => {
      const smallQueue = new ActionQueue<TestAction>(5);

      // Add and process more than the limit
      for (let i = 1; i <= 10; i++) {
        smallQueue.enqueue("client1", {
          seq: i,
          action: { type: "attack", value: i },
          clientTimestamp: Date.now(),
        });
      }
      smallQueue.dequeueAll();

      // Old entries should be trimmed
      expect(smallQueue.isProcessed("client1", 1)).toBe(false);
      expect(smallQueue.isProcessed("client1", 2)).toBe(false);
      // Recent entries should still be tracked
      expect(smallQueue.isProcessed("client1", 10)).toBe(true);
    });
  });
});
