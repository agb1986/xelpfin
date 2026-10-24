/**
 * Drives the whole app with the mock backend: server picker, login, home, detail, player.
 */
import React from 'react';
import ReactTestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import App from '../App';
import { BackHandler } from 'react-native';
import { MockBackend, MockConnector } from '../src/backend/mock/MockBackend';
import { BackendError, type Session } from '../src/backend/types';
import { MemoryStore } from '../src/platform/types';
import { testPlatform } from '../test-utils/testPlatform';
import {
  WARM_UP_TIMEOUT_MS,
  warmUpReactNative,
} from '../test-utils/warmUpReactNative';

class RecordingConnector extends MockConnector {
  backends: MockBackend[] = [];
  open(session: Session) {
    const b = new MockBackend(session);
    this.backends.push(b);
    return b;
  }
}

/**
 * Root cause of the CI flake: on CI's empty transform cache the first test paid seconds of
 * react-native module loading (see warmUpReactNative) and could pass Jest's 5 s timeout. Jest then
 * started the next test while the timed-out one was still running; the two shared `act` and the
 * renderer, so every later test failed too. The warm-up moves that cost out of the tests, and the
 * renderer bookkeeping below keeps a test that does fail from taking the others down with it.
 */
beforeAll(warmUpReactNative, WARM_UP_TIMEOUT_MS);

/**
 * Renderers mounted by the current test. When a test fails or times out, Jest moves on but the
 * test's async body keeps running; left alone it would keep calling act() alongside the next test.
 * afterEach unmounts its renderers and bumps the generation, and every helper below checks the
 * generation first, so a leftover test stops at its next step instead of breaking the next one.
 */
const mounted: Renderer[] = [];
const bornIn = new WeakMap<Renderer, number>();
let generation = 0;

class TestFinished extends Error {}

function live(root: Renderer) {
  if (bornIn.get(root) !== generation) {
    throw new TestFinished('this renderer belongs to a test that has ended');
  }
}

afterEach(async () => {
  generation++;
  while (mounted.length) {
    const r = mounted.pop()!;
    await act(async () => r.unmount());
  }
  jest.restoreAllMocks();
});

const flush = async (root: Renderer, ms = 0) => {
  live(root);
  await act(async () => {
    await new Promise<void>(r => setTimeout(r, ms));
  });
};

/** The composite element carrying a testID with an onPress handler (Pressable/TextInput). */
function byId(root: Renderer, id: string): ReactTestInstance {
  live(root);
  const all = root.root.findAll(
    n => n.props.testID === id && typeof n.type !== 'string',
  );
  if (!all.length) {
    throw new Error(`no element with testID ${id}`);
  }
  return all[0];
}
const has = (root: Renderer, id: string) => {
  live(root);
  return root.root.findAll(n => n.props.testID === id).length > 0;
};

/**
 * Retries a check while letting timers and promises run, until it passes or the deadline goes by.
 * The app reaches each screen through a chain of promises and effects whose length is not part of
 * its contract, so asserting after a fixed number of flushes is a race. The deadline only bounds
 * a real failure; a passing check returns as soon as it holds.
 */
async function waitFor<T>(
  root: Renderer,
  check: () => T | Promise<T>,
  timeoutMs = 2000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (e) {
      if (e instanceof TestFinished || Date.now() > deadline) {
        throw e;
      }
    }
    await flush(root, 5);
  }
}
const shown = (root: Renderer, id: string) =>
  waitFor(root, () => expect(has(root, id)).toBe(true));

/** Waits for a value the app writes to storage asynchronously. */
const stored = (
  root: Renderer,
  store: MemoryStore,
  key: string,
  check: (v: string | null | undefined) => void,
) => waitFor(root, async () => check(await store.get(key)));

const press = async (root: Renderer, id: string) => {
  const target = await waitFor(root, () => byId(root, id));
  await act(async () => {
    target.props.onPress();
  });
  await flush(root);
};

async function render(
  store = new MemoryStore(),
  connector = new RecordingConnector(),
) {
  let root!: Renderer;
  // Registered as soon as it exists, so afterEach unmounts it even if the test ends mid-act.
  await act(async () => {
    root = ReactTestRenderer.create(
      <App platform={testPlatform(store)} connector={connector} />,
    );
    mounted.push(root);
    bornIn.set(root, generation);
  });
  await flush(root);
  return { root, connector, store };
}

