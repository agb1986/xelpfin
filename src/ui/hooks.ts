import { useCallback, useEffect, useRef, useState } from 'react';

export type AsyncState<T> =
  | { status: 'loading'; data?: T; error?: undefined }
  | { status: 'ready'; data: T; error?: undefined }
  | { status: 'error'; data?: T; error: unknown };

/**
 * Runs an async loader, re-running when deps change or reload() is called. Results of stale
 * runs are dropped. Keeps the previous data while reloading so lists do not flash empty.
 */
export function useAsync<T>(
  load: () => Promise<T>,
  deps: unknown[],
): AsyncState<T> & { reload(): void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const run = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const id = ++run.current;
    setState(s => ({ status: 'loading', data: s.data }));
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
