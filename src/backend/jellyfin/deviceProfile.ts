import type {
  DeviceCapabilities,
  HdrFormat,
  VideoCodecCap,
} from '../../player/capabilities';

/**
 * Translates {@link DeviceCapabilities} into a Jellyfin DeviceProfile for POST /Items/{id}/PlaybackInfo.
 *
 * - Direct play: every container ExoPlayer demuxes, with every decodable codec.
 * - Direct stream (remux): the first transcoding profile is HLS with fMP4 segments and lists every
 *   codec ExoPlayer plays from fMP4, so when the codecs are fine the server only rewraps the
 *   container (PlayMethod DirectStream). When it has to encode it takes the first codec of each
 *   list: h264 and aac.
 * - Transcode fallback: HLS with MPEG-TS segments, for a server that cannot produce fMP4. With
 *   `avoidFmp4` it is the only profile, for a stream the player could not parse as fMP4.
 * - CodecProfiles limit resolution, bit depth and the HDR formats (VideoRangeType) per video codec,
 *   and the audio channel count.
 */
export interface JellyfinDeviceProfile {
  Name: string;
  MaxStreamingBitrate: number;
  MaxStaticBitrate: number;
  MusicStreamingTranscodingBitrate: number;
  DirectPlayProfiles: {
    Container: string;
    Type: 'Video' | 'Audio';
    VideoCodec?: string;
    AudioCodec?: string;
  }[];
  TranscodingProfiles: {
    Container: string;
    Type: 'Video' | 'Audio';
    VideoCodec?: string;
    AudioCodec: string;
    Protocol: 'hls' | 'http';
    Context: 'Streaming' | 'Static';
    MaxAudioChannels: string;
    MinSegments?: number;
    BreakOnNonKeyFrames?: boolean;
    CopyTimestamps?: boolean;
  }[];
  ContainerProfiles: unknown[];
  CodecProfiles: {
    Type: 'Video' | 'VideoAudio' | 'Audio';
    Codec?: string;
    Conditions: {
      Condition: string;
      Property: string;
      Value: string;
      IsRequired: boolean;
    }[];
  }[];
  SubtitleProfiles: {
    Format: string;
    Method: 'Embed' | 'External' | 'Encode' | 'Hls';
  }[];
}

/** Text subtitle formats xelpfin always side-loads as WebVTT (server-converted), so it can switch them freely. */
export const TEXT_SUBTITLE_FORMATS = [
  'srt',
  'subrip',
  'vtt',
  'webvtt',
  'ass',
  'ssa',
  'ttml',
  'mov_text',
  'sub',
];
/** Bitmap subtitles: rendered by ExoPlayer when embedded in mkv/ts, otherwise burned in. */
export const IMAGE_SUBTITLE_FORMATS = ['pgssub', 'dvdsub', 'dvbsub'];

/** Video codecs ExoPlayer plays from fMP4 HLS segments, so the server can stream-copy them. h264 first: it is the encode target. */
export const FMP4_VIDEO_CODECS = ['h264', 'hevc', 'av1'];
/** Audio codecs ExoPlayer plays from fMP4 HLS segments. aac first: it is the encode target. */
export const FMP4_AUDIO_CODECS = [
  'aac',
  'mp3',
  'ac3',
  'eac3',
  'opus',
  'flac',
  'dts',
];
/** What ffmpeg muxes into MPEG-TS and ExoPlayer reads back from it. */
export const TS_VIDEO_CODECS = ['h264', 'hevc'];
export const TS_AUDIO_CODECS = ['aac', 'mp3', 'ac3', 'eac3'];

/**
 * Jellyfin VideoRangeType values a codec may carry on this display. Every display shows SDR
 * streams, including Dolby Vision profiles with an SDR base layer (the enhancement is skipped).
 * HDR10+ and the Dolby Vision profiles with an HDR10 base layer decode as plain HDR10, HLG
 * likewise, so they follow the static formats. Profile 5 (DOVI) has no compatible base layer
 * and needs a Dolby Vision display.
 */
