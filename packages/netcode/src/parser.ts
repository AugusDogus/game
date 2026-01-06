/**
 * Custom Socket.IO parser using superjson for proper Map/Set/Date serialization.
 *
 * Usage:
 *   // Server
 *   const io = new Server({ parser: superjsonParser });
 *
 *   // Client
 *   const socket = io({ parser: superjsonParser });
 */

import { Emitter } from "@socket.io/component-emitter";
import superjson from "superjson";

interface DecoderEvents {
  decoded: (packet: unknown) => void;
}

/**
 * Encoder - converts packets to strings using superjson
 */
class Encoder {
  encode(packet: unknown): string[] {
    return [superjson.stringify(packet)];
  }
}

/**
 * Decoder - parses strings back to packets using superjson
 */
class Decoder extends Emitter<DecoderEvents, DecoderEvents> {
  add(chunk: string): void {
    const packet = superjson.parse(chunk);
    this.emit("decoded", packet);
  }

  destroy(): void {
    // Nothing to clean up
  }
}

/**
 * Socket.IO parser that uses superjson for serialization.
 * Properly handles Map, Set, Date, BigInt, and other complex types.
 */
export const superjsonParser = {
  Encoder,
  Decoder,
};
