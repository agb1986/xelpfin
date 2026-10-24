/**
 * The preferred-language picker on the settings screen offers the whole ISO 639-2 table,
 * so a language outside the common group (Japanese, Polish) can be chosen and is stored,
 * and the subtitle language can differ from the audio language. Rewind and fast-forward jump
 * by initial letter in both language pickers.
 */
import React from 'react';
import { FlatList, Modal, TVEventHandler } from 'react-native';
import ReactTestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import App from '../../App';
import { MockConnector } from '../../src/backend/mock/MockBackend';
import type { Session } from '../../src/backend/types';
import { MemoryStore } from '../../src/platform/types';
import {
  LANGUAGE_CHOICES,
  SORTED_LANGUAGES_START,
  SUBTITLE_LANGUAGE_CHOICES,
} from '../../src/state/settings';
import { testPlatform } from '../../test-utils/testPlatform';

const SESSION: Session = {
  server: { id: 'mock-server', name: 'Mock Server', url: 'http://mock.local' },
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
const press = async (root: Renderer, id: string) => {
  await act(async () => {
    byId(root, id).props.onPress();
  });
  await flush();
};
const text = (node: ReactTestInstance): string =>
  node
    .findAllByType('Text' as never)
    .flatMap(t => React.Children.toArray(t.props.children))
    .join('');

async function openSettings(settings?: object) {
  const store = new MemoryStore();
  await store.set('xelpfin.session', JSON.stringify(SESSION));
  if (settings) {
    await store.set('xelpfin.settings', JSON.stringify(settings));
  }
  let root!: Renderer;
  await act(async () => {
    root = ReactTestRenderer.create(
      <App platform={testPlatform(store)} connector={new MockConnector()} />,
    );
  });
  await flush();
  expect(has(root, 'screen-home')).toBe(true);
  await press(root, 'tab-settings');
  expect(has(root, 'screen-settings')).toBe(true);
  return { root, store };
}

/** Scrolls the picker's list so the item at `index` is rendered (the list is virtualised). */
async function scrollTo(
  root: Renderer,
  index: number,
  picker = 'pick-language',
) {
  const list = byId(root, picker).findByType(FlatList);
  const height = 1080;
  const layout = { x: 0, y: 0, width: 380, height };
  const scroll = list.findAll(
    n =>
      typeof n.props.onScroll === 'function' &&
      typeof n.props.onLayout === 'function',
  )[0];
  await act(async () => {
    scroll.props.onLayout({ nativeEvent: { layout } });
    scroll.props.onContentSizeChange?.(380, 52 * LANGUAGE_CHOICES.length);
    scroll.props.onScroll({
      nativeEvent: {
        contentOffset: { x: 0, y: 52 * index },
        contentSize: { width: 380, height: 52 * LANGUAGE_CHOICES.length },
        layoutMeasurement: { width: 380, height },
      },
    });
  });
  await flush();
}

const indexOf = (code: string) =>
  LANGUAGE_CHOICES.findIndex(c => c.value === code);

beforeEach(() => jest.useRealTimers());

test('the picker offers every language and stores Japanese when picked', async () => {
  const { root, store } = await openSettings();
  expect(text(byId(root, 'set-language'))).toContain('File default');
  expect(pickerOpen(root, 'pick-language')).toBe(false);
  await press(root, 'set-language');
  expect(pickerOpen(root, 'pick-language')).toBe(true);
  const list = byId(root, 'pick-language').findByType(FlatList);
  expect(list.props.data).toBe(LANGUAGE_CHOICES);

  const jpn = indexOf('jpn');
  expect(jpn).toBeGreaterThan(6);
  await scrollTo(root, jpn);
  expect(text(byId(root, `pick-language-${jpn}`))).toContain('Japanese');
  await press(root, `pick-language-${jpn}`);
  expect(pickerOpen(root, 'pick-language')).toBe(false);
  expect(text(byId(root, 'set-language'))).toContain('Japanese');
  expect(JSON.parse((await store.get('xelpfin.settings'))!)).toMatchObject({
    preferredLanguage: 'jpn',
  });
  await act(async () => root.unmount());
});

test('a stored Polish preference is shown and the picker opens on it', async () => {
  const { root, store } = await openSettings({ preferredLanguage: 'pol' });
  expect(text(byId(root, 'set-language'))).toContain('Polish');
  await press(root, 'set-language');
  const pol = indexOf('pol');
  const list = byId(root, 'pick-language').findByType(FlatList);
  expect(list.props.initialScrollIndex).toBe(pol);
  expect(byId(root, `pick-language-${pol}`).props.hasTVPreferredFocus).toBe(
    true,
  );
  await press(root, `pick-language-${pol}`);
  expect(JSON.parse((await store.get('xelpfin.settings'))!)).toMatchObject({
    preferredLanguage: 'pol',
  });
  await act(async () => root.unmount());
});

test('Japanese audio and Polish subtitles can both be set as defaults', async () => {
  const { root, store } = await openSettings();
  expect(text(byId(root, 'set-sublanguage'))).toContain('Same as audio');

  await press(root, 'set-language');
  const jpn = indexOf('jpn');
  await scrollTo(root, jpn);
  await press(root, `pick-language-${jpn}`);

  await press(root, 'set-sublanguage');
  const list = byId(root, 'pick-sublanguage').findByType(FlatList);
  expect(list.props.data).toBe(SUBTITLE_LANGUAGE_CHOICES);
  const pol = SUBTITLE_LANGUAGE_CHOICES.findIndex(c => c.value === 'pol');
  await scrollTo(root, pol, 'pick-sublanguage');
  await press(root, `pick-sublanguage-${pol}`);
  expect(pickerOpen(root, 'pick-sublanguage')).toBe(false);

  expect(text(byId(root, 'set-language'))).toContain('Japanese');
  expect(text(byId(root, 'set-sublanguage'))).toContain('Polish');
  expect(JSON.parse((await store.get('xelpfin.settings'))!)).toMatchObject({
    preferredLanguage: 'jpn',
    preferredSubtitleLanguage: 'pol',
  });
  await act(async () => root.unmount());
});

describe('jumping by letter with rewind and fast-forward', () => {
  type Listener = (evt: { eventType: string; eventKeyAction: number }) => void;
  const listeners = new Set<Listener>();
  beforeEach(() => {
    listeners.clear();
    jest.spyOn(TVEventHandler, 'addListener').mockImplementation(cb => {
      listeners.add(cb);
      return { remove: () => listeners.delete(cb) } as never;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  /** One remote key; Android TV reports it on key-up (eventKeyAction 1). */
  const key = async (eventType: string, eventKeyAction = 1) => {
    await act(async () => {
      listeners.forEach(l => l({ eventType, eventKeyAction }));
    });
    await flush();
  };
  /** Rows that ask for focus; the picker marks the jump target. */
  const preferred = (root: Renderer, picker: string) =>
    byId(root, picker)
      .findAll(
        n =>
          typeof n.props.testID === 'string' &&
          n.props.testID.startsWith(`${picker}-`) &&
          typeof n.type !== 'string' &&
          n.props.hasTVPreferredFocus === true,
      )
      .map(n => n.props.testID)
      .filter((id, i, all) => all.indexOf(id) === i);
  const initial = (i: number) => LANGUAGE_CHOICES[i].label.charAt(0);

  test('fast-forward skips the common languages and walks the letters to Japanese', async () => {
    const { root, store } = await openSettings();
    await press(root, 'set-language');
    expect(text(byId(root, 'pick-language-hint'))).toContain('jump by letter');
    const list = byId(root, 'pick-language').findByType(FlatList);
    const scrollToIndex = jest.spyOn(list.instance, 'scrollToIndex');

    // Focus starts on "File default"; the first fast-forward lands on the first "A" language.
    await key('fastForward');
    expect(preferred(root, 'pick-language')).toEqual([
      `pick-language-${SORTED_LANGUAGES_START}`,
    ]);
    expect(initial(SORTED_LANGUAGES_START)).toBe('A');
    expect(scrollToIndex).toHaveBeenLastCalledWith(
      expect.objectContaining({ index: SORTED_LANGUAGES_START }),
    );

    // Key-down reports are ignored, so one press moves one letter.
    await key('fastForward', 0);
    expect(preferred(root, 'pick-language')).toEqual([
      `pick-language-${SORTED_LANGUAGES_START}`,
    ]);

    // B, C, ... J: nine more presses, each landing on the first language of its letter.
    let target = SORTED_LANGUAGES_START;
    for (const letter of 'BCDEFGHIJ') {
      await key('fastForward');
      target = LANGUAGE_CHOICES.findIndex(
        (c, i) => i >= SORTED_LANGUAGES_START && c.label.startsWith(letter),
      );
      expect(initial(target - 1)).not.toBe(letter);
      expect(scrollToIndex).toHaveBeenLastCalledWith(
        expect.objectContaining({ index: target }),
      );
    }
    await scrollTo(root, target);
    expect(preferred(root, 'pick-language')).toEqual([
      `pick-language-${target}`,
    ]);
    expect(text(byId(root, `pick-language-${target}`))).toMatch(/^.J/);

    // D-pad down to Japanese from there, then pick it.
    const jpn = indexOf('jpn');
    await press(root, `pick-language-${jpn}`);
    expect(JSON.parse((await store.get('xelpfin.settings'))!)).toMatchObject({
      preferredLanguage: 'jpn',
    });
    await act(async () => root.unmount());
  });

  test('rewind goes back a letter from the focused row, then to the top', async () => {
    const { root } = await openSettings({ preferredLanguage: 'pol' });
    await press(root, 'set-language');
    const pol = indexOf('pol');
    // Focus moved by D-pad to a row in the middle of "P".
    await scrollTo(root, pol + 1);
    await act(async () => {
      byId(root, `pick-language-${pol + 1}`).props.onFocus?.({});
    });
    expect(initial(pol + 1)).toBe('P');

    await key('rewind');
    const firstO = LANGUAGE_CHOICES.findIndex(
      (c, i) => i >= SORTED_LANGUAGES_START && c.label.startsWith('O'),
    );
    await scrollTo(root, firstO);
    expect(preferred(root, 'pick-language')).toEqual([
      `pick-language-${firstO}`,
    ]);

    // Back to the first letter, and one more rewind returns to "File default".
    for (let i = 0; i < 'ABCDEFGHIJKLMN'.length; i++) {
      await key('rewind');
    }
    await scrollTo(root, SORTED_LANGUAGES_START);
    expect(preferred(root, 'pick-language')).toEqual([
      `pick-language-${SORTED_LANGUAGES_START}`,
    ]);
    await key('rewind');
    await scrollTo(root, 0);
    expect(preferred(root, 'pick-language')).toEqual(['pick-language-0']);
    await act(async () => root.unmount());
  });

  test('the subtitle language picker jumps too; other pickers ignore the keys', async () => {
    const { root } = await openSettings();
    await press(root, 'set-sublanguage');
    expect(has(root, 'pick-sublanguage-hint')).toBe(true);
    await key('fastForward');
    expect(preferred(root, 'pick-sublanguage')).toEqual([
      `pick-sublanguage-${SORTED_LANGUAGES_START}`,
    ]);
    expect(
      SUBTITLE_LANGUAGE_CHOICES[SORTED_LANGUAGES_START].label.charAt(0),
    ).toBe('A');

    // Opening another picker closes this one.
    await press(root, 'set-bitrate');
    expect(pickerOpen(root, 'pick-sublanguage')).toBe(false);
    expect(pickerOpen(root, 'pick-bitrate')).toBe(true);
    expect(has(root, 'pick-bitrate-hint')).toBe(false);
    const before = preferred(root, 'pick-bitrate');
    await key('fastForward');
    expect(preferred(root, 'pick-bitrate')).toEqual(before);
    await act(async () => root.unmount());
  });
});
