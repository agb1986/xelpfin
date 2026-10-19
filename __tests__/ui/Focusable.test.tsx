import React, { createRef } from 'react';
import { Platform, Text, type View } from 'react-native';
import ReactTestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import { Focusable } from '../../src/ui/components/Focusable';
import {
  NavigationStack,
  useNavigation,
  type Navigation,
  type Route,
} from '../../src/state/navigation';

// The host view that Pressable renders: it carries the Pressability handlers that the native
// topPressIn / topPressOut / topClick events reach.
const host = (root: Renderer, id: string): ReactTestInstance =>
  root.root.findAll(
    n => n.props.testID === id && typeof n.type === 'string',
  )[0];

const event = (target: unknown = {}) => ({
  nativeEvent: {},
  target,
  currentTarget: target,
  stopPropagation: () => undefined,
});

// One physical "select" on react-native-tvos: key down, key up, then the Android click that
// View.onKeyUp performs. On a Fire TV stick (Platform.isTV) Pressability drops the click itself;
// on the emulator it does not, so that is the case worth proving.
async function pressSelect(view: ReactTestInstance) {
  await act(async () => {
    view.props.onPressIn(event());
    view.props.onPressOut(event());
    view.props.onClick(event());
  });
}

const isTV = Object.getOwnPropertyDescriptor(Platform, 'isTV');
beforeAll(() => {
  Object.defineProperty(Platform, 'isTV', {
    configurable: true,
    get: () => false,
  });
});
afterAll(() => {
  if (isTV) {
    Object.defineProperty(Platform, 'isTV', isTV);
  }
});

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

test('one physical press registers once', async () => {
  const onPress = jest.fn();
  let root!: Renderer;
  await act(async () => {
    root = ReactTestRenderer.create(
      <Focusable testID="btn" onPress={onPress}>
        <Text>Play</Text>
      </Focusable>,
    );
  });
  await pressSelect(host(root, 'btn'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('two deliberate presses 200 ms apart register twice', async () => {
  const onPress = jest.fn();
  let root!: Renderer;
  await act(async () => {
    root = ReactTestRenderer.create(
      <Focusable testID="btn" onPress={onPress}>
        <Text>Seek</Text>
      </Focusable>,
    );
  });
  const view = host(root, 'btn');
  await pressSelect(view);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });
  await pressSelect(view);
  expect(onPress).toHaveBeenCalledTimes(2);
});

test('a delivered long press consumes the release, as with Pressable', async () => {
  const onPress = jest.fn();
  const onLongPress = jest.fn();
  let root!: Renderer;
  await act(async () => {
    root = ReactTestRenderer.create(
      <Focusable testID="btn" onPress={onPress} onLongPress={onLongPress}>
        <Text>Hold</Text>
      </Focusable>,
    );
  });
  const view = host(root, 'btn');
  await act(async () => {
    view.props.onPressIn(event());
    jest.advanceTimersByTime(1000);
    view.props.onPressOut(event());
    view.props.onClick(event());
  });
  expect(onLongPress).toHaveBeenCalledTimes(1);
  expect(onPress).not.toHaveBeenCalled();
  // The next short press is a press again.
  await pressSelect(view);
  expect(onPress).toHaveBeenCalledTimes(1);
});

let nav!: Navigation;
const btn = createRef<View>();
function Screen({ route }: { route: Route }) {
  nav = useNavigation();
  return (
    <Focusable ref={btn} testID={`btn-${route.name}`} onPress={() => undefined}>
      <Text>{route.name}</Text>
    </Focusable>
  );
}

test('the element focused last takes focus again when its screen comes back', async () => {
  let root!: Renderer;
  await act(async () => {
    root = ReactTestRenderer.create(
      <NavigationStack
        initial={[{ name: 'home' }]}
        render={r => <Screen route={r} />}
        onBackAtRoot={() => true}
      />,
    );
  });
  const requestTVFocus = jest.fn();
  (btn.current as View & { requestTVFocus: () => void }).requestTVFocus =
    requestTVFocus;
  const home = host(root, 'btn-home');
  await act(async () => {
    home.props.onFocus(event());
  });
  await act(async () => nav.push({ name: 'search' }));
  expect(host(root, 'btn-home').props.focusable).toBe(false);
  await act(async () => {
    nav.back();
  });
  expect(host(root, 'btn-home').props.focusable).toBe(true);
  await act(async () => {
    jest.advanceTimersByTime(0);
  });
  expect(requestTVFocus).toHaveBeenCalledTimes(1);
  // It keeps asking until the element reports focus.
  await act(async () => {
    jest.advanceTimersByTime(80);
  });
  expect(requestTVFocus).toHaveBeenCalledTimes(2);
  await act(async () => {
    host(root, 'btn-home').props.onFocus(event());
    jest.advanceTimersByTime(1000);
  });
  expect(requestTVFocus).toHaveBeenCalledTimes(2);
});
