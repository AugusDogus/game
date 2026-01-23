import { describe, test, expect, beforeEach } from "bun:test";
import { InputQueue } from "./input-queue.js";
import type { InputMessage } from "../core/types.js";
import type { PlatformerInput } from "@game/example-platformer";

describe("InputQueue", () => {
  let inputQueue: InputQueue<PlatformerInput>;

  beforeEach(() => {
    inputQueue = new InputQueue<PlatformerInput>();
  });

  const createInput = (seq: number): InputMessage<PlatformerInput> => ({
    seq,
    input: {
      moveX: 1,
      moveY: 0,
      jump: false,
      shoot: false,
      shootTargetX: 0,
      shootTargetY: 0,
      timestamp: Date.now(),
    },
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
      expect(pending.map((p: InputMessage<PlatformerInput>) => p.seq)).toEqual([0, 1, 2]);
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
      expect(pending.map((p: InputMessage<PlatformerInput>) => p.seq)).toEqual([0, 1]);
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

  describe("getAllPendingInputsBatched", () => {
    test("should return empty map when no inputs", () => {
      const batched = inputQueue.getAllPendingInputsBatched();
      expect(batched.size).toBe(0);
    });

    test("should return all inputs for all clients", () => {
      inputQueue.enqueue("client-1", createInput(0));
      inputQueue.enqueue("client-1", createInput(1));
      inputQueue.enqueue("client-2", createInput(0));

      const batched = inputQueue.getAllPendingInputsBatched();
      
      expect(batched.size).toBe(2);
      expect(batched.get("client-1")?.length).toBe(2);
      expect(batched.get("client-2")?.length).toBe(1);
    });

    test("should return copies not references", () => {
      inputQueue.enqueue("client-1", createInput(0));
      
      const batched1 = inputQueue.getAllPendingInputsBatched();
      const batched2 = inputQueue.getAllPendingInputsBatched();
      
      // Should be different array instances
      expect(batched1.get("client-1")).not.toBe(batched2.get("client-1"));
    });

    test("should not include clients with empty queues", () => {
      inputQueue.enqueue("client-1", createInput(0));
      inputQueue.enqueue("client-2", createInput(0));
      inputQueue.acknowledge("client-2", 0);

      const batched = inputQueue.getAllPendingInputsBatched();
      
      expect(batched.has("client-1")).toBe(true);
      expect(batched.has("client-2")).toBe(false);
    });

    test("should preserve input order", () => {
      inputQueue.enqueue("client-1", createInput(2));
      inputQueue.enqueue("client-1", createInput(0));
      inputQueue.enqueue("client-1", createInput(1));

      const batched = inputQueue.getAllPendingInputsBatched();
      const inputs = batched.get("client-1");
      
      expect(inputs?.[0]?.seq).toBe(0);
      expect(inputs?.[1]?.seq).toBe(1);
      expect(inputs?.[2]?.seq).toBe(2);
    });
  });

  describe("getAllPendingInputs", () => {
    test("should return empty map when no inputs", () => {
      const inputs = inputQueue.getAllPendingInputs();
      expect(inputs.size).toBe(0);
    });

    test("should return last input for each client", () => {
      const now = Date.now();
      inputQueue.enqueue("client-1", { 
        seq: 0, 
        input: { moveX: 1, moveY: 0, jump: false, shoot: false, shootTargetX: 0, shootTargetY: 0, timestamp: now }, 
        timestamp: now 
      });
      inputQueue.enqueue("client-1", { 
        seq: 1, 
        input: { moveX: -1, moveY: 0, jump: true, shoot: false, shootTargetX: 0, shootTargetY: 0, timestamp: now + 16 }, 
        timestamp: now + 16 
      });

      const inputs = inputQueue.getAllPendingInputs();
      
      // Should return the last input (seq 1)
      expect(inputs.get("client-1")?.moveX).toBe(-1);
      expect(inputs.get("client-1")?.jump).toBe(true);
    });
  });

  describe("getLastProcessedSeq", () => {
    test("should return -1 for unknown client", () => {
      expect(inputQueue.getLastProcessedSeq("unknown")).toBe(-1);
    });

    test("should return -1 for client with empty queue", () => {
      inputQueue.enqueue("client-1", createInput(0));
      inputQueue.acknowledge("client-1", 0);
      
      expect(inputQueue.getLastProcessedSeq("client-1")).toBe(-1);
    });

    test("should return seq before first pending input", () => {
      inputQueue.enqueue("client-1", createInput(5));
      inputQueue.enqueue("client-1", createInput(6));
      inputQueue.enqueue("client-1", createInput(7));

      // First pending is 5, so last processed is 4
      expect(inputQueue.getLastProcessedSeq("client-1")).toBe(4);
    });
  });

  describe("edge cases", () => {
    test("should handle many clients", () => {
      for (let i = 0; i < 100; i++) {
        inputQueue.enqueue(`client-${i}`, createInput(0));
      }

      expect(inputQueue.getClientsWithInputs().length).toBe(100);
      expect(inputQueue.getAllPendingInputsBatched().size).toBe(100);
    });

    test("should handle many inputs per client", () => {
      for (let i = 0; i < 500; i++) {
        inputQueue.enqueue("client-1", createInput(i));
      }

      expect(inputQueue.getPendingInputs("client-1").length).toBe(500);
    });

    test("should handle duplicate sequence numbers gracefully", () => {
      inputQueue.enqueue("client-1", createInput(5));
      inputQueue.enqueue("client-1", createInput(5)); // Duplicate

      const pending = inputQueue.getPendingInputs("client-1");
      // Both should be in queue (no deduplication in current implementation)
      expect(pending.length).toBe(2);
    });
  });
});
