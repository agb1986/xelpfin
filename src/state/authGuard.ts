import type { Backend } from '../backend/Backend';
import { BackendError } from '../backend/types';

/** True for an error that means the session token is no longer accepted (revoked or expired). */
export function isSessionExpired(e: unknown): boolean {
  return e instanceof BackendError && e.kind === 'auth' && e.status === 401;
}

/**
 * Wraps a backend so any call rejected with HTTP 401 reports the expired session once.
 * 403 is not treated as expiry: Jellyfin also uses it for items a user may not access.
 */
export function guardBackend(backend: Backend, onExpired: () => void): Backend {
  let fired = false;
  return new Proxy(backend, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || prop === 'logout') {
        return value;
      }
      return (...args: unknown[]) => {
        const out = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (out instanceof Promise) {
          return out.catch(e => {
            if (!fired && isSessionExpired(e)) {
              fired = true;
              onExpired();
            }
            throw e;
          });
        }
        return out;
      };
    },
  });
}
