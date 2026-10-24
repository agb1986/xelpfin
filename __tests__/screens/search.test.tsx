/**
 * Search as you type: the term is debounced, nothing is asked for under two characters,
 * results keep to playable and browsable kinds, and empty and failed searches say so.
 */
import React from 'react';
import { FlatList } from 'react-native';
import ReactTestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import { MockBackend } from '../../src/backend/mock/MockBackend';
import type { MediaItem, Session } from '../../src/backend/types';
import { SearchScreen } from '../../src/ui/screens/SearchScreen';

const SESSION: Session = {
  server: { id: 'mock-server', name: 'Mock Server', url: 'http://mock.local' },
  userId: 'u1',
  userName: 'xelpfin',
  accessToken: 'tok-u1',
  isAdmin: true,
};

// Stable identities: the search reruns whenever the backend changes.
const mockBackend = new MockBackend(SESSION);
const mockNav = { push: jest.fn() };
jest.mock('../../src/state/AppState', () => ({
  useBackend: () => mockBackend,
}));
jest.mock('../../src/state/navigation', () => ({
  ...jest.requireActual('../../src/state/navigation'),
  useNavigation: () => mockNav,
  useIsActive: () => true,
}));

const DEBOUNCE_MS = 400;

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
const text = (node: ReactTestInstance): string =>
  node
    .findAllByType('Text' as never)
    .flatMap(t => React.Children.toArray(t.props.children))
    .join('');

/** Lets pending promises settle without moving the fake clock. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
};
const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await settle();
};
const type = async (root: Renderer, value: string) => {
  await act(async () => {
    byId(root, 'search-input').props.onChangeText(value);
  });
};
const results = (root: Renderer): MediaItem[] =>
  root.root.findByType(FlatList).props.data;

describe('SearchScreen', () => {
  let search: jest.SpyInstance;
  let root: Renderer;
  beforeEach(async () => {
    jest.useFakeTimers();
    mockNav.push.mockClear();
    search = jest.spyOn(mockBackend, 'search');
    await act(async () => {
      root = ReactTestRenderer.create(<SearchScreen />);
    });
    await settle();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    search.mockRestore();
    jest.useRealTimers();
  });

  it('shows the hint and does not search before two characters', async () => {
    expect(text(byId(root, 'search'))).toContain(
      'Movies, shows and episodes from every library.',
    );
    await type(root, 'b');
    await advance(DEBOUNCE_MS);
    expect(search).not.toHaveBeenCalled();
    await type(root, '  b ');
    await advance(DEBOUNCE_MS);
    expect(search).not.toHaveBeenCalled();
    expect(root.root.findAllByType(FlatList)).toHaveLength(0);
  });

  it('waits for typing to pause before searching once', async () => {
    await type(root, 'ni');
    await advance(DEBOUNCE_MS - 100);
    await type(root, 'nig');
    await advance(DEBOUNCE_MS - 100);
    await type(root, 'night');
    await advance(DEBOUNCE_MS - 1);
    expect(search).not.toHaveBeenCalled();
    await advance(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('night', 48);
    expect(results(root).map(i => i.id)).toEqual(['m2']);
    expect(text(byId(root, 'search'))).toContain('1 result');
  });

  it('trims the term and lists movies, series and episodes but not seasons', async () => {
    await type(root, '  test ');
    await advance(DEBOUNCE_MS);
    expect(search).toHaveBeenCalledWith('test', 48);
    const kinds = results(root).map(i => i.kind);
    expect(kinds).toContain('movie');
    expect(kinds).toContain('series');
    expect(text(byId(root, 'search'))).toContain(
      `${results(root).length} results`,
    );

    await type(root, 'season');
    await advance(DEBOUNCE_MS);
    expect(search).toHaveBeenLastCalledWith('season', 48);
    expect(has(root, 'empty')).toBe(true);

    await type(root, 'episode');
    await advance(DEBOUNCE_MS);
    const episodes = results(root);
    expect(episodes.length).toBe(4);
    expect(episodes.every(i => i.kind === 'episode')).toBe(true);
  });

  it('says when nothing matches', async () => {
    await type(root, 'zzz');
    await advance(DEBOUNCE_MS);
    expect(has(root, 'empty')).toBe(true);
    expect(text(byId(root, 'empty'))).toContain('Nothing matches “zzz”.');
  });

  it('shows "Searching…" while the search runs', async () => {
    let resolve!: (items: MediaItem[]) => void;
    search.mockImplementationOnce(
      () => new Promise<MediaItem[]>(r => (resolve = r)),
    );
    await type(root, 'grid');
    await advance(DEBOUNCE_MS);
    expect(text(byId(root, 'search'))).toContain('Searching…');
    await act(async () => resolve([]));
    await settle();
    expect(has(root, 'empty')).toBe(true);
  });

  it('shows an error with retry when the search fails', async () => {
    search.mockRejectedValueOnce(new Error('offline'));
    await type(root, 'night');
    await advance(DEBOUNCE_MS);
    expect(has(root, 'error')).toBe(true);
    await act(async () => byId(root, 'retry').props.onPress());
    await settle();
    expect(has(root, 'error')).toBe(false);
    expect(results(root).map(i => i.id)).toEqual(['m2']);
  });

  it('opens the detail page of a result', async () => {
    await type(root, 'night');
    await advance(DEBOUNCE_MS);
    const list = root.root.findByType(FlatList);
    const card = list.props.renderItem({ item: list.props.data[0], index: 0 });
    act(() => card.props.onPress(list.props.data[0]));
    expect(mockNav.push).toHaveBeenCalledWith({ name: 'detail', itemId: 'm2' });
    const row = list.props.getItemLayout(null, 1);
    expect(row.offset).toBe(row.length);
  });
});
