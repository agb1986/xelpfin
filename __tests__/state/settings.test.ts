import { MemoryStore } from '../../src/platform/types';
import {
  DEFAULT_SETTINGS,
  languageMatches,
  loadSettings,
  sanitizeSettings,
  saveSettings,
} from '../../src/state/settings';
import { pickAudio, pickSubtitle } from '../../src/state/trackDefaults';
import type { SubtitleTrack } from '../../src/backend/types';

describe('settings', () => {
  it('sanitizes junk and keeps valid values', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(
      sanitizeSettings({
        maxBitrate: 123,
        subtitleMode: 'loud',
        preferredLanguage: 'english',
      }),
    ).toEqual(DEFAULT_SETTINGS);
    expect(
      sanitizeSettings({
        maxBitrate: 10_000_000,
        subtitleMode: 'always',
        preferredLanguage: 'ger',
        autoplayNext: false,
      }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      maxBitrate: 10_000_000,
      subtitleMode: 'always',
      preferredLanguage: 'ger',
      autoplayNext: false,
    });
  });

  it('keeps only offered subtitle style choices', () => {
    expect(
      sanitizeSettings({
        subtitleSize: 28,
        subtitleColor: '#ffe14d',
        subtitleBackground: 'shadow',
      }),
    ).toMatchObject({
      subtitleSize: 28,
      subtitleColor: '#ffe14d',
      subtitleBackground: 'shadow',
    });
    expect(
      sanitizeSettings({
        subtitleSize: 99,
        subtitleColor: 'red',
        subtitleBackground: 'neon',
      }),
    ).toMatchObject({
      subtitleSize: DEFAULT_SETTINGS.subtitleSize,
      subtitleColor: DEFAULT_SETTINGS.subtitleColor,
      subtitleBackground: DEFAULT_SETTINGS.subtitleBackground,
    });
  });

  it('round-trips through storage and survives corrupt JSON', async () => {
    const store = new MemoryStore();
    await saveSettings(store, { ...DEFAULT_SETTINGS, showDebugOverlay: true });
    expect((await loadSettings(store)).showDebugOverlay).toBe(true);
    await store.set('xelpfin.settings', '{not json');
    expect(await loadSettings(store)).toEqual(DEFAULT_SETTINGS);
  });

  it('matches language aliases', () => {
    expect(languageMatches('deu', 'ger')).toBe(true);
    expect(languageMatches('fra', 'fre')).toBe(true);
    expect(languageMatches('eng', 'ger')).toBe(false);
    expect(languageMatches(undefined, 'eng')).toBe(false);
  });
});

describe('track defaults', () => {
  const sub = (
    index: number,
    language: string,
    extra: Partial<SubtitleTrack> = {},
  ): SubtitleTrack => ({
    index,
    label: language,
    language,
    isDefault: false,
    isForced: false,
    delivery: 'external',
    ...extra,
  });
  const subs = [
    sub(3, 'eng'),
    sub(4, 'fra'),
    sub(5, 'fra', { isForced: true }),
  ];

  it('picks audio by preferred language', () => {
    const audio = [
      { index: 1, label: 'English', language: 'eng', isDefault: true },
      { index: 2, label: 'German', language: 'deu', isDefault: false },
    ];
    expect(
      pickAudio(audio, { ...DEFAULT_SETTINGS, preferredLanguage: 'ger' }),
    ).toBe(2);
    expect(pickAudio(audio, DEFAULT_SETTINGS)).toBeUndefined();
  });

  it('honours the subtitle mode', () => {
    expect(
      pickSubtitle(subs, { ...DEFAULT_SETTINGS, subtitleMode: 'off' }),
    ).toBe(-1);
    expect(pickSubtitle(subs, DEFAULT_SETTINGS)).toBe(5);
    expect(pickSubtitle([sub(3, 'eng')], DEFAULT_SETTINGS)).toBe(-1);
    expect(
      pickSubtitle([sub(3, 'eng', { isDefault: true })], DEFAULT_SETTINGS),
    ).toBe(3);
    expect(
      pickSubtitle(subs, {
        ...DEFAULT_SETTINGS,
        subtitleMode: 'always',
        preferredLanguage: 'fre',
      }),
    ).toBe(4);
    expect(
      pickSubtitle(subs, { ...DEFAULT_SETTINGS, subtitleMode: 'always' }),
    ).toBe(3);
  });
});
