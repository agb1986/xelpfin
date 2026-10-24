import type { KeyValueStore } from '../platform/types';
import { LANGUAGES, SPECIAL_LANGUAGE_CODES, type Language } from './languages';

export type SubtitleMode = 'off' | 'default' | 'always';

/**
 * Display mode switching at playback start: off, a mode whose refresh rate is a multiple of
 * the video's frame rate, or additionally one at the video's resolution.
 */
export type RefreshRateMatch = 'off' | 'frameRate' | 'frameRateAndResolution';

export interface Settings {
  /** Bits per second; 0 means no cap beyond what the device supports. */
  maxBitrate: number;
  subtitleMode: SubtitleMode;
  /** ISO 639-2/B code preferred for audio (and subtitles, unless set below), '' for the file default. */
  preferredLanguage: string;
  /** ISO 639-2/B code preferred for subtitles, '' to follow `preferredLanguage`. */
  preferredSubtitleLanguage: string;
  autoplayNext: boolean;
  showDebugOverlay: boolean;
  /**
   * Bitstream compressed audio (AC-3, E-AC-3, TrueHD, DTS) to the TV or receiver when it reports
   * that it decodes the format, instead of asking the server to transcode it. Off by default:
   * on a sink that lies about its formats the result is silence.
   */
  audioPassthrough: boolean;
  /**
   * Switch the display to a mode that fits the video's frame rate when playback starts, so 24p
   * film does not judder on a 60 Hz output, and switch back when the player closes. On by
   * default (frame rate only); the TV blanks for a moment at each switch.
   */
  refreshRateMatch: RefreshRateMatch;
  /** Font size of text subtitles drawn by the app, in dp. */
  subtitleSize: number;
  subtitleColor: string;
  subtitleBackground: SubtitleBackground;
}

export type SubtitleBackground = 'box' | 'solid' | 'shadow';

export const DEFAULT_SETTINGS: Settings = {
  maxBitrate: 0,
  subtitleMode: 'default',
  preferredLanguage: '',
  preferredSubtitleLanguage: '',
  autoplayNext: true,
  showDebugOverlay: false,
  audioPassthrough: false,
  refreshRateMatch: 'frameRate',
  subtitleSize: 22,
  subtitleColor: '#ffffff',
  subtitleBackground: 'box',
};

export const REFRESH_RATE_CHOICES: {
  label: string;
  value: RefreshRateMatch;
}[] = [
  { label: 'Off', value: 'off' },
  { label: 'Frame rate only', value: 'frameRate' },
  { label: 'Frame rate and resolution', value: 'frameRateAndResolution' },
];

export const SUBTITLE_SIZE_CHOICES: { label: string; value: number }[] = [
  { label: 'Small', value: 18 },
  { label: 'Medium', value: 22 },
  { label: 'Large', value: 28 },
  { label: 'Extra large', value: 36 },
];

export const SUBTITLE_COLOR_CHOICES: { label: string; value: string }[] = [
  { label: 'White', value: '#ffffff' },
  { label: 'Yellow', value: '#ffe14d' },
  { label: 'Cyan', value: '#5ce1ff' },
  { label: 'Green', value: '#7dff7a' },
];

export const SUBTITLE_BACKGROUND_CHOICES: {
  label: string;
  value: SubtitleBackground;
}[] = [
  { label: 'Translucent box', value: 'box' },
  { label: 'Solid box', value: 'solid' },
  { label: 'Outline only', value: 'shadow' },
];

export const BITRATE_CHOICES: { label: string; value: number }[] = [
  { label: 'Auto (device maximum)', value: 0 },
  { label: '40 Mbps', value: 40_000_000 },
  { label: '20 Mbps', value: 20_000_000 },
  { label: '10 Mbps', value: 10_000_000 },
  { label: '4 Mbps', value: 4_000_000 },
];

export const SUBTITLE_CHOICES: { label: string; value: SubtitleMode }[] = [
  { label: 'Off', value: 'off' },
  { label: 'Default and forced tracks', value: 'default' },
  { label: 'Always on', value: 'always' },
];

/** Languages listed at the top of the picker, in this order; the rest follow alphabetically. */
export const COMMON_LANGUAGE_CODES: readonly string[] = [
  'eng',
  'ger',
  'fre',
  'spa',
  'ita',
  'dut',
];

/** Every code a stream may carry for a language: ISO 639-2/B, 639-2/T and 639-1. */
export function languageCodes(language: Language): string[] {
  return [language.code, language.terminologic, language.alpha2].filter(
    (c): c is string => !!c,
  );
}

