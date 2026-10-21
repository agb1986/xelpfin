import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Video, {
  SelectedTrackType,
  type ReactVideoSource,
  type SelectedTrack,
  type VideoRef,
} from 'react-native-video';
import type {
  PlayerEngine,
  PlayerViewHandle,
  PlayerViewProps,
} from '../PlayerEngine';
import {
  audioSelection,
  canSwitchInStream,
  subtitleSelection,
  type TrackSelection,
} from './trackSelection';

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

const VideoView = forwardRef<PlayerViewHandle, PlayerViewProps>(
  function VideoView(props, ref) {
    const { plan } = props;
    const video = useRef<VideoRef>(null);
    useImperativeHandle(
      ref,
      () => ({ seek: ms => video.current?.seek(ms / 1000) }),
      [],
    );

    const subtitleStyle = useMemo(
      () => ({ fontSize: props.subtitleSize ?? 22, paddingBottom: 24 }),
      [props.subtitleSize],
    );

    const source = useMemo<ReactVideoSource>(
      () => ({
        uri: plan.url,
        type: plan.streamType === 'hls' ? 'm3u8' : undefined,
        // Carries the access token (Authorization) for direct play, so the stream URL itself has
        // no api_key. HLS transcodes keep api_key in the URL, see playback.ts.
        headers: plan.headers,
        startPosition: plan.startPositionMs,
        // Side-loaded (external) subtitles are drawn by the app, see useSubtitleCues.
        bufferConfig: {
          minBufferMs: 15_000,
          maxBufferMs: 50_000,
          bufferForPlaybackMs: 2_500,
          bufferForPlaybackAfterRebufferMs: 5_000,
        },
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
        selectedAudioTrack={toSelectedTrack(
          audioSelection(plan, props.audioStreamIndex),
        )}
        selectedTextTrack={toSelectedTrack(
          subtitleSelection(plan, props.subtitleStreamIndex),
        )}
        subtitleStyle={subtitleStyle}
        onLoad={e => props.onLoad?.({ durationMs: e.duration * 1000 })}
        onProgress={e =>
          props.onProgress?.({
            positionMs: e.currentTime * 1000,
            bufferedMs: e.playableDuration * 1000,
          })
        }
        onBuffer={e => props.onBuffering?.(e.isBuffering)}
        onEnd={props.onEnd}
        // The structured error (errorCode, errorString, stack trace) goes through as is, so
        // playerError can classify it by code instead of parsing the message.
        onError={e => props.onError?.(e.error)}
      />
    );
  },
);

/** react-native-video 6 (media3 ExoPlayer on Android). */
export const VideoEngine: PlayerEngine = {
  name: 'react-native-video',
  View: VideoView,
  canSwitchInStream,
};
