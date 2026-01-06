import type { InputMessage } from "../types.js";

/**
 * Queues and manages input messages from clients
 */
export class InputQueue {
  private queues: Map<string, InputMessage[]> = new Map();

  /**
   * Add an input message to the queue for a specific client
   */
  enqueue(clientId: string, message: InputMessage): void {
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
  getPendingInputs(clientId: string, upToSeq?: number): InputMessage[] {
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
    return queue[0]!.seq - 1;
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
    return Array.from(this.queues.keys()).filter(
      (id) => (this.queues.get(id)?.length ?? 0) > 0,
    );
  }
}
