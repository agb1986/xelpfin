import {
  KeplerVideoSurfaceView,
  VideoPlayer,
} from '@amazon-devices/react-native-w3cmedia';
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { StyleSheet, View } from 'react-native';
import type {
  PlayerEngine,
  PlayerViewHandle,
  PlayerViewProps,
} from '../../src/player/PlayerEngine';
import { canSwitchInStream } from '../../src/player/trackSelection';
import { streamUrlWithToken } from '../../src/player/vega/streamUrl';

/** Loads Shaka Player (and its polyfills) on first use, so progressive playback never pays for it. */
function loadShaka(): any {
  return require('./shaka').default;
}

function bufferedEndMs(video: any): number {
  const ranges = video.buffered;
  return ranges && ranges.length > 0
    ? ranges.end(ranges.length - 1) * 1000
    : 0;
}

/** Words the app's error classifier (src/player/errors.ts) looks for, from the media error. */
function failureMessage(event: any): string {
  const error = event?.target?.mediaControlStateUtil?.mError;
  const message: string = error?.message_ ?? 'media error';
  if (error?.code_ === 2) {
    return `NETWORK: ${message}`;
  }
  if (error?.code_ === 3 || /not-negotiated|kepler_viddec/.test(message)) {
    return `DECODER: ${message}`;
  }
  return message;
}

const VegaView = forwardRef<PlayerViewHandle, PlayerViewProps>(
  function VegaView(props, ref) {
    const { plan } = props;
    const video = useRef<any>(null);
    const shakaPlayer = useRef<any>(null);
    const surface = useRef<string | null>(null);
    const ready = useRef(false);
    // Callbacks and flags read by listeners that live as long as the element does.
    const latest = useRef(props);
    latest.current = props;

    useImperativeHandle(
      ref,
      () => ({
        seek: ms => {
          if (video.current) {
            video.current.currentTime = ms / 1000;
          }
        },
      }),
      [],
    );

    const applyPaused = () => {
      const el = video.current;
      if (!el || !surface.current || !ready.current) {
        return;
      }
      if (latest.current.paused) {
        el.pause();
      } else {
        el.play().catch(() => undefined);
      }
    };

    useEffect(() => {
      let cancelled = false;
      const el = new VideoPlayer();
      video.current = el;
      const listeners: Array<[string, (e: any) => void]> = [
        [
          'loadedmetadata',
          () => {
            if (plan.startPositionMs > 0) {
              el.currentTime = plan.startPositionMs / 1000;
            }
            ready.current = true;
            latest.current.onLoad?.({ durationMs: el.duration * 1000 });
            applyPaused();
          },
        ],
        [
          'timeupdate',
          () =>
            latest.current.onProgress?.({
              positionMs: el.currentTime * 1000,
              bufferedMs: bufferedEndMs(el),
            }),
        ],
        ['waiting', () => latest.current.onBuffering?.(true)],
        ['playing', () => latest.current.onBuffering?.(false)],
        ['ended', () => latest.current.onEnd?.()],
        ['error', e => latest.current.onError?.(failureMessage(e))],
      ];

      (async () => {
        try {
          await el.initialize();
          if (cancelled) {
            return;
          }
          el.autoplay = false;
          listeners.forEach(([name, fn]) => el.addEventListener(name, fn));
          if (surface.current) {
            el.setSurfaceHandle(surface.current);
          }
          if (plan.streamType === 'hls') {
            const shaka = loadShaka();
            // Constructing with the element is deprecated; attach() replaces it in Shaka v5.
            const player = new shaka.Player();
            shakaPlayer.current = player;
            await player.attach(el);
            if (cancelled) {
              return;
            }
            player.configure({
              streaming: {
                lowLatencyMode: false,
                bufferingGoal: 30,
                rebufferingGoal: 2,
                retryParameters: { maxAttempts: 3 },
              },
              manifest: { hls: { sequenceMode: true } },
              abr: { enabled: false },
            });
            const headers = plan.headers;
            player
              .getNetworkingEngine()
              .registerRequestFilter((type: number, request: any) => {
                const kinds = shaka.net.NetworkingEngine.RequestType;
                if (type === kinds.MANIFEST || type === kinds.SEGMENT) {
                  Object.assign(request.headers, headers);
                }
              });
            await player.load(plan.url);
          } else {
            el.src = streamUrlWithToken(plan.url, plan.headers);
            el.load();
          }
        } catch (error) {
          if (!cancelled) {
            latest.current.onError?.(`media error: ${String(error)}`);
          }
        }
      })();

      return () => {
        cancelled = true;
        ready.current = false;
        listeners.forEach(([name, fn]) => el.removeEventListener?.(name, fn));
        const player = shakaPlayer.current;
        shakaPlayer.current = null;
        Promise.resolve(player?.destroy?.())
          .catch(() => undefined)
          .then(() => el.deinitialize?.());
        video.current = null;
      };
      // A new plan is a new stream: the element is rebuilt for it.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [plan]);

    useEffect(applyPaused, [props.paused]);

    // The player re-renders on every progress update (4 Hz). The surface only reads refs, so it
    // is built once and React skips it on those renders.
    const surfaceView = useMemo(
      () => (
        <View style={StyleSheet.absoluteFill}>
          <KeplerVideoSurfaceView
            style={StyleSheet.absoluteFill}
            onSurfaceViewCreated={(handle: string) => {
              surface.current = handle;
              video.current?.setSurfaceHandle(handle);
              applyPaused();
            }}
            onSurfaceViewDestroyed={(handle: string) => {
              video.current?.clearSurfaceHandle(handle);
              surface.current = null;
            }}
          />
        </View>
      ),
      // applyPaused reads only refs, so the first render's copy stays correct.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );
    return surfaceView;
  },
);

/**
 * Vega OS media: the W3C media element from react-native-w3cmedia. Progressive streams (Jellyfin
 * direct play) play from the element's `src`; HLS transcodes go through Shaka Player.
 * Embedded subtitle rendering is not wired yet, so it falls back to the app-drawn cues.
 */
export const VegaEngine: PlayerEngine = {
  name: 'vega-w3cmedia',
  View: VegaView,
  canSwitchInStream,
};
