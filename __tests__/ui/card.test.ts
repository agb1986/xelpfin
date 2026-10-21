import { Image } from 'react-native';
import {
  BACKDROP_BOX,
  imageQuery,
  POSTER_BOX,
  THUMB_BOX,
} from '../../src/backend/jellyfin/dto';
import type { MediaItem } from '../../src/backend/types';
import {
  cardImagePixels,
  prefetchCardImages,
  resetCardPrefetch,
} from '../../src/ui/components/Card';

const item = (id: string, posterUrl?: string): MediaItem =>
  ({ id, name: id, kind: 'movie', posterUrl }) as MediaItem;

describe('card image sizing', () => {
  it('asks the server for exactly what a focused card shows at density 2', () => {
    expect(cardImagePixels('poster')).toEqual(POSTER_BOX);
    expect(cardImagePixels('thumb')).toEqual(THUMB_BOX);
  });

  it('scales with density', () => {
    expect(cardImagePixels('poster', 1)).toEqual({ width: 127, height: 190 });
  });

  it('requests a filled box as WebP at quality 85', () => {
    expect(imageQuery(POSTER_BOX, 't1')).toBe(
      '?fillWidth=253&fillHeight=379&quality=85&format=Webp&tag=t1',
    );
    expect(imageQuery(BACKDROP_BOX)).toBe(
      '?fillWidth=1280&fillHeight=720&quality=85&format=Webp',
    );
  });

  it('rounds fractional boxes', () => {
    expect(imageQuery({ width: 300.4, height: 450.6 })).toBe(
      '?fillWidth=300&fillHeight=451&quality=85&format=Webp',
    );
  });
});

describe('prefetchCardImages', () => {
  let prefetch: jest.SpyInstance;
  beforeEach(() => {
    resetCardPrefetch();
    prefetch = jest
      .spyOn(Image, 'prefetch')
      .mockImplementation(() => Promise.resolve(true));
  });
  afterEach(() => prefetch.mockRestore());

  it('prefetches each card image once and skips items without one', () => {
    const items = [item('a', 'http://x/a'), item('b'), item('c', 'http://x/c')];
    expect(prefetchCardImages(items, 'poster')).toBe(2);
    expect(prefetch.mock.calls.map(c => c[0])).toEqual([
      'http://x/a',
      'http://x/c',
    ]);
    expect(prefetchCardImages(items, 'poster')).toBe(0);
    expect(prefetch).toHaveBeenCalledTimes(2);
  });

  it('retries an image whose prefetch failed', async () => {
    prefetch.mockImplementationOnce(() => Promise.reject(new Error('404')));
    prefetchCardImages([item('a', 'http://x/a')], 'poster');
    await new Promise<void>(r => setTimeout(r, 0));
    expect(prefetchCardImages([item('a', 'http://x/a')], 'poster')).toBe(1);
  });

  it('survives a prefetch that throws synchronously', () => {
    prefetch.mockImplementationOnce(() => {
      throw new Error('no native module');
    });
    expect(() =>
      prefetchCardImages([item('a', 'http://x/a')], 'poster'),
    ).not.toThrow();
    expect(prefetchCardImages([item('a', 'http://x/a')], 'poster')).toBe(1);
  });
});
