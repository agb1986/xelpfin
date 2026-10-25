import type { Backend, ImageKind } from './Backend';
import type {
  ItemDetail,
  ItemQuery,
  Library,
  MediaItem,
  MediaSegment,
  Page,
  PlaybackPlan,
  PlaybackRequest,
  ProgressReport,
  Session,
  Trickplay,
} from './types';
import type { DeviceCapabilities } from '../player/capabilities';
import { ResponseCache } from './cache';

/** Time to live per kind of result, in milliseconds. */
export const TTL = {
  /** Libraries, latest, seasons, episodes and item detail: they change when media is added. */
  catalogue: 60_000,
  /** Continue Watching and Next Up: they change whenever something is played. */
  progress: 10_000,
} as const;

/** The read calls that go through the cache. */
export type CachedMethod =
  | 'libraries'
  | 'item'
  | 'latest'
  | 'seasons'
  | 'episodes'
  | 'resume'
  | 'resumeEpisode'
  | 'nextUp';

const TTL_OF: Record<CachedMethod, number> = {
  libraries: TTL.catalogue,
  item: TTL.catalogue,
  latest: TTL.catalogue,
  seasons: TTL.catalogue,
  episodes: TTL.catalogue,
  resume: TTL.progress,
  resumeEpisode: TTL.progress,
  nextUp: TTL.progress,
};

/** Every cached method whose result carries user data, so a mutation can drop them all. */
const USER_DATA_METHODS: CachedMethod[] = [
  'item',
  'latest',
  'seasons',
  'episodes',
  'resume',
  'resumeEpisode',
  'nextUp',
];

/**
 * Wraps a {@link Backend} so the list and detail calls the screens repeat are served from a
 * {@link ResponseCache} while fresh, and every call that changes user data (`reportStop`,
 * `clearProgress`, `setPlayed`, `setFavorite`) drops the entries it could have made stale. Keys
 * are scoped by server and user, so one cache instance can outlive a session. Paged `items`,
 * `search`, playback negotiation and progress reports always go to the server.
 */
