import {
  BASELINE_CAPABILITIES,
  capabilitiesFromAndroid,
  hdrFromAndroid,
  passthroughFromAndroid,
  withAudioPassthrough,
  withBitrateCap,
} from '../../src/player/capabilities';

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
        name: 'OMX.hw.vp9',
        hardware: true,
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
        hardware: true,
      },
    ]);
    expect(caps.audio).toEqual(['aac', 'ac3']);
    expect(caps.containers).toContain('mkv');
  });

  it('uses the defaults when no display or audio query is given', () => {
    const caps = capabilitiesFromAndroid([]);
    expect(caps.maxStreamingBitrate).toBe(40_000_000);
    expect(caps.maxStaticBitrate).toBe(100_000_000);
    expect(caps.maxAudioChannels).toBe(6);
    expect(caps.hdr).toEqual([]);
    expect(caps.passthrough).toEqual({ codecs: [], maxChannels: 0 });
  });

  it('keeps av1 and vp9 only with a hardware decoder, but h264 with any decoder', () => {
    const caps = capabilitiesFromAndroid([
      { mime: 'video/av01', name: 'c2.android.av1.decoder', hardware: false },
      { mime: 'video/x-vnd.on2.vp9', name: 'c2.android.vp9', hardware: false },
      { mime: 'video/avc', name: 'c2.android.avc.decoder', hardware: false },
    ]);
    expect(caps.video.map(v => v.codec)).toEqual(['h264']);

    const hw = capabilitiesFromAndroid([
      { mime: 'video/av01', name: 'c2.android.av1.decoder', hardware: false },
      {
        mime: 'video/av01',
        name: 'c2.hw.av1',
        hardware: true,
        maxWidth: 3840,
        maxHeight: 2160,
        profiles: [2],
      },
      { mime: 'video/x-vnd.on2.vp9', name: 'OMX.hw.vp9', hardware: true },
    ]);
    expect(hw.video).toEqual([
      {
        codec: 'av1',
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
        hardware: true,
      },
    ]);
  });

  it('maps the display HDR types and the audio sink encodings', () => {
    const caps = capabilitiesFromAndroid([], {
      display: { hdrTypes: [2, 3, 1, 4, 99] },
      audio: {
        encodings: [2, 5, 6, 7, 8, 14, 18, 19, 29, 1234],
        maxChannels: 8,
      },
      maxStreamingBitrate: 20_000_000,
      maxStaticBitrate: 50_000_000,
      maxAudioChannels: 2,
    });
    expect(caps.hdr).toEqual(['dolbyvision', 'hdr10', 'hdr10plus', 'hlg']);
    expect(caps.passthrough).toEqual({
      codecs: ['ac3', 'dts', 'eac3', 'truehd'],
      maxChannels: 8,
    });
    expect(caps.maxStreamingBitrate).toBe(20_000_000);
    expect(caps.maxStaticBitrate).toBe(50_000_000);
    expect(caps.maxAudioChannels).toBe(2);
  });
});

describe('hdrFromAndroid', () => {
  it('ignores unknown types and malformed input', () => {
    expect(hdrFromAndroid(undefined)).toEqual([]);
    expect(hdrFromAndroid({ hdrTypes: [] })).toEqual([]);
    expect(hdrFromAndroid({ hdrTypes: [0, 5, -1] })).toEqual([]);
    expect(hdrFromAndroid({ hdrTypes: [2, 2] })).toEqual(['hdr10']);
    expect(hdrFromAndroid({ hdrTypes: 'nope' as unknown as number[] })).toEqual(
      [],
    );
  });
});