export function videoRangeTypes(
  cap: Pick<VideoCodecCap, 'maxBitDepth'>,
  hdr: HdrFormat[],
): string[] {
  const types = ['SDR', 'DOVIWithSDR'];
  if (cap.maxBitDepth < 10) {
    return types;
  }
  if (hdr.includes('hdr10') || hdr.includes('hdr10plus')) {
    types.push('HDR10', 'HDR10Plus', 'DOVIWithHDR10');
  }
  if (hdr.includes('hlg')) {
    types.push('HLG', 'DOVIWithHLG');
  }
  if (hdr.includes('dolbyvision')) {
    types.push('DOVI');
  }
  return types;
}

const keep = (order: string[], available: string[]) =>
  order.filter(c => available.includes(c));

export function buildDeviceProfile(
  caps: DeviceCapabilities,
  name = 'xelpfin',
  {
    avoidFmp4 = false,
    directPlay = true,
  }: { avoidFmp4?: boolean; directPlay?: boolean } = {},
): JellyfinDeviceProfile {
  const videoCodecs = caps.video.map(v => v.codec);
  const audioCodecs = caps.audio;
  const vc = videoCodecs.join(',');
  const ac = audioCodecs.join(',');
  const channels = String(caps.maxAudioChannels);

  const codecProfiles: JellyfinDeviceProfile['CodecProfiles'] = caps.video.map(
    v => ({
      Type: 'Video',
      Codec: v.codec,
      Conditions: [
        {
          Condition: 'LessThanEqual',
          Property: 'Width',
          Value: String(v.maxWidth),
          IsRequired: false,
        },
        {
          Condition: 'LessThanEqual',
          Property: 'Height',
          Value: String(v.maxHeight),
          IsRequired: false,
        },
        {
          Condition: 'LessThanEqual',
          Property: 'VideoBitDepth',
          Value: String(v.maxBitDepth),
          IsRequired: false,
        },
        {
          Condition: 'EqualsAny',
          Property: 'VideoRangeType',
          Value: videoRangeTypes(v, caps.hdr).join('|'),
          IsRequired: false,
        },
      ],
    }),
  );
  codecProfiles.push({
    Type: 'VideoAudio',
    Conditions: [
      {
        Condition: 'LessThanEqual',
        Property: 'AudioChannels',
        Value: channels,
        IsRequired: false,
      },
    ],
  });

  const hls = {
    Type: 'Video' as const,
    Protocol: 'hls' as const,
    Context: 'Streaming' as const,
    MaxAudioChannels: channels,
    MinSegments: 1,
    BreakOnNonKeyFrames: true,
  };

  return {
    Name: name,
    MaxStreamingBitrate: caps.maxStreamingBitrate,
    MaxStaticBitrate: caps.maxStaticBitrate,
    MusicStreamingTranscodingBitrate: 192000,
    DirectPlayProfiles: directPlay
      ? caps.containers.map(c => ({
          Container: c,
          Type: 'Video' as const,
          VideoCodec: vc,
          AudioCodec: ac,
        }))
      : [],
    TranscodingProfiles: [
      ...(avoidFmp4
        ? []
        : [
            {
              ...hls,
              Container: 'mp4',
              VideoCodec: keep(FMP4_VIDEO_CODECS, videoCodecs).join(','),
              AudioCodec: keep(FMP4_AUDIO_CODECS, audioCodecs).join(','),
            },
          ]),
      {
        ...hls,
        Container: 'ts',
        VideoCodec: keep(TS_VIDEO_CODECS, videoCodecs).join(','),
        AudioCodec: keep(TS_AUDIO_CODECS, audioCodecs).join(','),
      },
    ],
    ContainerProfiles: [],
    CodecProfiles: codecProfiles,
    SubtitleProfiles: [
      ...TEXT_SUBTITLE_FORMATS.map(f => ({
        Format: f,
        Method: 'External' as const,
      })),
      ...IMAGE_SUBTITLE_FORMATS.map(f => ({
        Format: f,
        Method: 'Embed' as const,
      })),
      ...IMAGE_SUBTITLE_FORMATS.map(f => ({
        Format: f,
        Method: 'Encode' as const,
      })),
    ],
  };
}
