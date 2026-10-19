import type { PlaybackPlan } from '../../backend/types';

export type TrackSelection =
  | { type: 'index'; value: number }
  | { type: 'title'; value: string }
  | { type: 'language'; value: string }
  | { type: 'disabled' }
  | { type: 'system' };

/** Maps a backend audio stream index onto the player's audio track list. */
export function audioSelection(
  plan: PlaybackPlan,
  streamIndex?: number,
): TrackSelection {
  if (streamIndex === undefined || plan.method !== 'DirectPlay') {
    // A transcode carries exactly the audio track the server was asked for.
    return { type: 'system' };
  }
  const pos = plan.audioTracks.findIndex(a => a.index === streamIndex);
  return pos < 0 ? { type: 'system' } : { type: 'index', value: pos };
}

/**
 * Maps a backend subtitle stream index onto the player's own text tracks. Side-loaded
 * (external) tracks are drawn by the app, so the native renderer is turned off for them.
 */
export function subtitleSelection(
  plan: PlaybackPlan,
  streamIndex?: number,
): TrackSelection {
  if (streamIndex === undefined || streamIndex < 0) {
    return { type: 'disabled' };
  }
  const track = plan.subtitleTracks.find(s => s.index === streamIndex);
  if (!track) {
    return { type: 'disabled' };
  }
  if (track.delivery === 'embedded') {
    // Two tracks can share a language (a PGS and an ASS track, say), so prefer the position.
    if (track.containerPosition !== undefined && plan.method === 'DirectPlay') {
      return { type: 'index', value: track.containerPosition };
    }
    if (track.language) {
      return { type: 'language', value: track.language };
    }
  }
  // Burned-in subtitles are part of the picture.
  return { type: 'disabled' };
}

/** True when a track change can be applied by the player without a new stream from the server. */
export function canSwitchInStream(
  plan: PlaybackPlan,
  change: { audioStreamIndex?: number; subtitleStreamIndex?: number },
): boolean {
  if (
    change.audioStreamIndex !== undefined &&
    change.audioStreamIndex !== plan.selectedAudioIndex
  ) {
    if (plan.method !== 'DirectPlay') {
      return false;
    }
  }
  if (
    change.subtitleStreamIndex !== undefined &&
    change.subtitleStreamIndex >= 0
  ) {
    const track = plan.subtitleTracks.find(
      s => s.index === change.subtitleStreamIndex,
    );
    if (!track || track.delivery === 'burn-in') {
      return false;
    }
  }
  // Leaving burned-in subtitles needs a clean stream.
  const current = plan.subtitleTracks.find(
    s => s.index === plan.selectedSubtitleIndex,
  );
  if (
    current?.delivery === 'burn-in' &&
    change.subtitleStreamIndex !== plan.selectedSubtitleIndex
  ) {
    return false;
  }
  return true;
}
