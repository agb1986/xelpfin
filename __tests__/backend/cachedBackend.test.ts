import { ResponseCache } from '../../src/backend/cache';
import {
  CachedBackend,
  onUserDataChanged,
  hasPendingChanges,
  peekBackend,
  TTL,
} from '../../src/backend/CachedBackend';
import { MockBackend, MOCK_SERVER } from '../../src/backend/mock/MockBackend';
import type { ProgressReport, Session } from '../../src/backend/types';
import { BackendError } from '../../src/backend/types';
import { guardBackend } from '../../src/state/authGuard';

const session = (userId = 'u1'): Session => ({
  server: MOCK_SERVER,
  userId,
  userName: userId,
  accessToken: 't',
  isAdmin: true,
});

/** A mock backend that counts every call by method name. */
class CountingBackend extends MockBackend {
  calls: string[] = [];
  private count<T>(name: string, out: Promise<T>): Promise<T> {
    this.calls.push(name);
    return out;
  }
  libraries() {
    return this.count('libraries', super.libraries());
  }
  item(id: string) {
    return this.count('item', super.item(id));
  }
  resume() {
    return this.count('resume', super.resume());
  }
  resumeEpisode() {
    return this.count('resumeEpisode', super.resumeEpisode());
  }
  nextUp() {
    return this.count('nextUp', super.nextUp());
  }
  latest(libraryId: string) {
    return this.count('latest', super.latest(libraryId));
  }
  seasons() {
    return this.count('seasons', super.seasons());
  }
  episodes(seriesId: string, seasonId?: string) {
    return this.count('episodes', super.episodes(seriesId, seasonId));
  }
  search(term: string) {
    return this.count('search', super.search(term));
  }
  genres(libraryId: string) {
    return this.count('genres', super.genres(libraryId));
  }
  years(libraryId: string) {
    return this.count('years', super.years(libraryId));
  }
  studios(libraryId: string) {
    return this.count('studios', super.studios(libraryId));
  }
  tags(libraryId: string) {
    return this.count('tags', super.tags(libraryId));
  }
  officialRatings(libraryId: string) {
    return this.count('officialRatings', super.officialRatings(libraryId));
  }
}

const stop: ProgressReport = {
  plan: {
    itemId: 'm1',
    mediaSourceId: 'm1',
    playSessionId: 'p',
    method: 'DirectPlay',
  },
  positionMs: 1000,
  isPaused: false,
};

const macrotask = () => new Promise<void>(r => setTimeout(r, 0));

function setup(userId = 'u1') {
  let t = 1_000;
  const cache = new ResponseCache(() => t);
  const inner = new CountingBackend(session(userId));
  const backend = new CachedBackend(inner, cache);
  return { inner, cache, backend, tick: (ms: number) => (t += ms) };
}

