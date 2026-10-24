import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { MockBackend } from '../../../src/backend/mock/MockBackend';
import type {
  MediaSegment,
  PlaybackPlan,
  PlaybackRequest,
  Session,
} from '../../../src/backend/types';
import type { DeviceCapabilities } from '../../../src/player/capabilities';
import { BASELINE_CAPABILITIES } from '../../../src/player/capabilities';
import type { PlayerEngine } from '../../../src/player/PlayerEngine';
import type { DisplayControl } from '../../../src/platform/types';
import { DEFAULT_SETTINGS, type Settings } from '../../../src/state/settings';
import {
  MODE_SETTLE_MS,
  REPORT_EVERY_MS,
  usePlaybackSession,
} from '../../../src/ui/player/usePlaybackSession';
import { testPlatform } from '../../../test-utils/testPlatform';
import {
  WARM_UP_TIMEOUT_MS,
  warmUpReactNative,
} from '../../../test-utils/warmUpReactNative';

let mockApp: {
  backend: MockBackend;
  settings: Settings;
  platform: ReturnType<typeof testPlatform>;
  capabilities(): Promise<DeviceCapabilities>;
};
jest.mock('../../../src/state/AppState', () => ({
  useApp: () => mockApp,
  useBackend: () => mockApp.backend,
}));

beforeAll(warmUpReactNative, WARM_UP_TIMEOUT_MS);

const SESSION: Session = {
  server: { id: 'mock-server', name: 'Mock', url: 'http://mock.local:8096' },
  userId: 'u1',
  userName: 'xelpfin',
  accessToken: 'tok-u1',
  isAdmin: true,
};

/** The mock server with a 23.976 fps video, an intro segment and recorded plan requests. */
class FilmBackend extends MockBackend {
  requests: PlaybackRequest[] = [];
  failNext = false;
  async playback(
    req: PlaybackRequest,
    caps: DeviceCapabilities,
  ): Promise<PlaybackPlan> {
    this.requests.push(req);
    if (this.failNext) {
      this.failNext = false;
      throw new Error('playback failed');
    }
    const plan = await super.playback(req, caps);
    return { ...plan, videoFrameRate: 23.976, videoWidth: 1920 };
  }
  async mediaSegments(): Promise<MediaSegment[]> {
    return [{ kind: 'intro', startMs: 0, endMs: 30_000 }];
  }
}

const display = (switched: boolean) => ({
  modes: jest.fn(async () => ({
    modes: [
      { id: 1, width: 1920, height: 1080, refreshRate: 60 },
      { id: 2, width: 1920, height: 1080, refreshRate: 24 },
    ],
    activeModeId: 1,
  })),
  setPreferredMode: jest.fn(async (_id: number) => switched),
});

const engine = (inStream: boolean): PlayerEngine => ({
  name: 'fake',
  View: (() => null) as unknown as PlayerEngine['View'],
  canSwitchInStream: () => inStream,
});

type Session_ = ReturnType<typeof usePlaybackSession>;

function setup(
  opts: {
    itemId?: string;
    display?: DisplayControl;
    inStream?: boolean;
    settings?: Partial<Settings>;
  } = {},
) {
  const backend = new FilmBackend(SESSION);
  mockApp = {
    backend,
    settings: {
      ...DEFAULT_SETTINGS,
      refreshRateMatch: 'frameRate',
      ...opts.settings,
    },
    platform: { ...testPlatform(), display: opts.display },
    capabilities: async () => BASELINE_CAPABILITIES,
  };
  const out = { current: undefined as unknown as Session_ };
  const eng = engine(opts.inStream ?? true);
  function Probe() {
    out.current = usePlaybackSession(opts.itemId ?? 'm2', 5000, eng);
    return null;
  }
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(<Probe />);
  });
  mounted.push(r);
  return { out, backend, renderer: r };
}
/** Unmounted after each test, so the progress interval does not keep Jest from exiting. */
let mounted: ReactTestRenderer.ReactTestRenderer[] = [];

