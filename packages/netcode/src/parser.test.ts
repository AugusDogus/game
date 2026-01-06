import { describe, test, expect } from "bun:test";
import { superjsonParser } from "./parser.js";

describe("superjsonParser", () => {
  const encoder = new superjsonParser.Encoder();

  describe("Encoder", () => {
    test("should encode simple object to string array", () => {
      const packet = { type: 2, data: { foo: "bar" } };
      const encoded = encoder.encode(packet);
      
      expect(Array.isArray(encoded)).toBe(true);
      expect(encoded).toHaveLength(1);
      expect(typeof encoded[0]).toBe("string");
    });

    test("should encode Map correctly", () => {
      const map = new Map<string, number>([["a", 1], ["b", 2]]);
      const packet = { type: 2, data: { players: map } };
      const encoded = encoder.encode(packet);
      
      // superjson uses lowercase "map" in meta
      expect(encoded[0]).toContain("map");
    });

    test("should encode Set correctly", () => {
      const set = new Set([1, 2, 3]);
      const packet = { type: 2, data: { items: set } };
      const encoded = encoder.encode(packet);
      
      // superjson uses lowercase "set" in meta
      expect(encoded[0]).toContain("set");
    });

    test("should encode Date correctly", () => {
      const date = new Date("2024-01-01T00:00:00Z");
      const packet = { type: 2, data: { timestamp: date } };
      const encoded = encoder.encode(packet);
      
      expect(encoded[0]).toContain("Date");
    });

    test("should encode BigInt correctly", () => {
      const packet = { type: 2, data: { bigNumber: BigInt(9007199254740993) } };
      const encoded = encoder.encode(packet);
      
      expect(encoded[0]).toContain("bigint");
    });
  });

  describe("Decoder", () => {
    test("should decode string back to object", () => {
      const decoder = new superjsonParser.Decoder();
      const packet = { type: 2, data: { foo: "bar" } };
      const encoded = encoder.encode(packet);
      
      let decoded: unknown;
      decoder.on("decoded", (p) => {
        decoded = p;
      });
      
      decoder.add(encoded[0]!);
      
      expect(decoded).toEqual(packet);
    });

    test("should emit 'decoded' event on add", () => {
      const decoder = new superjsonParser.Decoder();
      let eventFired = false;
      
      decoder.on("decoded", () => {
        eventFired = true;
      });
      
      decoder.add('{"json":{"test":true}}');
      
      expect(eventFired).toBe(true);
    });

    test("should call destroy without error", () => {
      const decoder = new superjsonParser.Decoder();
      expect(() => decoder.destroy()).not.toThrow();
    });
  });

  describe("Round-trip serialization", () => {
    test("Map should survive round-trip", () => {
      const decoder = new superjsonParser.Decoder();
      const originalMap = new Map([["player1", { x: 10, y: 20 }], ["player2", { x: 30, y: 40 }]]);
      const packet = { type: 2, data: { players: originalMap } };
      
      const encoded = encoder.encode(packet);
      
      let decoded: typeof packet | null = null;
      decoder.on("decoded", (p) => {
        decoded = p as typeof packet;
      });
      decoder.add(encoded[0]!);
      
      expect(decoded?.data.players).toBeInstanceOf(Map);
      expect(decoded?.data.players.get("player1")).toEqual({ x: 10, y: 20 });
      expect(decoded?.data.players.get("player2")).toEqual({ x: 30, y: 40 });
    });

    test("Set should survive round-trip", () => {
      const decoder = new superjsonParser.Decoder();
      const originalSet = new Set(["a", "b", "c"]);
      const packet = { type: 2, data: { tags: originalSet } };
      
      const encoded = encoder.encode(packet);
      
      let decoded: typeof packet | null = null;
      decoder.on("decoded", (p) => {
        decoded = p as typeof packet;
      });
      decoder.add(encoded[0]!);
      
      expect(decoded?.data.tags).toBeInstanceOf(Set);
      expect(decoded?.data.tags.has("a")).toBe(true);
      expect(decoded?.data.tags.has("b")).toBe(true);
      expect(decoded?.data.tags.has("c")).toBe(true);
    });

    test("Date should survive round-trip", () => {
      const decoder = new superjsonParser.Decoder();
      const originalDate = new Date("2024-06-15T12:30:00Z");
      const packet = { type: 2, data: { created: originalDate } };
      
      const encoded = encoder.encode(packet);
      
      let decoded: typeof packet | null = null;
      decoder.on("decoded", (p) => {
        decoded = p as typeof packet;
      });
      decoder.add(encoded[0]!);
      
      expect(decoded?.data.created).toBeInstanceOf(Date);
      expect(decoded?.data.created.getTime()).toBe(originalDate.getTime());
    });

    test("BigInt should survive round-trip", () => {
      const decoder = new superjsonParser.Decoder();
      const originalBigInt = BigInt("12345678901234567890");
      const packet = { type: 2, data: { id: originalBigInt } };
      
      const encoded = encoder.encode(packet);
      
      let decoded: typeof packet | null = null;
      decoder.on("decoded", (p) => {
        decoded = p as typeof packet;
      });
      decoder.add(encoded[0]!);
      
      expect(typeof decoded?.data.id).toBe("bigint");
      expect(decoded?.data.id).toBe(originalBigInt);
    });

    test("nested Map inside Map should survive round-trip", () => {
      const decoder = new superjsonParser.Decoder();
      const innerMap = new Map([["score", 100]]);
      const outerMap = new Map([["player1", innerMap]]);
      const packet = { type: 2, data: { nested: outerMap } };
      
      const encoded = encoder.encode(packet);
      
      let decoded: typeof packet | null = null;
      decoder.on("decoded", (p) => {
        decoded = p as typeof packet;
      });
      decoder.add(encoded[0]!);
      
      expect(decoded?.data.nested).toBeInstanceOf(Map);
      expect(decoded?.data.nested.get("player1")).toBeInstanceOf(Map);
      expect(decoded?.data.nested.get("player1")?.get("score")).toBe(100);
    });

    test("complex game state should survive round-trip", () => {
      const decoder = new superjsonParser.Decoder();
      const gameState = {
        tick: 42,
        timestamp: Date.now(),
        state: {
          players: new Map([
            ["p1", { position: { x: 100, y: 200 }, velocity: { x: 0, y: 0 }, isGrounded: true }],
            ["p2", { position: { x: 300, y: 200 }, velocity: { x: 5, y: -10 }, isGrounded: false }],
          ]),
          tick: 42,
        },
        inputAcks: new Map([
          ["p1", 15],
          ["p2", 12],
        ]),
      };
      
      const encoded = encoder.encode(gameState);
      
      let decoded: typeof gameState | null = null;
      decoder.on("decoded", (p) => {
        decoded = p as typeof gameState;
      });
      decoder.add(encoded[0]!);
      
      expect(decoded?.tick).toBe(42);
      expect(decoded?.state.players).toBeInstanceOf(Map);
      expect(decoded?.state.players.size).toBe(2);
      expect(decoded?.state.players.get("p1")?.position.x).toBe(100);
      expect(decoded?.inputAcks).toBeInstanceOf(Map);
      expect(decoded?.inputAcks.get("p1")).toBe(15);
    });
  });

  describe("Error handling", () => {
    test("should handle empty object", () => {
      const decoder = new superjsonParser.Decoder();
      const encoded = encoder.encode({});
      
      let decoded: unknown;
      decoder.on("decoded", (p) => {
        decoded = p;
      });
      decoder.add(encoded[0]!);
      
      expect(decoded).toEqual({});
    });

    test("should handle null values", () => {
      const decoder = new superjsonParser.Decoder();
      const packet = { data: null };
      const encoded = encoder.encode(packet);
      
      let decoded: typeof packet | null = null;
      decoder.on("decoded", (p) => {
        decoded = p as typeof packet;
      });
      decoder.add(encoded[0]!);
      
      expect(decoded?.data).toBeNull();
    });

    test("should handle undefined values in objects", () => {
      const decoder = new superjsonParser.Decoder();
      // Note: undefined is not JSON-serializable, so superjson may omit it
      const packet = { a: 1, b: undefined };
      const encoded = encoder.encode(packet);
      
      let decoded: Partial<typeof packet> | null = null;
      decoder.on("decoded", (p) => {
        decoded = p as typeof packet;
      });
      decoder.add(encoded[0]!);
      
      expect(decoded?.a).toBe(1);
      // undefined may be omitted or preserved depending on superjson version
    });

    test("should throw on invalid JSON string", () => {
      const decoder = new superjsonParser.Decoder();
      
      expect(() => {
        decoder.add("not valid json {{{");
      }).toThrow();
    });

    test("should handle empty array", () => {
      const decoder = new superjsonParser.Decoder();
      const encoded = encoder.encode([]);
      
      let decoded: unknown;
      decoder.on("decoded", (p) => {
        decoded = p;
      });
      decoder.add(encoded[0]!);
      
      expect(decoded).toEqual([]);
    });

    test("should handle deeply nested structures", () => {
      const decoder = new superjsonParser.Decoder();
      const deep = { l1: { l2: { l3: { l4: { l5: { value: "deep" } } } } } };
      const encoded = encoder.encode(deep);
      
      let decoded: typeof deep | null = null;
      decoder.on("decoded", (p) => {
        decoded = p as typeof deep;
      });
      decoder.add(encoded[0]!);
      
      expect(decoded?.l1.l2.l3.l4.l5.value).toBe("deep");
    });
  });

  describe("Socket.IO packet format compatibility", () => {
    test("should handle Socket.IO event packet structure", () => {
      const decoder = new superjsonParser.Decoder();
      // Socket.IO packet format: type 2 = EVENT
      const packet = {
        type: 2,
        nsp: "/",
        data: ["netcode:snapshot", { tick: 1, state: new Map() }],
      };
      
      const encoded = encoder.encode(packet);
      
      let decoded: typeof packet | null = null;
      decoder.on("decoded", (p) => {
        decoded = p as typeof packet;
      });
      decoder.add(encoded[0]!);
      
      expect(decoded?.type).toBe(2);
      expect(decoded?.nsp).toBe("/");
      expect(Array.isArray(decoded?.data)).toBe(true);
      expect(decoded?.data[0]).toBe("netcode:snapshot");
    });

    test("should handle Socket.IO ack packet structure", () => {
      const decoder = new superjsonParser.Decoder();
      // Socket.IO packet format: type 3 = ACK
      const packet = {
        type: 3,
        id: 42,
        nsp: "/",
        data: [{ success: true, ackSeq: 10 }],
      };
      
      const encoded = encoder.encode(packet);
      
      let decoded: typeof packet | null = null;
      decoder.on("decoded", (p) => {
        decoded = p as typeof packet;
      });
      decoder.add(encoded[0]!);
      
      expect(decoded?.type).toBe(3);
      expect(decoded?.id).toBe(42);
    });
  });
});
