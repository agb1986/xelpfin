/**
 * The settings screen against the mock backend: every option picker stores its choice, the
 * toggles flip, the data actions ask for a second press and report what they did, and the
 * account rows sign out to the right screen.
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
import { MemoryStore, type PlatformServices } from '../../src/platform/types';
import { resetLocalLists } from '../../src/state/localLists';
import {
  BITRATE_CHOICES,
  DEFAULT_SETTINGS,
  LANGUAGE_CHOICES,
  REFRESH_RATE_CHOICES,
  SUBTITLE_BACKGROUND_CHOICES,
  SUBTITLE_CHOICES,
  SUBTITLE_COLOR_CHOICES,
  SUBTITLE_LANGUAGE_CHOICES,
  SUBTITLE_SIZE_CHOICES,
  type Settings,
} from '../../src/state/settings';
import { testPlatform } from '../../test-utils/testPlatform';

const SESSION: Session = {
  server: { id: 'mock-server', name: 'Mock Server', url: 'http://mock.local' },
  userId: 'u1',
  userName: 'xelpfin',
  accessToken: 'tok-u1',
  isAdmin: true,
};
const RANDOMIZER_KEY = 'xelpfin.randomizer.mock-server.u1';
const HIDDEN_KEY = 'xelpfin.hidden-next-up.mock-server.u1';

class TrackingConnector extends MockConnector {
  backend?: MockBackend;
  open(session: Session) {
    this.backend = new MockBackend(session);
    return this.backend;
  }
}

const flush = async (ms = 0) => {
  await act(async () => {
    await new Promise<void>(r => setTimeout(r, ms));
  });
};

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
/** Whether the picker with this testID is shown (a closed Modal may keep its children). */
const pickerOpen = (root: Renderer, id: string) =>
  root.root
    .findAllByType(Modal)
    .some(
      m => m.props.visible && m.findAll(n => n.props.testID === id).length > 0,
    );
/**
 * Retries a check while timers and promises run, until it passes or the deadline goes by, as in
 * App.test: how many flushes the app needs to reach a state is not part of its contract.
 */
async function waitFor<T>(
  check: () => T | Promise<T>,
  timeoutMs = 2000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (e) {
      if (Date.now() > deadline) {
        throw e;
      }
    }
    await flush(5);
  }
}
const shown = (root: Renderer, id: string) =>
  waitFor(() => expect(has(root, id)).toBe(true));
const press = async (root: Renderer, id: string) => {
  const target = await waitFor(() => byId(root, id));
  await act(async () => {
    target.props.onPress();
  });
  await flush();
};
const text = (node: ReactTestInstance): string =>
  node
    .findAllByType('Text' as never)
    .flatMap(t => React.Children.toArray(t.props.children))
    .join('');

async function openSettings(
  opts: {
    platform?: (store: MemoryStore) => PlatformServices;
    seed?: Record<string, unknown>;
  } = {},
) {
  const store = new MemoryStore();
  await store.set('xelpfin.session', JSON.stringify(SESSION));
  for (const [k, v] of Object.entries(opts.seed ?? {})) {
    await store.set(k, JSON.stringify(v));
  }
  const connector = new TrackingConnector();
  const platform = (opts.platform ?? testPlatform)(store);
  let root!: Renderer;
  await act(async () => {
    root = ReactTestRenderer.create(
      <App platform={platform} connector={connector} />,
    );
  });
  await flush();
  await shown(root, 'screen-home');
  await press(root, 'tab-settings');
  await shown(root, 'screen-settings');
  return { root, store, backend: connector.backend! };
}

const stored = async (store: MemoryStore): Promise<Settings> =>
  JSON.parse((await store.get('xelpfin.settings'))!);

/** A platform that can switch display modes, so the refresh rate row is offered. */
const withDisplay = (store: MemoryStore): PlatformServices => ({
  ...testPlatform(store),
  display: {
    modes: async () => ({ modes: [], activeModeId: 0 }),
    setPreferredMode: async () => false,
  },
});

