/**
 * A small keyed response cache: every entry has a time to live, keys can be invalidated by
 * prefix, and identical concurrent loads share one request. Pure TypeScript, no React, so it is
 * unit tested on its own. {@link CachedBackend} builds the keys as
 * `<serverId>/<userId>/<method>/<args>`, which keeps sessions apart and lets a mutation drop
 * every result of one method with a single prefix.
 */

export interface CacheHit<T> {
  value: T;
  /** False once the entry is older than its time to live; {@link ResponseCache.peek} still serves it. */
  fresh: boolean;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class ResponseCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 500,
  ) {}

  /** The value under `key` while its time to live has not run out. */
  get<T>(key: string): T | undefined {
    const hit = this.peek<T>(key);
    return hit?.fresh ? hit.value : undefined;
  }

  /** The value under `key` whether fresh or expired, for showing something while revalidating. */
  peek<T>(key: string): CacheHit<T> | undefined {
    const e = this.entries.get(key);
    return e
      ? { value: e.value as T, fresh: e.expiresAt > this.now() }
      : undefined;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    // Re-insert so the map iterates least recently written first.
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
  }

  /**
   * Serves a fresh entry, otherwise runs `load` and stores its result. Callers that arrive while
   * a load for the same key is in flight share it. A result is not stored when the key was
   * invalidated while the load was running, because it may predate the change.
   */
  fetch<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const fresh = this.get<T>(key);
    if (fresh !== undefined) {
      return Promise.resolve(fresh);
    }
    const pending = this.inflight.get(key);
    if (pending) {
      return pending as Promise<T>;
    }
    const p = load().then(
      value => {
        if (this.inflight.get(key) === p) {
          this.inflight.delete(key);
          this.set(key, value, ttlMs);
        }
        return value;
      },
      error => {
        if (this.inflight.get(key) === p) {
          this.inflight.delete(key);
        }
        throw error;
      },
    );
    this.inflight.set(key, p);
    return p;
  }

  /** Drops every entry and in-flight load whose key starts with `prefix`; returns how many entries went. */
  invalidate(prefix: string): number {
    let dropped = 0;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        dropped++;
      }
    }
    for (const key of [...this.inflight.keys()]) {
      if (key.startsWith(prefix)) {
        this.inflight.delete(key);
      }
    }
    return dropped;
  }

  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