async function signIn(root: Renderer) {
  await shown(root, 'screen-servers');
  await press(root, 'server-mock-server');
  await shown(root, 'screen-login');
  await press(root, 'user-xelpfin');
  await act(async () =>
    byId(root, 'password').props.onChangeText('xelpfin-pass'),
  );
  await press(root, 'signin');
  await shown(root, 'screen-home');
}

beforeEach(() => jest.useRealTimers());

test('first launch goes from server picker through login to home', async () => {
  const { root, store } = await render();
  await signIn(root);
  await shown(root, 'row-resume');
  await shown(root, 'card-m1');
  await stored(root, store, 'xelpfin.session', v =>
    expect(JSON.parse(v!).userName).toBe('xelpfin'),
  );
  await act(async () => root.unmount());
});

test('a wrong password shows an error and stays on login', async () => {
  const { root } = await render();
  await press(root, 'server-mock-server');
  await press(root, 'user-xelpfin');
  await act(async () => byId(root, 'password').props.onChangeText('nope'));
  await press(root, 'signin');
  await shown(root, 'login-error');
  expect(has(root, 'screen-login')).toBe(true);
  expect(byId(root, 'password').props.value).toBe('');
  await act(async () => root.unmount());
});

test('a stored session starts on home, opens detail and plays with progress reports', async () => {
  const store = new MemoryStore();
  const session: Session = {
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
  await store.set('xelpfin.session', JSON.stringify(session));
  const { root, connector } = await render(store);
  await shown(root, 'screen-home');

  await press(root, 'card-m2');
  await shown(root, 'screen-detail');
  await waitFor(root, () =>
    expect(byId(root, 'detail-title').props.children).toBe('Night Grid'),
  );

  await press(root, 'play');
  await shown(root, 'screen-player');
  const v = await playing(root, 'http://mock.local:8096/stream/m2');
  await act(async () => v.props.onLoad({ duration: 40 }));
  await act(async () =>
    v.props.onProgress({ currentTime: 12, playableDuration: 20 }),
  );
  await act(async () => root.unmount());

  const backend = connector.backends[connector.backends.length - 1];
  const types = backend.reports.map(r => r.type);
  expect(types[0]).toBe('start');
  expect(types[types.length - 1]).toBe('stop');
  expect(backend.reports[backend.reports.length - 1].report.positionMs).toBe(
    12_000,
  );
});

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

async function signedIn(
  connector = new RecordingConnector(),
  settings?: object,
) {
  const store = new MemoryStore();
  await store.set('xelpfin.session', JSON.stringify(SESSION));
  if (settings) {
    await store.set('xelpfin.settings', JSON.stringify(settings));
  }
  const out = await render(store, connector);
  await shown(out.root, 'screen-home');
  return out;
}

/** The mocked <Video>; throws until the player has mounted it, so it can be waited for. */
function video(root: Renderer): ReactTestInstance {
  const v = root.root.findAll(n => n.props.testID === 'video')[0];
  if (!v) {
    throw new Error('no video element');
  }
  return v;
}
function playing(root: Renderer, uri: string) {
  return waitFor(root, () => {
    const v = video(root);
    expect(v.props.source.uri).toBe(uri);
    return v;
  });
}

test('the end of an episode plays the next one in series order', async () => {
  const { root } = await signedIn();
  await press(root, 'card-e2');
  const v = await playing(root, 'http://mock.local:8096/stream/e2');
  await act(async () => v.props.onLoad({ duration: 20 }));
  await act(async () => v.props.onEnd());
  await playing(root, 'http://mock.local:8096/stream/e3');
  expect(has(root, 'screen-player')).toBe(true);
  await act(async () => root.unmount());
});

test('BACK while the next episode is being looked up leaves the player and does not replace the page below', async () => {
  // A hardware BACK stand-in: the newest live listener gets the press first, as on Android.
  // afterEach restores the spy even when the test fails part way.
  const listeners: (() => boolean)[] = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, fn) => {
    listeners.push(fn as () => boolean);
    return {
      remove: () => listeners.splice(listeners.indexOf(fn as () => boolean), 1),
    };
  });
  const pressBack = () => [...listeners].reverse().some(fn => fn());
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  class SlowBackend extends MockBackend {
    async episodes(seriesId: string) {
      await gate;
      return super.episodes(seriesId);
    }
  }
  class SlowConnector extends RecordingConnector {
    open(session: Session) {
      const b = new SlowBackend(session);
      this.backends.push(b);
      return b;
    }
  }
  const { root, connector } = await signedIn(new SlowConnector());
  await press(root, 'card-e2');
  const v = await playing(root, 'http://mock.local:8096/stream/e2');
  await act(async () => v.props.onLoad({ duration: 20 }));
  await act(async () => {
    v.props.onEnd();
    v.props.onEnd();
  });
  await act(async () => {
    pressBack();
  });
  await shown(root, 'screen-home');
  expect(has(root, 'screen-player')).toBe(false);
  await act(async () => release());
  // Asserting that nothing happens: give the released lookup time to (wrongly) navigate.
  await flush(root, 10);
  expect(has(root, 'screen-player')).toBe(false);
  expect(has(root, 'screen-home')).toBe(true);
  // One start and exactly one stop: the second end event and the unmount add nothing.
  await act(async () => root.unmount());
  const types = connector.backends[connector.backends.length - 1].reports.map(
    r => r.type,
  );
  expect(types.filter(t => t === 'start')).toHaveLength(1);
  expect(types.filter(t => t === 'stop')).toHaveLength(1);
});

