/**
 * Erasing a memory, with a way back.
 *
 * The journal's delete is final, so the Memory Lab never calls it straight
 * away. Erasing starts a countdown: the memory dissolves on screen and a
 * Restore button counts down, and only when it reaches zero is the journal
 * asked to delete. Closing the lab commits what is pending — that is the
 * reader leaving, having seen it go — but a crash or a power cut deletes
 * nothing, because nothing was deleted yet.
 *
 * Pure bookkeeping, so the rule can be tested without a clock.
 */

/** Seconds a memory can still be restored after it is erased. */
export const RESTORE_WINDOW_S = 8;

export interface PendingErase {
  key: string;
  /** When the journal will be asked to delete it, in milliseconds. */
  deadline: number;
}

export class EraseQueue {
  private pending = new Map<string, PendingErase>();

  erase(key: string, nowMs: number): PendingErase {
    const entry = { key, deadline: nowMs + RESTORE_WINDOW_S * 1000 };
    this.pending.set(key, entry);
    return entry;
  }

  /** True if it was still pending and is now saved. */
  restore(key: string): boolean {
    return this.pending.delete(key);
  }

  isPending(key: string): boolean {
    return this.pending.has(key);
  }

  secondsLeft(key: string, nowMs: number): number {
    const entry = this.pending.get(key);
    return entry ? Math.max(0, Math.ceil((entry.deadline - nowMs) / 1000)) : 0;
  }

  /** The ones whose time is up, removed from the queue: delete these now. */
  due(nowMs: number): string[] {
    const out: string[] = [];
    for (const [key, entry] of this.pending) {
      if (entry.deadline <= nowMs) {
        out.push(key);
        this.pending.delete(key);
      }
    }
    return out;
  }

  /** Everything still pending, removed: the reader is leaving the lab. */
  flush(): string[] {
    const out = [...this.pending.keys()];
    this.pending.clear();
    return out;
  }
}
