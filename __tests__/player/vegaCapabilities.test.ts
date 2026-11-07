import {
  BASELINE_CAPABILITIES,
  capabilitiesFromVega,
  type VegaVideoProbe,
} from '../../src/player/capabilities';

const probe = (over: Partial<VegaVideoProbe>): VegaVideoProbe => ({
  codec: 'h264',
  maxWidth: 1920,
  maxHeight: 1080,
  hardware: true,
  tenBit: false,
  ...over,
});

describe('capabilitiesFromVega', () => {
  it('falls back to the baseline when no video decoder is found', () => {
    expect(capabilitiesFromVega([], ['aac'])).toBe(BASELINE_CAPABILITIES);
  });

  it('maps decoders, sorts them and flags 10-bit', () => {
    const caps = capabilitiesFromVega(
      [
        probe({
          codec: 'hevc',
          maxWidth: 3840,
          maxHeight: 2160,
          tenBit: true,
        }),
        probe({ codec: 'h264' }),
      ],
      ['mp3', 'aac', 'aac'],
    );
    expect(caps.video.map(v => v.codec)).toEqual(['h264', 'hevc']);
    expect(caps.video[1]).toMatchObject({ maxWidth: 3840, maxBitDepth: 10 });
    expect(caps.audio).toEqual(['aac', 'mp3']);
    expect(caps.hdr).toEqual(['hdr10', 'hlg']);
  });

  it('assumes 1080p when the decoder lists no resolution', () => {
    const caps = capabilitiesFromVega(
      [probe({ maxWidth: 0, maxHeight: 0 })],
      [],
    );
    expect(caps.video[0]).toMatchObject({ maxWidth: 1920, maxHeight: 1080 });
    expect(caps.hdr).toEqual([]);
  });

  it('drops software-only AV1 and VP9', () => {
    const caps = capabilitiesFromVega(
      [
        probe({ codec: 'h264' }),
        probe({ codec: 'av1', hardware: false }),
        probe({ codec: 'vp9', hardware: false }),
      ],
      [],
    );
    expect(caps.video.map(v => v.codec)).toEqual(['h264']);
  });

  it('draws text subtitles itself and leaves embedded ones to the server', () => {
    const caps = capabilitiesFromVega([probe({})], []);
    expect(caps.subtitles.embedded).toEqual([]);
    expect(caps.subtitles.external).toContain('srt');
  });
});
