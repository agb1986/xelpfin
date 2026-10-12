/**
 * What the playback device can decode. Platform adapters produce this (Android: MediaCodecList);
 * backends turn it into their own negotiation format (Jellyfin: DeviceProfile).
 * Codec names follow the ffmpeg/Jellyfin convention: h264, hevc, vp9, av1, aac, ac3, ...
 */
export interface VideoCodecCap {
  codec: string;
  maxWidth: number;
  maxHeight: number;
  /** Highest bit depth the decoder handles (8 or 10). */
  maxBitDepth: number;
  hardware: boolean;
}

export interface DeviceCapabilities {
  video: VideoCodecCap[];
  audio: string[];
  containers: string[];
  maxStreamingBitrate: number;
  maxAudioChannels: number;
  subtitles: {
    /** Formats the player renders when they are muxed in the container. */
    embedded: string[];
    /** Formats the player can load as a separate side-loaded file. */
    external: string[];
  };
}

export interface AndroidDecoder {
  mime: string;
  name: string;
  hardware: boolean;
  maxWidth?: number;
  maxHeight?: number;
  profiles?: number[];
}

const ANDROID_VIDEO_MIME: Record<string, string> = {
  'video/avc': 'h264',
  'video/hevc': 'hevc',
  'video/x-vnd.on2.vp9': 'vp9',
  'video/x-vnd.on2.vp8': 'vp8',
  'video/av01': 'av1',
  'video/mp4v-es': 'mpeg4',
  'video/mpeg2': 'mpeg2video',
  'video/3gpp': 'h263',
};

const ANDROID_AUDIO_MIME: Record<string, string[]> = {
  'audio/mp4a-latm': ['aac'],
  'audio/mpeg': ['mp3'],
  'audio/mpeg-l2': ['mp2'],
  'audio/ac3': ['ac3'],
  'audio/eac3': ['eac3'],
  'audio/eac3-joc': ['eac3'],
  'audio/opus': ['opus'],
  'audio/vorbis': ['vorbis'],
  'audio/flac': ['flac'],
  'audio/alac': ['alac'],
  'audio/vnd.dts': ['dts', 'dca'],
  'audio/vnd.dts.hd': ['dts', 'dca'],
  'audio/true-hd': ['truehd'],
  'audio/raw': ['pcm_s16le', 'pcm_s24le'],
};

// MediaCodecInfo.CodecProfileLevel constants for 10-bit profiles.
const HEVC_MAIN10 = [0x2, 0x1000, 0x2000]; // Main10, Main10HDR10, Main10HDR10Plus
const VP9_PROFILE2 = [0x4, 0x1000, 0x2000]; // Profile2, Profile2HDR, Profile2HDR10Plus
const AV1_MAIN10 = [0x2, 0x1000, 0x2000];

function tenBit(codec: string, profiles: number[] = []): boolean {
  const set = codec === 'hevc' ? HEVC_MAIN10 : codec === 'vp9' ? VP9_PROFILE2 : codec === 'av1' ? AV1_MAIN10 : [];
  return profiles.some(p => set.includes(p));
}

/** ExoPlayer (media3) extractors that react-native-video ships. */
export const EXOPLAYER_CONTAINERS = ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'ts', 'mpegts', 'avi', 'flv', 'ogg'];

export const EXOPLAYER_SUBTITLES = {
  embedded: ['srt', 'subrip', 'ass', 'ssa', 'vtt', 'webvtt', 'pgssub', 'dvdsub', 'dvbsub', 'ttml'],
  external: ['srt', 'subrip', 'vtt', 'webvtt', 'ttml'],
};

/** Maps an Android MediaCodecList dump onto {@link DeviceCapabilities}. */
export function capabilitiesFromAndroid(
  decoders: AndroidDecoder[],
  opts: { maxStreamingBitrate?: number; maxAudioChannels?: number } = {},
): DeviceCapabilities {
  const video = new Map<string, VideoCodecCap>();
  const audio = new Set<string>();
  for (const d of decoders) {
    const mime = d.mime.toLowerCase();
    const vcodec = ANDROID_VIDEO_MIME[mime];
    if (vcodec) {
      const prev = video.get(vcodec);
      const depth = tenBit(vcodec, d.profiles) ? 10 : 8;
      video.set(vcodec, {
        codec: vcodec,
        maxWidth: Math.max(prev?.maxWidth ?? 0, d.maxWidth ?? 1920),
        maxHeight: Math.max(prev?.maxHeight ?? 0, d.maxHeight ?? 1080),
        maxBitDepth: Math.max(prev?.maxBitDepth ?? 8, depth),
        hardware: (prev?.hardware ?? false) || d.hardware,
      });
      continue;
    }
    for (const a of ANDROID_AUDIO_MIME[mime] ?? []) {
      audio.add(a);
    }
  }
  return {
    video: [...video.values()].sort((a, b) => a.codec.localeCompare(b.codec)),
    audio: [...audio].sort(),
    containers: EXOPLAYER_CONTAINERS,
    maxStreamingBitrate: opts.maxStreamingBitrate ?? 40_000_000,
    maxAudioChannels: opts.maxAudioChannels ?? 6,
    subtitles: EXOPLAYER_SUBTITLES,
  };
}

/**
 * Conservative profile used when the platform cannot enumerate decoders (tests, Vega stub).
 * Matches the Fire TV Stick 4K (2nd gen) class of device.
 */
export const BASELINE_CAPABILITIES: DeviceCapabilities = {
  video: [
    { codec: 'h264', maxWidth: 1920, maxHeight: 1080, maxBitDepth: 8, hardware: true },
    { codec: 'hevc', maxWidth: 3840, maxHeight: 2160, maxBitDepth: 10, hardware: true },
    { codec: 'vp9', maxWidth: 3840, maxHeight: 2160, maxBitDepth: 10, hardware: true },
  ],
  audio: ['aac', 'ac3', 'eac3', 'flac', 'mp3', 'opus', 'vorbis'],
  containers: EXOPLAYER_CONTAINERS,
  maxStreamingBitrate: 40_000_000,
  maxAudioChannels: 6,
  subtitles: EXOPLAYER_SUBTITLES,
};

/** Applies a user bitrate cap (settings) without mutating the input. */
export function withBitrateCap(caps: DeviceCapabilities, maxBitrate?: number): DeviceCapabilities {
  if (!maxBitrate) {
    return caps;
  }
  return { ...caps, maxStreamingBitrate: Math.min(caps.maxStreamingBitrate, maxBitrate) };
}
