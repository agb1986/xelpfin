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

class RecordingConnector extends MockConnector {
  backends: MockBackend[] = [];
  open(session: Session) {
    const b = new MockBackend(session);
    this.backends.push(b);
    return b;
  }
}

const flush = async (ms = 0) => {
  await act(async () => {
    await new Promise<void>(r => setTimeout(r, ms));
  });
};

/** The composite element carrying a testID with an onPress handler (Pressable/TextInput). */
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
const press = async (root: Renderer, id: string) => {
  await act(async () => {
    byId(root, id).props.onPress();
  });
  await flush();
};

async function render(
  store = new MemoryStore(),
  connector = new RecordingConnector(),
) {
  let root!: Renderer;
  await act(async () => {
    root = ReactTestRenderer.create(
      <App platform={testPlatform(store)} connector={connector} />,
    );
  });
  await flush();
  return { root, connector, store };
}

async function signIn(root: Renderer) {
  await flush(10);
  expect(has(root, 'screen-servers')).toBe(true);
  await press(root, 'server-mock-server');
  expect(has(root, 'screen-login')).toBe(true);
  await press(root, 'user-xelpfin');
  await act(async () =>
    byId(root, 'password').props.onChangeText('xelpfin-pass'),
  );
  await press(root, 'signin');
  await flush();
  expect(has(root, 'screen-home')).toBe(true);
}

beforeEach(() => jest.useRealTimers());

test('first launch goes from server picker through login to home', async () => {
  const { root, store } = await render();
  await signIn(root);
  expect(has(root, 'row-resume')).toBe(true);
  expect(has(root, 'card-m1')).toBe(true);
  expect(JSON.parse((await store.get('xelpfin.session'))!).userName).toBe(
    'xelpfin',
  );
  await act(async () => root.unmount());
});

test('a wrong password shows an error and stays on login', async () => {
  const { root } = await render();
  await flush(10);
  await press(root, 'server-mock-server');
  await press(root, 'user-xelpfin');
  await act(async () => byId(root, 'password').props.onChangeText('nope'));
  await press(root, 'signin');
  expect(has(root, 'login-error')).toBe(true);
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
  await flush();
  expect(has(root, 'screen-home')).toBe(true);

  await press(root, 'card-m2');
  expect(has(root, 'screen-detail')).toBe(true);
  expect(byId(root, 'detail-title').props.children).toBe('Night Grid');

  await press(root, 'play');
  await flush();
  expect(has(root, 'screen-player')).toBe(true);
  const video = root.root.findAll(n => n.props.testID === 'video')[0];
  expect(video.props.source.uri).toBe('http://mock.local:8096/stream/m2');
  await act(async () => video.props.onLoad({ duration: 40 }));
  await act(async () =>
    video.props.onProgress({ currentTime: 12, playableDuration: 20 }),
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
  await flush();
  expect(has(out.root, 'screen-home')).toBe(true);
  return out;
}

const video = (root: Renderer) =>
  root.root.findAll(n => n.props.testID === 'video')[0];

test('the end of an episode plays the next one in series order', async () => {
  const { root } = await signedIn();
  await press(root, 'card-e2');
  expect(video(root).props.source.uri).toBe('http://mock.local:8096/stream/e2');
  await act(async () => video(root).props.onLoad({ duration: 20 }));
  await act(async () => video(root).props.onEnd());
  await flush();
  expect(has(root, 'screen-player')).toBe(true);
  expect(video(root).props.source.uri).toBe('http://mock.local:8096/stream/e3');
  await act(async () => root.unmount());
});

test('BACK while the next episode is being looked up leaves the player and does not replace the page below', async () => {
  // A hardware BACK stand-in: the newest live listener gets the press first, as on Android.
  const listeners: (() => boolean)[] = [];
  const spy = jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation((_e, fn) => {
      listeners.push(fn as () => boolean);
      return {
        remove: () =>
          listeners.splice(listeners.indexOf(fn as () => boolean), 1),
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
  await act(async () => video(root).props.onLoad({ duration: 20 }));
  await act(async () => {
    video(root).props.onEnd();
    video(root).props.onEnd();
  });
  await act(async () => {
    pressBack();
  });
  expect(has(root, 'screen-player')).toBe(false);
  expect(has(root, 'screen-home')).toBe(true);
  await act(async () => release());
  await flush(10);
  expect(has(root, 'screen-player')).toBe(false);
  expect(has(root, 'screen-home')).toBe(true);
  // One start and exactly one stop: the second end event and the unmount add nothing.
  const types = connector.backends[connector.backends.length - 1].reports.map(
    r => r.type,
  );
  expect(types.filter(t => t === 'start')).toHaveLength(1);
  expect(types.filter(t => t === 'stop')).toHaveLength(1);
  spy.mockRestore();
  await act(async () => root.unmount());
});

test('with autoplay off the end of an episode returns to where playback started', async () => {
  const { root } = await signedIn(undefined, { autoplayNext: false });
  await press(root, 'card-e2');
  await act(async () => video(root).props.onLoad({ duration: 20 }));
  await act(async () => video(root).props.onEnd());
  await flush();
  expect(has(root, 'screen-home')).toBe(true);
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
  await flush(10);
  expect(has(root, 'screen-login')).toBe(true);
  expect(has(root, 'login-expired')).toBe(true);
  expect(await store.get('xelpfin.session')).toBeFalsy();
  await act(async () => root.unmount());
});

test('subtitle style settings are offered, saved and applied', async () => {
  const { root, store } = await signedIn();
  await press(root, 'tab-settings');
  expect(has(root, 'screen-settings')).toBe(true);
  await press(root, 'set-subsize');
  await press(root, 'pick-subsize-2');
  await press(root, 'set-subcolor');
  await press(root, 'pick-subcolor-1');
  await press(root, 'set-subbg');
  await press(root, 'pick-subbg-2');
  await flush();
  expect(JSON.parse((await store.get('xelpfin.settings'))!)).toMatchObject({
    subtitleSize: 28,
    subtitleColor: '#ffe14d',
    subtitleBackground: 'shadow',
  });
  await act(async () => root.unmount());
});

test('switch user and change server leave the signed-in screens without a render that has no backend', async () => {
  const { root, store } = await signedIn();
  await press(root, 'tab-settings');
  await press(root, 'set-switch-user');
  await flush(10);
  expect(has(root, 'screen-login')).toBe(true);
  expect(has(root, 'screen-home')).toBe(false);
  expect(await store.get('xelpfin.session')).toBeFalsy();
  await press(root, 'user-guest');
  await press(root, 'signin');
  await flush(10);
  expect(has(root, 'screen-home')).toBe(true);
  await press(root, 'tab-settings');
  await press(root, 'set-change-server');
  await flush(10);
  expect(has(root, 'screen-servers')).toBe(true);
  expect(has(root, 'screen-home')).toBe(false);
  await act(async () => root.unmount());
});
