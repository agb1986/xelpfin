import type { MediaItem } from '../../src/backend/types';
import { LocalList } from '../../src/state/localLists';
import { sanitizeHidden, withoutHidden } from '../../src/state/hiddenNextUp';
import { drawEpisode, emptyRandomizer, HISTORY_LIMIT, recentDraws, sanitizeRandomizer, toggleSeries, type RandomizerState } from '../../src/state/randomizer';

const ep = (id: string, seriesId: string): MediaItem => ({ id, name: id, kind: 'episode', seriesId });
const pool = [ep('a1', 'A'), ep('a2', 'A'), ep('a3', 'A'), ep('b1', 'B'), ep('b2', 'B')];

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('drawEpisode', () => {
  it('plays every episode once before any repeats', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = seeded(seed);
      let state = emptyRandomizer();
      let previous: MediaItem | undefined;
      const seen: string[] = [];
      for (let i = 0; i < pool.length; i++) {
        const d = drawEpisode(state, pool, rng, previous)!;
        seen.push(d.episode.id);
        state = d.state;
        previous = d.episode;
      }
      expect(new Set(seen).size).toBe(pool.length);
    }
  });

  it('starts a new cycle without repeating the last episode first', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const last = pool[2];
      const state: RandomizerState = { series: ['A', 'B'], played: pool.map(e => e.id), history: [] };
      const d = drawEpisode(state, pool, seeded(seed), last)!;
      expect(d.episode.id).not.toBe(last.id);
      expect(d.state.played).toEqual([d.episode.id]);
    }
  });

  it('avoids the series that just played while others have candidates', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const d = drawEpisode(emptyRandomizer(), pool, seeded(seed), pool[0])!;
      expect(d.episode.seriesId).toBe('B');
    }
  });

  it('falls back to the same series when it is all that is left', () => {
    const state: RandomizerState = { series: [], played: ['b1', 'b2'], history: [] };
    const d = drawEpisode(state, pool, seeded(3), pool[3])!;
    expect(d.episode.seriesId).toBe('A');
    const onlyA = drawEpisode({ series: [], played: ['a1'], history: [] }, pool.slice(0, 3), seeded(3), pool[0])!;
    expect(onlyA.episode.seriesId).toBe('A');
  });

  it('drops played ids that left the pool and handles a single episode', () => {
    const d = drawEpisode({ series: [], played: ['gone', 'a1'], history: [] }, pool, seeded(2))!;
    expect(d.state.played).not.toContain('gone');
    expect(drawEpisode(emptyRandomizer(), [], seeded(1))).toBeUndefined();
    const single = [ep('x', 'X')];
    const s1 = drawEpisode(emptyRandomizer(), single, seeded(1))!;
    expect(drawEpisode(s1.state, single, seeded(1), s1.episode)!.episode.id).toBe('x');
  });
});

describe('randomizer history', () => {
  it('keeps draws across a cycle reset, newest first, capped', () => {
    const single = [ep('x', 'X')];
    let state = emptyRandomizer();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      state = drawEpisode(state, single, seeded(1))!.state;
    }
    expect(state.history).toHaveLength(HISTORY_LIMIT);
    expect(state.played.length).toBeLessThan(HISTORY_LIMIT);
    expect(recentDraws({ ...state, history: ['a', 'b', 'c'] }, 2)).toEqual(['c', 'b']);
  });
});

describe('randomizer state', () => {
  it('toggles series and sanitizes stored data', () => {
    const on = toggleSeries(emptyRandomizer(), 'A');
    expect(on.series).toEqual(['A']);
    expect(toggleSeries(on, 'A').series).toEqual([]);
    expect(sanitizeRandomizer({ series: ['A', 'A', 3], played: 'x' })).toEqual({ series: ['A'], played: [], history: [] });
    expect(sanitizeRandomizer(null)).toEqual(emptyRandomizer());
  });
});

describe('hidden Next Up', () => {
  it('hides only the offered episode of a series', () => {
    const items = [ep('a1', 'A'), ep('b2', 'B')];
    expect(withoutHidden(items, { A: 'a1' }).map(i => i.id)).toEqual(['b2']);
    expect(withoutHidden(items, { A: 'a0' }).map(i => i.id)).toEqual(['a1', 'b2']);
    expect(sanitizeHidden({ A: 'a1', B: 4 })).toEqual({ A: 'a1' });
  });
});

describe('LocalList', () => {
  const flush = () => new Promise<void>(resolve => setImmediate(() => resolve()));
  const memory = (initial?: string) => {
    const data = new Map<string, string>(initial ? [['k', initial]] : []);
    return {
      data,
      get: async (k: string) => data.get(k) ?? null,
      set: async (k: string, v: string): Promise<void> => void data.set(k, v),
      remove: async (k: string) => void data.delete(k),
    };
  };

  it('loads, updates, persists and notifies', async () => {
    const store = memory(JSON.stringify({ series: ['A'], played: [] }));
    const list = new LocalList(store, 'k', emptyRandomizer, sanitizeRandomizer);
    const fn = jest.fn();
    list.subscribe(fn);
    await list.load();
    expect(list.get().series).toEqual(['A']);
    list.update(s => toggleSeries(s, 'B'));
    await flush();
    expect(JSON.parse(store.data.get('k')!).series).toEqual(['A', 'B']);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('keeps an update made before the load finished', async () => {
    const store = memory(JSON.stringify({ series: ['old'], played: [] }));
    const list = new LocalList(store, 'k', emptyRandomizer, sanitizeRandomizer);
    const loading = list.load();
    list.update(() => ({ series: ['new'], played: [], history: [] }));
    await loading;
    expect(list.get().series).toEqual(['new']);
  });

  it('sets an unreadable document aside instead of overwriting it', async () => {
    const store = memory('{not json');
    const list = new LocalList(store, 'k', emptyRandomizer, sanitizeRandomizer);
    await list.load();
    expect(store.data.get('k.corrupt')).toBe('{not json');
    list.update(s => toggleSeries(s, 'B'));
    await flush();
    expect(JSON.parse(store.data.get('k')!).series).toEqual(['B']);
  });

  it('does not write over a document it could not read', async () => {
    const store = memory(JSON.stringify({ series: ['A'], played: [] }));
    const get = jest.spyOn(store, 'get').mockRejectedValueOnce(new Error('busy'));
    const set = jest.spyOn(store, 'set');
    const list = new LocalList(store, 'k', emptyRandomizer, sanitizeRandomizer);
    await list.load();
    list.update(s => toggleSeries(s, 'B'));
    await flush();
    expect(set).not.toHaveBeenCalled();
    await list.load();
    expect(get).toHaveBeenCalledTimes(2);
    expect(list.get().series).toEqual(['A']);
    list.update(s => toggleSeries(s, 'C'));
    await flush();
    expect(JSON.parse(store.data.get('k')!).series).toEqual(['A', 'C']);
  });

  it('writes in the order updates were made', async () => {
    const store = memory();
    const slow: Array<() => void> = [];
    const set = store.set;
    store.set = (k: string, v: string) => new Promise<void>(resolve => slow.push(() => set(k, v).then(resolve)));
    const list = new LocalList(store, 'k', emptyRandomizer, sanitizeRandomizer);
    await list.load();
    list.update(s => toggleSeries(s, 'A'));
    list.update(s => toggleSeries(s, 'B'));
    await flush();
    expect(slow).toHaveLength(1);
    slow.shift()!();
    await flush();
    slow.shift()!();
    await flush();
    expect(JSON.parse(store.data.get('k')!).series).toEqual(['A', 'B']);
  });
});
