import {
  BASELINE_CAPABILITIES,
  capabilitiesFromAndroid,
  withBitrateCap,
} from '../../src/player/capabilities';
import { buildDeviceProfile } from '../../src/backend/jellyfin/deviceProfile';

describe('capabilitiesFromAndroid', () => {
  it('maps MediaCodecList MIME types and merges decoders of the same codec', () => {
    const caps = capabilitiesFromAndroid([
      {
        mime: 'video/avc',
        name: 'c2.android.avc.decoder',
        hardware: false,
        maxWidth: 4096,
        maxHeight: 4096,
      },
      {
        mime: 'video/avc',
        name: 'OMX.hw.avc',
        hardware: true,
        maxWidth: 1920,
        maxHeight: 1088,
      },
      {
        mime: 'video/hevc',
        name: 'OMX.hw.hevc',
        hardware: true,
        maxWidth: 3840,
        maxHeight: 2160,
        profiles: [1, 2],
      },
      {
        mime: 'video/x-vnd.on2.vp9',
        name: 'c2.vp9',
        hardware: false,
        profiles: [1],
      },
      { mime: 'audio/mp4a-latm', name: 'aac', hardware: false },
      { mime: 'audio/ac3', name: 'ac3', hardware: true },
      { mime: 'audio/x-unknown', name: 'x', hardware: false },
      { mime: 'image/png', name: 'x', hardware: false },
    ]);
    expect(caps.video).toEqual([
      {
        codec: 'h264',
        maxWidth: 4096,
        maxHeight: 4096,
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
        maxWidth: 1920,
        maxHeight: 1080,
        maxBitDepth: 8,
        hardware: false,
      },
    ]);
    expect(caps.audio).toEqual(['aac', 'ac3']);
    expect(caps.containers).toContain('mkv');
  });

  it('applies a bitrate cap without mutating', () => {
    const capped = withBitrateCap(BASELINE_CAPABILITIES, 8_000_000);
    expect(capped.maxStreamingBitrate).toBe(8_000_000);
    expect(BASELINE_CAPABILITIES.maxStreamingBitrate).toBe(40_000_000);
    expect(withBitrateCap(BASELINE_CAPABILITIES, undefined)).toBe(
      BASELINE_CAPABILITIES,
    );
  });
});

describe('buildDeviceProfile', () => {
  const p = buildDeviceProfile(BASELINE_CAPABILITIES);
  it('offers direct play for every container with the decodable codecs', () => {
    expect(p.DirectPlayProfiles.map(d => d.Container)).toEqual(
      BASELINE_CAPABILITIES.containers,
    );
    expect(p.DirectPlayProfiles[0].VideoCodec).toBe('h264,hevc,vp9');
    expect(p.DirectPlayProfiles[0].AudioCodec).toContain('ac3');
  });
  it('transcodes to HLS with h264/hevc and aac/ac3/eac3', () => {
    expect(p.TranscodingProfiles).toEqual([
      expect.objectContaining({
        Container: 'ts',
        Protocol: 'hls',
        VideoCodec: 'h264,hevc',
        AudioCodec: 'aac,ac3,eac3',
      }),
    ]);
  });
  it('limits resolution and bit depth per codec', () => {
    const h264 = p.CodecProfiles.find(c => c.Codec === 'h264')!;
    expect(h264.Conditions).toContainEqual(
      expect.objectContaining({ Property: 'Width', Value: '1920' }),
    );
    expect(h264.Conditions).toContainEqual(
      expect.objectContaining({ Property: 'VideoBitDepth', Value: '8' }),
    );
  });
  it('side-loads text subtitles and embeds or burns bitmap ones', () => {
    expect(p.SubtitleProfiles).toContainEqual({
      Format: 'srt',
      Method: 'External',
    });
    expect(p.SubtitleProfiles).toContainEqual({
      Format: 'pgssub',
      Method: 'Embed',
    });
    expect(p.SubtitleProfiles).toContainEqual({
      Format: 'pgssub',
      Method: 'Encode',
    });
  });
});
