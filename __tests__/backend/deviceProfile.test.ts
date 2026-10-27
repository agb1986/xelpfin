import {
  BASELINE_CAPABILITIES,
  withAudioPassthrough,
  type DeviceCapabilities,
} from '../../src/player/capabilities';
import {
  buildDeviceProfile,
  videoRangeTypes,
} from '../../src/backend/jellyfin/deviceProfile';

const rangeTypes = (p: ReturnType<typeof buildDeviceProfile>, codec: string) =>
  p.CodecProfiles.find(c => c.Codec === codec)!
    .Conditions.find(c => c.Property === 'VideoRangeType')!
    .Value.split('|');

describe('buildDeviceProfile', () => {
  const p = buildDeviceProfile(BASELINE_CAPABILITIES);

  it('offers direct play for every container with the decodable codecs', () => {
    expect(p.DirectPlayProfiles.map(d => d.Container)).toEqual(
      BASELINE_CAPABILITIES.containers,
    );
    expect(p.DirectPlayProfiles[0].VideoCodec).toBe('h264,hevc,vp9');
    expect(p.DirectPlayProfiles[0].AudioCodec).toContain('ac3');
  });

  it('remuxes or transcodes to fMP4 HLS first, with h264 and aac as the encode targets', () => {
    expect(p.TranscodingProfiles[0]).toEqual({
      Container: 'mp4',
      Type: 'Video',
      Protocol: 'hls',
      Context: 'Streaming',
      VideoCodec: 'h264,hevc',
      AudioCodec: 'aac,mp3,ac3,eac3,opus,flac',
      MaxAudioChannels: '6',
      MinSegments: 1,
      BreakOnNonKeyFrames: true,
    });
  });

  it('keeps MPEG-TS HLS as the fallback with the codecs ffmpeg muxes into it', () => {
    expect(p.TranscodingProfiles).toHaveLength(2);
    expect(p.TranscodingProfiles[1]).toEqual(
      expect.objectContaining({
        Container: 'ts',
        Protocol: 'hls',
        VideoCodec: 'h264,hevc',
        AudioCodec: 'aac,mp3,ac3,eac3',
      }),
    );
  });

  it('offers only MPEG-TS HLS when asked to avoid fMP4', () => {
    const ts = buildDeviceProfile(BASELINE_CAPABILITIES, 'xelpfin', {
      avoidFmp4: true,
    });
    expect(ts.TranscodingProfiles.map(t => t.Container)).toEqual(['ts']);
  });

  it('adds av1 to the fMP4 profile only when the device decodes it, never to ts', () => {
    const caps: DeviceCapabilities = {
      ...BASELINE_CAPABILITIES,
      video: [
        ...BASELINE_CAPABILITIES.video,
        {
          codec: 'av1',
          maxWidth: 3840,
          maxHeight: 2160,
          maxBitDepth: 10,
          hardware: true,
        },
      ],
    };
    const [fmp4, ts] = buildDeviceProfile(caps).TranscodingProfiles;
    expect(fmp4.VideoCodec).toBe('h264,hevc,av1');
    expect(ts.VideoCodec).toBe('h264,hevc');
    expect(p.TranscodingProfiles[0].VideoCodec).not.toContain('av1');
  });

  it('separates the direct play bitrate from the streaming bitrate', () => {
    expect(p.MaxStreamingBitrate).toBe(40_000_000);
    expect(p.MaxStaticBitrate).toBe(100_000_000);
    const capped = buildDeviceProfile({
      ...BASELINE_CAPABILITIES,
      maxStreamingBitrate: 8_000_000,
      maxStaticBitrate: 20_000_000,
    });
    expect(capped.MaxStreamingBitrate).toBe(8_000_000);
    expect(capped.MaxStaticBitrate).toBe(20_000_000);
  });

  it('limits resolution and bit depth per codec', () => {
    const h264 = p.CodecProfiles.find(c => c.Codec === 'h264')!;
    expect(h264.Conditions).toContainEqual(
      expect.objectContaining({ Property: 'Width', Value: '1920' }),
    );
    expect(h264.Conditions).toContainEqual(
      expect.objectContaining({ Property: 'VideoBitDepth', Value: '8' }),
    );
    expect(h264.Conditions).toContainEqual(
      expect.objectContaining({
        Condition: 'EqualsAny',
        Property: 'VideoRangeType',
        IsRequired: false,
      }),
    );
  });

  describe('VideoRangeType per display', () => {
    it('allows only SDR on an 8-bit codec whatever the display', () => {
      expect(rangeTypes(p, 'h264')).toEqual(['SDR', 'DOVIWithSDR']);
      const dv = buildDeviceProfile({
        ...BASELINE_CAPABILITIES,
        hdr: ['hdr10', 'hlg', 'dolbyvision', 'hdr10plus'],
      });
      expect(rangeTypes(dv, 'h264')).toEqual(['SDR', 'DOVIWithSDR']);
    });

    it('allows only SDR on an SDR display even for 10-bit codecs', () => {
      const sdr = buildDeviceProfile({ ...BASELINE_CAPABILITIES, hdr: [] });
      expect(rangeTypes(sdr, 'hevc')).toEqual(['SDR', 'DOVIWithSDR']);
      expect(rangeTypes(sdr, 'vp9')).toEqual(['SDR', 'DOVIWithSDR']);
    });

    it('allows HDR10 and HLG (plus the Dolby Vision profiles built on them) on the baseline', () => {
      expect(rangeTypes(p, 'hevc')).toEqual([
        'SDR',
        'DOVIWithSDR',
        'HDR10',
        'HDR10Plus',
        'DOVIWithHDR10',
        'HLG',
        'DOVIWithHLG',
      ]);
      expect(rangeTypes(p, 'hevc')).not.toContain('DOVI');
    });

    it('allows HDR10 without HLG and the other way round', () => {
      const hdr10 = buildDeviceProfile({
        ...BASELINE_CAPABILITIES,
        hdr: ['hdr10'],
      });
      expect(rangeTypes(hdr10, 'hevc')).toEqual([
        'SDR',
        'DOVIWithSDR',
        'HDR10',
        'HDR10Plus',
        'DOVIWithHDR10',
      ]);
      const hlg = buildDeviceProfile({
        ...BASELINE_CAPABILITIES,
        hdr: ['hlg'],
      });
      expect(rangeTypes(hlg, 'hevc')).toEqual([
        'SDR',
        'DOVIWithSDR',
        'HLG',
        'DOVIWithHLG',
      ]);
    });

    it('treats an HDR10+ display as HDR10 capable', () => {
      expect(videoRangeTypes({ maxBitDepth: 10 }, ['hdr10plus'])).toEqual([
        'SDR',
        'DOVIWithSDR',
        'HDR10',
        'HDR10Plus',
        'DOVIWithHDR10',
      ]);
    });

    it('allows profile 5 Dolby Vision only on a Dolby Vision display', () => {
      const dv = buildDeviceProfile({
        ...BASELINE_CAPABILITIES,
        hdr: ['dolbyvision', 'hdr10'],
      });
      expect(rangeTypes(dv, 'hevc')).toEqual([
        'SDR',
        'DOVIWithSDR',
        'HDR10',
        'HDR10Plus',
        'DOVIWithHDR10',
        'DOVI',
      ]);
    });
  });

  describe('audio', () => {
    it('limits the channel count from the capabilities', () => {
      const va = p.CodecProfiles.find(c => c.Type === 'VideoAudio')!;
      expect(va.Conditions).toEqual([
        {
          Condition: 'LessThanEqual',
          Property: 'AudioChannels',
          Value: '6',
          IsRequired: false,
        },
      ]);
      expect(p.TranscodingProfiles.map(t => t.MaxAudioChannels)).toEqual([
        '6',
        '6',
      ]);
    });

    it('raises the channel count and adds bitstream codecs with passthrough on', () => {
      const sink: DeviceCapabilities = {
        ...BASELINE_CAPABILITIES,
        passthrough: {
          codecs: ['ac3', 'eac3', 'truehd', 'dts'],
          maxChannels: 8,
        },
      };
      const off = buildDeviceProfile(withAudioPassthrough(sink, false));
      expect(off.DirectPlayProfiles[0].AudioCodec).not.toContain('truehd');
      expect(off.TranscodingProfiles[0].AudioCodec).not.toContain('dts');
      expect(off.TranscodingProfiles[0].MaxAudioChannels).toBe('6');

      const on = buildDeviceProfile(withAudioPassthrough(sink, true));
      expect(on.DirectPlayProfiles[0].AudioCodec).toBe(
        'aac,ac3,dts,eac3,flac,mp3,opus,truehd,vorbis',
      );
      expect(on.TranscodingProfiles[0].AudioCodec).toBe(
        'aac,mp3,ac3,eac3,opus,flac,dts',
      );
      expect(on.TranscodingProfiles[1].AudioCodec).toBe('aac,mp3,ac3,eac3');
      expect(on.TranscodingProfiles[0].MaxAudioChannels).toBe('8');
      const va = on.CodecProfiles.find(c => c.Type === 'VideoAudio')!;
      expect(va.Conditions[0].Value).toBe('8');
    });
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

  it('names the profile', () => {
    expect(p.Name).toBe('xelpfin');
    expect(buildDeviceProfile(BASELINE_CAPABILITIES, 'stick').Name).toBe(
      'stick',
    );
  });
});
