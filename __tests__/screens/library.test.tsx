/**
 * The library grid: paging at the page boundary, sort and letter pickers, the filter panel and
 * its Menu key, the saved view per library, the column count from the window width, and the
 * empty and error states.
 */
import React from 'react';
import { Dimensions, FlatList, type HWEvent, Image, Modal } from 'react-native';
import ReactTestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import type { ItemQuery, MediaItem, Page } from '../../src/backend/types';
import { MemoryStore } from '../../src/platform/types';
import { resetLocalLists } from '../../src/state/localLists';
import { cardStride, resetCardPrefetch } from '../../src/ui/components/Card';
import { LibraryScreen } from '../../src/ui/screens/LibraryScreen';
import { space } from '../../src/ui/theme';

let mockTotal = 3;
const mockItems = jest.fn(async (q: ItemQuery): Promise<Page<MediaItem>> => {
  const start = q.startIndex ?? 0;
  const end = Math.min(mockTotal, start + (q.limit ?? 60));
  const page: MediaItem[] = [];
  for (let n = start; n < end; n++) {
    page.push({ id: `m${n}`, name: `Movie ${n}`, kind: 'movie' });
  }
  return { items: page, totalCount: mockTotal, startIndex: start };
});

// Stable identities: the screen reloads whenever the backend changes.
const mockBackend = {
  session: { server: { id: 'srv' }, userId: 'u1' },
  items: mockItems,
  genres: jest.fn(async () => ['Comedy', 'Drama']),
  years: jest.fn(async () => [2024, 2023]),
  officialRatings: jest.fn(async () => ['PG', 'PG-13']),
  tags: jest.fn(async () => ['Classic']),
  studios: jest.fn(async () => ['Blender']),
};
const mockNav = { push: jest.fn() };
let mockActive = true;
let mockStorage = new MemoryStore();
jest.mock('../../src/state/AppState', () => ({
  useBackend: () => mockBackend,
  useApp: () => ({ platform: { storage: mockStorage }, backend: mockBackend }),
}));
// Every mounted handler sees every key, as on the device.
const mockKeyHandlers: ((evt: HWEvent) => void)[] = [];
jest.mock(
  'react-native/Libraries/Components/TV/useTVEventHandler',
  () => ({
    __esModule: true,
    default: (fn: (evt: HWEvent) => void) => {
      mockKeyHandlers.push(fn);
    },
  }),
);
jest.mock('../../src/state/navigation', () => ({
  ...jest.requireActual('../../src/state/navigation'),
  useNavigation: () => mockNav,
  useIsActive: () => mockActive,
}));

const LIBRARY = { id: 'lib', name: 'Movies', collectionType: 'movies' };
const SHOWS = { id: 'shows', name: 'Shows', collectionType: 'tvshows' };
const STORAGE_KEY = 'xelpfin.library-views.srv.u1';

const flush = async () => {
  await act(async () => {
    await new Promise<void>(r => setTimeout(r, 0));
  });
};

function byId(root: Renderer, id: string): ReactTestInstance {
  const all = root.root.findAll(
    n => n.props.testID === id && typeof n.type !== 'string',
  );
  if (!all.length) {
    throw new Error(`no element with testID ${id}`);
  }
  return all[0];
}
const has = (root: Renderer, id: string) =>
  root.root.findAll(n => n.props.testID === id).length > 0;
const pickerOpen = (root: Renderer, id: string) =>
  root.root
    .findAllByType(Modal)
    .some(
      m => m.props.visible && m.findAll(n => n.props.testID === id).length > 0,
    );
const press = async (root: Renderer, id: string) => {
  await act(async () => {
    byId(root, id).props.onPress();
  });
  await flush();
};
const text = (node: ReactTestInstance): string =>
  node
    .findAllByType('Text' as never)
    .flatMap(t => React.Children.toArray(t.props.children))
    .join('');
const lastQuery = () =>
  mockItems.mock.calls[mockItems.mock.calls.length - 1][0];
const closeModal = (root: Renderer, id: string) =>
  root.root
    .findAllByType(Modal)
    .find(m => m.props.visible && m.findAll(n => n.props.testID === id).length)!
    .props.onRequestClose();