export class CachedBackend implements Backend {
  private readonly scope: string;
  private readonly listeners = new Set<() => void>();
  /** Mutations sent and not yet answered. */
  private pending = 0;
  /** Set between the last pending mutation settling and the listeners being told. */
  private notifyTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly inner: Backend,
    private readonly cache: ResponseCache,
  ) {
    this.scope = `${inner.session.server.id}/${inner.session.userId}/`;
  }

  get session(): Session {
    return this.inner.session;
  }

  /**
   * A cached result for `method` with these arguments, fresh or expired, without a request. A
   * screen that mounts with this shows it at once and revalidates in the background.
   */
  peek<M extends CachedMethod>(
    method: M,
    ...args: Parameters<Backend[M]>
  ): Awaited<ReturnType<Backend[M]>> | undefined {
    return this.cache.peek<Awaited<ReturnType<Backend[M]>>>(
      this.key(method, args),
    )?.value;
  }

  /**
   * Calls `listener` once user data changed on the server, so an on-screen list can refresh.
   * Mutations that follow each other closely, such as the player's stop report and the watched
   * mark after it, are told as one change, after the last of them settles. Returns the
   * unsubscribe function.
   */
  onUserDataChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * True while a mutation is in flight or its listeners have not been told yet. A screen that
   * becomes active again can then skip its own refresh and wait for the change notification,
   * instead of loading the same rows twice.
   */
  hasPendingChanges(): boolean {
    return this.pending > 0 || this.notifyTimer !== undefined;
  }

  validate(): Promise<void> {
    return this.inner.validate();
  }
  logout(): Promise<void> {
    return this.inner.logout();
  }

  libraries(): Promise<Library[]> {
    return this.cached('libraries', [], () => this.inner.libraries());
  }
  items(query: ItemQuery): Promise<Page<MediaItem>> {
    return this.inner.items(query);
  }
  item(id: string): Promise<ItemDetail> {
    return this.cached('item', [id], () => this.inner.item(id));
  }
  search(term: string, limit?: number): Promise<MediaItem[]> {
    return this.inner.search(term, limit);
  }
  resume(limit?: number): Promise<MediaItem[]> {
    return this.cached('resume', [limit], () => this.inner.resume(limit));
  }
  resumeEpisode(seriesId: string): Promise<MediaItem | undefined> {
    return this.cached('resumeEpisode', [seriesId], () =>
      this.inner.resumeEpisode(seriesId),
    );
  }
  nextUp(limit?: number, seriesId?: string): Promise<MediaItem[]> {
    return this.cached('nextUp', [limit, seriesId], () =>
      this.inner.nextUp(limit, seriesId),
    );
  }
  latest(libraryId: string, limit?: number): Promise<MediaItem[]> {
    return this.cached('latest', [libraryId, limit], () =>
      this.inner.latest(libraryId, limit),
    );
  }
  seasons(seriesId: string): Promise<MediaItem[]> {
    return this.cached('seasons', [seriesId], () =>
      this.inner.seasons(seriesId),
    );
  }
  episodes(seriesId: string, seasonId?: string): Promise<MediaItem[]> {
    return this.cached('episodes', [seriesId, seasonId], () =>
      this.inner.episodes(seriesId, seasonId),
    );
  }
  imageUrl(itemId: string, kind: ImageKind, maxWidth: number): string {
    return this.inner.imageUrl(itemId, kind, maxWidth);
  }

  playback(
    request: PlaybackRequest,
    caps: DeviceCapabilities,
  ): Promise<PlaybackPlan> {
    return this.inner.playback(request, caps);
  }
  reportStart(report: ProgressReport): Promise<void> {
    return this.inner.reportStart(report);
  }
  reportProgress(report: ProgressReport): Promise<void> {
    return this.inner.reportProgress(report);
  }
  reportStop(report: ProgressReport): Promise<void> {
    return this.mutate(() => this.inner.reportStop(report));
  }
  mediaSegments(itemId: string): Promise<MediaSegment[]> {
    return this.inner.mediaSegments(itemId);
  }
  trickplay(
    itemId: string,
    mediaSourceId?: string,
  ): Promise<Trickplay | undefined> {
    return this.inner.trickplay(itemId, mediaSourceId);
  }
  clearProgress(itemId: string): Promise<void> {
    return this.mutate(() => this.inner.clearProgress(itemId));
  }
  setPlayed(itemId: string, played: boolean): Promise<void> {
    return this.mutate(() => this.inner.setPlayed(itemId, played));
  }
  setFavorite(itemId: string, favorite: boolean): Promise<void> {
    return this.mutate(() => this.inner.setFavorite(itemId, favorite));
  }

  private cached<T>(
    method: CachedMethod,
    args: unknown[],
    load: () => Promise<T>,
  ): Promise<T> {
    return this.cache.fetch(this.key(method, args), TTL_OF[method], load);
  }

  /**
   * Runs a call that changes user data and then drops every cached result that carries user
   * data. Dropping afterwards also discards loads that were in flight during the call, since
   * they may have been answered before the change. Libraries never carry user data and stay.
   * Listeners are told on the next macrotask after the last pending mutation settles, failed or
   * not, so a follow-up mutation chained on this one is folded into the same notification.
   */
  private async mutate(call: () => Promise<void>): Promise<void> {
    this.pending++;
    if (this.notifyTimer !== undefined) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = undefined;
    }
    try {
      await call();
    } finally {
      for (const method of USER_DATA_METHODS) {
        this.cache.invalidate(this.scope + method + '/');
      }
      if (--this.pending === 0) {
        this.notifyTimer = setTimeout(() => {
          this.notifyTimer = undefined;
          for (const l of [...this.listeners]) {
            l();
          }
        }, 0);
      }
    }
  }

  private key(method: CachedMethod, args: unknown[]): string {
    // Trailing omitted arguments key the same as explicit `undefined`.
    const a = [...args];
    while (a.length && a[a.length - 1] === undefined) {
      a.pop();
    }
    return `${this.scope}${method}/${JSON.stringify(a)}`;
  }
}

/** Looks at the cache of a backend; undefined for backends without one. */
export function peekBackend<M extends CachedMethod>(
  backend: Backend,
  method: M,
  ...args: Parameters<Backend[M]>
): Awaited<ReturnType<Backend[M]>> | undefined {
  const peek = (backend as Partial<CachedBackend>).peek as
    | ((
        m: M,
        ...a: Parameters<Backend[M]>
      ) => ReturnType<CachedBackend['peek']>)
    | undefined;
  return typeof peek === 'function'
    ? (peek.call(backend, method, ...args) as
        Awaited<ReturnType<Backend[M]>> | undefined)
    : undefined;
}

/** Subscribes to user-data changes on a backend; a no-op for backends without a cache. */
export function onUserDataChanged(
  backend: Backend,
  listener: () => void,
): () => void {
  const on = (backend as Partial<CachedBackend>).onUserDataChanged;
  return typeof on === 'function' ? on.call(backend, listener) : () => {};
}

/** True while a cached backend has a user-data change in flight; false for other backends. */
export function hasPendingChanges(backend: Backend): boolean {
  const pending = (backend as Partial<CachedBackend>).hasPendingChanges;
  return typeof pending === 'function' ? pending.call(backend) : false;
}
