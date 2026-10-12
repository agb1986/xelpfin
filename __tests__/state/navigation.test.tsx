import React, { useEffect } from 'react';
import { BackHandler, Text } from 'react-native';
import ReactTestRenderer, { act, type ReactTestRenderer as Renderer } from 'react-test-renderer';
import { NavigationStack, useIsActive, useNavigation, type Navigation, type Route } from '../../src/state/navigation';

let nav!: Navigation;
const mounts: string[] = [];

function Probe({ route }: { route: Route }) {
  nav = useNavigation();
  const active = useIsActive();
  useEffect(() => {
    mounts.push(route.name);
  }, [route.name]);
  return <Text testID={`probe-${route.name}`}>{active ? 'active' : 'hidden'}</Text>;
}

const text = (root: Renderer, name: string) => root.root.findByProps({ testID: `probe-${name}` }).props.children;

test('push, back, replace and reset; lower screens stay mounted but inactive', async () => {
  const backSpy = jest.spyOn(BackHandler, 'addEventListener');
  const onRoot = jest.fn(() => true);
  let root!: Renderer;
  await act(async () => {
    root = ReactTestRenderer.create(<NavigationStack initial={[{ name: 'home' }]} render={r => <Probe route={r} />} onBackAtRoot={onRoot} />);
  });
  await act(async () => nav.push({ name: 'search' }));
  expect(text(root, 'home')).toBe('hidden');
  expect(text(root, 'search')).toBe('active');
  expect(nav.depth).toBe(2);
  expect(mounts).toEqual(['home', 'search']);

  // The hardware back handler pops, and calls onBackAtRoot at the root.
  const handler = backSpy.mock.calls[backSpy.mock.calls.length - 1][1] as () => boolean;
  await act(async () => {
    expect(handler()).toBe(true);
  });
  expect(text(root, 'home')).toBe('active');
  expect(root.root.findAllByProps({ testID: 'probe-search' })).toHaveLength(0);
  await act(async () => {
    handler();
  });
  expect(onRoot).toHaveBeenCalledTimes(1);

  await act(async () => nav.replace({ name: 'settings' }));
  expect(root.root.findAllByProps({ testID: 'probe-home' })).toHaveLength(0);
  await act(async () => nav.reset([{ name: 'servers' }, { name: 'search' }]));
  expect(text(root, 'servers')).toBe('hidden');
  expect(nav.depth).toBe(2);
  await act(async () => root.unmount());
});
