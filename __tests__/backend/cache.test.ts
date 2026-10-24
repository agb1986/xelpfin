import { ResponseCache } from '../../src/backend/cache';

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, tick: (ms: number) => (t += ms) };
}

describe('ResponseCache', () => {
  it('serves an entry until its time to live runs out, then only through peek', () => {
    const c = clock();
    const cache = new ResponseCache(c.now);
    cache.set('k', [1], 100);
    expect(cache.get('k')).toEqual([1]);
    c.tick(99);
    expect(cache.get('k')).toEqual([1]);
    expect(cache.peek('k')).toEqual({ value: [1], fresh: true });
    c.tick(1);
    expect(cache.get('k')).toBeUndefined();
    expect(cache.peek('k')).toEqual({ value: [1], fresh: false });
    expect(cache.peek('other')).toBeUndefined();
  });

  it('invalidates by prefix without touching other keys, and clears everything', () => {
    const cache = new ResponseCache(clock().now);
    cache.set('s/u/resume/[]', 1, 100);
    cache.set('s/u/resumeEpisode/["x"]', 2, 100);
    cache.set('s/u/libraries/[]', 3, 100);
    cache.set('s/other/resume/[]', 4, 100);
    expect(cache.invalidate('s/u/resume/')).toBe(1);
    expect(cache.get('s/u/resume/[]')).toBeUndefined();
    expect(cache.get('s/u/resumeEpisode/["x"]')).toBe(2);
    expect(cache.get('s/u/libraries/[]')).toBe(3);
    expect(cache.get('s/other/resume/[]')).toBe(4);
    expect(cache.size).toBe(3);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('s/u/libraries/[]')).toBeUndefined();
  });

  it('fetch loads once, shares an in-flight load and serves the stored result', async () => {
    const c = clock();
    const cache = new ResponseCache(c.now);
    const load = jest.fn(async () => 'v');
    const [a, b] = await Promise.all([
      cache.fetch('k', 100, load),
      cache.fetch('k', 100, load),
    ]);
    expect(a).toBe('v');
    expect(b).toBe('v');
    expect(load).toHaveBeenCalledTimes(1);
    expect(await cache.fetch('k', 100, load)).toBe('v');
    expect(load).toHaveBeenCalledTimes(1);
    c.tick(100);
    expect(await cache.fetch('k', 100, load)).toBe('v');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not store a result that arrives after the key was invalidated', async () => {
    const cache = new ResponseCache(clock().now);
    let release!: (v: string) => void;
    const pending = cache.fetch(
      'k',
      100,
      () => new Promise<string>(r => (release = r)),
    );
    cache.invalidate('k');
    release('stale');
    expect(await pending).toBe('stale');
    expect(cache.get('k')).toBeUndefined();
    const load = jest.fn(async () => 'fresh');
    expect(await cache.fetch('k', 100, load)).toBe('fresh');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures and lets the next call try again', async () => {
    const cache = new ResponseCache(clock().now);
    const load = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce('ok');
    await expect(cache.fetch('k', 100, load)).rejects.toThrow('down');
    expect(cache.get('k')).toBeUndefined();
    expect(await cache.fetch('k', 100, load)).toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entries past the size limit', () => {
    const cache = new ResponseCache(clock().now, 2);
    cache.set('a', 1, 100);
    cache.set('b', 2, 100);
    cache.set('a', 3, 100);
    cache.set('c', 4, 100);
    expect(cache.size).toBe(2);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(3);
    expect(cache.get('c')).toBe(4);
  });
});