beforeEach(() => {
  jest.useRealTimers();
  resetLocalLists();
});

type Picker = {
  row: string;
  picker: string;
  field: keyof Settings;
  choices: { label: string; value: unknown }[];
};
const PICKERS: Picker[] = [
  {
    row: 'set-bitrate',
    picker: 'pick-bitrate',
    field: 'maxBitrate',
    choices: BITRATE_CHOICES,
  },
  {
    row: 'set-refreshrate',
    picker: 'pick-refreshrate',
    field: 'refreshRateMatch',
    choices: REFRESH_RATE_CHOICES,
  },
  {
    row: 'set-subtitles',
    picker: 'pick-subtitles',
    field: 'subtitleMode',
    choices: SUBTITLE_CHOICES,
  },
  {
    row: 'set-subsize',
    picker: 'pick-subsize',
    field: 'subtitleSize',
    choices: SUBTITLE_SIZE_CHOICES,
  },
  {
    row: 'set-subcolor',
    picker: 'pick-subcolor',
    field: 'subtitleColor',
    choices: SUBTITLE_COLOR_CHOICES,
  },
  {
    row: 'set-subbg',
    picker: 'pick-subbg',
    field: 'subtitleBackground',
    choices: SUBTITLE_BACKGROUND_CHOICES,
  },
];

describe('option pickers', () => {
  test.each(PICKERS)(
    '$row stores the option picked in $picker',
    async ({ row, picker, field, choices }) => {
      const { root, store } = await openSettings({ platform: withDisplay });
      const current = choices.find(c => c.value === DEFAULT_SETTINGS[field])!;
      await waitFor(() =>
        expect(text(byId(root, row))).toContain(current.label),
      );
      expect(pickerOpen(root, picker)).toBe(false);

      await press(root, row);
      expect(pickerOpen(root, picker)).toBe(true);
      const index = choices.findIndex(c => c.value !== DEFAULT_SETTINGS[field]);
      await press(root, `${picker}-${index}`);
      expect(pickerOpen(root, picker)).toBe(false);

      await waitFor(() =>
        expect(text(byId(root, row))).toContain(choices[index].label),
      );
      await waitFor(async () =>
        expect((await stored(store))[field]).toEqual(choices[index].value),
      );
      await act(async () => root.unmount());
    },
  );

  // The language pickers are kept to the round trip: open, choose, stored.
  test.each([
    ['set-language', 'pick-language', 'preferredLanguage', LANGUAGE_CHOICES],
    [
      'set-sublanguage',
      'pick-sublanguage',
      'preferredSubtitleLanguage',
      SUBTITLE_LANGUAGE_CHOICES,
    ],
  ] as const)(
    '%s round-trips into settings',
    async (row, picker, field, choices) => {
      const { root, store } = await openSettings();
      await press(root, row);
      expect(pickerOpen(root, picker)).toBe(true);
      await press(root, `${picker}-1`);
      expect(pickerOpen(root, picker)).toBe(false);
      expect(choices[1].value).not.toBe('');
      await waitFor(async () =>
        expect((await stored(store))[field]).toBe(choices[1].value),
      );
      await waitFor(() =>
        expect(text(byId(root, row))).toContain(choices[1].label),
      );
      await act(async () => root.unmount());
    },
  );

  test('BACK closes a picker without changing the setting', async () => {
    const { root, store } = await openSettings();
    await press(root, 'set-subtitles');
    const modal = root.root.findAllByType(Modal).find(m => m.props.visible)!;
    await act(async () => modal.props.onRequestClose());
    await flush();
    expect(pickerOpen(root, 'pick-subtitles')).toBe(false);
    await waitFor(async () =>
      expect((await stored(store)).subtitleMode).toBe(
        DEFAULT_SETTINGS.subtitleMode,
      ),
    );
    await act(async () => root.unmount());
  });

  test('the refresh rate row is offered only where the display can switch modes', async () => {
    const { root } = await openSettings();
    expect(has(root, 'set-refreshrate')).toBe(false);
    await act(async () => root.unmount());
  });
});

