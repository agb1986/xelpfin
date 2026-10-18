import { mapLimit } from '../../src/state/mapLimit';

describe('mapLimit', () => {
  it('keeps at most `limit` calls in flight and returns results in order', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    const out = await mapLimit(items, 3, async n => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>(r => setTimeout(() => r(), (n * 7) % 5));
      inFlight--;
      return n * 2;
    });
    expect(peak).toBe(3);
    expect(out).toEqual(items.map(n => n * 2));
  });

  it('handles an empty list and a limit below one', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
    expect(await mapLimit([1, 2], 0, async n => n)).toEqual([1, 2]);
  });

  it('rejects when a call rejects', async () => {
    await expect(mapLimit([1, 2, 3], 2, async n => (n === 2 ? Promise.reject(new Error('no')) : n))).rejects.toThrow('no');
  });
});
