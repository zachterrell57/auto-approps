// ---------------------------------------------------------------------------
// concurrency.ts — Concurrency control for parallel session support
//
// Provides a Semaphore primitive and pre-configured limiters for the two
// heaviest resource categories: Playwright browser instances and Anthropic
// API calls.  When 10+ sessions run in parallel these limiters prevent
// memory exhaustion (browsers) and API rate-limit errors (Claude calls).
// ---------------------------------------------------------------------------

/**
 * A counting semaphore that queues callers when the concurrency limit is
 * reached.  Usage:
 *
 *   const result = await semaphore.run(() => doExpensiveWork());
 */
export class Semaphore {
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  /** Execute `fn` once a permit is available. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      // Hand the permit directly to the next waiter (running count stays the same).
      next();
    } else {
      this.running--;
    }
  }
}

// ---------------------------------------------------------------------------
// Pre-configured limiters
// ---------------------------------------------------------------------------

/**
 * Limits concurrent Playwright browser instances.
 * Each Chromium process uses 200–500 MB; capping at 3 keeps peak memory
 * around 1.5 GB even when 10 sessions scrape simultaneously.
 */
export const browserSemaphore = new Semaphore(3);

/**
 * Limits concurrent Anthropic API requests.
 * Prevents overwhelming the API with 10+ simultaneous mapping / naming /
 * classification calls that would trigger 429 rate-limit responses.
 */
export const apiSemaphore = new Semaphore(6);