const LANGUAGE_BY_CODE: ReadonlyMap<string, Language> = new Map(
  LANGUAGES.flatMap(l => languageCodes(l).map(c => [c, l] as const)),
);

/**
 * The ISO 639-2/B code for any B, T or ISO 639-1 code, matched case-insensitively,
 * or undefined for a code the table does not know.
 */
export function canonicalLanguage(
  code: string | undefined,
): string | undefined {
  return code ? LANGUAGE_BY_CODE.get(code.toLowerCase())?.code : undefined;
}

/** The first published name, so "Dutch; Flemish" is listed as "Dutch". */
export function languageLabel(language: Language): string {
  return language.name.split(';')[0].trim();
}

export interface LanguageChoice {
  label: string;
  detail?: string;
  value: string;
}

const languageChoice = (language: Language): LanguageChoice => ({
  label: languageLabel(language),
  detail: languageCodes(language).join(' / '),
  value: language.code,
});

export const LANGUAGE_CHOICES: LanguageChoice[] = [
  { label: 'File default', value: '' },
  ...COMMON_LANGUAGE_CODES.map(c => languageChoice(LANGUAGE_BY_CODE.get(c)!)),
  ...LANGUAGES.filter(
    l =>
      !COMMON_LANGUAGE_CODES.includes(l.code) &&
      !SPECIAL_LANGUAGE_CODES.includes(l.code),
  )
    .map(languageChoice)
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)),
];

/** The subtitle picker: the same languages, with '' meaning "follow the audio language". */
export const SUBTITLE_LANGUAGE_CHOICES: LanguageChoice[] = [
  { label: 'Same as audio', value: '' },
  ...LANGUAGE_CHOICES.slice(1),
];

const KEY = 'xelpfin.settings';

/** Accepts anything (old versions, hand edits) and returns a valid Settings object. */
export function sanitizeSettings(raw: unknown): Settings {
  const s = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') {
    return s;
  }
  const r = raw as Record<string, unknown>;
  if (
    typeof r.maxBitrate === 'number' &&
    BITRATE_CHOICES.some(c => c.value === r.maxBitrate)
  ) {
    s.maxBitrate = r.maxBitrate;
  }
  if (SUBTITLE_CHOICES.some(c => c.value === r.subtitleMode)) {
    s.subtitleMode = r.subtitleMode as SubtitleMode;
  }
  if (typeof r.preferredLanguage === 'string') {
    // A T or 639-1 code (hand edit, older build) is stored as its B code.
    s.preferredLanguage = canonicalLanguage(r.preferredLanguage) ?? '';
  }
  if (typeof r.preferredSubtitleLanguage === 'string') {
    s.preferredSubtitleLanguage =
      canonicalLanguage(r.preferredSubtitleLanguage) ?? '';
  }
  if (typeof r.autoplayNext === 'boolean') {
    s.autoplayNext = r.autoplayNext;
  }
  if (typeof r.showDebugOverlay === 'boolean') {
    s.showDebugOverlay = r.showDebugOverlay;
  }
  if (typeof r.audioPassthrough === 'boolean') {
    s.audioPassthrough = r.audioPassthrough;
  }
  if (REFRESH_RATE_CHOICES.some(c => c.value === r.refreshRateMatch)) {
    s.refreshRateMatch = r.refreshRateMatch as RefreshRateMatch;
  }
  if (SUBTITLE_SIZE_CHOICES.some(c => c.value === r.subtitleSize)) {
    s.subtitleSize = r.subtitleSize as number;
  }
  if (SUBTITLE_COLOR_CHOICES.some(c => c.value === r.subtitleColor)) {
    s.subtitleColor = r.subtitleColor as string;
  }
  if (SUBTITLE_BACKGROUND_CHOICES.some(c => c.value === r.subtitleBackground)) {
    s.subtitleBackground = r.subtitleBackground as SubtitleBackground;
  }
  return s;
}

export async function loadSettings(store: KeyValueStore): Promise<Settings> {
  try {
    const raw = await store.get(KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : undefined);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(
  store: KeyValueStore,
  settings: Settings,
): Promise<void> {
  await store.set(KEY, JSON.stringify(settings)).catch(() => undefined);
}

/**
 * Whether a stream's language code names the preferred language. Jellyfin stores some
 * languages under the T code (deu, fra, nld) and some files carry 639-1 codes, so every
 * code of the language counts, in any case.
 */
export function languageMatches(
  code: string | undefined,
  preferred: string,
): boolean {
  if (!code || !preferred) {
    return false;
  }
  const c = code.toLowerCase();
  const p = preferred.toLowerCase();
  const language = LANGUAGE_BY_CODE.get(p);
  return language ? languageCodes(language).includes(c) : c === p;
}