test('autoplay and the debug overlay toggle on and off', async () => {
  const { root, store } = await openSettings();
  await waitFor(() => expect(text(byId(root, 'set-autoplay'))).toContain('On'));
  await press(root, 'set-autoplay');
  await waitFor(() =>
    expect(text(byId(root, 'set-autoplay'))).toContain('Off'),
  );
  await waitFor(async () =>
    expect((await stored(store)).autoplayNext).toBe(false),
  );

  await waitFor(() => expect(text(byId(root, 'set-debug'))).toContain('Off'));
  await press(root, 'set-debug');
  await waitFor(() => expect(text(byId(root, 'set-debug'))).toContain('On'));
  await waitFor(async () =>
    expect((await stored(store)).showDebugOverlay).toBe(true),
  );
  await press(root, 'set-debug');
  await waitFor(async () =>
    expect((await stored(store)).showDebugOverlay).toBe(false),
  );
  await act(async () => root.unmount());
});

test('the about section names the device, the server and the decoders', async () => {
  const { root } = await openSettings();
  const about = await waitFor(() => {
    const t = text(byId(root, 'screen-settings'));
    expect(t).toContain('Video decoders:');
    return t;
  });
  expect(about).toContain('test test · Android 35');
  expect(about).toContain('x86_64');
  expect(about).toContain('emulator');
  expect(about).toContain('Mock Server');
  expect(about).toContain('http://mock.local');
  expect(about).toContain('Video decoders:');
  expect(about).toContain('Audio decoders:');
  await act(async () => root.unmount());
});

describe('account', () => {
  test('switch user signs out to the sign-in page of the same server', async () => {
    const { root, store, backend } = await openSettings();
    const logout = jest.spyOn(backend, 'logout');
    await waitFor(() =>
      expect(text(byId(root, 'set-switch-user'))).toContain(
        'Signed in as xelpfin',
      ),
    );
    await press(root, 'set-switch-user');
    await shown(root, 'screen-login');
    expect(logout).toHaveBeenCalled();
    expect(has(root, 'screen-settings')).toBe(false);
    expect(await store.get('xelpfin.session')).toBeFalsy();
    await act(async () => root.unmount());
  });

  test('change server signs out to the server list', async () => {
    const { root, store, backend } = await openSettings();
    const logout = jest.spyOn(backend, 'logout');
    await waitFor(() =>
      expect(text(byId(root, 'set-change-server'))).toContain(
        'Server Mock Server',
      ),
    );
    await press(root, 'set-change-server');
    await shown(root, 'screen-servers');
    expect(logout).toHaveBeenCalled();
    expect(has(root, 'screen-login')).toBe(false);
    expect(await store.get('xelpfin.session')).toBeFalsy();
    await act(async () => root.unmount());
  });
});

