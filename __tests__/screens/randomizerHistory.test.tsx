/**
 * Randomizer history, reached from Settings: the latest picks newest first, ids the server
 * lost are left out, a reset empties the list, and a row opens the episode's detail page.
 */
import React from 'react';
import ReactTestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import App from '../../App';
import { MockBackend, MockConnector } from '../../src/backend/mock/MockBackend';
import type { Session } from '../../src/backend/types';
import { episodeCode } from '../../src/player/seeking';
import { MemoryStore } from '../../src/platform/types';
import { resetLocalLists } from '../../src/state/localLists';
import { HISTORY_SHOWN } from '../../src/ui/screens/RandomizerHistoryScreen';
import { testPlatform } from '../../test-utils/testPlatform';

const SESSION: Session = {
  server: { id: 'mock-server', name: 'Mock Server', url: 'http://mock.local' },
  userId: 'u1',
  userName: 'xelpfin',
  accessToken: 'tok-u1',
  isAdmin: true,
};
const RANDOMIZER_KEY = 'xelpfin.randomizer.mock-server.u1';

/** Mock connector whose backend has `extra` more episodes, ids x0, x1, ... */
class ExtraEpisodesConnector extends MockConnector {
  constructor(private readonly extra: number) {
    super();
  }
  open(session: Session) {
    const backend = new MockBackend(session);
    for (let i = 0; i < this.extra; i++) {
      backend.data.episodes.push({
        id: `x${i}`,
        name: `Extra ${i}`,
        kind: 'episode',
        seriesId: 's1',
        seriesName: 'Test Show',
        parentIndexNumber: 3,
        indexNumber: i + 1,
      });
    }
    return backend;
  }
}

const flush = async (ms = 0) => {
  await act(async () => {
    await new Promise<void>(r => setTimeout(r, ms));
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
/**
 * Retries a check while timers and promises run, until it passes or the deadline goes by, as in
 * App.test: how many flushes the app needs to reach a state is not part of its contract.
 */
async function waitFor<T>(
  check: () => T | Promise<T>,
  timeoutMs = 2000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (e) {
      if (Date.now() > deadline) {
        throw e;
      }
    }
    await flush(5);
  }
}
const shown = (root: Renderer, id: string) =>
  waitFor(() => expect(has(root, id)).toBe(true));
const press = async (root: Renderer, id: string) => {
  const target = await waitFor(() => byId(root, id));
  await act(async () => {
    target.props.onPress();
  });
  await flush();
};
const text = (node: ReactTestInstance): string =>
  node
    .findAllByType('Text' as never)
    .flatMap(t => React.Children.toArray(t.props.children))
    .join('');

async function openHistory(randomizer?: object, extraEpisodes = 0) {
  const store = new MemoryStore();
  await store.set('xelpfin.session', JSON.stringify(SESSION));
  if (randomizer) {
    await store.set(RANDOMIZER_KEY, JSON.stringify(randomizer));
  }
  const connector = new ExtraEpisodesConnector(extraEpisodes);
  let root!: Renderer;
  await act(async () => {
    root = ReactTestRenderer.create(
      <App platform={testPlatform(store)} connector={connector} />,
    );
  });
  await flush();
  await shown(root, 'screen-home');
  await press(root, 'tab-settings');
  await press(root, 'act-randomizer-history');
  await flush();
  await shown(root, 'screen-randomizerHistory');
  return { root, store };
}

beforeEach(() => {
  jest.useRealTimers();
  resetLocalLists();
});

test('lists the latest picks newest first and skips ids the server lost', async () => {
  const { root } = await openHistory({
    series: ['s1'],
    played: ['e1', 'e4'],
    history: ['e1', 'gone', 'e4'],
  });
  await shown(root, 'history-0');
  await waitFor(() =>
    expect(text(byId(root, 'history-0'))).toContain('Test Show'),
  );
  await waitFor(() =>
    expect(text(byId(root, 'history-0'))).toContain('Episode 1'),
  );
  expect(byId(root, 'history-0').props.hasTVPreferredFocus).toBe(true);
  await waitFor(() =>
    expect(text(byId(root, 'history-0'))).toContain(episodeCode(2, 1)!),
  );
  await waitFor(() =>
    expect(text(byId(root, 'history-1'))).toContain('Episode 1'),
  );
  await waitFor(() =>
    expect(text(byId(root, 'history-1'))).toContain(episodeCode(1, 1)!),
  );
  expect(has(root, 'history-2')).toBe(false);
  await act(async () => root.unmount());
});

test(`shows only the newest ${HISTORY_SHOWN} picks`, async () => {
  const count = HISTORY_SHOWN + 5;
  const history = Array.from({ length: count }, (_, i) => `x${i}`);
  const { root } = await openHistory(
    { series: ['s1'], played: [], history },
    count,
  );
  await shown(root, `history-${HISTORY_SHOWN - 1}`);
  expect(has(root, `history-${HISTORY_SHOWN}`)).toBe(false);
  await waitFor(() =>
    expect(text(byId(root, 'history-0'))).toContain(`Extra ${count - 1}`),
  );
  await waitFor(() =>
    expect(text(byId(root, `history-${HISTORY_SHOWN - 1}`))).toContain(
      `Extra ${count - HISTORY_SHOWN}`,
    ),
  );
  await act(async () => root.unmount());
});

test('says nothing has played yet when the history is empty', async () => {
  const { root } = await openHistory();
  await shown(root, 'empty');
  await waitFor(() =>
    expect(text(byId(root, 'empty'))).toContain('Nothing played yet'),
  );
  expect(has(root, 'history-0')).toBe(false);
  await act(async () => root.unmount());
});

test('a row opens the episode detail page', async () => {
  const { root } = await openHistory({
    series: ['s1'],
    played: [],
    history: ['e2', 'e3'],
  });
  await waitFor(() =>
    expect(text(byId(root, 'history-0'))).toContain('Episode 3'),
  );
  await press(root, 'history-0');
  await flush();
  await shown(root, 'screen-detail');
  await act(async () => root.unmount());
});

test('resetting the Randomizer in Settings clears the list', async () => {
  const store = new MemoryStore();
  await store.set('xelpfin.session', JSON.stringify(SESSION));
  await store.set(
    RANDOMIZER_KEY,
    JSON.stringify({ series: ['s1'], played: ['e1'], history: ['e1'] }),
  );
  let root!: Renderer;
  await act(async () => {
    root = ReactTestRenderer.create(
      <App platform={testPlatform(store)} connector={new MockConnector()} />,
    );
  });
  await flush();
  await press(root, 'tab-settings');
  await press(root, 'act-reset-randomizer');
  await press(root, 'act-reset-randomizer');
  await waitFor(() =>
    expect(text(byId(root, 'act-reset-randomizer'))).toContain(
      'History cleared',
    ),
  );
  await press(root, 'act-randomizer-history');
  await flush();
  await shown(root, 'screen-randomizerHistory');
  await shown(root, 'empty');
  expect(has(root, 'history-0')).toBe(false);
  await act(async () => root.unmount());
});