test('with autoplay off the end of an episode returns to where playback started', async () => {
  const { root } = await signedIn(undefined, { autoplayNext: false });
  await press(root, 'card-e2');
  const v = await playing(root, 'http://mock.local:8096/stream/e2');
  await act(async () => v.props.onLoad({ duration: 20 }));
  await act(async () => v.props.onEnd());
  await shown(root, 'screen-home');
  expect(has(root, 'screen-player')).toBe(false);
  await act(async () => root.unmount());
});

test('a revoked token sends the user to sign in again with an explanation', async () => {
  class ExpiringBackend extends MockBackend {
    async item(): Promise<never> {
      throw new BackendError('Unauthorized', 'auth', 401);
    }
  }
  class ExpiringConnector extends RecordingConnector {
    open(session: Session) {
      const b = new ExpiringBackend(session);
      this.backends.push(b);
      return b;
    }
  }
  const { root, store } = await signedIn(new ExpiringConnector());
  await press(root, 'card-m2');
  await shown(root, 'screen-login');
  expect(has(root, 'login-expired')).toBe(true);
  await stored(root, store, 'xelpfin.session', v => expect(v).toBeFalsy());
  await act(async () => root.unmount());
});

test('subtitle style settings are offered, saved and applied', async () => {
  const { root, store } = await signedIn();
  await press(root, 'tab-settings');
  await shown(root, 'screen-settings');
  await press(root, 'set-subsize');
  await press(root, 'pick-subsize-2');
  await press(root, 'set-subcolor');
  await press(root, 'pick-subcolor-1');
  await press(root, 'set-subbg');
  await press(root, 'pick-subbg-2');
  await stored(root, store, 'xelpfin.settings', v =>
    expect(JSON.parse(v!)).toMatchObject({
      subtitleSize: 28,
      subtitleColor: '#ffe14d',
      subtitleBackground: 'shadow',
    }),
  );
  await act(async () => root.unmount());
});

test('switch user and change server leave the signed-in screens without a render that has no backend', async () => {
  const { root, store } = await signedIn();
  await press(root, 'tab-settings');
  await press(root, 'set-switch-user');
  await shown(root, 'screen-login');
  expect(has(root, 'screen-home')).toBe(false);
  await stored(root, store, 'xelpfin.session', v => expect(v).toBeFalsy());
  await press(root, 'user-guest');
  await press(root, 'signin');
  await shown(root, 'screen-home');
  await press(root, 'tab-settings');
  await press(root, 'set-change-server');
  await shown(root, 'screen-servers');
  expect(has(root, 'screen-home')).toBe(false);
  await act(async () => root.unmount());
});
