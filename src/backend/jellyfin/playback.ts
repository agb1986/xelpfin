import type { DeviceCapabilities } from '../../player/capabilities';
import { BackendError, type PlaybackPlan, type PlaybackRequest, type SubtitleTrack } from '../types';
import { mapAudio, mapSubtitle, ticksToMs, type MediaSourceDto, type MediaStreamDto } from './dto';
import { buildQuery } from './http';
import { IMAGE_SUBTITLE_FORMATS } from './deviceProfile';

const norm = (s?: string) => (s ?? '').toLowerCase();

/** Containers as Jellyfin reports them can be lists ("mov,mp4,m4a,3gp,3g2,mj2"). */
function containerSupported(container: string | undefined, caps: DeviceCapabilities): boolean {
  if (!container) {
    return false;
  }
  return norm(container)
    .split(',')
    .some(c => caps.containers.includes(c === 'matroska' ? 'mkv' : c));
}

/**
 * Client-side direct play check. Returns the reasons direct play is impossible (empty = OK).
 * The server runs the same kind of check against the DeviceProfile; we need our own because the
 * server's answer does not say *why*, and the UI shows the reason in the playback info overlay.
 */
export function directPlayBlockers(
  source: MediaSourceDto,
  caps: DeviceCapabilities,
  audioStreamIndex?: number,
  maxBitrate?: number,
): string[] {
  const reasons: string[] = [];
  const streams = source.MediaStreams ?? [];
  if (!containerSupported(source.Container, caps)) {
    reasons.push(`ContainerNotSupported:${source.Container ?? '?'}`);
  }
  const video = streams.find(s => s.Type === 'Video');
  if (video) {
    const cap = caps.video.find(v => v.codec === norm(video.Codec));
    if (!cap) {
      reasons.push(`VideoCodecNotSupported:${video.Codec ?? '?'}`);
    } else {
      if ((video.Width ?? 0) > cap.maxWidth || (video.Height ?? 0) > cap.maxHeight) {
        reasons.push(`VideoResolutionNotSupported:${video.Width}x${video.Height}`);
      }
      if ((video.BitDepth ?? 8) > cap.maxBitDepth) {
        reasons.push(`VideoBitDepthNotSupported:${video.BitDepth}`);
      }
    }
  }
  const audios = streams.filter(s => s.Type === 'Audio');
  const audio =
    audios.find(s => s.Index === audioStreamIndex) ??
    audios.find(s => s.Index === source.DefaultAudioStreamIndex) ??
    audios[0];
  if (audio) {
    if (!caps.audio.includes(norm(audio.Codec))) {
      reasons.push(`AudioCodecNotSupported:${audio.Codec ?? '?'}`);
    }
    if ((audio.Channels ?? 2) > caps.maxAudioChannels) {
      reasons.push(`AudioChannelsNotSupported:${audio.Channels}`);
    }
  }
  const limit = Math.min(caps.maxStreamingBitrate, maxBitrate ?? Infinity);
  if (source.Bitrate && source.Bitrate > limit) {
    reasons.push(`ContainerBitrateExceedsLimit:${source.Bitrate}`);
  }
  return reasons;
}

const VIDEO_REASONS = ['VideoCodecNotSupported', 'VideoResolutionNotSupported', 'VideoBitDepthNotSupported', 'ContainerBitrateExceedsLimit'];

export interface PlanContext {
  baseUrl: string;
  token: string;
  deviceId: string;
}

/** Text subtitle tracks are always side-loaded as server-converted WebVTT so switching is instant. */
export function subtitleTracksFor(
  itemId: string,
  source: MediaSourceDto,
  ctx: PlanContext,
  burnInIndex?: number,
): SubtitleTrack[] {
  const inFile = (source.MediaStreams ?? []).filter(s => s.Type === 'Subtitle' && !s.IsExternal).map(s => s.Index);
  return (source.MediaStreams ?? [])
    .filter(s => s.Type === 'Subtitle')
    .map((s: MediaStreamDto) => {
      const t = mapSubtitle(s, ctx.baseUrl);
      const isImage = IMAGE_SUBTITLE_FORMATS.includes(norm(s.Codec)) || s.IsTextSubtitleStream === false;
      if (!isImage) {
        const url =
          `${ctx.baseUrl}/Videos/${encodeURIComponent(itemId)}/${encodeURIComponent(source.Id)}` +
          `/Subtitles/${s.Index}/0/Stream.vtt${buildQuery({ api_key: ctx.token })}`;
        return { ...t, delivery: 'external', url, mimeType: 'text/vtt' };
      }
      if (s.Index === burnInIndex) {
        return { ...t, delivery: 'burn-in', url: undefined, mimeType: undefined };
      }
      const at = inFile.indexOf(s.Index);
      return { ...t, delivery: 'embedded', url: undefined, mimeType: undefined, containerPosition: at < 0 ? undefined : at };
    });
}

/**
 * Combines the server's PlaybackInfo answer with the client-side decision into a playable plan.
 * DirectPlay: static file stream. Otherwise the server's TranscodingUrl (HLS).
 */
