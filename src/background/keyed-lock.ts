/**
 * Efficient per-key async mutex with bounded memory and deadlock protection.
 * Each key has a tail promise chain – tasks for same key run sequentially,
 * different keys run concurrently. This avoids global locks while preventing
 * duplicate cleanup for same container.
 *
 * Improvements for invisibility:
 * - Bounded map size (auto-prunes stale entries)
 * - Timeout for waiting tasks to avoid hanging forever if previous task stalls
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<void>>();
  private static readonly MAX_KEYS = 200;
  private static readonly WAIT_TIMEOUT_MS = 30_000;

  public async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    // Prune if we exceed bounded size – prevents memory leak from many container IDs
    if (this.tails.size > KeyedLock.MAX_KEYS) {
      const toDelete = [...this.tails.keys()].slice(0, 20);
      for (const k of toDelete) this.tails.delete(k);
    }

    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    this.tails.set(key, tail);

    // Wait for previous with timeout – if previous hangs, we proceed anyway to avoid deadlock
    try {
      await this.withTimeout(
        previous.catch(() => undefined),
        KeyedLock.WAIT_TIMEOUT_MS,
      );
    } catch {
      // Timeout – previous task took too long, proceed anyway (fail open for availability)
    }

    try {
      return await task();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Lock wait timeout")), ms);
      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  public size(): number {
    return this.tails.size;
  }
}
