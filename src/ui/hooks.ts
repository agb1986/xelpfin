import { useCallback, useEffect, useRef, useState } from 'react';
import type { Backend } from '../backend/Backend';
import { hasPendingChanges, onUserDataChanged } from '../backend/CachedBackend';

export type AsyncState<T> =
  | { status: 'loading'; data?: T; error?: undefined }
  | { status: 'ready'; data: T; error?: undefined }
  | { status: 'error'; data?: T; error: unknown };

export interface AsyncOptions<T> {
  /**
   * Synchronous first value, typically a cache peek. When it yields one, the hook starts
   * `ready` with it and the loader revalidates in the background.
   */
  initial?: () => T | undefined;
}

/**
 * Runs an async loader, re-running when deps change or reload() is called. Results of stale
 * runs are dropped. Keeps the previous data while reloading so lists do not flash empty.
 */
export function useAsync<T>(
  load: () => Promise<T>,
  deps: unknown[],
  options: AsyncOptions<T> = {},
): AsyncState<T> & { reload(): void } {
  const [state, setState] = useState<AsyncState<T>>(() => {
    const data = options.initial?.();
    return data === undefined
      ? { status: 'loading' }
      : { status: 'ready', data };
  });
  const [tick, setTick] = useState(0);
  const run = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const id = ++run.current;
    setState(s =>
      s.status === 'loading' ? s : { status: 'loading', data: s.data },
    );
    loadRef.current().then(
      data => id === run.current && setState({ status: 'ready', data }),
      error =>
        id === run.current &&
        setState(s => ({ status: 'error', error, data: s.data })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick(t => t + 1), []);
  return { ...state, reload };
}

/**
 * Refreshes a screen's progress-carrying rows when it becomes active again (back from the
 * player or a detail page) and when user data changes while it is active. When a change is
 * still in flight on return, such as the player's stop report, the return refresh is skipped
 * and the change notification does it once, so the rows are not loaded twice.
 */
export function useRefreshOnReturn(
  active: boolean,
  backend: Backend,
  refresh: () => void,
): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const activeRef = useRef(active);
  activeRef.current = active;

  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current && !hasPendingChanges(backend)) {
      refreshRef.current();
    }
    wasActive.current = active;
  }, [active, backend]);

  useEffect(
    () =>
      onUserDataChanged(backend, () => {
        if (activeRef.current) {
          refreshRef.current();
        }
      }),
    [backend],
  );
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function formatDuration(ms?: number): string {
  if (!ms || ms < 0) {
    return '0:00';
  }
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function formatRuntime(ms?: number): string | undefined {
  if (!ms) {
    return undefined;
  }
  const min = Math.round(ms / 60000);
  if (min < 1) {
    return `${Math.max(1, Math.round(ms / 1000))} s`;
  }
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}
