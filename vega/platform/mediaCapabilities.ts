import {
  AudioDecoderConfig,
  CodecMimeType,
  KeplerMediaDescriptor,
  MediaFormat,
  VideoDecoderConfig,
} from '@amazon-devices/keplermediadescriptor';
import { MediaSource } from '@amazon-devices/react-native-w3cmedia';
import {
  capabilitiesFromVega,
  type DeviceCapabilities,
  type VegaVideoProbe,
} from '../../src/player/capabilities';

const VIDEO: Array<{ codec: string; mime: CodecMimeType; tenBitType: string }> =
  [
    {
      codec: 'h264',
      mime: CodecMimeType.MIME_AVC,
      tenBitType: 'video/mp4; codecs="avc1.6E0033"',
    },
    {
      codec: 'hevc',
      mime: CodecMimeType.MIME_HEVC,
      tenBitType: 'video/mp4; codecs="hvc1.2.4.L120.B0"',
    },
    {
      codec: 'vp9',
      mime: CodecMimeType.MIME_VP9,
      tenBitType: 'video/webm; codecs="vp09.02.10.10"',
    },
    {
      codec: 'av1',
      mime: CodecMimeType.MIME_AV1,
      tenBitType: 'video/mp4; codecs="av01.0.08M.10"',
    },
  ];

const AUDIO: Array<{ codec: string; mime: CodecMimeType }> = [
  { codec: 'aac', mime: CodecMimeType.MIME_AAC_LATM },
  { codec: 'mp3', mime: CodecMimeType.MIME_MP3 },
  { codec: 'ac3', mime: CodecMimeType.MIME_AC3 },
  { codec: 'eac3', mime: CodecMimeType.MIME_EAC3 },
  { codec: 'opus', mime: CodecMimeType.MIME_OPUS },
  { codec: 'flac', mime: CodecMimeType.MIME_FLAC },
  { codec: 'vorbis', mime: CodecMimeType.MIME_VORBIS },
];

function tenBitSupported(type: string): boolean {
  try {
    return MediaSource.isTypeSupported(type);
  } catch {
    return false;
  }
}

async function probeVideo(
  entry: (typeof VIDEO)[number],
): Promise<VegaVideoProbe | undefined> {
  const config = new VideoDecoderConfig();
  config.mediaFormat = new MediaFormat(entry.mime);
  const caps = await KeplerMediaDescriptor.queryMediaCapabilities(config);
  if (!caps.length) {
    return undefined;
  }
  let maxWidth = 0;
  let maxHeight = 0;
  let hardware = false;
  for (const c of caps as any[]) {
    hardware ||= Boolean(c.mediaCodecFeaturesCapabilities?.hardwareBacked);
    for (const r of c.videoFormatCapabilities?.resolutions ?? []) {
      if (r.width * r.height > maxWidth * maxHeight) {
        maxWidth = r.width;
        maxHeight = r.height;
      }
    }
  }
  return {
    codec: entry.codec,
    maxWidth,
    maxHeight,
    hardware,
    tenBit: tenBitSupported(entry.tenBitType),
  };
}

async function probeAudio(
  entry: (typeof AUDIO)[number],
): Promise<string | undefined> {
  const config = new AudioDecoderConfig();
  config.mediaFormat = new MediaFormat(entry.mime);
  const caps = await KeplerMediaDescriptor.queryMediaCapabilities(config);
  return caps.length ? entry.codec : undefined;
}

/** Asks the Vega media stack which decoders exist; a failed query counts as "not supported". */
export async function queryVegaCapabilities(): Promise<DeviceCapabilities> {
  const [video, audio] = await Promise.all([
    Promise.all(VIDEO.map(e => probeVideo(e).catch(() => undefined))),
    Promise.all(AUDIO.map(e => probeAudio(e).catch(() => undefined))),
  ]);
  return capabilitiesFromVega(
    video.filter((v): v is VegaVideoProbe => Boolean(v)),
    audio.filter((a): a is string => Boolean(a)),
  );
}
