import { describe, test, expect, beforeEach } from "bun:test";
import { InputBuffer } from "./input-buffer.js";

describe("InputBuffer", () => {
  let buffer: InputBuffer;

  beforeEach(() => {
    buffer = new InputBuffer();
  });

  describe("add", () => {
    test("should add input and return sequence number", () => {
      const seq = buffer.add({ moveX: 1, moveY: 0, timestamp: 1000 });
      expect(seq).toBe(0);

      const seq2 = buffer.add({ moveX: 0, moveY: 1, timestamp: 1001 });
      expect(seq2).toBe(1);
    });

    test("should store input retrievable by sequence", () => {
      const seq = buffer.add({ moveX: 1, moveY: -1, timestamp: 1000 });

      const input = buffer.get(seq);
      expect(input?.input.moveX).toBe(1);
      expect(input?.input.moveY).toBe(-1);
    });
  });

  describe("get", () => {
    test("should return undefined for non-existent sequence", () => {
      expect(buffer.get(999)).toBeUndefined();
    });
  });

  describe("getUnacknowledged", () => {
    test("should return inputs after given sequence", () => {
      buffer.add({ moveX: 1, moveY: 0, timestamp: 1000 }); // seq 0
      buffer.add({ moveX: 0, moveY: 1, timestamp: 1001 }); // seq 1
      buffer.add({ moveX: -1, moveY: 0, timestamp: 1002 }); // seq 2

      const unacked = buffer.getUnacknowledged(0);
      expect(unacked).toHaveLength(2);
      expect(unacked.map((i) => i.seq)).toEqual([1, 2]);
    });

    test("should return all inputs when afterSeq is -1", () => {
      buffer.add({ moveX: 1, moveY: 0, timestamp: 1000 });
      buffer.add({ moveX: 0, moveY: 1, timestamp: 1001 });

      const unacked = buffer.getUnacknowledged(-1);
      expect(unacked).toHaveLength(2);
    });

    test("should return empty array when all acknowledged", () => {
      buffer.add({ moveX: 1, moveY: 0, timestamp: 1000 }); // seq 0
      buffer.add({ moveX: 0, moveY: 1, timestamp: 1001 }); // seq 1

      const unacked = buffer.getUnacknowledged(1);
      expect(unacked).toHaveLength(0);
    });
  });

  describe("acknowledge", () => {
    test("should remove acknowledged inputs", () => {
      buffer.add({ moveX: 1, moveY: 0, timestamp: 1000 }); // seq 0
      buffer.add({ moveX: 0, moveY: 1, timestamp: 1001 }); // seq 1
      buffer.add({ moveX: -1, moveY: 0, timestamp: 1002 }); // seq 2

      buffer.acknowledge(1);

      expect(buffer.get(0)).toBeUndefined();
      expect(buffer.get(1)).toBeUndefined();
      expect(buffer.get(2)).toBeDefined();
      expect(buffer.size()).toBe(1);
    });
  });

  describe("clear", () => {
    test("should remove all inputs and reset sequence", () => {
      buffer.add({ moveX: 1, moveY: 0, timestamp: 1000 });
      buffer.add({ moveX: 0, moveY: 1, timestamp: 1001 });

      buffer.clear();

      expect(buffer.size()).toBe(0);
      expect(buffer.getNextSeq()).toBe(0);
    });
  });

  describe("size", () => {
    test("should return number of pending inputs", () => {
      expect(buffer.size()).toBe(0);

      buffer.add({ moveX: 1, moveY: 0, timestamp: 1000 });
      expect(buffer.size()).toBe(1);

      buffer.add({ moveX: 0, moveY: 1, timestamp: 1001 });
      expect(buffer.size()).toBe(2);
    });
  });
});