export function buildPlan(
  req: PlaybackRequest,
  sources: MediaSourceDto[],
  playSessionId: string,
  caps: DeviceCapabilities,
  ctx: PlanContext,
): PlaybackPlan {
  const source = (req.mediaSourceId && sources.find(s => s.Id === req.mediaSourceId)) || sources[0];
  if (!source) {
    throw new BackendError('Server returned no playable media source', 'unsupported');
  }
  const streams = source.MediaStreams ?? [];
  const audioIndex = req.audioStreamIndex ?? source.DefaultAudioStreamIndex ?? streams.find(s => s.Type === 'Audio')?.Index;
  const subIndex = req.subtitleStreamIndex ?? source.DefaultSubtitleStreamIndex;
  const selectedSub = streams.find(s => s.Type === 'Subtitle' && s.Index === subIndex);

  const reasons = directPlayBlockers(source, caps, audioIndex, req.maxBitrate);
  // A selected bitmap subtitle in a container ExoPlayer cannot read it from needs burning in.
  const imageSubSelected = !!selectedSub && (IMAGE_SUBTITLE_FORMATS.includes(norm(selectedSub.Codec)) || selectedSub.IsTextSubtitleStream === false);
  if (imageSubSelected && !['mkv', 'matroska', 'ts', 'mpegts'].some(c => norm(source.Container).split(',').includes(c))) {
    reasons.push(`SubtitleCodecNotSupported:${selectedSub?.Codec}`);
  }
  const canDirect = reasons.length === 0 && source.SupportsDirectPlay !== false;
  if (reasons.length === 0 && source.SupportsDirectPlay === false) {
    reasons.push('ServerDeniedDirectPlay');
  }

  const durationMs = ticksToMs(source.RunTimeTicks);
  const startPositionMs = req.startPositionMs ?? 0;
  const headers: Record<string, string> = {};
  const common = {
    itemId: req.itemId,
    mediaSourceId: source.Id,
    playSessionId,
    startPositionMs,
    durationMs,
    container: source.Container,
    audioTracks: streams.filter(s => s.Type === 'Audio').map(mapAudio),
    selectedAudioIndex: audioIndex,
    selectedSubtitleIndex: subIndex !== undefined && subIndex >= 0 ? subIndex : undefined,
    headers,
  };

  if (canDirect) {
    const url =
      `${ctx.baseUrl}/Videos/${encodeURIComponent(req.itemId)}/stream` +
      buildQuery({
        static: true,
        mediaSourceId: source.Id,
        playSessionId,
        deviceId: ctx.deviceId,
        api_key: ctx.token,
      });
    return {
      ...common,
      method: 'DirectPlay',
      reasons: [],
      url,
      streamType: 'progressive',
      subtitleTracks: subtitleTracksFor(req.itemId, source, ctx),
    };
  }

  if (!source.TranscodingUrl || source.SupportsTranscoding === false) {
    throw new BackendError(`This item cannot be played on this device (${reasons.join(', ')})`, 'unsupported');
  }
  let url = /^https?:/i.test(source.TranscodingUrl) ? source.TranscodingUrl : `${ctx.baseUrl}${source.TranscodingUrl}`;
  // The access token is appended below, so it must not be sent to a host the user did not sign in to.
  if (originOf(url) !== originOf(ctx.baseUrl)) {
    throw new BackendError('The server sent a stream address on a different host, so it was not opened.', 'unsupported');
  }
  if (!/[?&]api_key=/i.test(url)) {
    url += `${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(ctx.token)}`;
  }
  // A bitmap subtitle cannot travel inside the HLS stream to the player, so once the server is
  // remuxing or transcoding anyway, it has to burn the subtitle into the picture. Make that
  // explicit in the URL in case the server picked another delivery method.
  const burn = imageSubSelected ? subIndex : undefined;
  if (burn !== undefined) {
    url = withQueryParams(url, { SubtitleMethod: 'Encode', SubtitleStreamIndex: String(burn) });
  }
  const videoOk = !reasons.some(r => VIDEO_REASONS.includes(r.split(':')[0]));
  return {
    ...common,
    method: videoOk && burn === undefined ? 'DirectStream' : 'Transcode',
    reasons,
    url,
    streamType: norm(source.TranscodingSubProtocol) === 'hls' || /\.m3u8/i.test(url) ? 'hls' : 'progressive',
    container: source.TranscodingContainer ?? 'ts',
    subtitleTracks: subtitleTracksFor(req.itemId, source, ctx, burn),
  };
}

/** Scheme, host and port of an http(s) URL, lower-cased; undefined for anything else. */
export function originOf(url: string): string | undefined {
  const m = /^(https?):\/\/([^/?#]+)/i.exec(url);
  if (!m) {
    return undefined;
  }
  const scheme = m[1].toLowerCase();
  const host = m[2].toLowerCase().replace(scheme === 'http' ? /:80$/ : /:443$/, '');
  return `${scheme}://${host}`;
}

/** Sets (or replaces) query parameters on a URL, matching existing names case-insensitively. */
export function withQueryParams(url: string, params: Record<string, string>): string {
  const [path, query = ''] = url.split('?', 2);
  const parts = query ? query.split('&') : [];
  for (const [key, value] of Object.entries(params)) {
    const at = parts.findIndex(p => p.split('=')[0].toLowerCase() === key.toLowerCase());
    const pair = `${key}=${encodeURIComponent(value)}`;
    if (at >= 0) {
      parts[at] = pair;
    } else {
      parts.push(pair);
    }
  }
  return parts.length ? `${path}?${parts.join('&')}` : path;
}
