import type { QuickConnectState } from '../backend/types';

export const QUICK_CONNECT_POLL_MS = 3000;
/** Jellyfin forgets a Quick Connect request after ten minutes. */
export const QUICK_CONNECT_TTL_MS = 10 * 60 * 1000;

export interface QuickConnectWatch {
  /** Called once the request has been approved; the caller completes the sign-in. */
  onAuthorized(): void;
  onExpired(): void;
  onError(error: unknown): void;
}

/**
 * Polls `poll` until the request is approved, fails or expires. Each poll starts only after the
 * previous one has answered, so a slow server never has several in flight. Returns a function that
 * stops polling; no callback runs after it has been called.
 */
export function watchQuickConnect(
  poll: () => Promise<QuickConnectState>,
  watch: QuickConnectWatch,
  { intervalMs = QUICK_CONNECT_POLL_MS, ttlMs = QUICK_CONNECT_TTL_MS } = {},
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expires = Date.now() + ttlMs;
  const tick = async () => {
    let st: QuickConnectState;
    try {
      st = await poll();
    } catch (e) {
      if (!stopped) {
        stopped = true;
        watch.onError(e);
      }
      return;
    }
    if (stopped) {
      return;
    }
    if (st.status === 'authorized') {
      stopped = true;
      watch.onAuthorized();
    } else if (Date.now() >= expires) {
      stopped = true;
      watch.onExpired();
    } else {
      timer = setTimeout(tick, intervalMs);
    }
  };
  timer = setTimeout(tick, intervalMs);
  return () => {
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  };
}
