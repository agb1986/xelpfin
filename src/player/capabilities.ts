/**
 * What the playback device can decode, what its display can show and what its audio sink
 * accepts. Platform adapters produce this (Android: MediaCodecList, Display.getHdrCapabilities
 * and AudioManager); backends turn it into their own negotiation format (Jellyfin:
 * DeviceProfile). Codec names follow the ffmpeg/Jellyfin convention: h264, hevc, vp9, av1,
 * aac, ac3, ...
 */
export interface VideoCodecCap {
  codec: string;
  maxWidth: number;
  maxHeight: number;
  /** Highest bit depth the decoder handles (8 or 10). */
  maxBitDepth: number;
  hardware: boolean;
}

/** HDR formats a display can show. */
export type HdrFormat = 'hdr10' | 'hdr10plus' | 'hlg' | 'dolbyvision';

/** Compressed audio the sink (TV or receiver on HDMI) decodes itself when it is bitstreamed. */
export interface AudioPassthroughCap {
  /** Codecs the sink accepts: ac3, eac3, truehd, dts. */
  codecs: string[];
  /** Highest channel count the sink reports; 0 when unknown. */
  maxChannels: number;
}

export interface DeviceCapabilities {
  video: VideoCodecCap[];
  audio: string[];
  containers: string[];
  /** Highest bitrate for a stream the server transcodes or remuxes (MaxStreamingBitrate). */
  maxStreamingBitrate: number;
  /** Highest bitrate for the original file served as it is (MaxStaticBitrate, direct play). */
  maxStaticBitrate: number;
  maxAudioChannels: number;
  /** HDR formats the display shows; empty means SDR only. */
  hdr: HdrFormat[];
  /**
   * What the audio sink accepts as a bitstream. It is not part of `audio` until
   * {@link withAudioPassthrough} merges it, so passthrough stays a user choice.
   */
  passthrough: AudioPassthroughCap;
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

/** Display.getHdrCapabilities().getSupportedHdrTypes() of the default display. */
export interface AndroidDisplayCapabilities {
  hdrTypes: number[];
}

/** Encodings and channel counts of the audio output devices (AudioManager.getDevices). */
export interface AndroidAudioCapabilities {
  encodings: number[];
  maxChannels: number;
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

// Display.HdrCapabilities.HDR_TYPE_* constants.
const ANDROID_HDR_TYPE: Record<number, HdrFormat> = {
  1: 'dolbyvision',
  2: 'hdr10',
  3: 'hlg',
  4: 'hdr10plus',
};

// AudioFormat.ENCODING_* constants of the compressed formats a sink can take as a bitstream.
const ANDROID_PASSTHROUGH_ENCODING: Record<number, string> = {
  5: 'ac3', // ENCODING_AC3
  6: 'eac3', // ENCODING_E_AC3
  7: 'dts', // ENCODING_DTS
  8: 'dts', // ENCODING_DTS_HD
  14: 'truehd', // ENCODING_DOLBY_TRUEHD
  18: 'eac3', // ENCODING_E_AC3_JOC
  19: 'truehd', // ENCODING_DOLBY_MAT
  29: 'dts', // ENCODING_DTS_HD_MA
};

/**
 * Codecs advertised only with a hardware decoder. The software AV1 and VP9 decoders Android
 * ships cannot keep up with 4K on a stick, and a transcode to h264 plays better than a stutter.
 */
const HARDWARE_ONLY_VIDEO = ['av1', 'vp9'];

// MediaCodecInfo.CodecProfileLevel constants for 10-bit profiles.
const HEVC_MAIN10 = [0x2, 0x1000, 0x2000]; // Main10, Main10HDR10, Main10HDR10Plus
const VP9_PROFILE2 = [0x4, 0x1000, 0x2000]; // Profile2, Profile2HDR, Profile2HDR10Plus
const AV1_MAIN10 = [0x2, 0x1000, 0x2000];

function tenBit(codec: string, profiles: number[] = []): boolean {
  const set =
    codec === 'hevc'
      ? HEVC_MAIN10
      : codec === 'vp9'
        ? VP9_PROFILE2
        : codec === 'av1'
          ? AV1_MAIN10
          : [];
  return profiles.some(p => set.includes(p));
}

/** ExoPlayer (media3) extractors that react-native-video ships. */
export const EXOPLAYER_CONTAINERS = [
  'mp4',
  'm4v',
  'mov',
  'mkv',
  'webm',
  'ts',
  'mpegts',
  'avi',
  'flv',
  'ogg',
];

export const EXOPLAYER_SUBTITLES = {
  embedded: [
    'srt',
    'subrip',
    'ass',
    'ssa',
    'vtt',
    'webvtt',
    'pgssub',
    'dvdsub',
    'dvbsub',
    'ttml',
  ],
  external: ['srt', 'subrip', 'vtt', 'webvtt', 'ttml'],
};

/** Bitrate a transcoded stream may have unless the user caps it lower. */
export const DEFAULT_STREAMING_BITRATE = 40_000_000;
/** Bitrate the original file may have for direct play; a UHD remux sits well under it. */
export const DEFAULT_STATIC_BITRATE = 100_000_000;
/** Channels the device decodes to PCM itself (5.1); more only with passthrough. */
export const DEFAULT_AUDIO_CHANNELS = 6;

/** Maps Display.HdrCapabilities types onto {@link HdrFormat}; unknown numbers are ignored. */
export function hdrFromAndroid(
  display?: AndroidDisplayCapabilities,
): HdrFormat[] {
  const out = new Set<HdrFormat>();
  const types = Array.isArray(display?.hdrTypes) ? display.hdrTypes : [];
  for (const t of types) {
    const format = ANDROID_HDR_TYPE[t];
    if (format) {
      out.add(format);
    }
  }
  return [...out].sort();
}

/** Maps AudioDeviceInfo encodings onto the codecs a sink accepts as a bitstream. */
export function passthroughFromAndroid(
  audio?: AndroidAudioCapabilities,
): AudioPassthroughCap {
  const codecs = new Set<string>();
  const encodings = Array.isArray(audio?.encodings) ? audio.encodings : [];
  for (const e of encodings) {
    const codec = ANDROID_PASSTHROUGH_ENCODING[e];
    if (codec) {
      codecs.add(codec);
    }
  }
  const channels = Number(audio?.maxChannels ?? 0);
  return {
    codecs: [...codecs].sort(),
    maxChannels: Number.isFinite(channels) && channels > 0 ? channels : 0,
  };
}

export interface AndroidCapabilityOptions {
  display?: AndroidDisplayCapabilities;
  audio?: AndroidAudioCapabilities;
  maxStreamingBitrate?: number;
  maxStaticBitrate?: number;
  maxAudioChannels?: number;
}

/** Maps an Android MediaCodecList dump (plus display and audio sink queries) onto {@link DeviceCapabilities}. */
export function capabilitiesFromAndroid(
  decoders: AndroidDecoder[],
  opts: AndroidCapabilityOptions = {},
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
    video: [...video.values()]
      .filter(v => v.hardware || !HARDWARE_ONLY_VIDEO.includes(v.codec))
      .sort((a, b) => a.codec.localeCompare(b.codec)),
    audio: [...audio].sort(),
    containers: EXOPLAYER_CONTAINERS,
    maxStreamingBitrate: opts.maxStreamingBitrate ?? DEFAULT_STREAMING_BITRATE,
    maxStaticBitrate: opts.maxStaticBitrate ?? DEFAULT_STATIC_BITRATE,
    maxAudioChannels: opts.maxAudioChannels ?? DEFAULT_AUDIO_CHANNELS,
    hdr: hdrFromAndroid(opts.display),
    passthrough: passthroughFromAndroid(opts.audio),
    subtitles: EXOPLAYER_SUBTITLES,
  };
}

/**
 * Conservative profile used when the platform cannot enumerate decoders (tests, Vega stub).
 * Matches the Fire TV Stick 4K (2nd gen) class of device: HDR10 and HLG on the display, no
 * Dolby Vision (wrong colours on a display without it) and nothing bitstreamed to the sink.
 */
export const BASELINE_CAPABILITIES: DeviceCapabilities = {
  video: [
    {
      codec: 'h264',
      maxWidth: 1920,
      maxHeight: 1080,
      maxBitDepth: 8,
      hardware: true,
    },
    {
      codec: 'hevc',
      maxWidth: 3840,
      maxHeight: 2160,
      maxBitDepth: 10,
      hardware: true,
    },
    {
      codec: 'vp9',
      maxWidth: 3840,
      maxHeight: 2160,
      maxBitDepth: 10,
      hardware: true,
    },
  ],
  audio: ['aac', 'ac3', 'eac3', 'flac', 'mp3', 'opus', 'vorbis'],
  containers: EXOPLAYER_CONTAINERS,
  maxStreamingBitrate: DEFAULT_STREAMING_BITRATE,
  maxStaticBitrate: DEFAULT_STATIC_BITRATE,
  maxAudioChannels: DEFAULT_AUDIO_CHANNELS,
  hdr: ['hdr10', 'hlg'],
  passthrough: { codecs: [], maxChannels: 0 },
  subtitles: EXOPLAYER_SUBTITLES,
};

/** Applies a user bitrate cap (settings) to streaming and direct play without mutating the input. */
export function withBitrateCap(
  caps: DeviceCapabilities,
  maxBitrate?: number,
): DeviceCapabilities {
  if (!maxBitrate) {
    return caps;
  }
  return {
    ...caps,
    maxStreamingBitrate: Math.min(caps.maxStreamingBitrate, maxBitrate),
    maxStaticBitrate: Math.min(caps.maxStaticBitrate, maxBitrate),
  };
}

/**
 * Applies the audio passthrough setting. On, the formats the sink accepts as a bitstream count
 * as playable and its channel count lifts the limit (7.1 TrueHD or DTS-HD stays as it is).
 * Off, the device decodes everything itself and the sink's formats are ignored.
 */
export function withAudioPassthrough(
  caps: DeviceCapabilities,
  enabled: boolean,
): DeviceCapabilities {
  if (!enabled) {
    return caps;
  }
  const audio = [
    ...new Set([...caps.audio, ...caps.passthrough.codecs]),
  ].sort();
  const maxAudioChannels = Math.max(
    caps.maxAudioChannels,
    caps.passthrough.maxChannels,
  );
  if (
    audio.length === caps.audio.length &&
    maxAudioChannels === caps.maxAudioChannels
  ) {
    return caps;
  }
  return { ...caps, audio, maxAudioChannels };
}