/** Lets the mock backend's promises settle; works with real and fake timers alike. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
const types = (b: MockBackend) => b.reports.map(r => r.type);

describe('usePlaybackSession', () => {
  afterEach(() => {
    act(() => mounted.forEach(r => r.unmount()));
    mounted = [];
    jest.useRealTimers();
  });

  it('loads the item, its segments and a plan, leaving the audio to the server', async () => {
    const { out, backend } = setup();
    expect(out.current.buffering).toBe(true);
    await settle();
    expect(out.current.item?.id).toBe('m2');
    expect(out.current.segments).toHaveLength(1);
    expect(out.current.plan?.itemId).toBe('m2');
    expect(out.current.audio).toBe(1);
    expect(out.current.subtitle).toBe(-1);
    expect(out.current.position).toBe(5000);
    expect(backend.requests[0]).toMatchObject({
      itemId: 'm2',
      startPositionMs: 5000,
      audioStreamIndex: undefined,
      subtitleStreamIndex: -1,
    });
  });

  it('reports start on load, progress on pause and stop on unmount', async () => {
    const { out, backend, renderer } = setup();
    await settle();
    // Nothing is reported before the engine has loaded the stream.
    act(() => out.current.reportProgress());
    expect(backend.reports).toEqual([]);
    act(() => out.current.viewProps.onLoad!({ durationMs: 40_000 }));
    act(() =>
      out.current.viewProps.onProgress!({ positionMs: 9000, bufferedMs: 20_000 }),
    );
    expect(out.current.positionRef.current).toBe(9000);
    expect(out.current.duration).toBe(40_000);
    expect(out.current.buffering).toBe(false);
    act(() => out.current.togglePaused());
    expect(out.current.paused).toBe(true);
    act(() => out.current.reportProgress());
    act(() => renderer.unmount());
    await settle();
    expect(types(backend)).toEqual(['start', 'progress', 'progress', 'stop']);
    expect(backend.reports[1].report.isPaused).toBe(true);
    expect(backend.reports[3].report.positionMs).toBe(9000);
    expect(backend.data.movies[1].userData?.played).toBe(false);
  });

  it('reports progress every REPORT_EVERY_MS once started', async () => {
    jest.useFakeTimers();
    const { out, backend } = setup();
    await settle();
    act(() => out.current.viewProps.onLoad!({ durationMs: 40_000 }));
    act(() => {
      jest.advanceTimersByTime(REPORT_EVERY_MS);
    });
    await settle();
    expect(types(backend)).toEqual(['start', 'progress']);
  });

  it('marks the item played when it ends, and only ends once', async () => {
    const { out, backend } = setup();
    await settle();
    act(() => out.current.viewProps.onLoad!({ durationMs: 40_000 }));
    let first = false;
    let second = true;
    act(() => {
      first = out.current.finish();
      second = out.current.finish();
    });
    expect([first, second]).toEqual([true, false]);
    expect(out.current.hasEnded()).toBe(true);
    await settle();
    expect(types(backend)).toEqual(['start', 'stop']);
    expect(backend.reports[1].report.positionMs).toBe(40_000);
    expect(backend.data.movies[1].userData?.played).toBe(true);
  });

  it('switches tracks inside the stream when the engine can', async () => {
    const { out, backend } = setup({ inStream: true });
    await settle();
    act(() => out.current.viewProps.onLoad!({ durationMs: 40_000 }));
    act(() => out.current.chooseAudio(1));
    act(() => out.current.chooseAudio(2));
    act(() => out.current.chooseSubtitle(3));
    await settle();
    expect(out.current.audio).toBe(2);
    expect(out.current.subtitle).toBe(3);
    expect(backend.requests).toHaveLength(1);
    expect(types(backend)).toEqual(['start', 'progress', 'progress']);
  });

  it('asks for a new plan at the current position when the engine cannot switch', async () => {
    const { out, backend } = setup({ inStream: false });
    await settle();
    act(() => out.current.viewProps.onLoad!({ durationMs: 40_000 }));
    act(() =>
      out.current.viewProps.onProgress!({ positionMs: 12_000, bufferedMs: 0 }),
    );
    act(() => out.current.chooseSubtitle(3));
    expect(out.current.plan).toBeUndefined();
    await settle();
    expect(backend.requests[1]).toMatchObject({
      startPositionMs: 12_000,
      audioStreamIndex: 1,
      subtitleStreamIndex: 3,
    });
    expect(out.current.subtitle).toBe(3);
    act(() => out.current.chooseAudio(2));
    await settle();
    expect(backend.requests[2]).toMatchObject({
      audioStreamIndex: 2,
      subtitleStreamIndex: 3,
    });
    // The first plan's session was stopped before the new one was asked for.
    expect(types(backend)).toEqual(['start', 'stop']);
  });

  it('shows a plan error and retries from where it was', async () => {
    const { out, backend } = setup();
    backend.failNext = true;
    await settle();
    expect(out.current.error).toBeInstanceOf(Error);
    expect(out.current.plan).toBeUndefined();
    act(() => {
      out.current.retry();
    });
    await settle();
    expect(out.current.error).toBeUndefined();
    expect(out.current.plan).toBeDefined();
    expect(backend.requests[1].startPositionMs).toBe(5000);
  });

  it('shows an error for an item the server does not have, and for engine failures', async () => {
    const missing = setup({ itemId: 'nope' });
    await settle();
    expect(missing.out.current.error).toBeDefined();
    const { out } = setup();
    await settle();
    act(() => out.current.viewProps.onError!('decoder failed'));
    expect(out.current.error).toBeDefined();
  });

  it('keeps the display mode when nothing fits, and clears the preference on exit', async () => {
    const d = display(false);
    const { out, renderer } = setup({ display: d, settings: {} });
    await settle();
    expect(out.current.plan).toBeDefined();
    expect(d.setPreferredMode).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
    expect(d.setPreferredMode).toHaveBeenLastCalledWith(0);
  });

  it('switches the display mode for the first plan only and waits for the TV to settle', async () => {
    jest.useFakeTimers();
    const d = display(true);
    const { out, renderer } = setup({ display: d, inStream: false });
    await settle();
    expect(d.setPreferredMode).toHaveBeenCalledWith(2);
    // Black while HDMI renegotiates.
    expect(out.current.plan).toBeUndefined();
    act(() => {
      jest.advanceTimersByTime(MODE_SETTLE_MS);
    });
    await settle();
    expect(out.current.plan).toBeDefined();
    act(() => out.current.chooseSubtitle(3));
    await settle();
    expect(out.current.plan).toBeDefined();
    expect(d.modes).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
    expect(d.setPreferredMode).toHaveBeenLastCalledWith(0);
    expect(d.setPreferredMode).toHaveBeenCalledTimes(2);
  });

  it('does not touch the display with matching off', async () => {
    const d = display(true);
    const { out, renderer } = setup({
      display: d,
      settings: { refreshRateMatch: 'off' },
    });
    await settle();
    expect(out.current.plan).toBeDefined();
    expect(d.modes).not.toHaveBeenCalled();
    act(() => renderer.unmount());
    // Clearing a preference that was never set is a no-op on the device.
    expect(d.setPreferredMode).toHaveBeenCalledWith(0);
  });
});