describe('actions', () => {
  test('clear Continue Watching asks for a second press, then clears', async () => {
    const { root, backend } = await openSettings();
    const clear = jest.spyOn(backend, 'clearProgress');
    await waitFor(() =>
      expect(text(byId(root, 'act-clear-continue'))).toContain(
        'Forget resume positions',
      ),
    );
    await press(root, 'act-clear-continue');
    await waitFor(() =>
      expect(text(byId(root, 'act-clear-continue'))).toContain(
        'Press again to confirm',
      ),
    );
    expect(clear).not.toHaveBeenCalled();
    await press(root, 'act-clear-continue');
    await waitFor(() =>
      expect(text(byId(root, 'act-clear-continue'))).toContain('Cleared 1'),
    );
    expect(clear).toHaveBeenCalledWith('m1');
    expect(backend.data.movies[0].userData?.playbackPositionMs).toBe(0);

    await press(root, 'act-clear-continue');
    await press(root, 'act-clear-continue');
    await flush();
    await waitFor(() =>
      expect(text(byId(root, 'act-clear-continue'))).toContain(
        'Nothing to clear',
      ),
    );
    await act(async () => root.unmount());
  });

  test('clear Continue Watching reports the items it could not clear', async () => {
    const { root, backend } = await openSettings();
    jest
      .spyOn(backend, 'clearProgress')
      .mockRejectedValue(new Error('offline'));
    await press(root, 'act-clear-continue');
    await press(root, 'act-clear-continue');
    await flush();
    await waitFor(() =>
      expect(text(byId(root, 'act-clear-continue'))).toContain(
        'Cleared 0 of 1',
      ),
    );
    await act(async () => root.unmount());
  });

  test('an action that fails says so', async () => {
    const { root, backend } = await openSettings();
    jest.spyOn(backend, 'resume').mockRejectedValue(new Error('offline'));
    await press(root, 'act-clear-continue');
    await press(root, 'act-clear-continue');
    await flush();
    await waitFor(() =>
      expect(text(byId(root, 'act-clear-continue'))).toContain('Failed'),
    );
    await act(async () => root.unmount());
  });

  test('pressing another action moves the confirmation to it', async () => {
    const { root, backend } = await openSettings();
    const resume = jest.spyOn(backend, 'resume');
    const nextUp = jest.spyOn(backend, 'nextUp');
    resume.mockClear();
    nextUp.mockClear();
    await press(root, 'act-clear-continue');
    await press(root, 'act-clear-nextup');
    await waitFor(() =>
      expect(text(byId(root, 'act-clear-continue'))).toContain(
        'Forget resume positions',
      ),
    );
    await waitFor(() =>
      expect(text(byId(root, 'act-clear-nextup'))).toContain(
        'Press again to confirm',
      ),
    );
    expect(resume).not.toHaveBeenCalled();
    expect(nextUp).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  test('clear Next Up hides the current entries', async () => {
    const { root, store } = await openSettings();
    await waitFor(() =>
      expect(text(byId(root, 'act-clear-nextup'))).toContain(
        'Hide current entries',
      ),
    );
    await press(root, 'act-clear-nextup');
    await press(root, 'act-clear-nextup');
    await flush();
    await waitFor(() =>
      expect(text(byId(root, 'act-clear-nextup'))).toContain('Cleared 1'),
    );
    await waitFor(async () =>
      expect(JSON.parse((await store.get(HIDDEN_KEY))!)).toEqual({ s1: 'e2' }),
    );
    await act(async () => root.unmount());
  });

  test('reset Randomizer keeps the series and forgets the picks', async () => {
    const { root, store } = await openSettings({
      seed: {
        [RANDOMIZER_KEY]: { series: ['s1'], played: ['e1'], history: ['e1'] },
      },
    });
    await waitFor(() =>
      expect(text(byId(root, 'act-reset-randomizer'))).toContain(
        'Start a new cycle',
      ),
    );
    await press(root, 'act-reset-randomizer');
    await waitFor(() =>
      expect(text(byId(root, 'act-reset-randomizer'))).toContain(
        'Press again to confirm',
      ),
    );
    await press(root, 'act-reset-randomizer');
    await flush();
    await waitFor(() =>
      expect(text(byId(root, 'act-reset-randomizer'))).toContain(
        'History cleared',
      ),
    );
    await waitFor(async () =>
      expect(JSON.parse((await store.get(RANDOMIZER_KEY))!)).toEqual({
        series: ['s1'],
        played: [],
        history: [],
      }),
    );

    await press(root, 'act-reset-randomizer');
    await press(root, 'act-reset-randomizer');
    await flush();
    await waitFor(() =>
      expect(text(byId(root, 'act-reset-randomizer'))).toContain(
        'Nothing to clear',
      ),
    );
    await act(async () => root.unmount());
  });

  test('View Randomizer History opens the history page', async () => {
    const { root } = await openSettings();
    await press(root, 'act-randomizer-history');
    await flush();
    await shown(root, 'screen-randomizerHistory');
    await act(async () => root.unmount());
  });
});