describe('CachedBackend', () => {
  it('serves repeated list calls from memory until the time to live passes', async () => {
    const { inner, backend, tick } = setup();
    await backend.libraries();
    await backend.libraries();
    await backend.latest('lib-movies', 24);
    await backend.latest('lib-movies', 24);
    await backend.latest('lib-shows', 24);
    expect(inner.calls).toEqual(['libraries', 'latest', 'latest']);
    tick(TTL.catalogue);
    await backend.libraries();
    expect(inner.calls).toEqual(['libraries', 'latest', 'latest', 'libraries']);
  });

  it('gives progress rows a shorter time to live than the catalogue', async () => {
    const { inner, backend, tick } = setup();
    await backend.nextUp(24);
    await backend.resume(24);
    tick(TTL.progress);
    await backend.nextUp(24);
    await backend.resume(24);
    await backend.libraries();
    expect(inner.calls).toEqual([
      'nextUp',
      'resume',
      'nextUp',
      'resume',
      'libraries',
    ]);
  });

  it('marking an item watched drops next up, resume and detail but keeps libraries', async () => {
    const { inner, backend } = setup();
    await backend.libraries();
    await backend.nextUp(24);
    await backend.resume(24);
    await backend.item('e2');
    await backend.episodes('s1', 'se1');
    inner.calls = [];
    await backend.setPlayed('e2', true);
    const detail = await backend.item('e2');
    expect(detail.userData?.played).toBe(true);
    await backend.nextUp(24);
    await backend.resume(24);
    await backend.episodes('s1', 'se1');
    await backend.libraries();
    expect(inner.calls).toEqual(['item', 'nextUp', 'resume', 'episodes']);
  });

  it('a stop report and a cleared resume point refresh Continue Watching', async () => {
    const { inner, backend } = setup();
    expect((await backend.resume(24)).map(m => m.id)).toEqual(['m1']);
    await backend.reportStop(stop);
    inner.calls = [];
    await backend.resume(24);
    expect(inner.calls).toEqual(['resume']);
    await backend.clearProgress('m1');
    expect(await backend.resume(24)).toEqual([]);
    expect(inner.calls).toEqual(['resume', 'resume']);
  });

  it('a favourite toggle refreshes the item detail', async () => {
    const { inner, backend } = setup();
    expect((await backend.item('m2')).userData?.favorite).toBe(false);
    await backend.setFavorite('m2', true);
    expect((await backend.item('m2')).userData?.favorite).toBe(true);
    expect(inner.calls).toEqual(['item', 'item']);
  });

  it('invalidates even when the mutation fails', async () => {
    const { inner, backend } = setup();
    await backend.nextUp(24);
    inner.setPlayed = async () => {
      throw new BackendError('down', 'network');
    };
    await expect(backend.setPlayed('e2', true)).rejects.toThrow('down');
    await backend.nextUp(24);
    expect(inner.calls).toEqual(['nextUp', 'nextUp']);
  });

  it('does not store a list that was in flight while a mutation ran', async () => {
    const { inner, backend } = setup();
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const original = inner.nextUp.bind(inner);
    inner.nextUp = async () => {
      await gate;
      return original();
    };
    const pending = backend.nextUp(24);
    await backend.setPlayed('e2', true);
    release();
    await pending;
    await backend.nextUp(24);
    expect(inner.calls.filter(c => c === 'nextUp')).toHaveLength(2);
  });

  it('keeps users and servers apart in one cache', async () => {
    const cache = new ResponseCache();
    const a = new CountingBackend(session('u1'));
    const b = new CountingBackend(session('u2'));
    const ca = new CachedBackend(a, cache);
    const cb = new CachedBackend(b, cache);
    await ca.nextUp(24);
    await cb.nextUp(24);
    await ca.setPlayed('e2', true);
    await cb.nextUp(24);
    expect(a.calls).toEqual(['nextUp']);
    expect(b.calls).toEqual(['nextUp']);
  });

  it('peeks at cached results synchronously, also through the auth guard', async () => {
    const { backend } = setup();
    expect(peekBackend(backend, 'libraries')).toBeUndefined();
    await backend.libraries();
    await backend.nextUp(24);
    expect(peekBackend(backend, 'libraries')?.length).toBe(2);
    expect(peekBackend(backend, 'nextUp', 24)?.[0].id).toBe('e2');
    expect(peekBackend(backend, 'nextUp', 12)).toBeUndefined();
    const guarded = guardBackend(backend, () => {});
    expect(peekBackend(guarded, 'libraries')?.length).toBe(2);
    const plain = new MockBackend(session());
    expect(peekBackend(plain, 'libraries')).toBeUndefined();
    expect(typeof onUserDataChanged(plain, () => {})).toBe('function');
  });

  it('tells listeners once per burst of changes and lets them unsubscribe', async () => {
    const { backend } = setup();
    const listener = jest.fn();
    const off = onUserDataChanged(backend, listener);
    // The player's stop report followed by its watched mark is one change.
    await backend.reportStop(stop).then(() => backend.setPlayed('e2', true));
    expect(listener).not.toHaveBeenCalled();
    await macrotask();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    await backend.clearProgress('m1');
    await macrotask();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reports pending changes from the call until listeners were told', async () => {
    const { inner, backend } = setup();
    let release!: () => void;
    inner.reportStop = () => new Promise<void>(r => (release = r));
    const listener = jest.fn(() => {
      expect(hasPendingChanges(backend)).toBe(false);
    });
    onUserDataChanged(backend, listener);
    expect(hasPendingChanges(backend)).toBe(false);
    const sent = backend.reportStop(stop);
    expect(hasPendingChanges(backend)).toBe(true);
    release();
    await sent;
    expect(hasPendingChanges(backend)).toBe(true);
    await macrotask();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(hasPendingChanges(guardBackend(backend, () => {}))).toBe(false);
    expect(hasPendingChanges(new MockBackend(session()))).toBe(false);
  });

  it('tells listeners after a failed mutation too, since the cache was dropped', async () => {
    const { inner, backend } = setup();
    const listener = jest.fn();
    onUserDataChanged(backend, listener);
    inner.setFavorite = async () => {
      throw new BackendError('down', 'network');
    };
    await expect(backend.setFavorite('m2', true)).rejects.toThrow('down');
    await macrotask();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('caches filter values per library and keeps them through mutations', async () => {
    const { inner, backend, tick } = setup();
    const all = (libraryId: string) =>
      Promise.all([
        backend.genres(libraryId),
        backend.years(libraryId),
        backend.studios(libraryId),
        backend.tags(libraryId),
        backend.officialRatings(libraryId),
      ]);
    const first = await all('lib-movies');
    expect(first).toEqual([
      ['Animation', 'Comedy', 'Drama'],
      [2024, 2023, 2001],
      ['Blender', 'Grid Pictures'],
      ['Classic', 'Open movie'],
      ['PG', 'PG-13'],
    ]);
    await backend.setPlayed('m1', true);
    expect(await all('lib-movies')).toEqual(first);
    expect(inner.calls).toHaveLength(5);
    await all('lib-shows');
    expect(inner.calls).toHaveLength(10);
    tick(TTL.catalogue + 1);
    await all('lib-movies');
    expect(inner.calls).toHaveLength(15);
  });

  it('does not cache failures, search or pages', async () => {
    const { inner, backend } = setup();
    const ok = inner.item.bind(inner);
    inner.item = async () => {
      throw new BackendError('down', 'network');
    };
    await expect(backend.item('m1')).rejects.toThrow('down');
    inner.item = ok;
    expect((await backend.item('m1')).id).toBe('m1');
    await backend.search('night');
    await backend.search('night');
    await backend.items({ libraryId: 'lib-movies' });
    await backend.items({ libraryId: 'lib-movies' });
    // The failing call bypassed the counter; the second one reaching the server proves it was not kept.
    expect(inner.calls).toEqual(['item', 'search', 'search']);
    expect(backend.imageUrl('m1', 'poster', 300)).toContain('/img/m1/');
    expect(backend.session.userId).toBe('u1');
  });

  it('passes trickplay through to the server', async () => {
    const { inner, backend } = setup();
    const spy = jest.spyOn(inner, 'trickplay');
    expect(await backend.trickplay('m1', 'src')).toBeUndefined();
    expect(spy).toHaveBeenCalledWith('m1', 'src');
  });
});
