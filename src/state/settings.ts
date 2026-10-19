import type { KeyValueStore } from '../platform/types';

export type SubtitleMode = 'off' | 'default' | 'always';

export interface Settings {
  /** Bits per second; 0 means no cap beyond what the device supports. */
  maxBitrate: number;
  subtitleMode: SubtitleMode;
  /** ISO 639-2 code preferred for audio and subtitles, '' for the file default. */
  preferredLanguage: string;
  autoplayNext: boolean;
  showDebugOverlay: boolean;
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
  autoplayNext: true,
  showDebugOverlay: false,
  subtitleSize: 22,
  subtitleColor: '#ffffff',
  subtitleBackground: 'box',
};

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

export const LANGUAGE_CHOICES: { label: string; value: string }[] = [
  { label: 'File default', value: '' },
  { label: 'English', value: 'eng' },
  { label: 'German', value: 'ger' },
  { label: 'French', value: 'fre' },
  { label: 'Spanish', value: 'spa' },
  { label: 'Italian', value: 'ita' },
  { label: 'Dutch', value: 'dut' },
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
  if (
    typeof r.preferredLanguage === 'string' &&
    /^[a-z]{0,3}$/.test(r.preferredLanguage)
  ) {
    s.preferredLanguage = r.preferredLanguage;
  }
  if (typeof r.autoplayNext === 'boolean') {
    s.autoplayNext = r.autoplayNext;
  }
  if (typeof r.showDebugOverlay === 'boolean') {
    s.showDebugOverlay = r.showDebugOverlay;
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

/** Language codes Jellyfin may use for the same language (it normalises some B codes to T codes). */
const LANGUAGE_ALIASES: Record<string, string[]> = {
  ger: ['ger', 'deu', 'de'],
  fre: ['fre', 'fra', 'fr'],
  dut: ['dut', 'nld', 'nl'],
  eng: ['eng', 'en'],
  spa: ['spa', 'es'],
  ita: ['ita', 'it'],
};

export function languageMatches(
  code: string | undefined,
  preferred: string,
): boolean {
  if (!code || !preferred) {
    return false;
  }
  const c = code.toLowerCase();
  return (LANGUAGE_ALIASES[preferred] ?? [preferred]).includes(c);
}
