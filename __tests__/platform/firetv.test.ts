import { NativeModules } from 'react-native';
import { BASELINE_CAPABILITIES } from '../../src/player/capabilities';
import type { PlatformServices } from '../../src/platform/types';

/**
 * Loads src/platform/firetv fresh with the given native module (or none). The isolated module
 * has its own copy of capabilities.ts, so baseline comparisons use toEqual.
 */
function load(mod: Record<string, unknown> | undefined): PlatformServices {
  let platform: PlatformServices | undefined;
  jest.isolateModules(() => {
    (NativeModules as Record<string, unknown>).XelpfinPlatform = mod;
    const { createFireTvPlatform } = require('../../src/platform/firetv');
    platform = createFireTvPlatform();
  });
  return platform!;
}

const decoders = [
  {
    mime: 'video/avc',
    name: 'OMX.hw.avc',
    hardware: true,
    maxWidth: 1920,
    maxHeight: 1080,
  },
  { mime: 'audio/mp4a-latm', name: 'aac', hardware: false },
];

afterEach(() => {
  delete (NativeModules as Record<string, unknown>).XelpfinPlatform;
});

describe('firetv capabilities()', () => {
  it('uses the baseline when the native module is missing', async () => {
    const platform = load(undefined);
    expect(platform.udp).toBeUndefined();
    expect(await platform.capabilities()).toEqual(BASELINE_CAPABILITIES);
  });

  it('combines decoders, display and audio queries', async () => {
    const platform = load({
      getDecoders: jest.fn().mockResolvedValue(decoders),
      getDisplayCapabilities: jest.fn().mockResolvedValue({ hdrTypes: [2, 1] }),
      getAudioCapabilities: jest
        .fn()
        .mockResolvedValue({ encodings: [5, 6, 2], maxChannels: 8 }),
    });
    const caps = await platform.capabilities();
    expect(caps.video.map(v => v.codec)).toEqual(['h264']);
    expect(caps.audio).toEqual(['aac']);
    expect(caps.hdr).toEqual(['dolbyvision', 'hdr10']);
    expect(caps.passthrough).toEqual({
      codecs: ['ac3', 'eac3'],
      maxChannels: 8,
    });
    expect(caps.maxStaticBitrate).toBe(100_000_000);
  });

  it('degrades to no HDR and no passthrough when those queries are missing or fail', async () => {
    const missing = load({
      getDecoders: jest.fn().mockResolvedValue(decoders),
    });
    const a = await missing.capabilities();
    expect(a.video.map(v => v.codec)).toEqual(['h264']);
    expect(a.hdr).toEqual([]);
    expect(a.passthrough).toEqual({ codecs: [], maxChannels: 0 });

    const failing = load({
      getDecoders: jest.fn().mockResolvedValue(decoders),
      getDisplayCapabilities: jest
        .fn()
        .mockRejectedValue(new Error('E_DISPLAY')),
      getAudioCapabilities: jest.fn().mockRejectedValue(new Error('E_AUDIO')),
    });
    const b = await failing.capabilities();
    expect(b.video.map(v => v.codec)).toEqual(['h264']);
    expect(b.hdr).toEqual([]);
    expect(b.passthrough).toEqual({ codecs: [], maxChannels: 0 });
  });

  it('falls back to the baseline when there are no video decoders or the query fails', async () => {
    const empty = load({
      getDecoders: jest.fn().mockResolvedValue([]),
      getDisplayCapabilities: jest.fn().mockResolvedValue({ hdrTypes: [2] }),
    });
    expect(await empty.capabilities()).toEqual(BASELINE_CAPABILITIES);

    const broken = load({
      getDecoders: jest.fn().mockRejectedValue(new Error('E_CODECS')),
    });
    expect(await broken.capabilities()).toEqual(BASELINE_CAPABILITIES);
  });

  it('queries the module once and memoises the result', async () => {
    const getDecoders = jest.fn().mockResolvedValue(decoders);
    const platform = load({ getDecoders });
    const first = await platform.capabilities();
    expect(await platform.capabilities()).toBe(first);
    expect(getDecoders).toHaveBeenCalledTimes(1);
  });
});
