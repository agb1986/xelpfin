/**
 * The player screen put together: the engine view, the overlays the remote opens and the
 * buttons on them, against the mock server and the react-native-video mock.
 */
import React from 'react';
import { BackHandler, Modal, type HWEvent } from 'react-native';
import ReactTestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import { MockBackend } from '../../../src/backend/mock/MockBackend';
import type {
  MediaSegment,
  PlaybackPlan,
  PlaybackRequest,
  Session,
} from '../../../src/backend/types';
import type { DeviceCapabilities } from '../../../src/player/capabilities';
import { BASELINE_CAPABILITIES } from '../../../src/player/capabilities';
import type { RandomizerState } from '../../../src/state/randomizer';
import { DEFAULT_SETTINGS, type Settings } from '../../../src/state/settings';
import { PlayerScreen } from '../../../src/ui/screens/PlayerScreen';
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

const mockNav = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  reset: jest.fn(),
};
jest.mock('../../../src/state/navigation', () => ({
  ...jest.requireActual('../../../src/state/navigation'),
  useNavigation: () => mockNav,
  useIsActive: () => true,
}));

let mockRandomizer: RandomizerState = { series: [], played: [], history: [] };
jest.mock('../../../src/state/randomizer', () => ({
  ...jest.requireActual('../../../src/state/randomizer'),
  useRandomizer: () => ({
    state: mockRandomizer,
    list: {
      get: () => mockRandomizer,
      update: (fn: (s: RandomizerState) => RandomizerState) => {
        mockRandomizer = fn(mockRandomizer);
      },
    },
  }),
}));

/** Every mounted handler gets each key, as on the device; the pickers register one too. */
const mockKeyHandlers = new Set<{ current: (evt: HWEvent) => void }>();
jest.mock('react-native/Libraries/Components/TV/useTVEventHandler', () => {
  const { useEffect, useRef } = jest.requireActual('react');
  function useTVEventHandler(fn: (evt: HWEvent) => void) {
    const handler = useRef(fn);
    handler.current = fn;
    useEffect(() => {
      mockKeyHandlers.add(handler);
      return () => {
        mockKeyHandlers.delete(handler);
      };
    }, []);
  }
  return { __esModule: true, default: useTVEventHandler };
});

beforeAll(warmUpReactNative, WARM_UP_TIMEOUT_MS);

const SESSION: Session = {
  server: { id: 'mock-server', name: 'Mock', url: 'http://mock.local:8096' },
  userId: 'u1',
  userName: 'xelpfin',
  accessToken: 'tok-u1',
  isAdmin: true,
};

/** The mock server with two audio tracks, an embedded subtitle and an intro on every item. */
class RichBackend extends MockBackend {
  failPlayback = false;
  async playback(
    req: PlaybackRequest,
    caps: DeviceCapabilities,
  ): Promise<PlaybackPlan> {
    if (this.failPlayback) {
      throw new Error('playback failed');
    }
    const plan = await super.playback(req, caps);
    return {
      ...plan,
      audioTracks: [
        ...plan.audioTracks,
        {
          index: 2,
          label: 'Commentary - English - AAC - Stereo',
          language: 'eng',
          codec: 'aac',
          isDefault: false,
        },
      ],
      subtitleTracks: [
        {
          index: 3,
          label: 'English',
          language: 'eng',
          codec: 'subrip',
          isDefault: false,
          isForced: false,
          delivery: 'embedded',
          containerPosition: 0,
        },
      ],
    };
  }
  async mediaSegments(): Promise<MediaSegment[]> {
    return [{ kind: 'intro', startMs: 0, endMs: 30_000 }];
  }
}

const flush = async () => {
  await act(async () => {
    await new Promise<void>(r => setTimeout(r, 0));
  });
};
const has = (root: Renderer, id: string) =>
  root.root.findAll(n => n.props.testID === id).length > 0;
function byId(root: Renderer, id: string): ReactTestInstance {
  const all = root.root.findAll(
    n => n.props.testID === id && typeof n.type !== 'string',
  );
  if (!all.length) {
    throw new Error(`no element with testID ${id}`);
  }
  return all[0];
}
const press = async (root: Renderer, id: string) => {
  await act(async () => {
    byId(root, id).props.onPress();
  });
  await flush();
};
const pickerOpen = (root: Renderer, id: string) =>
  root.root
    .findAllByType(Modal)
    .some(
      m => m.props.visible && m.findAll(n => n.props.testID === id).length > 0,
    );
const key = (eventType: string) =>
  act(() =>
    mockKeyHandlers.forEach(h =>
      h.current({ eventType, eventKeyAction: 1 } as HWEvent),
    ),
  );

let listeners: (() => boolean)[];
const pressBack = () => {
  let handled = false;
  act(() => {
    handled = [...listeners].reverse().some(fn => fn());
  });
  return handled;
};

async function open(
  props: { itemId?: string; shuffle?: boolean } = {},
  settings: Partial<Settings> = {},
  failPlayback = false,
) {
  const backend = new RichBackend(SESSION);
  backend.failPlayback = failPlayback;
  mockApp = {
    backend,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    platform: testPlatform(),
    capabilities: async () => BASELINE_CAPABILITIES,
  };
  let root!: Renderer;
  await act(async () => {
    root = ReactTestRenderer.create(
      <PlayerScreen
        itemId={props.itemId ?? 'e2'}
        startPositionMs={5000}
        shuffle={props.shuffle}
      />,
    );
  });
  await flush();
  await flush();
  mounted.push(root);
  return { root, backend };
}
/** Unmounted after each test, so the player's intervals do not keep Jest from exiting. */
let mounted: Renderer[] = [];

