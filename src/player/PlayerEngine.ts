import type { ForwardRefExoticComponent, RefAttributes } from 'react';
import type { PlaybackPlan } from '../backend/types';

export interface PlayerViewHandle {
  seek(positionMs: number): void;
}

export interface PlayerViewProps {
  plan: PlaybackPlan;
  paused: boolean;
  /** Backend stream index of the audio track to play; undefined keeps the container default. */
  audioStreamIndex?: number;
  /** Backend stream index of the subtitle track to show; undefined means off. */
  subtitleStreamIndex?: number;
  /** Font size for subtitles the engine renders itself (embedded text tracks). */
  subtitleSize?: number;
  onLoad?(e: { durationMs: number }): void;
  onProgress?(e: { positionMs: number; bufferedMs: number }): void;
  onBuffering?(buffering: boolean): void;
  onEnd?(): void;
  onError?(message: string): void;
}

/**
 * The only seam between screens and the media stack. Fire TV uses react-native-video (ExoPlayer);
 * a Vega OS build swaps in an engine on Vega's media player without touching the screens.
 */
export interface PlayerEngine {
  readonly name: string;
  readonly View: ForwardRefExoticComponent<
    PlayerViewProps & RefAttributes<PlayerViewHandle>
  >;
  /**
   * Whether switching to this audio/subtitle track can happen inside the current stream.
   * When false the caller asks the backend for a new plan (e.g. a transcode with another
   * audio track or burned-in subtitles) and restarts at the current position.
   */
  canSwitchInStream(
    plan: PlaybackPlan,
    change: { audioStreamIndex?: number; subtitleStreamIndex?: number },
  ): boolean;
}
