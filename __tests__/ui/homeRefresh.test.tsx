/**
 * Drives the app with a counting mock backend to check what returning to a screen costs: the
 * cache answers the catalogue rows, and only the rows playback changes are fetched again.
 */
import React from 'react';
import { BackHandler } from 'react-native';
import ReactTestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import App from '../../App';
import { MockBackend, MockConnector } from '../../src/backend/mock/MockBackend';
import type { MediaItem, Session } from '../../src/backend/types';
import { MemoryStore } from '../../src/platform/types';
import { testPlatform } from '../../test-utils/testPlatform';

const READS = [
  'libraries',
  'item',
  'items',
  'search',
  'resume',
  'resumeEpisode',
  'nextUp',
  'latest',
  'seasons',
  'episodes',
] as const;

/** Records every read call; Next Up is the first unwatched episode, like the server's. */
class CountingBackend extends MockBackend {
  reads: string[] = [];
  constructor(session: Session) {
    super(session);
    for (const name of READS) {
      const original = (this[name] as (...a: unknown[]) => unknown).bind(this);
      (this as unknown as Record<string, unknown>)[name] = (
        ...a: unknown[]
      ) => {
        this.reads.push(name);
        return original(...a);
      };
    }
  }
  async nextUp(): Promise<MediaItem[]> {
    const next = this.data.episodes.find(e => !e.userData?.played);
    return next ? [next] : [];
  }
}

class CountingConnector extends MockConnector {
  backend?: CountingBackend;
  open(session: Session) {
    this.backend = new CountingBackend(session);
    return this.backend;
  }
}

const SESSION: Session = {
  server: {
    id: 'mock-server',
    name: 'Mock Server',
    url: 'http://mock.local:8096',
  },
  userId: 'u1',
  userName: 'xelpfin',
  accessToken: 'tok-u1',
  isAdmin: true,
};

const flush = async (ms = 0) => {
  await act(async () => {
    await new Promise<void>(r => setTimeout(r, ms));
  });
};

function byId(root: Renderer, id: string, within?: ReactTestInstance) {
  const all = (within ?? root.root).findAll(
    n => n.props.testID === id && typeof n.type !== 'string',
  );
  if (!all.length) {
    throw new Error(`no element with testID ${id}`);
  }
  return all[0];
}
const has = (root: Renderer, id: string, within?: ReactTestInstance) =>
  (within ?? root.root).findAll(n => n.props.testID === id).length > 0;
const press = async (
  root: Renderer,
  id: string,
  within?: ReactTestInstance,
) => {
  await act(async () => {
    byId(root, id, within).props.onPress();
  });
  await flush();
};

/** The newest detail page: pages below the top one stay mounted. */
function topDetail(root: Renderer): ReactTestInstance {
  const pages = root.root.findAll(
    n => n.props.testID === 'screen-detail' && typeof n.type === 'string',
  );
  return pages[pages.length - 1];
}

let listeners: (() => boolean)[] = [];
const pressBack = async () => {
  await act(async () => {
    [...listeners].reverse().some(fn => fn());
  });
  await flush(5);
};

beforeEach(() => {
  listeners = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, fn) => {
    listeners.push(fn as () => boolean);
    return {
      remove: () => listeners.splice(listeners.indexOf(fn as () => boolean), 1),
    };
  });
});
afterEach(() => jest.restoreAllMocks());

async function signedIn() {
  const store = new MemoryStore();
  await store.set('xelpfin.session', JSON.stringify(SESSION));
  const connector = new CountingConnector();
  let root!: Renderer;
  await act(async () => {
    root = ReactTestRenderer.create(
      <App platform={testPlatform(store)} connector={connector} />,
    );
  });
  await flush(10);
  expect(has(root, 'screen-home')).toBe(true);
  return { root, backend: connector.backend! };
}

test('returning from the player to home fetches only continue watching and next up', async () => {
  const { root, backend } = await signedIn();
  await press(root, 'card-e1');
  expect(has(root, 'screen-player')).toBe(true);
  const video = root.root.findAll(n => n.props.testID === 'video')[0];
  await act(async () => video.props.onLoad({ duration: 20 }));
  await act(async () =>
    video.props.onProgress({ currentTime: 8, playableDuration: 20 }),
  );
  backend.reads = [];
  // The player lowers its controls and asks for a second press before it leaves.
  for (let i = 0; i < 5 && has(root, 'screen-player'); i++) {
    await pressBack();
  }
  expect(has(root, 'screen-player')).toBe(false);
  expect(has(root, 'screen-home')).toBe(true);
  expect(backend.reports.map(r => r.type)).toContain('stop');
  expect(backend.reads.length).toBeLessThanOrEqual(2);
  expect([...backend.reads].sort()).toEqual(['nextUp', 'resume']);
  await act(async () => root.unmount());
});

test('returning from a detail page without changes costs no requests', async () => {
  const { root, backend } = await signedIn();
  await press(root, 'card-m2');
  expect(has(root, 'screen-detail')).toBe(true);
  backend.reads = [];
  await pressBack();
  expect(has(root, 'screen-home')).toBe(true);
  expect(backend.reads).toEqual([]);
  await act(async () => root.unmount());
});

test('marking an episode watched on detail updates next up on home', async () => {
  const { root } = await signedIn();
  expect(has(root, 'card-e1', byId(root, 'row-nextup'))).toBe(true);
  await press(root, 'card-s1');
  expect(has(root, 'screen-detail')).toBe(true);
  await press(root, 'card-e1', byId(root, 'episodes'));
  // The series page stays mounted below; act on the episode's page on top.
  const page = topDetail(root);
  // Only an episode's detail page offers the way back to its series.
  expect(has(root, 'back-to-series', page)).toBe(true);
  await press(root, 'toggle-played', page);
  await flush(5);
  await pressBack();
  await pressBack();
  expect(has(root, 'screen-home')).toBe(true);
  const row = byId(root, 'row-nextup');
  expect(has(root, 'card-e1', row)).toBe(false);
  expect(has(root, 'card-e2', row)).toBe(true);
  await act(async () => root.unmount());
});
