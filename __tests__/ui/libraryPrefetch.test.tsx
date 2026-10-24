import React from 'react';
import { FlatList, Image } from 'react-native';
import ReactTestRenderer, {
  act,
  type ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import type { ItemQuery, MediaItem, Page } from '../../src/backend/types';
import { resetCardPrefetch } from '../../src/ui/components/Card';
import { LibraryScreen } from '../../src/ui/screens/LibraryScreen';

const TOTAL = 150;
const mockItems = jest.fn(
  async (q: ItemQuery): Promise<Page<MediaItem>> => {
    const start = q.startIndex ?? 0;
    const end = Math.min(TOTAL, start + (q.limit ?? 60));
    const page: MediaItem[] = [];
    for (let n = start; n < end; n++) {
      page.push({
        id: `m${n}`,
        name: `Movie ${n}`,
        kind: 'movie',
        posterUrl: `http://srv/p/${n}`,
      } as MediaItem);
    }
    return { items: page, totalCount: TOTAL, startIndex: start };
  },
);

// Stable identities: the screen reloads whenever the backend changes.
const mockBackend = { items: mockItems };
const mockNav = { push: jest.fn() };
jest.mock('../../src/state/AppState', () => ({
  useBackend: () => mockBackend,
}));
jest.mock('../../src/state/navigation', () => ({
  ...jest.requireActual('../../src/state/navigation'),
  useNavigation: () => mockNav,
  useIsActive: () => true,
}));

const flush = async () => {
  await act(async () => {
    await new Promise<void>(r => setTimeout(r, 0));
  });
};

const scrollTo = (root: Renderer, lastVisible: number) =>
  act(() => {
    root.root.findByType(FlatList).props.onViewableItemsChanged({
      viewableItems: [{ index: lastVisible - 1 }, { index: lastVisible }],
      changed: [],
    });
  });

describe('LibraryScreen paging', () => {
  let prefetch: jest.SpyInstance;
  beforeEach(() => {
    mockItems.mockClear();
    resetCardPrefetch();
    prefetch = jest
      .spyOn(Image, 'prefetch')
      .mockImplementation(() => Promise.resolve(true));
  });
  afterEach(() => prefetch.mockRestore());

  it('fetches the next page at the halfway mark and prefetches its posters', async () => {
    let root!: Renderer;
    await act(async () => {
      root = ReactTestRenderer.create(
        <LibraryScreen
          library={{ id: 'lib', name: 'Movies', collectionType: 'movies' }}
        />,
      );
    });
    await flush();
    expect(mockItems).toHaveBeenCalledTimes(1);
    expect(prefetch).not.toHaveBeenCalled();

    scrollTo(root, 20);
    expect(mockItems).toHaveBeenCalledTimes(1);

    scrollTo(root, 30);
    scrollTo(root, 31);
    await flush();
    expect(mockItems).toHaveBeenCalledTimes(2);
    expect(mockItems.mock.calls[1][0].startIndex).toBe(60);
    expect(prefetch).toHaveBeenCalledTimes(60);
    expect(prefetch).toHaveBeenCalledWith('http://srv/p/60');
    expect(prefetch).toHaveBeenCalledWith('http://srv/p/119');

    scrollTo(root, 90);
    await flush();
    expect(mockItems).toHaveBeenCalledTimes(3);
    expect(mockItems.mock.calls[2][0].startIndex).toBe(120);
    expect(prefetch).toHaveBeenCalledTimes(90);

    scrollTo(root, 149);
    await flush();
    expect(mockItems).toHaveBeenCalledTimes(3);
    act(() => root.unmount());
  });
});
