import { describe, test, expect, beforeEach } from "bun:test";
import { InputBuffer } from "./input-buffer.js";
import type { PlatformerInput } from "@game/example-platformer";

/** Helper to create test input with all required fields */
const createInput = (
  moveX: number,
  moveY: number,
  jump: boolean,
  timestamp: number,
): PlatformerInput => ({
  moveX,
  moveY,
  jump,
  shoot: false,
  shootTargetX: 0,
  shootTargetY: 0,
  timestamp,
});

describe("InputBuffer", () => {
  let buffer: InputBuffer<PlatformerInput>;

  beforeEach(() => {
    buffer = new InputBuffer<PlatformerInput>();
  });

  describe("add", () => {
    test("should add input and return sequence number", () => {
      const seq = buffer.add(createInput(1, 0, false, 1000));
      expect(seq).toBe(0);

      const seq2 = buffer.add(createInput(0, 1, false, 1001));
      expect(seq2).toBe(1);
    });

    test("should store input retrievable by sequence", () => {
      const seq = buffer.add(createInput(1, -1, true, 1000));

      const input = buffer.get(seq);
      expect(input?.input.moveX).toBe(1);
      expect(input?.input.moveY).toBe(-1);
      expect(input?.input.jump).toBe(true);
    });
  });

  describe("get", () => {
    test("should return undefined for non-existent sequence", () => {
      expect(buffer.get(999)).toBeUndefined();
    });
  });

  describe("getUnacknowledged", () => {
    test("should return inputs after given sequence", () => {
      buffer.add(createInput(1, 0, false, 1000)); // seq 0
      buffer.add(createInput(0, 1, false, 1001)); // seq 1
      buffer.add(createInput(-1, 0, false, 1002)); // seq 2

      const unacked = buffer.getUnacknowledged(0);
      expect(unacked).toHaveLength(2);
      expect(unacked.map((i: { seq: number }) => i.seq)).toEqual([1, 2]);
    });

    test("should return all inputs when afterSeq is -1", () => {
      buffer.add(createInput(1, 0, false, 1000));
      buffer.add(createInput(0, 1, false, 1001));

      const unacked = buffer.getUnacknowledged(-1);
      expect(unacked).toHaveLength(2);
    });

    test("should return empty array when all acknowledged", () => {
      buffer.add(createInput(1, 0, false, 1000)); // seq 0
      buffer.add(createInput(0, 1, false, 1001)); // seq 1

      const unacked = buffer.getUnacknowledged(1);
      expect(unacked).toHaveLength(0);
    });
  });

  describe("acknowledge", () => {
    test("should remove acknowledged inputs", () => {
      buffer.add(createInput(1, 0, false, 1000)); // seq 0
      buffer.add(createInput(0, 1, false, 1001)); // seq 1
      buffer.add(createInput(-1, 0, false, 1002)); // seq 2

      buffer.acknowledge(1);

      expect(buffer.get(0)).toBeUndefined();
      expect(buffer.get(1)).toBeUndefined();
      expect(buffer.get(2)).toBeDefined();
      expect(buffer.size()).toBe(1);
    });
  });

  describe("clear", () => {
    test("should remove all inputs and reset sequence", () => {
      buffer.add(createInput(1, 0, false, 1000));
      buffer.add(createInput(0, 1, false, 1001));

      buffer.clear();

      expect(buffer.size()).toBe(0);
      expect(buffer.getNextSeq()).toBe(0);
    });
  });

  describe("size", () => {
    test("should return number of pending inputs", () => {
      expect(buffer.size()).toBe(0);

      buffer.add(createInput(1, 0, false, 1000));
      expect(buffer.size()).toBe(1);

      buffer.add(createInput(0, 1, false, 1001));
      expect(buffer.size()).toBe(2);
    });
  });

  describe("getNextSeq", () => {
    test("should return 0 initially", () => {
      expect(buffer.getNextSeq()).toBe(0);
    });

    test("should increment after adding inputs", () => {
      buffer.add(createInput(1, 0, false, 1000));
      expect(buffer.getNextSeq()).toBe(1);

      buffer.add(createInput(0, 0, false, 1001));
      expect(buffer.getNextSeq()).toBe(2);
    });

    test("should NOT reset after acknowledge", () => {
      buffer.add(createInput(1, 0, false, 1000)); // seq 0
      buffer.add(createInput(0, 0, false, 1001)); // seq 1
      
      buffer.acknowledge(0); // Remove seq 0
      
      // getNextSeq should still be 2, not reset
      expect(buffer.getNextSeq()).toBe(2);
      
      // Adding new input should use seq 2
      const seq = buffer.add(createInput(-1, 0, false, 1002));
      expect(seq).toBe(2);
    });
  });

  describe("MAX_INPUT_BUFFER_SIZE overflow", () => {
    test("should remove oldest input when buffer exceeds max size", () => {
      // MAX_INPUT_BUFFER_SIZE is 1024, add more than that
      for (let i = 0; i < 1100; i++) {
        buffer.add(createInput(1, 0, false, 1000 + i));
      }

      // Buffer should be capped at 1024
      expect(buffer.size()).toBeLessThanOrEqual(1024);

      // Oldest inputs should be removed
      expect(buffer.get(0)).toBeUndefined();
      expect(buffer.get(75)).toBeUndefined(); // 1100 - 1024 = 76 oldest removed

      // Newest inputs should still exist
      expect(buffer.get(1099)).toBeDefined();
      expect(buffer.get(1098)).toBeDefined();
    });

    test("should preserve newest inputs when overflow occurs", () => {
      for (let i = 0; i < 1100; i++) {
        buffer.add(createInput(i % 3 - 1, 0, i % 10 === 0, 1000 + i));
      }

      // The most recent input should be retrievable
      const lastInput = buffer.get(1099);
      expect(lastInput).toBeDefined();
      expect(lastInput?.timestamp).toBe(2099);
    });

    test("sequence numbers should continue incrementing after overflow", () => {
      for (let i = 0; i < 1100; i++) {
        buffer.add(createInput(1, 0, false, 1000 + i));
      }

      // Next sequence should be 1100, not wrapped or reset
      expect(buffer.getNextSeq()).toBe(1100);

      const newSeq = buffer.add(createInput(0, 0, false, 2100));
      expect(newSeq).toBe(1100);
    });
  });

  describe("edge cases", () => {
    test("should handle very large sequence numbers", () => {
      // Simulate many inputs over time
      for (let i = 0; i < 1000; i++) {
        buffer.add(createInput(1, 0, false, 1000 + i));
        if (i > 10) {
          buffer.acknowledge(i - 10); // Keep only last 10
        }
      }

      // Should still work correctly with large sequence numbers
      expect(buffer.getNextSeq()).toBe(1000);
      expect(buffer.size()).toBeLessThanOrEqual(11);
    });

    test("should handle acknowledge with no matching inputs", () => {
      buffer.add(createInput(1, 0, false, 1000)); // seq 0
      
      // Acknowledge a future sequence (shouldn't crash)
      buffer.acknowledge(100);
      
      // Original input should be removed
      expect(buffer.get(0)).toBeUndefined();
      expect(buffer.size()).toBe(0);
    });
  });
});
