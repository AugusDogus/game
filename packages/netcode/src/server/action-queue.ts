/**
 * Queue for managing client actions awaiting server processing.
 *
 * Similar to InputQueue but for discrete actions (attacks, abilities)
 * rather than continuous inputs (movement).
 *
 * @module server/action-queue
 */

import type { ActionMessage } from "../core/types.js";

/**
 * Internal storage for queued actions with receive timestamp.
 */
interface StoredAction<TAction> {
  /** The action message */
  message: ActionMessage<TAction>;

  /** Server timestamp when action was received (captured at enqueue time) */
  serverReceiveTime: number;
}

/**
 * Queued action with client metadata.
 */
export interface QueuedAction<TAction> {
  /** The client who sent this action */
  clientId: string;

  /** The action message */
  message: ActionMessage<TAction>;

  /** Server timestamp when action was received */
  serverReceiveTime: number;
}

/**
 * Queue for managing client actions.
 *
 * Features:
 * - FIFO ordering per client
 * - Deduplication by (clientId, seq) to handle retries
 * - Batch retrieval for tick processing
 *
 * @typeParam TAction - Your game's action type
 *
 * @example
 * ```ts
 * const actionQueue = new ActionQueue<AttackAction>();
 *
 * // When receiving action from client
 * actionQueue.enqueue(clientId, actionMessage);
 *
 * // During tick processing
 * const actions = actionQueue.dequeueAll();
 * for (const action of actions) {
 *   const result = lagCompensator.validateAction(...);
 *   // Send result back to client
 * }
 * ```
 */
export class ActionQueue<TAction> {
  /** Actions waiting to be processed, keyed by clientId */
  private queues: Map<string, StoredAction<TAction>[]> = new Map();

  /** Set of processed (clientId, seq) pairs for deduplication */
  private processedActions: Map<string, Set<number>> = new Map();

  /** Maximum number of processed seq numbers to remember per client */
  private readonly maxProcessedHistory: number;

  constructor(maxProcessedHistory: number = 100) {
    this.maxProcessedHistory = maxProcessedHistory;
  }

  /**
   * Add an action to the queue.
   *
   * Duplicate actions (same clientId + seq) are silently ignored.
   * The server receive time is captured at enqueue time.
   *
   * @param clientId - The client who sent the action
   * @param message - The action message
   * @returns true if action was queued, false if it was a duplicate
   */
  enqueue(clientId: string, message: ActionMessage<TAction>): boolean {
    // Check for duplicate
    const processed = this.processedActions.get(clientId);
    if (processed?.has(message.seq)) {
      return false; // Duplicate, ignore
    }

    // Get or create queue for this client
    let queue = this.queues.get(clientId);
    if (!queue) {
      queue = [];
      this.queues.set(clientId, queue);
    }

    // Check if already in queue (not yet processed)
    const alreadyQueued = queue.some((stored) => stored.message.seq === message.seq);
    if (alreadyQueued) {
      return false; // Already queued
    }

    // Store with receive timestamp captured now
    queue.push({
      message,
      serverReceiveTime: Date.now(),
    });
    return true;
  }

  /**
   * Get all pending actions for a specific client without removing them.
   *
   * @param clientId - The client ID
   * @returns Array of pending action messages
   */
  getPending(clientId: string): ActionMessage<TAction>[] {
    const queue = this.queues.get(clientId);
    return queue?.map((stored) => stored.message) ?? [];
  }

  /**
   * Dequeue all pending actions from all clients.
   *
   * Returns actions in order of receipt and marks them as processed
   * for deduplication. Uses the serverReceiveTime captured at enqueue.
   *
   * @returns Array of queued actions with client metadata
   */
  dequeueAll(): QueuedAction<TAction>[] {
    const result: QueuedAction<TAction>[] = [];

    for (const [clientId, queue] of this.queues) {
      for (const stored of queue) {
        result.push({
          clientId,
          message: stored.message,
          serverReceiveTime: stored.serverReceiveTime,
        });

        // Mark as processed for deduplication
        this.markProcessed(clientId, stored.message.seq);
      }
    }

    // Clear all queues
    this.queues.clear();

    return result;
  }

  /**
   * Dequeue all pending actions for a specific client.
   *
   * @param clientId - The client ID
   * @returns Array of action messages
   */
  dequeueClient(clientId: string): ActionMessage<TAction>[] {
    const queue = this.queues.get(clientId);
    if (!queue || queue.length === 0) {
      return [];
    }

    // Mark all as processed
    for (const stored of queue) {
      this.markProcessed(clientId, stored.message.seq);
    }

    // Clear and return messages only
    this.queues.set(clientId, []);
    return queue.map((stored) => stored.message);
  }

  /**
   * Mark an action as processed (for deduplication).
   */
  private markProcessed(clientId: string, seq: number): void {
    let processed = this.processedActions.get(clientId);
    if (!processed) {
      processed = new Set();
      this.processedActions.set(clientId, processed);
    }

    processed.add(seq);

    // Trim old entries if needed
    if (processed.size > this.maxProcessedHistory) {
      // Remove oldest entries (lowest seq numbers)
      const sorted = Array.from(processed).sort((a, b) => a - b);
      const toRemove = sorted.slice(0, processed.size - this.maxProcessedHistory);
      for (const seq of toRemove) {
        processed.delete(seq);
      }
    }
  }

  /**
   * Check if an action has already been processed.
   *
   * @param clientId - The client ID
   * @param seq - The action sequence number
   * @returns true if already processed
   */
  isProcessed(clientId: string, seq: number): boolean {
    return this.processedActions.get(clientId)?.has(seq) ?? false;
  }

  /**
   * Remove all data for a disconnected client.
   *
   * @param clientId - The client ID
   */
  removeClient(clientId: string): void {
    this.queues.delete(clientId);
    this.processedActions.delete(clientId);
  }

  /**
   * Get the number of pending actions across all clients.
   */
  size(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.length;
    }
    return total;
  }

  /**
   * Clear all queues and processed history.
   */
  clear(): void {
    this.queues.clear();
    this.processedActions.clear();
  }
}
