import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Video, {
  SelectedTrackType,
  type ReactVideoSource,
  type SelectedTrack,
  type VideoRef,
} from 'react-native-video';
import type { PlayerEngine, PlayerViewHandle, PlayerViewProps } from '../PlayerEngine';
import { audioSelection, canSwitchInStream, subtitleSelection, type TrackSelection } from './trackSelection';

function toSelectedTrack(s: TrackSelection): SelectedTrack {
  switch (s.type) {
    case 'index':
      return { type: SelectedTrackType.INDEX, value: s.value };
    case 'title':
      return { type: SelectedTrackType.TITLE, value: s.value };
    case 'language':
      return { type: SelectedTrackType.LANGUAGE, value: s.value };
    case 'disabled':
      return { type: SelectedTrackType.DISABLED };
    case 'system':
      return { type: SelectedTrackType.SYSTEM };
  }
}

const VideoView = forwardRef<PlayerViewHandle, PlayerViewProps>(function VideoView(props, ref) {
  const { plan } = props;
  const video = useRef<VideoRef>(null);
  useImperativeHandle(ref, () => ({ seek: ms => video.current?.seek(ms / 1000) }), []);

  const subtitleStyle = useMemo(() => ({ fontSize: props.subtitleSize ?? 22, paddingBottom: 24 }), [props.subtitleSize]);

  const source = useMemo<ReactVideoSource>(
    () => ({
      uri: plan.url,
      type: plan.streamType === 'hls' ? 'm3u8' : undefined,
      headers: plan.headers,
      startPosition: plan.startPositionMs,
      // Side-loaded (external) subtitles are drawn by the app, see useSubtitleCues.
      bufferConfig: { minBufferMs: 15_000, maxBufferMs: 50_000, bufferForPlaybackMs: 2_500, bufferForPlaybackAfterRebufferMs: 5_000 },
    }),
    [plan],
  );

  return (
    <Video
      ref={video}
      style={StyleSheet.absoluteFill}
      source={source}
      paused={props.paused}
      resizeMode="contain"
      controls={false}
      focusable={false}
      progressUpdateInterval={250}
      selectedAudioTrack={toSelectedTrack(audioSelection(plan, props.audioStreamIndex))}
      selectedTextTrack={toSelectedTrack(subtitleSelection(plan, props.subtitleStreamIndex))}
      subtitleStyle={subtitleStyle}
      onLoad={e => props.onLoad?.({ durationMs: e.duration * 1000 })}
      onProgress={e => props.onProgress?.({ positionMs: e.currentTime * 1000, bufferedMs: e.playableDuration * 1000 })}
      onBuffer={e => props.onBuffering?.(e.isBuffering)}
      onEnd={props.onEnd}
      onError={e => props.onError?.(describeError(e.error))}
    />
  );
});

function describeError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const text = String(e.errorString ?? e.localizedDescription ?? e.errorException ?? 'Playback failed');
    const code = e.errorCode ?? e.code;
    return code !== undefined && !text.includes(String(code)) ? `${text} (${String(code)})` : text;
  }
  return 'Playback failed';
}

/** react-native-video 6 (media3 ExoPlayer on Android). */
export const VideoEngine: PlayerEngine = {
  name: 'react-native-video',
  View: VideoView,
  canSwitchInStream,
};
