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

  it('keeps audio passthrough off unless stored as a boolean true', () => {
    expect(DEFAULT_SETTINGS.audioPassthrough).toBe(false);
    expect(sanitizeSettings({ audioPassthrough: true }).audioPassthrough).toBe(
      true,
    );
    expect(sanitizeSettings({ audioPassthrough: 'yes' }).audioPassthrough).toBe(
      false,
    );
    expect(sanitizeSettings({ audioPassthrough: 1 }).audioPassthrough).toBe(
      false,
    );
  });

  it('matches the refresh rate by default and keeps only known policies', () => {
    expect(DEFAULT_SETTINGS.refreshRateMatch).toBe('frameRate');
    expect(sanitizeSettings({ refreshRateMatch: 'off' }).refreshRateMatch).toBe(
      'off',
    );
    expect(
      sanitizeSettings({ refreshRateMatch: 'frameRateAndResolution' })
        .refreshRateMatch,
    ).toBe('frameRateAndResolution');
    expect(
      sanitizeSettings({ refreshRateMatch: 'always' }).refreshRateMatch,
    ).toBe('frameRate');
  });

  it('round-trips through storage and survives corrupt JSON', async () => {
    const store = new MemoryStore();
    await saveSettings(store, {
      ...DEFAULT_SETTINGS,
      showDebugOverlay: true,
      audioPassthrough: true,
    });
    expect((await loadSettings(store)).showDebugOverlay).toBe(true);
    expect((await loadSettings(store)).audioPassthrough).toBe(true);
    await store.set('xelpfin.settings', '{not json');
    expect(await loadSettings(store)).toEqual(DEFAULT_SETTINGS);
  });

  it('stores any known language code as its B code', () => {
    expect(sanitizeSettings({ preferredLanguage: 'jpn' })).toMatchObject({
      preferredLanguage: 'jpn',
    });
    expect(sanitizeSettings({ preferredLanguage: 'pol' })).toMatchObject({
      preferredLanguage: 'pol',
    });
    expect(sanitizeSettings({ preferredLanguage: 'deu' })).toMatchObject({
      preferredLanguage: 'ger',
    });
    expect(sanitizeSettings({ preferredLanguage: 'NL' })).toMatchObject({
      preferredLanguage: 'dut',
    });
    expect(sanitizeSettings({ preferredLanguage: 'xxx' })).toMatchObject({
      preferredLanguage: '',
    });
    expect(sanitizeSettings({ preferredLanguage: '' })).toMatchObject({
      preferredLanguage: '',
    });
  });

  it('keeps a separate subtitle language, stored as its B code', () => {
    expect(
      sanitizeSettings({
        preferredLanguage: 'ja',
        preferredSubtitleLanguage: 'pl',
      }),
    ).toMatchObject({
      preferredLanguage: 'jpn',
      preferredSubtitleLanguage: 'pol',
    });
    expect(
      sanitizeSettings({ preferredSubtitleLanguage: 'xxx' }),
    ).toMatchObject({ preferredSubtitleLanguage: '' });
    // Settings saved before the subtitle language existed follow the audio language.
    expect(sanitizeSettings({ preferredLanguage: 'ger' })).toMatchObject({
      preferredLanguage: 'ger',
      preferredSubtitleLanguage: '',
    });
  });

  it('matches language aliases', () => {
    expect(languageMatches('deu', 'ger')).toBe(true);
    expect(languageMatches('fra', 'fre')).toBe(true);
    expect(languageMatches('nld', 'dut')).toBe(true);
    expect(languageMatches('de', 'ger')).toBe(true);
    expect(languageMatches('eng', 'ger')).toBe(false);
    expect(languageMatches(undefined, 'eng')).toBe(false);
    expect(languageMatches('eng', '')).toBe(false);
  });

  it('matches either code of a language in any case, for any language in the table', () => {
    expect(languageMatches('jpn', 'jpn')).toBe(true);
    expect(languageMatches('JA', 'jpn')).toBe(true);
    expect(languageMatches('pol', 'pol')).toBe(true);
    expect(languageMatches('Pol', 'pol')).toBe(true);
    expect(languageMatches('pl', 'pol')).toBe(true);
    expect(languageMatches('jpn', 'pol')).toBe(false);
    // The preference may itself be a T or 639-1 code.
    expect(languageMatches('ger', 'deu')).toBe(true);
    expect(languageMatches('zho', 'zh')).toBe(true);
    // Unknown codes still match themselves.
    expect(languageMatches('xyz', 'xyz')).toBe(true);
    expect(languageMatches('xyz', 'abc')).toBe(false);
  });

  it('picks Japanese audio and Polish subtitles from one set of settings', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      subtitleMode: 'always' as const,
      preferredLanguage: 'jpn',
      preferredSubtitleLanguage: 'pol',
    };
    const audio = [
      { index: 1, label: 'English', language: 'eng', isDefault: true },
      { index: 2, label: 'Japanese', language: 'jpn', isDefault: false },
    ];
    expect(pickAudio(audio, settings)).toBe(2);
    const subs: SubtitleTrack[] = [
      {
        index: 3,
        label: 'English',
        language: 'eng',
        isDefault: true,
        isForced: false,
        delivery: 'external',
      },
      {
        index: 4,
        label: 'Polish',
        language: 'pl',
        isDefault: false,
        isForced: false,
        delivery: 'external',
      },
    ];
    expect(pickSubtitle(subs, settings)).toBe(4);
    // Without a subtitle language, subtitles follow the audio language.
    expect(
      pickSubtitle(subs, { ...settings, preferredSubtitleLanguage: '' }),
    ).toBe(3);
    expect(
      pickSubtitle(subs, {
        ...settings,
        preferredLanguage: 'pol',
        preferredSubtitleLanguage: '',
      }),
    ).toBe(4);
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
