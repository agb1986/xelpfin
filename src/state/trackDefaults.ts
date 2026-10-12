import type { AudioTrack, SubtitleTrack } from '../backend/types';
import { languageMatches, type Settings } from './settings';

/** Audio stream to request when playback starts; undefined lets the server pick the default. */
export function pickAudio(tracks: AudioTrack[], settings: Settings): number | undefined {
  if (!settings.preferredLanguage) {
    return undefined;
  }
  return tracks.find(t => languageMatches(t.language, settings.preferredLanguage))?.index;
}

/** Subtitle stream to request when playback starts; -1 means none. */
export function pickSubtitle(tracks: SubtitleTrack[], settings: Settings): number {
  if (settings.subtitleMode === 'off' || tracks.length === 0) {
    return -1;
  }
  const lang = settings.preferredLanguage;
  const inLang = lang ? tracks.filter(t => languageMatches(t.language, lang)) : tracks;
  const forced = inLang.find(t => t.isForced) ?? tracks.find(t => t.isForced);
  if (settings.subtitleMode === 'always') {
    return (inLang.find(t => !t.isForced) ?? inLang[0] ?? tracks[0]).index;
  }
  const def = tracks.find(t => t.isDefault);
  return (forced ?? def)?.index ?? -1;
}
