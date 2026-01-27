import type { InputMessage } from "../core/types.js";
import { getFirst, getLast } from "../core/utils.js";

/**
 * Queues and manages input messages from clients.
 * Generic version that works with any input type.
 */
export class InputQueue<TInput> {
  private queues: Map<string, InputMessage<TInput>[]> = new Map();

  /**
   * Add an input message to the queue for a specific client
   */
  enqueue(clientId: string, message: InputMessage<TInput>): void {
    const queue = this.queues.get(clientId);
    if (!queue) {
      this.queues.set(clientId, [message]);
      return;
    }

    // Insert in order by sequence number (handle out-of-order packets)
    const insertIndex = queue.findIndex((m) => m.seq > message.seq);
    if (insertIndex === -1) {
      queue.push(message);
    } else {
      queue.splice(insertIndex, 0, message);
    }
  }

  /**
   * Get all pending inputs for a client up to a certain sequence number
   */
  getPendingInputs(clientId: string, upToSeq?: number): InputMessage<TInput>[] {
    const queue = this.queues.get(clientId);
    if (!queue || queue.length === 0) {
      return [];
    }

    if (upToSeq === undefined) {
      return [...queue];
    }

    return queue.filter((msg) => msg.seq <= upToSeq);
  }

  /**
   * Remove processed inputs from the queue
   */
  acknowledge(clientId: string, lastProcessedSeq: number): void {
    const queue = this.queues.get(clientId);
    if (!queue) {
      return;
    }

    // Remove all inputs with seq <= lastProcessedSeq
    const filtered = queue.filter((msg) => msg.seq > lastProcessedSeq);
    this.queues.set(clientId, filtered);
  }

  /**
   * Get the last processed sequence number for a client (highest seq in queue - 1)
   */
  getLastProcessedSeq(clientId: string): number {
    const queue = this.queues.get(clientId);
    if (!queue || queue.length === 0) {
      return -1;
    }

    // Return the sequence number before the first pending input
    return getFirst(queue, "input queue").seq - 1;
  }

  /**
   * Remove all queues for a disconnected client
   */
  removeClient(clientId: string): void {
    this.queues.delete(clientId);
  }

  /**
   * Get all client IDs with pending inputs
   */
  getClientsWithInputs(): string[] {
    return Array.from(this.queues.keys()).filter((id) => (this.queues.get(id)?.length ?? 0) > 0);
  }

  /**
   * Get the number of pending inputs for a client.
   */
  getQueueLength(clientId: string): number {
    return this.queues.get(clientId)?.length ?? 0;
  }

  /**
   * Get all pending inputs from all clients as a map.
   * Returns the last input for each client (most recent intent).
   * Used for whole-world simulation.
   */
  getAllPendingInputs(): Map<string, TInput> {
    const result = new Map<string, TInput>();
    for (const [clientId, queue] of this.queues.entries()) {
      if (queue.length > 0) {
        // Use the last input from each client (most recent)
        const lastInput = getLast(queue, "input queue");
        result.set(clientId, lastInput.input);
      }
    }
    return result;
  }

  /**
   * Get all pending input messages from all clients, with full message data.
   * Returns InputMessage objects with input, seq, and timestamp.
   */
  getAllPendingInputsBatched(): Map<string, InputMessage<TInput>[]> {
    const result = new Map<string, InputMessage<TInput>[]>();
    for (const [clientId, queue] of this.queues.entries()) {
      if (queue.length > 0) {
        result.set(clientId, [...queue]);
      }
    }
    return result;
  }

  /**
   * Get the highest sequence number received for a client.
   * Returns -1 if no inputs received.
   */
  getLastSeq(clientId: string): number {
    const queue = this.queues.get(clientId);
    if (!queue || queue.length === 0) {
      return -1;
    }
    // Queue is sorted by seq, so last element has highest seq
    return getLast(queue, "input queue").seq;
  }

  /**
   * Clear all input queues.
   */
  clear(): void {
    this.queues.clear();
  }
}
