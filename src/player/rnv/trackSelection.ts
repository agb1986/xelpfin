import type { PlaybackPlan } from '../../backend/types';

/** Title used for side-loaded subtitle tracks so they can be selected unambiguously. */
export const sideLoadedTitle = (index: number) => `xelpfin-sub-${index}`;

export type TrackSelection =
  | { type: 'index'; value: number }
  | { type: 'title'; value: string }
  | { type: 'language'; value: string }
  | { type: 'disabled' }
  | { type: 'system' };

/** Maps a backend audio stream index onto the player's audio track list. */
export function audioSelection(plan: PlaybackPlan, streamIndex?: number): TrackSelection {
  if (streamIndex === undefined || plan.method !== 'DirectPlay') {
    // A transcode carries exactly the audio track the server was asked for.
    return { type: 'system' };
  }
  const pos = plan.audioTracks.findIndex(a => a.index === streamIndex);
  return pos < 0 ? { type: 'system' } : { type: 'index', value: pos };
}

/** Maps a backend subtitle stream index onto the player's text tracks. */
export function subtitleSelection(plan: PlaybackPlan, streamIndex?: number): TrackSelection {
  if (streamIndex === undefined || streamIndex < 0) {
    return { type: 'disabled' };
  }
  const track = plan.subtitleTracks.find(s => s.index === streamIndex);
  if (!track) {
    return { type: 'disabled' };
  }
  if (track.delivery === 'external' && track.url) {
    return { type: 'title', value: sideLoadedTitle(track.index) };
  }
  if (track.delivery === 'embedded' && track.language) {
    return { type: 'language', value: track.language };
  }
  // Burned-in subtitles are part of the picture.
  return { type: 'disabled' };
}

/** True when a track change can be applied by the player without a new stream from the server. */
export function canSwitchInStream(
  plan: PlaybackPlan,
  change: { audioStreamIndex?: number; subtitleStreamIndex?: number },
): boolean {
  if (change.audioStreamIndex !== undefined && change.audioStreamIndex !== plan.selectedAudioIndex) {
    if (plan.method !== 'DirectPlay') {
      return false;
    }
  }
  if (change.subtitleStreamIndex !== undefined && change.subtitleStreamIndex >= 0) {
    const track = plan.subtitleTracks.find(s => s.index === change.subtitleStreamIndex);
    if (!track || track.delivery === 'burn-in') {
      return false;
    }
  }
  // Leaving burned-in subtitles needs a clean stream.
  const current = plan.subtitleTracks.find(s => s.index === plan.selectedSubtitleIndex);
  if (current?.delivery === 'burn-in' && change.subtitleStreamIndex !== plan.selectedSubtitleIndex) {
    return false;
  }
  return true;
}
