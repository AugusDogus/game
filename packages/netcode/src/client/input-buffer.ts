import type { InputMessage } from "../types.js";
import { MAX_INPUT_BUFFER_SIZE } from "../constants.js";

/**
 * Stores pending input messages that haven't been acknowledged by the server
 */
export class InputBuffer {
  private inputs: Map<number, InputMessage> = new Map();
  private nextSeq = 0;

  /**
   * Add a new input and return its sequence number
   */
  add(input: { moveX: number; moveY: number; timestamp: number }): number {
    const seq = this.nextSeq++;
    const message: InputMessage = {
      seq,
      input: {
        moveX: input.moveX,
        moveY: input.moveY,
        timestamp: input.timestamp,
      },
      timestamp: input.timestamp,
    };

    this.inputs.set(seq, message);

    // Prevent unbounded growth
    if (this.inputs.size > MAX_INPUT_BUFFER_SIZE) {
      const oldestSeq = Math.min(...Array.from(this.inputs.keys()));
      this.inputs.delete(oldestSeq);
    }

    return seq;
  }

  /**
   * Get an input by sequence number
   */
  get(seq: number): InputMessage | undefined {
    return this.inputs.get(seq);
  }

  /**
   * Get all inputs with sequence numbers greater than the given number
   * (i.e., unacknowledged inputs)
   */
  getUnacknowledged(afterSeq: number): InputMessage[] {
    const result: InputMessage[] = [];
    for (const [seq, msg] of this.inputs.entries()) {
      if (seq > afterSeq) {
        result.push(msg);
      }
    }
    // Sort by sequence number
    return result.sort((a, b) => a.seq - b.seq);
  }

  /**
   * Remove all inputs up to and including the given sequence number
   */
  acknowledge(upToSeq: number): void {
    for (const seq of Array.from(this.inputs.keys())) {
      if (seq <= upToSeq) {
        this.inputs.delete(seq);
      }
    }
  }

  /**
   * Clear all inputs
   */
  clear(): void {
    this.inputs.clear();
    this.nextSeq = 0;
  }

  /**
   * Get the current sequence number (next one to be assigned)
   */
  getNextSeq(): number {
    return this.nextSeq;
  }

  /**
   * Get the number of pending inputs
   */
  size(): number {
    return this.inputs.size;
  }
}
