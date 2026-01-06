import { describe, test, expect, beforeEach } from "bun:test";
import { InputQueue } from "./input-queue.js";
import type { InputMessage } from "../types.js";

describe("InputQueue", () => {
  let inputQueue: InputQueue;

  beforeEach(() => {
    inputQueue = new InputQueue();
  });

  const createInput = (seq: number): InputMessage => ({
    seq,
    input: { moveX: 1, moveY: 0, jump: false, timestamp: Date.now() },
    timestamp: Date.now(),
  });

  describe("enqueue", () => {
    test("should add input to queue", () => {
      inputQueue.enqueue("client-1", createInput(0));

      const pending = inputQueue.getPendingInputs("client-1");
      expect(pending).toHaveLength(1);
      expect(pending[0]?.seq).toBe(0);
    });

    test("should maintain order by sequence number", () => {
      inputQueue.enqueue("client-1", createInput(2));
      inputQueue.enqueue("client-1", createInput(0));
      inputQueue.enqueue("client-1", createInput(1));

      const pending = inputQueue.getPendingInputs("client-1");
      expect(pending.map((p) => p.seq)).toEqual([0, 1, 2]);
    });

    test("should handle multiple clients", () => {
      inputQueue.enqueue("client-1", createInput(0));
      inputQueue.enqueue("client-2", createInput(0));
      inputQueue.enqueue("client-1", createInput(1));

      expect(inputQueue.getPendingInputs("client-1")).toHaveLength(2);
      expect(inputQueue.getPendingInputs("client-2")).toHaveLength(1);
    });
  });

  describe("getPendingInputs", () => {
    test("should return empty array for unknown client", () => {
      const pending = inputQueue.getPendingInputs("unknown");
      expect(pending).toHaveLength(0);
    });

    test("should return all inputs when no upToSeq specified", () => {
      inputQueue.enqueue("client-1", createInput(0));
      inputQueue.enqueue("client-1", createInput(1));
      inputQueue.enqueue("client-1", createInput(2));

      const pending = inputQueue.getPendingInputs("client-1");
      expect(pending).toHaveLength(3);
    });

    test("should filter by upToSeq", () => {
      inputQueue.enqueue("client-1", createInput(0));
      inputQueue.enqueue("client-1", createInput(1));
      inputQueue.enqueue("client-1", createInput(2));
      inputQueue.enqueue("client-1", createInput(3));

      const pending = inputQueue.getPendingInputs("client-1", 1);
      expect(pending).toHaveLength(2);
      expect(pending.map((p) => p.seq)).toEqual([0, 1]);
    });
  });

  describe("acknowledge", () => {
    test("should remove acknowledged inputs", () => {
      inputQueue.enqueue("client-1", createInput(0));
      inputQueue.enqueue("client-1", createInput(1));
      inputQueue.enqueue("client-1", createInput(2));

      inputQueue.acknowledge("client-1", 1);

      const pending = inputQueue.getPendingInputs("client-1");
      expect(pending).toHaveLength(1);
      expect(pending[0]?.seq).toBe(2);
    });

    test("should handle acknowledging all inputs", () => {
      inputQueue.enqueue("client-1", createInput(0));
      inputQueue.enqueue("client-1", createInput(1));

      inputQueue.acknowledge("client-1", 1);

      const pending = inputQueue.getPendingInputs("client-1");
      expect(pending).toHaveLength(0);
    });

    test("should handle acknowledging unknown client", () => {
      inputQueue.acknowledge("unknown", 5);
      // Should not throw
    });
  });

  describe("removeClient", () => {
    test("should remove all inputs for a client", () => {
      inputQueue.enqueue("client-1", createInput(0));
      inputQueue.enqueue("client-1", createInput(1));
      inputQueue.enqueue("client-2", createInput(0));

      inputQueue.removeClient("client-1");

      expect(inputQueue.getPendingInputs("client-1")).toHaveLength(0);
      expect(inputQueue.getPendingInputs("client-2")).toHaveLength(1);
    });
  });

  describe("getClientsWithInputs", () => {
    test("should return clients with pending inputs", () => {
      inputQueue.enqueue("client-1", createInput(0));
      inputQueue.enqueue("client-2", createInput(0));

      const clients = inputQueue.getClientsWithInputs();
      expect(clients.sort()).toEqual(["client-1", "client-2"]);
    });

    test("should not return clients with empty queues", () => {
      inputQueue.enqueue("client-1", createInput(0));
      inputQueue.acknowledge("client-1", 0);

      const clients = inputQueue.getClientsWithInputs();
      expect(clients).toHaveLength(0);
    });
  });
});
