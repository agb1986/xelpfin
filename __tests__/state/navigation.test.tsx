import React, { useEffect } from 'react';
import { BackHandler, Text } from 'react-native';
import ReactTestRenderer, {
  act,
  type ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import {
  MAX_MOUNTED_SCREENS,
  NavigationStack,
  useIsActive,
  useNavigation,
  useScreenState,
  type Navigation,
  type Route,
  type ScreenState,
} from '../../src/state/navigation';
import {
  WARM_UP_TIMEOUT_MS,
  warmUpReactNative,
} from '../../test-utils/warmUpReactNative';

beforeAll(warmUpReactNative, WARM_UP_TIMEOUT_MS);

let nav!: Navigation;
const mounts: string[] = [];
/** The screen state seen by the most recent render of each route, by probe id. */
const screens = new Map<string, ScreenState>();

const id = (route: Route) =>
  route.name === 'detail' ? `detail-${route.itemId}` : route.name;

function Probe({ route }: { route: Route }) {
  nav = useNavigation();
  const active = useIsActive();
  screens.set(id(route), useScreenState());
  useEffect(() => {
    mounts.push(id(route));
  }, [route]);
  return (
    <Text testID={`probe-${id(route)}`}>{active ? 'active' : 'hidden'}</Text>
  );
}

const text = (root: Renderer, name: string) =>
  root.root.findByProps({ testID: `probe-${name}` }).props.children;
const mounted = (root: Renderer, name: string) =>
  root.root.findAllByProps({ testID: `probe-${name}` }).length > 0;

async function mount(initial: Route[], onBackAtRoot?: () => boolean) {
  let root!: Renderer;
  await act(async () => {
    root = ReactTestRenderer.create(
      <NavigationStack
        initial={initial}
        render={r => <Probe route={r} />}
        onBackAtRoot={onBackAtRoot}
      />,
    );
  });
  return root;
}

const pop = () =>
  act(async () => {
    nav.back();
  });

const lastBackHandler = (spy: jest.SpyInstance) =>
  spy.mock.calls[spy.mock.calls.length - 1][1] as () => boolean;

beforeEach(() => {
  mounts.length = 0;
  screens.clear();
});

test('push, back, replace and reset; lower screens stay mounted but inactive', async () => {
  const backSpy = jest.spyOn(BackHandler, 'addEventListener');
  const onRoot = jest.fn(() => true);
  const root = await mount([{ name: 'home' }], onRoot);
  await act(async () => nav.push({ name: 'search' }));
  expect(text(root, 'home')).toBe('hidden');
  expect(text(root, 'search')).toBe('active');
  expect(nav.depth).toBe(2);
  expect(mounts).toEqual(['home', 'search']);

  // The hardware back handler pops, and calls onBackAtRoot at the root.
  const handler = lastBackHandler(backSpy);
  await act(async () => {
    expect(handler()).toBe(true);
  });
  expect(text(root, 'home')).toBe('active');
  expect(mounted(root, 'search')).toBe(false);
  await act(async () => {
    handler();
  });
  expect(onRoot).toHaveBeenCalledTimes(1);

  await act(async () => nav.replace({ name: 'settings' }));
  expect(mounted(root, 'home')).toBe(false);
  await act(async () => nav.reset([{ name: 'servers' }, { name: 'search' }]));
  expect(text(root, 'servers')).toBe('hidden');
  expect(nav.depth).toBe(2);
  await act(async () => root.unmount());
});

test('screens deeper than the cap are unmounted and mounted again on pop', async () => {
  expect(MAX_MOUNTED_SCREENS).toBe(4);
  const root = await mount([{ name: 'home' }]);
  const chain: Route[] = [
    {
      name: 'library',
      library: { id: 'l', name: 'L', collectionType: 'movies' },
    },
    { name: 'detail', itemId: 's1' },
    { name: 'detail', itemId: 'e1' },
    { name: 'detail', itemId: 's2' },
    { name: 'detail', itemId: 'e2' },
  ];
  for (const route of chain) {
    await act(async () => nav.push(route));
  }
  // Six deep: only the top four are mounted, the rest keep their place in the stack.
  expect(nav.depth).toBe(6);
  expect(mounted(root, 'home')).toBe(false);
  expect(mounted(root, 'library')).toBe(false);
  expect(mounted(root, 'detail-s1')).toBe(true);
  expect(text(root, 'detail-s1')).toBe('hidden');
  expect(text(root, 'detail-e2')).toBe('active');
  expect(mounts).toEqual([
    'home',
    'library',
    'detail-s1',
    'detail-e1',
    'detail-s2',
    'detail-e2',
  ]);

  // Popping brings the next deeper screen back, with its route, until the root is visible.
  await pop();
  expect(mounted(root, 'library')).toBe(true);
  expect(text(root, 'library')).toBe('hidden');
  expect(mounted(root, 'home')).toBe(false);
  expect(mounts.slice(6)).toEqual(['library']);
  await pop();
  expect(mounted(root, 'home')).toBe(true);
  expect(mounts.slice(6)).toEqual(['library', 'home']);
  for (let i = 0; i < 3; i++) {
    await pop();
  }
  expect(text(root, 'home')).toBe('active');
  expect(nav.depth).toBe(1);
  expect(nav.back()).toBe(false);
  await act(async () => root.unmount());
});

test('a remounted screen gets the same lastFocused it had before', async () => {
  const root = await mount([{ name: 'home' }]);
  const home = screens.get('home')!;
  const remembered = { ref: { current: null }, key: 'card-3' };
  home.lastFocused.current = remembered;

  for (const name of ['library', 'search', 'settings', 'randomizerHistory']) {
    await act(async () => nav.push({ name } as Route));
  }
  expect(mounted(root, 'home')).toBe(false);
  await pop();
  expect(mounted(root, 'home')).toBe(true);
  expect(mounts.filter(m => m === 'home')).toHaveLength(2);
  // Same ref object, so Focusable can restore by the remembered testID.
  const again = screens.get('home')!;
  expect(again.lastFocused).toBe(home.lastFocused);
  expect(again.lastFocused.current).toBe(remembered);
  expect(again.active).toBe(false);

  for (let i = 0; i < 3; i++) {
    await pop();
  }
  expect(screens.get('home')!.active).toBe(true);
  expect(screens.get('home')!.lastFocused.current).toBe(remembered);
  await act(async () => root.unmount());
});

test('pushing a detail route already in the stack pops back to it', async () => {
  const root = await mount([{ name: 'home' }]);
  await act(async () => nav.push({ name: 'detail', itemId: 'series' }));
  const series = screens.get('detail-series')!;
  series.lastFocused.current = { key: 'episode-2' };
  await act(async () => nav.push({ name: 'detail', itemId: 'episode' }));
  expect(nav.depth).toBe(3);

  // Episode -> its series: back to the existing series screen, still mounted, same state.
  await act(async () => nav.push({ name: 'detail', itemId: 'series' }));
  expect(nav.depth).toBe(2);
  expect(text(root, 'detail-series')).toBe('active');
  expect(mounted(root, 'detail-episode')).toBe(false);
  expect(screens.get('detail-series')!.lastFocused).toBe(series.lastFocused);
  expect(screens.get('detail-series')!.lastFocused.current).toEqual({
    key: 'episode-2',
  });
  expect(mounts).toEqual(['home', 'detail-series', 'detail-episode']);

  // A different item still stacks; a non-detail route is never collapsed.
  await act(async () => nav.push({ name: 'detail', itemId: 'other' }));
  await act(async () => nav.push({ name: 'search' }));
  await act(async () => nav.push({ name: 'search' }));
  expect(nav.depth).toBe(5);

  // Collapsing also reaches entries below the mount cap.
  await act(async () => nav.push({ name: 'detail', itemId: 'series' }));
  expect(nav.depth).toBe(2);
  expect(text(root, 'detail-series')).toBe('active');
  expect(text(root, 'home')).toBe('hidden');
  await act(async () => root.unmount());
});

test('the player is unmounted when popped and screens below it are not', async () => {
  const root = await mount([{ name: 'home' }]);
  await act(async () => nav.push({ name: 'detail', itemId: 'movie' }));
  await act(async () => nav.push({ name: 'player', itemId: 'movie' }));
  expect(text(root, 'player')).toBe('active');
  expect(text(root, 'detail-movie')).toBe('hidden');

  await pop();
  expect(mounted(root, 'player')).toBe(false);
  expect(text(root, 'detail-movie')).toBe('active');
  expect(mounts.filter(m => m === 'detail-movie')).toHaveLength(1);

  // The same holds when the player sits on a chain deeper than the cap.
  for (const itemId of ['a', 'b', 'c']) {
    await act(async () => nav.push({ name: 'detail', itemId }));
  }
  await act(async () => nav.push({ name: 'player', itemId: 'c' }));
  expect(nav.depth).toBe(6);
  expect(mounted(root, 'home')).toBe(false);
  expect(mounted(root, 'detail-movie')).toBe(false);
  await pop();
  expect(mounted(root, 'player')).toBe(false);
  expect(text(root, 'detail-c')).toBe('active');
  expect(mounted(root, 'detail-movie')).toBe(true);
  await act(async () => root.unmount());
});

test('the hardware BACK key pops through unmounted screens and stops at the root', async () => {
  const backSpy = jest.spyOn(BackHandler, 'addEventListener');
  const onRoot = jest.fn(() => false);
  const root = await mount([{ name: 'home' }], onRoot);
  for (const name of ['library', 'search', 'settings', 'randomizerHistory']) {
    await act(async () => nav.push({ name } as Route));
  }
  const handler = lastBackHandler(backSpy);
  expect(mounted(root, 'home')).toBe(false);
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      expect(handler()).toBe(true);
    });
  }
  expect(text(root, 'home')).toBe('active');
  expect(nav.depth).toBe(1);
  await act(async () => {
    expect(handler()).toBe(false);
  });
  expect(onRoot).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});
