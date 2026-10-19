import type { DeviceCapabilities } from '../../player/capabilities';

/**
 * Translates {@link DeviceCapabilities} into a Jellyfin DeviceProfile for POST /Items/{id}/PlaybackInfo.
 * Direct play is offered for every container ExoPlayer can demux with the decodable codecs; anything
 * else is transcoded to HLS (MPEG-TS segments) with h264 (or hevc when the device has it) + aac/ac3.
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

export function buildDeviceProfile(
  caps: DeviceCapabilities,
  name = 'xelpfin',
): JellyfinDeviceProfile {
  const videoCodecs = caps.video.map(v => v.codec);
  const audioCodecs = caps.audio;
  const vc = videoCodecs.join(',');
  const ac = audioCodecs.join(',');
  const hlsVideo = [
    'h264',
    ...(videoCodecs.includes('hevc') ? ['hevc'] : []),
  ].join(',');
  const hlsAudio = [
    'aac',
    ...(audioCodecs.includes('ac3') ? ['ac3'] : []),
    ...(audioCodecs.includes('eac3') ? ['eac3'] : []),
  ].join(',');

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
      ],
    }),
  );
  codecProfiles.push({
    Type: 'VideoAudio',
    Conditions: [
      {
        Condition: 'LessThanEqual',
        Property: 'AudioChannels',
        Value: String(caps.maxAudioChannels),
        IsRequired: false,
      },
    ],
  });

  return {
    Name: name,
    MaxStreamingBitrate: caps.maxStreamingBitrate,
    MaxStaticBitrate: caps.maxStreamingBitrate,
    MusicStreamingTranscodingBitrate: 192000,
    DirectPlayProfiles: caps.containers.map(c => ({
      Container: c,
      Type: 'Video',
      VideoCodec: vc,
      AudioCodec: ac,
    })),
    TranscodingProfiles: [
      {
        Container: 'ts',
        Type: 'Video',
        VideoCodec: hlsVideo,
        AudioCodec: hlsAudio,
        Protocol: 'hls',
        Context: 'Streaming',
        MaxAudioChannels: String(caps.maxAudioChannels),
        MinSegments: 1,
        BreakOnNonKeyFrames: true,
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
