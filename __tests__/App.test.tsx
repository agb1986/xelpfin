/**
 * Drives the whole app with the mock backend: server picker, login, home, detail, player.
 */
import React from 'react';
import ReactTestRenderer, { act, type ReactTestInstance, type ReactTestRenderer as Renderer } from 'react-test-renderer';
import App from '../App';
import { MockBackend, MockConnector } from '../src/backend/mock/MockBackend';
import type { Session } from '../src/backend/types';
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
  const all = root.root.findAll(n => n.props.testID === id && typeof n.type !== 'string');
  if (!all.length) {
    throw new Error(`no element with testID ${id}`);
  }
  return all[0];
}
const has = (root: Renderer, id: string) => root.root.findAll(n => n.props.testID === id).length > 0;
const press = async (root: Renderer, id: string) => {
  await act(async () => {
    byId(root, id).props.onPress();
  });
  await flush();
};

async function render(store = new MemoryStore(), connector = new RecordingConnector()) {
  let root!: Renderer;
  await act(async () => {
    root = ReactTestRenderer.create(<App platform={testPlatform(store)} connector={connector} />);
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
  await act(async () => byId(root, 'password').props.onChangeText('xelpfin-pass'));
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
  expect(JSON.parse((await store.get('xelpfin.session'))!).userName).toBe('xelpfin');
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
  await act(async () => root.unmount());
});

test('a stored session starts on home, opens detail and plays with progress reports', async () => {
  const store = new MemoryStore();
  const session: Session = {
    server: { id: 'mock-server', name: 'Mock Server', url: 'http://mock.local:8096' },
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
  await act(async () => video.props.onProgress({ currentTime: 12, playableDuration: 20 }));
  await act(async () => root.unmount());

  const backend = connector.backends[connector.backends.length - 1];
  const types = backend.reports.map(r => r.type);
  expect(types[0]).toBe('start');
  expect(types[types.length - 1]).toBe('stop');
  expect(backend.reports[backend.reports.length - 1].report.positionMs).toBe(12_000);
});
