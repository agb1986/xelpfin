import { useEffect, useState } from 'react';
import type { KeyValueStore } from '../platform/types';
import { useApp } from './AppState';

/**
 * A small JSON document kept on the device, one per signed-in user. Screens that show the same
 * document stay in step through {@link LocalList.subscribe}.
 */
export class LocalList<T> {
  private value: T;
  private loaded = false;
  /** False while the stored document could not be read, so a write would replace data we never saw. */
  private writable = true;
  private loading?: Promise<void>;
  private writing: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();

  constructor(
    private readonly storage: KeyValueStore,
    private readonly key: string,
    private readonly empty: () => T,
    private readonly sanitize: (raw: unknown) => T,
  ) {
    this.value = empty();
  }

  get(): T {
    return this.value;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  load(): Promise<void> {
    this.loading ??= this.storage
      .get(this.key)
      .then(
        async raw => {
          let parsed: unknown;
          try {
            parsed = raw ? JSON.parse(raw) : undefined;
          } catch {
            // Keep the unreadable document aside instead of silently overwriting it.
            await this.storage.set(`${this.key}.corrupt`, raw ?? '').catch(() => undefined);
          }
          // An update made before the first read finished wins over what was stored. After a failed
          // read, what is stored wins over changes that were only ever kept in memory.
          if (!this.loaded || !this.writable) {
            this.value = this.sanitize(parsed);
          }
          this.writable = true;
        },
        () => {
          // Storage did not answer: work from memory and try reading again next time.
          this.writable = false;
          this.loading = undefined;
        },
      )
      .then(() => {
        this.loaded = true;
        this.emit();
      });
    return this.loading;
  }

  update(fn: (current: T) => T): void {
    this.value = fn(this.value);
    this.loaded = true;
    if (this.writable) {
      this.persist();
    }
    this.emit();
  }

  /** Writes the current value after any earlier write, so writes land in the order they were made. */
  private persist(): void {
    this.writing = this.writing
      .then(() => this.storage.set(this.key, JSON.stringify(this.value)))
      .catch(e => console.warn(`xelpfin: could not save ${this.key}`, e));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach(fn => fn());
  }
}

const lists = new Map<string, LocalList<unknown>>();

/** The shared list `name` of the signed-in user on this server. */
export function useLocalList<T>(name: string, empty: () => T, sanitize: (raw: unknown) => T): { value: T; list: LocalList<T> } {
  const { platform, backend } = useApp();
  const key = `xelpfin.${name}.${backend?.session.server.id ?? 'none'}.${backend?.session.userId ?? 'none'}`;
  let list = lists.get(key) as LocalList<T> | undefined;
  if (!list) {
    list = new LocalList(platform.storage, key, empty, sanitize);
    lists.set(key, list as LocalList<unknown>);
  }
  const current = list;
  const [value, setValue] = useState(() => current.get());
  useEffect(() => {
    setValue(current.get());
    const off = current.subscribe(() => setValue(current.get()));
    current.load();
    return off;
  }, [current]);
  return { value, list: current };
}

/** Test hook: forget cached lists. */
export function resetLocalLists(): void {
  lists.clear();
}
