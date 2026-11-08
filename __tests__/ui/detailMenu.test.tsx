/**
 * Long-pressing the main button on a detail page opens a menu of the page's actions; a short
 * press still plays.
 */
import React from 'react';
import { Modal } from 'react-native';
import ReactTestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import App from '../../App';
import { MockBackend, MockConnector } from '../../src/backend/mock/MockBackend';
import type { Session } from '../../src/backend/types';
import { MemoryStore } from '../../src/platform/types';
import { testPlatform } from '../../test-utils/testPlatform';

class Connector extends MockConnector {
  backend?: MockBackend;
  open(session: Session) {
    this.backend = new MockBackend(session);
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

async function signedIn() {
  const store = new MemoryStore();
  await store.set('xelpfin.session', JSON.stringify(SESSION));
  const connector = new Connector();
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

const longPress = async (root: Renderer, id: string) => {
  await act(async () => {
    byId(root, id).props.onLongPress();
  });
  await flush();
};
const labelOf = (root: Renderer, id: string) => byId(root, id).props.label;
const menuIds = (root: Renderer) => [
  ...new Set(
    root.root
      .findAll(n => /^detail-menu-\d+$/.test(n.props.testID ?? ''))
      .map(n => n.props.testID as string),
  ),
];
const menuText = (root: Renderer, id: string) =>
  byId(root, id)
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => n.props.children)
    .join('');

test('long press on a film opens the menu; an action runs and closes it', async () => {
  const { root, backend } = await signedIn();
  await press(root, 'card-m2');
  expect(labelOf(root, 'toggle-played')).toBe('Mark watched');
  await longPress(root, 'play');
  expect(has(root, 'screen-player')).toBe(false);
  // Mark watched and Favourite; no Randomizer for a film.
  expect(menuIds(root)).toEqual(['detail-menu-0', 'detail-menu-1']);
  expect(menuText(root, 'detail-menu-0')).toBe('Mark watched');
  expect(menuText(root, 'detail-menu-1')).toBe('♡ Favourite');
  await press(root, 'detail-menu-0');
  await flush(5);
  expect(menuIds(root)).toEqual([]);
  expect(labelOf(root, 'toggle-played')).toBe('Mark unwatched');
  expect((await backend.item('m2')).userData?.played).toBe(true);
  await act(async () => root.unmount());
});

test('the series menu offers the Randomizer and BACK closes it unchanged', async () => {
  const { root } = await signedIn();
  await press(root, 'card-s1');
  const main = ['resume-episode', 'play-next'].find(id => has(root, id))!;
  await longPress(root, main);
  expect(menuIds(root)).toHaveLength(3);
  const before = labelOf(root, 'toggle-randomizer');
  // BACK on Android reaches an open Modal as onRequestClose, not the app's own handler.
  await act(async () => {
    root.root.findByType(Modal).props.onRequestClose();
  });
  expect(menuIds(root)).toEqual([]);
  expect(has(root, 'screen-detail')).toBe(true);
  expect(labelOf(root, 'toggle-randomizer')).toBe(before);
  await longPress(root, main);
  await press(root, 'detail-menu-1');
  expect(menuIds(root)).toEqual([]);
  expect(labelOf(root, 'toggle-randomizer')).not.toBe(before);
  await act(async () => root.unmount());
});

test('a short press on the main button still plays', async () => {
  const { root } = await signedIn();
  await press(root, 'card-m2');
  await press(root, 'play');
  expect(has(root, 'screen-player')).toBe(true);
  expect(menuIds(root)).toEqual([]);
  await act(async () => root.unmount());
});