/** The engine reports the stream loaded and playing at `atS` seconds. */
async function play(root: Renderer, atS = 5, durationS = 40) {
  const video = byId(root, 'video');
  await act(async () => {
    video.props.onLoad({ duration: durationS });
    video.props.onProgress({ currentTime: atS, playableDuration: 20 });
  });
  await flush();
}

describe('PlayerScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRandomizer = { series: ['s1'], played: [], history: [] };
    listeners = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, fn) => {
      listeners.push(fn as () => boolean);
      return {
        remove: () =>
          listeners.splice(listeners.indexOf(fn as () => boolean), 1),
      };
    });
  });
  afterEach(() => {
    act(() => mounted.forEach(r => r.unmount()));
    mounted = [];
    jest.restoreAllMocks();
  });

  it('plays the item with the controls, debug panel and skip button up', async () => {
    const { root, backend } = await open({}, { showDebugOverlay: true });
    expect(has(root, 'player')).toBe(true);
    expect(has(root, 'video')).toBe(true);
    await play(root);
    for (const id of [
      'player-overlay',
      'player-position',
      'player-debug',
      'player-skip',
      'player-playpause',
      'player-prev-episode',
      'player-next-episode',
      'player-rew',
      'player-ffwd',
      'player-audio',
      'player-subtitles',
    ]) {
      expect([id, has(root, id)]).toEqual([id, true]);
    }
    expect(backend.reports.map(r => r.type)).toEqual(['start']);
    await press(root, 'player-skip');
    expect(backend.reports.at(-1)?.report.positionMs).toBe(30_000);
    // The skip leaves the seek panel up; menu brings the controls back.
    key('menu');
    await press(root, 'player-playpause');
    expect(byId(root, 'video').props.paused).toBe(true);
    await press(root, 'player-rew');
    await press(root, 'player-ffwd');
  });

  it('chooses audio and subtitle tracks from the pickers', async () => {
    const { root } = await open();
    await play(root);
    await press(root, 'player-audio');
    expect(pickerOpen(root, 'pick-audio')).toBe(true);
    await press(root, 'pick-audio-1');
    expect(pickerOpen(root, 'pick-audio')).toBe(false);
    await press(root, 'player-subtitles');
    expect(pickerOpen(root, 'pick-subtitle')).toBe(true);
    await press(root, 'pick-subtitle-1');
    await flush();
    const video = byId(root, 'video');
    expect(video.props.selectedAudioTrack).toEqual({ type: 'index', value: 1 });
    expect(video.props.selectedTextTrack).toEqual({ type: 'index', value: 0 });
  });

  it('opens the scene navigator with Up and the episode reel with Down', async () => {
    const { root } = await open();
    // Long enough for the navigator's evenly spaced marks.
    await play(root, 5, 3600);
    key('up');
    expect(has(root, 'player-scenes')).toBe(true);
    await press(root, 'player-scene-0');
    expect(has(root, 'player-scenes')).toBe(false);
    key('down');
    expect(has(root, 'player-episodes')).toBe(true);
    await press(root, 'player-episode-0');
    expect(mockNav.replace).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'e3' }),
    );
  });

  it('shows the seek panel for a hidden-controls seek and the pending target', async () => {
    const { root } = await open();
    await play(root);
    expect(pressBack()).toBe(true);
    expect(has(root, 'player-overlay')).toBe(false);
    expect(has(root, 'player-skip-hint')).toBe(true);
    key('right');
    expect(has(root, 'player-overlay')).toBe(true);
    expect(has(root, 'player-pending')).toBe(true);
    expect(has(root, 'player-playpause')).toBe(false);
  });

  it('skips with select on the surface, then asks before leaving', async () => {
    const { root, backend } = await open();
    await play(root);
    expect(pressBack()).toBe(true);
    await press(root, 'player-surface');
    expect(backend.reports.at(-1)?.report.positionMs).toBe(30_000);
    await press(root, 'player-surface');
    expect(has(root, 'player-playpause')).toBe(true);
    expect(pressBack()).toBe(true);
    expect(pressBack()).toBe(false);
  });

  it('shows the exit hint on BACK with nothing left to close', async () => {
    const { root } = await open({ itemId: 'm1' });
    // Past the intro, so BACK has no skip button to dismiss.
    await play(root, 35);
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    expect(pressBack()).toBe(true);
    // Past the window in which a second BACK would leave.
    clock.mockReturnValue(now + 5000);
    expect(pressBack()).toBe(true);
    expect(has(root, 'player-exit-hint')).toBe(true);
  });

  it('moves on to the next episode when the item ends', async () => {
    const { root } = await open();
    await play(root);
    await act(async () => {
      byId(root, 'video').props.onEnd();
    });
    await flush();
    expect(mockNav.replace).toHaveBeenCalledWith({
      name: 'player',
      itemId: 'e3',
      startPositionMs: 0,
    });
  });

  it('skips the intro by itself and offers a random next episode in shuffle mode', async () => {
    const { root, backend } = await open({ shuffle: true });
    await play(root);
    expect(backend.reports.at(-1)?.report.positionMs).toBe(30_000);
    key('menu');
    expect(has(root, 'player-prev-episode')).toBe(false);
    await press(root, 'player-next-episode');
    expect(mockNav.replace).toHaveBeenCalledWith(
      expect.objectContaining({ shuffle: true }),
    );
  });

  it('shows an error with Retry and Back when there is no plan', async () => {
    const { root, backend } = await open({}, {}, true);
    expect(has(root, 'error')).toBe(true);
    await press(root, 'player-back');
    expect(mockNav.back).toHaveBeenCalled();
    backend.failPlayback = false;
    await press(root, 'retry');
    await flush();
    expect(has(root, 'error')).toBe(false);
    expect(has(root, 'video')).toBe(true);
  });
});
