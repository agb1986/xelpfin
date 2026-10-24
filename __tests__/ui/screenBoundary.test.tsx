import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, {
  act,
  type ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import { ScreenBoundary } from '../../src/ui/components/ScreenBoundary';
import {
  WARM_UP_TIMEOUT_MS,
  warmUpReactNative,
} from '../../test-utils/warmUpReactNative';

beforeAll(warmUpReactNative, WARM_UP_TIMEOUT_MS);

let broken = true;
function Flaky() {
  if (broken) {
    throw new Error('bad item');
  }
  return <Text testID="ok">fine</Text>;
}

test('a screen that throws shows the error view, and Retry renders it again', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const error = jest
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  let root!: Renderer;
  await act(async () => {
    root = ReactTestRenderer.create(
      <ScreenBoundary>
        <Flaky />
      </ScreenBoundary>,
    );
  });
  const has = (id: string) =>
    root.root.findAll(n => n.props.testID === id).length > 0;
  expect(has('error')).toBe(true);
  expect(has('ok')).toBe(false);
  broken = false;
  await act(async () => {
    root.root
      .findAll(n => n.props.testID === 'retry' && typeof n.type !== 'string')[0]
      .props.onPress();
  });
  expect(has('ok')).toBe(true);
  await act(async () => root.unmount());
  warn.mockRestore();
  error.mockRestore();
});