describe('passthroughFromAndroid', () => {
  it('ignores PCM and unknown encodings and nonsense channel counts', () => {
    expect(passthroughFromAndroid(undefined)).toEqual({
      codecs: [],
      maxChannels: 0,
    });
    expect(
      passthroughFromAndroid({ encodings: [2, 3, 4, 1000], maxChannels: 2 }),
    ).toEqual({ codecs: [], maxChannels: 2 });
    expect(
      passthroughFromAndroid({ encodings: [5, 6], maxChannels: -3 }),
    ).toEqual({ codecs: ['ac3', 'eac3'], maxChannels: 0 });
    expect(
      passthroughFromAndroid({
        encodings: [7],
        maxChannels: NaN,
      }),
    ).toEqual({ codecs: ['dts'], maxChannels: 0 });
    expect(
      passthroughFromAndroid({
        encodings: 'nope' as unknown as number[],
        maxChannels: 6,
      }),
    ).toEqual({ codecs: [], maxChannels: 6 });
  });
});

describe('withBitrateCap', () => {
  it('caps both bitrates without mutating', () => {
    const capped = withBitrateCap(BASELINE_CAPABILITIES, 8_000_000);
    expect(capped.maxStreamingBitrate).toBe(8_000_000);
    expect(capped.maxStaticBitrate).toBe(8_000_000);
    expect(BASELINE_CAPABILITIES.maxStreamingBitrate).toBe(40_000_000);
    expect(BASELINE_CAPABILITIES.maxStaticBitrate).toBe(100_000_000);
  });

  it('never raises a bitrate', () => {
    const capped = withBitrateCap(BASELINE_CAPABILITIES, 60_000_000);
    expect(capped.maxStreamingBitrate).toBe(40_000_000);
    expect(capped.maxStaticBitrate).toBe(60_000_000);
  });

  it('returns the input when there is no cap', () => {
    expect(withBitrateCap(BASELINE_CAPABILITIES, undefined)).toBe(
      BASELINE_CAPABILITIES,
    );
    expect(withBitrateCap(BASELINE_CAPABILITIES, 0)).toBe(
      BASELINE_CAPABILITIES,
    );
  });
});

describe('withAudioPassthrough', () => {
  const sink = {
    ...BASELINE_CAPABILITIES,
    passthrough: { codecs: ['ac3', 'dts', 'truehd'], maxChannels: 8 },
  };

  it('returns the input when passthrough is off', () => {
    expect(withAudioPassthrough(sink, false)).toBe(sink);
  });

  it('returns the input when the sink adds nothing', () => {
    expect(withAudioPassthrough(BASELINE_CAPABILITIES, true)).toBe(
      BASELINE_CAPABILITIES,
    );
    const quiet = {
      ...BASELINE_CAPABILITIES,
      passthrough: { codecs: ['ac3'], maxChannels: 2 },
    };
    expect(withAudioPassthrough(quiet, true)).toBe(quiet);
  });

  it('merges the sink codecs and lifts the channel count when on', () => {
    const on = withAudioPassthrough(sink, true);
    expect(on.audio).toEqual([
      'aac',
      'ac3',
      'dts',
      'eac3',
      'flac',
      'mp3',
      'opus',
      'truehd',
      'vorbis',
    ]);
    expect(on.maxAudioChannels).toBe(8);
    expect(on.passthrough).toBe(sink.passthrough);
    expect(sink.audio).toEqual(BASELINE_CAPABILITIES.audio);
    expect(sink.maxAudioChannels).toBe(6);
  });
});

describe('BASELINE_CAPABILITIES', () => {
  it('is an SDR-safe HDR10/HLG 4K profile with nothing bitstreamed', () => {
    expect(BASELINE_CAPABILITIES.hdr).toEqual(['hdr10', 'hlg']);
    expect(BASELINE_CAPABILITIES.passthrough).toEqual({
      codecs: [],
      maxChannels: 0,
    });
    expect(BASELINE_CAPABILITIES.maxStaticBitrate).toBeGreaterThan(
      BASELINE_CAPABILITIES.maxStreamingBitrate,
    );
    expect(BASELINE_CAPABILITIES.video.every(v => v.hardware)).toBe(true);
  });
});
