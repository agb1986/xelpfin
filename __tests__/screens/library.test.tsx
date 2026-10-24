/**
 * The library grid: paging at the page boundary, sort and letter pickers, the unwatched
 * filter, the column count from the window width, and the empty and error states.
 */
import React from 'react';
import { Dimensions, FlatList, Image, Modal } from 'react-native';
import ReactTestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import type { ItemQuery, MediaItem, Page } from '../../src/backend/types';
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
const mockBackend = { items: mockItems };
const mockNav = { push: jest.fn() };
let mockActive = true;
jest.mock('../../src/state/AppState', () => ({
  useBackend: () => mockBackend,
}));
jest.mock('../../src/state/navigation', () => ({
  ...jest.requireActual('../../src/state/navigation'),
  useNavigation: () => mockNav,
  useIsActive: () => mockActive,
}));

const LIBRARY = { id: 'lib', name: 'Movies', collectionType: 'movies' };

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

async function render(): Promise<Renderer> {
  let root!: Renderer;
  await act(async () => {
    root = ReactTestRenderer.create(<LibraryScreen library={LIBRARY} />);
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
    expect(lastQuery()).toMatchObject({
      libraryId: 'lib',
      sort: 'name',
      descending: false,
      nameStartsWith: undefined,
      unplayedOnly: false,
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

  it('toggles the unwatched filter', async () => {
    const root = await render();
    expect(text(byId(root, 'unplayed'))).toContain('All items');
    await press(root, 'unplayed');
    expect(text(byId(root, 'unplayed'))).toContain('Unwatched only');
    expect(lastQuery()).toMatchObject({ unplayedOnly: true, startIndex: 0 });
    await press(root, 'unplayed');
    expect(lastQuery()).toMatchObject({ unplayedOnly: false });
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
});
