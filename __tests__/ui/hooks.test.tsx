import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ResponseCache } from '../../src/backend/cache';
import { CachedBackend } from '../../src/backend/CachedBackend';
import type { Backend } from '../../src/backend/Backend';
import { MockBackend, MOCK_SERVER } from '../../src/backend/mock/MockBackend';
import { useAsync, useRefreshOnReturn } from '../../src/ui/hooks';

function Probe({
  load,
  initial,
}: {
  load: () => Promise<string>;
  initial?: () => string | undefined;
}) {
  const s = useAsync(load, [], { initial });
  return <Text testID="out">{`${s.status}:${s.data ?? ''}`}</Text>;
}

const text = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findByProps({ testID: 'out' }).props.children as string;

describe('useAsync', () => {
  it('starts loading without data when nothing is cached', async () => {
    let release!: (v: string) => void;
    const load = () => new Promise<string>(r => (release = r));
    let r!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      r = ReactTestRenderer.create(<Probe load={load} />);
    });
    expect(text(r)).toBe('loading:');
    await act(async () => release('net'));
    expect(text(r)).toBe('ready:net');
  });

  it('shows the initial value at once and replaces it when the loader resolves', async () => {
    let release!: (v: string) => void;
    const load = jest.fn(() => new Promise<string>(r => (release = r)));
    let r!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      r = ReactTestRenderer.create(
        <Probe load={load} initial={() => 'cached'} />,
      );
    });
    expect(text(r)).toBe('loading:cached');
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => release('net'));
    expect(text(r)).toBe('ready:net');
  });
});

function ReturnProbe({
  active,
  backend,
  refresh,
}: {
  active: boolean;
  backend: Backend;
  refresh: () => void;
}) {
  useRefreshOnReturn(active, backend, refresh);
  return null;
}

describe('useRefreshOnReturn', () => {
  const session = {
    server: MOCK_SERVER,
    userId: 'u1',
    userName: 'u1',
    accessToken: 't',
    isAdmin: true,
  };
  const macrotask = () => new Promise<void>(r => setTimeout(r, 0));

  it('refreshes when the screen becomes active again, not on mount or when leaving', async () => {
    const backend = new CachedBackend(
      new MockBackend(session),
      new ResponseCache(),
    );
    const refresh = jest.fn();
    let r!: ReactTestRenderer.ReactTestRenderer;
    const show = (active: boolean) =>
      act(async () => {
        const el = (
          <ReturnProbe active={active} backend={backend} refresh={refresh} />
        );
        if (r) {
          r.update(el);
        } else {
          r = ReactTestRenderer.create(el);
        }
      });
    await show(true);
    await show(false);
    expect(refresh).not.toHaveBeenCalled();
    await show(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('leaves the return refresh to the change notice while a change is in flight', async () => {
    const inner = new MockBackend(session);
    let release!: () => void;
    inner.reportStop = () => new Promise<void>(res => (release = res));
    const backend = new CachedBackend(inner, new ResponseCache());
    const refresh = jest.fn();
    let r!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      r = ReactTestRenderer.create(
        <ReturnProbe active={false} backend={backend} refresh={refresh} />,
      );
    });
    const sent = backend.reportStop({
      plan: {
        itemId: 'm1',
        mediaSourceId: 'm1',
        playSessionId: 'p',
        method: 'DirectPlay',
      },
      positionMs: 0,
      isPaused: false,
    });
    await act(async () =>
      r.update(<ReturnProbe active backend={backend} refresh={refresh} />),
    );
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      release();
      await sent;
      await macrotask();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    // A change while the screen is covered is picked up by the next return instead.
    await act(async () =>
      r.update(
        <ReturnProbe active={false} backend={backend} refresh={refresh} />,
      ),
    );
    await act(async () => {
      await backend.setPlayed('e2', true);
      await macrotask();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => r.unmount());
  });
});