/** Picks a filter in the open panel, then a value in its list, which goes back to the panel. */
const setFilter = async (root: Renderer, filter: number, value: number) => {
  await press(root, `filter-picker-${filter}`);
  await press(root, `filter-value-picker-${value}`);
};
const sendKey = (evt: Pick<HWEvent, 'eventType' | 'eventKeyAction'>) =>
  act(() => {
    [...mockKeyHandlers].forEach(h => h(evt as HWEvent));
  });

async function render(library = LIBRARY): Promise<Renderer> {
  let root!: Renderer;
  await act(async () => {
    root = ReactTestRenderer.create(<LibraryScreen library={library} />);
  });
  await flush();
  return root;
}

describe('LibraryScreen', () => {
  let prefetch: jest.SpyInstance;
  beforeEach(() => {
    jest.useRealTimers();
    mockTotal = 3;
    mockActive = true;
    mockStorage = new MemoryStore();
    resetLocalLists();
    mockKeyHandlers.length = 0;
    mockItems.mockClear();
    mockNav.push.mockClear();
    resetCardPrefetch();
    prefetch = jest
      .spyOn(Image, 'prefetch')
      .mockImplementation(() => Promise.resolve(true));
  });
  afterEach(() => prefetch.mockRestore());

  it('loads the first page sorted by name and opens an item on press', async () => {
    const root = await render();
    expect(mockItems).toHaveBeenCalledTimes(1);
    expect(lastQuery().nameStartsWith).toBeUndefined();
    expect(lastQuery().played).toBeUndefined();
    expect(lastQuery()).toMatchObject({
      libraryId: 'lib',
      sort: 'name',
      descending: false,
      startIndex: 0,
      limit: 60,
    });
    const list = root.root.findByType(FlatList);
    expect(list.props.data.map((i: MediaItem) => i.id)).toEqual([
      'm0',
      'm1',
      'm2',
    ]);
    expect(text(byId(root, 'library'))).toContain('3 items');

    const first = list.props.renderItem({ item: list.props.data[0], index: 0 });
    expect(first.props.hasTVPreferredFocus).toBe(true);
    act(() => first.props.onPress(list.props.data[0]));
    expect(mockNav.push).toHaveBeenCalledWith({ name: 'detail', itemId: 'm0' });
    expect(list.props.getItemLayout(null, 2).offset).toBe(
      2 * list.props.getItemLayout(null, 1).offset,
    );
    act(() => root.unmount());
  });

  it('says "1 item" for a single result', async () => {
    mockTotal = 1;
    const root = await render();
    expect(text(byId(root, 'library'))).toContain('1 item');
    expect(text(byId(root, 'library'))).not.toContain('1 items');
    act(() => root.unmount());
  });

  it('asks for no second page when the total is exactly one page', async () => {
    mockTotal = 60;
    const root = await render();
    const list = root.root.findByType(FlatList);
    expect(list.props.data).toHaveLength(60);
    act(() => list.props.onEndReached());
    await flush();
    expect(mockItems).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it('asks for the next page once when the total is one past the page', async () => {
    mockTotal = 61;
    const root = await render();
    act(() => root.root.findByType(FlatList).props.onEndReached());
    act(() => root.root.findByType(FlatList).props.onEndReached());
    await flush();
    expect(mockItems).toHaveBeenCalledTimes(2);
    expect(lastQuery().startIndex).toBe(60);
    expect(root.root.findByType(FlatList).props.data).toHaveLength(61);
    act(() => root.root.findByType(FlatList).props.onEndReached());
    await flush();
    expect(mockItems).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
  });

  it('shows a footer error when a later page fails', async () => {
    mockTotal = 61;
    const root = await render();
    mockItems.mockRejectedValueOnce(new Error('boom'));
    act(() => root.root.findByType(FlatList).props.onEndReached());
    await flush();
    const list = root.root.findByType(FlatList);
    expect(list.props.data).toHaveLength(60);
    expect(list.props.ListFooterComponent).not.toBeNull();
    // A failed page is not asked for again by scrolling.
    act(() => list.props.onEndReached());
    await flush();
    expect(mockItems).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
  });

  it('switches sort through the picker, descending for everything but name', async () => {
    const root = await render();
    expect(text(byId(root, 'sort'))).toContain('Sort: Name');
    expect(pickerOpen(root, 'sort-picker')).toBe(false);
    await press(root, 'sort');
    expect(pickerOpen(root, 'sort-picker')).toBe(true);
    await press(root, 'sort-picker-1');
    expect(pickerOpen(root, 'sort-picker')).toBe(false);
    expect(text(byId(root, 'sort'))).toContain('Sort: Date added');
    expect(lastQuery()).toMatchObject({
      sort: 'dateAdded',
      descending: true,
      startIndex: 0,
    });

    await press(root, 'sort');
    await press(root, 'sort-picker-3');
    expect(lastQuery()).toMatchObject({ sort: 'rating', descending: true });

    await press(root, 'sort');
    await press(root, 'sort-picker-0');
    expect(lastQuery()).toMatchObject({ sort: 'name', descending: false });
    act(() => root.unmount());
  });

  it('filters by first letter and back to all', async () => {
    const root = await render();
    expect(text(byId(root, 'letter'))).toContain('Letter: All');
    await press(root, 'letter');
    expect(pickerOpen(root, 'letter-picker')).toBe(true);
    // All, #, then A..Z: index 4 is C.
    await press(root, 'letter-picker-4');
    expect(text(byId(root, 'letter'))).toContain('Letter: C');
    expect(lastQuery()).toMatchObject({ nameStartsWith: 'C', startIndex: 0 });

    await press(root, 'letter');
    await press(root, 'letter-picker-0');
    expect(text(byId(root, 'letter'))).toContain('Letter: All');
    expect(lastQuery().nameStartsWith).toBeUndefined();
    act(() => root.unmount());
  });

  it('cycles the watched filter through unwatched, watched and all', async () => {
    const root = await render();
    expect(text(byId(root, 'unplayed'))).toContain('All items');
    await press(root, 'unplayed');
    expect(text(byId(root, 'unplayed'))).toContain('Unwatched only');
    expect(lastQuery()).toMatchObject({ played: false, startIndex: 0 });
    await press(root, 'unplayed');
    expect(text(byId(root, 'unplayed'))).toContain('Watched only');
    expect(lastQuery()).toMatchObject({ played: true });
    await press(root, 'unplayed');
    expect(text(byId(root, 'unplayed'))).toContain('All items');
    expect(lastQuery().played).toBeUndefined();
    act(() => root.unmount());
  });

  it('says the library is empty, or that the filter matches nothing', async () => {
    mockTotal = 0;
    const root = await render();
    expect(has(root, 'empty')).toBe(true);
    expect(text(byId(root, 'empty'))).toContain('This library is empty.');
    await press(root, 'unplayed');
    expect(text(byId(root, 'empty'))).toContain(
      'Nothing matches the current filter.',
    );
    act(() => root.unmount());
  });

  it('shows the error view when the first page fails and retries', async () => {
    mockItems.mockRejectedValueOnce(new Error('offline'));
    const root = await render();
    expect(has(root, 'error')).toBe(true);
    expect(has(root, 'library')).toBe(true);
    await press(root, 'retry');
    expect(mockItems).toHaveBeenCalledTimes(2);
    expect(has(root, 'error')).toBe(false);
    expect(root.root.findByType(FlatList).props.data).toHaveLength(3);
    act(() => root.unmount());
  });

  it('shows the loading view until the first page arrives', async () => {
    let resolve!: (p: Page<MediaItem>) => void;
    mockItems.mockImplementationOnce(
      () => new Promise<Page<MediaItem>>(r => (resolve = r)),
    );
    const root = await render();
    expect(has(root, 'loading')).toBe(true);
    await act(async () =>
      resolve({
        items: [{ id: 'x', name: 'X', kind: 'movie' }],
        totalCount: 1,
        startIndex: 0,
      }),
    );
    expect(has(root, 'loading')).toBe(false);
    expect(root.root.findByType(FlatList).props.data).toHaveLength(1);
    act(() => root.unmount());
  });

  it('drops a page that arrives after the filter changed', async () => {
    let resolve!: (p: Page<MediaItem>) => void;
    mockItems.mockImplementationOnce(
      () => new Promise<Page<MediaItem>>(r => (resolve = r)),
    );
    const root = await render();
    await press(root, 'unplayed');
    await act(async () =>
      resolve({
        items: [{ id: 'stale', name: 'Stale', kind: 'movie' }],
        totalCount: 1,
        startIndex: 0,
      }),
    );
    const ids = root.root
      .findByType(FlatList)
      .props.data.map((i: MediaItem) => i.id);
    expect(ids).not.toContain('stale');
    expect(ids).toEqual(['m0', 'm1', 'm2']);
    act(() => root.unmount());
  });

  it('reloads the first page when the screen becomes active again', async () => {
    mockActive = false;
    const root = await render();
    expect(mockItems).toHaveBeenCalledTimes(1);
    mockActive = true;
    await act(async () => {
      root.update(<LibraryScreen library={LIBRARY} />);
    });
    await flush();
    expect(mockItems).toHaveBeenCalledTimes(2);
    expect(lastQuery().startIndex).toBe(0);
    act(() => root.unmount());
  });

  it('fits as many poster columns as the width allows, at least three', async () => {
    const original = Dimensions.get('window');
    const set = (width: number) =>
      act(() => {
        Dimensions.set({
          window: { ...original, width },
          screen: { ...original, width },
        });
      });
    try {
      set(1920);
      const root = await render();
      const expected = Math.floor(
        (1920 - space.safeX * 2) / cardStride('poster'),
      );
      expect(expected).toBeGreaterThan(3);
      expect(root.root.findByType(FlatList).props.numColumns).toBe(expected);

      set(400);
      await flush();
      expect(root.root.findByType(FlatList).props.numColumns).toBe(3);
      act(() => root.unmount());
    } finally {
      set(original.width);
    }
  });

  it.each([
    [0, 'name', false],
    [1, 'dateAdded', true],
    [2, 'year', true],
    [3, 'rating', true],
    [4, 'runtime', true],
    [5, 'premiereDate', true],
    [6, 'playCount', true],
    [7, 'datePlayed', true],
    [8, 'criticRating', true],
    [9, 'random', false],
  ])('sorts by picker row %i as %s', async (row, sort, descending) => {
    const root = await render();
    await press(root, 'sort');
    await press(root, `sort-picker-${row}`);
    expect(lastQuery()).toMatchObject({ sort, descending, startIndex: 0 });
    act(() => root.unmount());
  });

  it('combines filters from the panel and asks the server for their choices', async () => {
    const root = await render();
    expect(text(byId(root, 'filters'))).toBe('Filters');
    await press(root, 'filters');
    expect(pickerOpen(root, 'filter-picker')).toBe(true);
    // Watched state, Genre, Year, Parental rating, Tag, Studio, Resolution, Clear filters.
    await setFilter(root, 1, 2); // Genre: Drama
    expect(mockBackend.genres).toHaveBeenCalledWith('lib');
    expect(pickerOpen(root, 'filter-picker')).toBe(true);
    await setFilter(root, 2, 2); // Year: 2023
    await setFilter(root, 3, 1); // Parental rating: PG
    await setFilter(root, 4, 1); // Tag: Classic
    await setFilter(root, 5, 1); // Studio: Blender
    await setFilter(root, 6, 2); // Resolution: HD
    await setFilter(root, 0, 1); // Watched state: unwatched
    expect(lastQuery()).toMatchObject({
      libraryId: 'lib',
      genres: ['Drama'],
      years: [2023],
      officialRatings: ['PG'],
      tags: ['Classic'],
      studios: ['Blender'],
      resolution: 'hd',
      played: false,
      startIndex: 0,
    });
    const panel = byId(root, 'filter-picker');
    expect(text(panel)).toContain('Drama');
    expect(text(panel)).toContain('HD');
    await act(async () => closeModal(root, 'filter-picker'));
    expect(pickerOpen(root, 'filter-picker')).toBe(false);
    expect(text(byId(root, 'filters'))).toBe('Filters (7)');
    act(() => root.unmount());
  });

  it('marks the current value and goes back to the panel from a value list', async () => {
    const root = await render();
    await press(root, 'filters');
    await setFilter(root, 2, 1); // Year: 2024
    await press(root, 'filter-picker-2');
    expect(pickerOpen(root, 'filter-value-picker')).toBe(true);
    expect(text(byId(root, 'filter-value-picker'))).toContain('2024');
    // Back leaves the value list for the panel, without changing the filter.
    const before = mockItems.mock.calls.length;
    await act(async () => closeModal(root, 'filter-value-picker'));
    expect(pickerOpen(root, 'filter-value-picker')).toBe(false);
    expect(pickerOpen(root, 'filter-picker')).toBe(true);
    expect(mockItems.mock.calls.length).toBe(before);
    // Choosing "Any" removes the filter again.
    await setFilter(root, 2, 0);
    expect(lastQuery().years).toBeUndefined();
    act(() => root.unmount());
  });

  it('offers only "Any" when the choices cannot be loaded', async () => {
    mockBackend.studios.mockRejectedValueOnce(new Error('offline'));
    const root = await render();
    await press(root, 'filters');
    await press(root, 'filter-picker-5');
    expect(text(byId(root, 'filter-value-picker'))).toContain(
      'Could not load the choices',
    );
    expect(has(root, 'filter-value-picker-1')).toBe(false);
    act(() => root.unmount());
  });

  it('clears every filter but keeps the sort and letter', async () => {
    const root = await render();
    await press(root, 'sort');
    await press(root, 'sort-picker-4');
    await press(root, 'letter');
    await press(root, 'letter-picker-4');
    await press(root, 'filters');
    await setFilter(root, 1, 1);
    await setFilter(root, 6, 1);
    expect(lastQuery()).toMatchObject({ genres: ['Comedy'], resolution: '4k' });
    await press(root, 'filter-picker-7');
    expect(lastQuery().genres).toBeUndefined();
    expect(lastQuery().resolution).toBeUndefined();
    expect(lastQuery()).toMatchObject({ sort: 'runtime', nameStartsWith: 'C' });
    expect(text(byId(root, 'filters'))).toBe('Filters');
    act(() => root.unmount());
  });

  it('opens the filter panel with the Menu key, on key-up only and only when active', async () => {
    const root = await render();
    sendKey({ eventType: 'menu', eventKeyAction: 0 });
    expect(pickerOpen(root, 'filter-picker')).toBe(false);
    sendKey({ eventType: 'select', eventKeyAction: 1 });
    expect(pickerOpen(root, 'filter-picker')).toBe(false);
    sendKey({ eventType: 'menu', eventKeyAction: 1 });
    expect(pickerOpen(root, 'filter-picker')).toBe(true);
    act(() => root.unmount());

    // Another list already open stays open.
    mockKeyHandlers.length = 0;
    const second = await render();
    await press(second, 'sort');
    sendKey({ eventType: 'menu', eventKeyAction: 1 });
    expect(pickerOpen(second, 'sort-picker')).toBe(true);
    expect(pickerOpen(second, 'filter-picker')).toBe(false);
    act(() => second.unmount());

    mockKeyHandlers.length = 0;
    mockActive = false;
    const hidden = await render();
    sendKey({ eventType: 'menu', eventKeyAction: 1 });
    expect(pickerOpen(hidden, 'filter-picker')).toBe(false);
    act(() => hidden.unmount());
  });

  it('pages past the page boundary with filters on', async () => {
    mockTotal = 61;
    const root = await render();
    await press(root, 'filters');
    await setFilter(root, 1, 1);
    await setFilter(root, 2, 1);
    expect(lastQuery()).toMatchObject({
      genres: ['Comedy'],
      years: [2024],
      startIndex: 0,
      limit: 60,
    });
    await act(async () => closeModal(root, 'filter-picker'));
    const calls = mockItems.mock.calls.length;
    act(() => root.root.findByType(FlatList).props.onEndReached());
    await flush();
    expect(mockItems).toHaveBeenCalledTimes(calls + 1);
    expect(lastQuery()).toMatchObject({
      genres: ['Comedy'],
      years: [2024],
      startIndex: 60,
      limit: 60,
    });
    expect(root.root.findByType(FlatList).props.data).toHaveLength(61);
    act(() => root.root.findByType(FlatList).props.onEndReached());
    await flush();
    expect(mockItems).toHaveBeenCalledTimes(calls + 1);
    act(() => root.unmount());
  });

  it('keeps the sort and filters of each library when coming back to it', async () => {
    const root = await render();
    await press(root, 'sort');
    await press(root, 'sort-picker-2');
    await press(root, 'unplayed');
    await press(root, 'filters');
    await setFilter(root, 1, 2);
    act(() => root.unmount());
    await flush();
    expect(JSON.parse(mockStorage.data.get(STORAGE_KEY)!)).toEqual({
      lib: { sort: 'year', letter: '', played: false, genre: 'Drama' },
    });

    // Leaving and coming back: the first and only request already has the saved view.
    mockItems.mockClear();
    const again = await render();
    expect(mockItems).toHaveBeenCalledTimes(1);
    expect(lastQuery()).toMatchObject({
      sort: 'year',
      descending: true,
      played: false,
      genres: ['Drama'],
    });
    expect(text(byId(again, 'sort'))).toContain('Release year');
    expect(text(byId(again, 'filters'))).toBe('Filters (2)');
    act(() => again.unmount());

    // After a restart the view is read back from storage.
    resetLocalLists();
    mockItems.mockClear();
    const restarted = await render();
    expect(mockItems).toHaveBeenCalledTimes(1);
    expect(lastQuery()).toMatchObject({ sort: 'year', genres: ['Drama'] });
    act(() => restarted.unmount());

    // Another library keeps its own view and has no resolution filter.
    mockItems.mockClear();
    const shows = await render(SHOWS);
    expect(lastQuery()).toMatchObject({ libraryId: 'shows', sort: 'name' });
    expect(lastQuery().genres).toBeUndefined();
    await press(shows, 'filters');
    expect(text(byId(shows, 'filter-picker'))).not.toContain('Resolution');
    expect(has(shows, 'filter-picker-6')).toBe(true);
    expect(has(shows, 'filter-picker-7')).toBe(false);
    act(() => shows.unmount());
  });

  it('starts from the default view when the stored view is not understood', async () => {
    await mockStorage.set(STORAGE_KEY, '{"lib":{"sort":"bogus","genre":7}}');
    const root = await render();
    expect(mockItems).toHaveBeenCalledTimes(1);
    expect(lastQuery()).toMatchObject({ sort: 'name', descending: false });
    expect(lastQuery().genres).toBeUndefined();
    act(() => root.unmount());
  });

  it('drops repeats from a random order and does not reshuffle on return', async () => {
    mockTotal = 61;
    mockActive = false;
    const root = await render();
    await press(root, 'sort');
    await press(root, 'sort-picker-9');
    mockItems.mockImplementationOnce(async q => ({
      items: [
        { id: 'm0', name: 'Movie 0', kind: 'movie' },
        { id: 'late', name: 'Late', kind: 'movie' },
      ],
      totalCount: 61,
      startIndex: q.startIndex ?? 0,
    }));
    act(() => root.root.findByType(FlatList).props.onEndReached());
    await flush();
    const ids = root.root
      .findByType(FlatList)
      .props.data.map((i: MediaItem) => i.id);
    expect(ids).toHaveLength(61);
    expect(ids.filter((id: string) => id === 'm0')).toHaveLength(1);
    expect(ids[60]).toBe('late');
    // The server's list is used up, so scrolling asks for nothing more.
    const calls = mockItems.mock.calls.length;
    act(() => root.root.findByType(FlatList).props.onEndReached());
    mockActive = true;
    await act(async () => {
      root.update(<LibraryScreen library={LIBRARY} />);
    });
    await flush();
    expect(mockItems.mock.calls.length).toBe(calls);
    act(() => root.unmount());
  });
});
