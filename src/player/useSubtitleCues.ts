import { useEffect, useState } from 'react';
import type { SubtitleTrack } from '../backend/types';
import { parseWebVtt, type Cue } from './webvtt';

/**
 * Loads the cues of a side-loaded (server-converted WebVTT) subtitle track. Subtitles are drawn
 * by the app rather than the native player: react-native-video 6 on Android builds its progressive
 * and HLS sources directly, which drops side-loaded subtitle configurations, and drawing them in
 * shared code also gives Vega OS the same subtitles for free.
 */
export function useSubtitleCues(
  track: SubtitleTrack | undefined,
  headers?: Record<string, string>,
): Cue[] {
  const [cues, setCues] = useState<Cue[]>([]);
  const url = track?.delivery === 'external' ? track.url : undefined;
  useEffect(() => {
    setCues([]);
    if (!url) {
      return;
    }
    let cancelled = false;
    fetch(url, { headers })
      .then(r =>
        r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then(text => !cancelled && setCues(parseWebVtt(text)))
      .catch(() => !cancelled && setCues([]));
    return () => {
      cancelled = true;
    };
    // Headers are derived from the session and stable for a given url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return cues;
}
