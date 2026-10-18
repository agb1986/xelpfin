import { buildPlan, directPlayBlockers, originOf, withQueryParams } from '../../src/backend/jellyfin/playback';
import type { MediaSourceDto } from '../../src/backend/jellyfin/dto';
import { BASELINE_CAPABILITIES, type DeviceCapabilities } from '../../src/player/capabilities';

const ctx = { baseUrl: 'http://srv:8096', token: 'tok', deviceId: 'dev-1' };

const h264Mp4: MediaSourceDto = {
  Id: 'ms1',
  Container: 'mov,mp4,m4a,3gp,3g2,mj2',
  Bitrate: 2_000_000,
  RunTimeTicks: 400_000_000,
  SupportsDirectPlay: true,
  SupportsTranscoding: true,
  TranscodingUrl: '/videos/i1/master.m3u8?MediaSourceId=ms1&VideoCodec=h264',
  TranscodingSubProtocol: 'hls',
  DefaultAudioStreamIndex: 1,
  MediaStreams: [
    { Index: 0, Type: 'Video', Codec: 'h264', Width: 1280, Height: 720, BitDepth: 8 },
    { Index: 1, Type: 'Audio', Codec: 'aac', Channels: 2, Language: 'eng', DisplayTitle: 'English AAC', IsDefault: true },
    { Index: 2, Type: 'Subtitle', Codec: 'subrip', Language: 'eng', IsExternal: true, IsTextSubtitleStream: true, DisplayTitle: 'English' },
  ],
};

const aviOld: MediaSourceDto = {
  Id: 'ms3',
  Container: 'avi',
  Bitrate: 1_500_000,
  SupportsDirectPlay: false,
  SupportsTranscoding: true,
  TranscodingUrl: '/videos/i3/master.m3u8?MediaSourceId=ms3&VideoCodec=h264&api_key=tok',
  TranscodingSubProtocol: 'hls',
  MediaStreams: [
    { Index: 0, Type: 'Video', Codec: 'msmpeg4v3', Width: 640, Height: 360 },
    { Index: 1, Type: 'Audio', Codec: 'mp3', Channels: 2 },
  ],
};

const hevcMkv: MediaSourceDto = {
  Id: 'ms2',
  Container: 'mkv',
  Bitrate: 3_000_000,
  SupportsDirectPlay: true,
  SupportsTranscoding: true,
  TranscodingUrl: '/videos/i2/master.m3u8?MediaSourceId=ms2',
  TranscodingSubProtocol: 'hls',
  DefaultAudioStreamIndex: 1,
  MediaStreams: [
    { Index: 0, Type: 'Video', Codec: 'hevc', Width: 1920, Height: 1080, BitDepth: 10 },
    { Index: 1, Type: 'Audio', Codec: 'aac', Channels: 2, Language: 'eng' },
    { Index: 2, Type: 'Audio', Codec: 'ac3', Channels: 6, Language: 'ger' },
    { Index: 3, Type: 'Subtitle', Codec: 'subrip', Language: 'eng', IsTextSubtitleStream: true },
    { Index: 4, Type: 'Subtitle', Codec: 'PGSSUB', Language: 'fre', IsTextSubtitleStream: false },
  ],
};

const noAc3HevcSdr: DeviceCapabilities = {
  ...BASELINE_CAPABILITIES,
  video: [
    { codec: 'h264', maxWidth: 1920, maxHeight: 1080, maxBitDepth: 8, hardware: true },
    { codec: 'hevc', maxWidth: 1920, maxHeight: 1080, maxBitDepth: 8, hardware: true },
  ],
  audio: ['aac', 'mp3'],
};

describe('directPlayBlockers', () => {
  it('accepts a plain h264/aac mp4', () => {
    expect(directPlayBlockers(h264Mp4, BASELINE_CAPABILITIES)).toEqual([]);
  });
  it('flags container and codec problems', () => {
    expect(directPlayBlockers(aviOld, { ...BASELINE_CAPABILITIES, containers: ['mp4', 'mkv'] })).toEqual([
      'ContainerNotSupported:avi',
      'VideoCodecNotSupported:msmpeg4v3',
    ]);
  });
  it('checks bit depth, the selected audio track and bitrate', () => {
    expect(directPlayBlockers(hevcMkv, noAc3HevcSdr)).toEqual(['VideoBitDepthNotSupported:10']);
    expect(directPlayBlockers(hevcMkv, noAc3HevcSdr, 2)).toEqual([
      'VideoBitDepthNotSupported:10',
      'AudioCodecNotSupported:ac3',
    ]);
    expect(directPlayBlockers(h264Mp4, BASELINE_CAPABILITIES, undefined, 1_000_000)).toEqual([
      'ContainerBitrateExceedsLimit:2000000',
    ]);
  });
});

describe('buildPlan', () => {
  it('direct plays with a static stream URL and side-loaded WebVTT subtitles', () => {
    const plan = buildPlan({ itemId: 'i1', startPositionMs: 5000 }, [h264Mp4], 'ps1', BASELINE_CAPABILITIES, ctx);
    expect(plan.method).toBe('DirectPlay');
    expect(plan.streamType).toBe('progressive');
    expect(plan.url).toBe(
      'http://srv:8096/Videos/i1/stream?static=true&mediaSourceId=ms1&playSessionId=ps1&deviceId=dev-1&api_key=tok',
    );
    expect(plan.durationMs).toBe(40_000);
    expect(plan.startPositionMs).toBe(5000);
    expect(plan.selectedAudioIndex).toBe(1);
    expect(plan.audioTracks).toEqual([
      { index: 1, label: 'English AAC', language: 'eng', codec: 'aac', channels: 2, isDefault: true },
    ]);
    expect(plan.subtitleTracks[0]).toMatchObject({
      index: 2,
      delivery: 'external',
      mimeType: 'text/vtt',
      url: 'http://srv:8096/Videos/i1/ms1/Subtitles/2/0/Stream.vtt?api_key=tok',
    });
  });

  it('transcodes over HLS when the codec is not supported', () => {
    const plan = buildPlan({ itemId: 'i3' }, [aviOld], 'ps3', BASELINE_CAPABILITIES, ctx);
    expect(plan.method).toBe('Transcode');
    expect(plan.streamType).toBe('hls');
    expect(plan.url).toBe('http://srv:8096/videos/i3/master.m3u8?MediaSourceId=ms3&VideoCodec=h264&api_key=tok');
    expect(plan.reasons).toContain('VideoCodecNotSupported:msmpeg4v3');
  });

  it('labels audio-only incompatibility as DirectStream and appends the token', () => {
    const caps: DeviceCapabilities = { ...BASELINE_CAPABILITIES, audio: ['aac'] };
    const plan = buildPlan({ itemId: 'i2', audioStreamIndex: 2 }, [hevcMkv], 'ps2', caps, ctx);
    expect(plan.method).toBe('DirectStream');
    expect(plan.reasons).toEqual(['AudioCodecNotSupported:ac3']);
    expect(plan.url).toBe('http://srv:8096/videos/i2/master.m3u8?MediaSourceId=ms2&api_key=tok');
    expect(plan.selectedAudioIndex).toBe(2);
  });

  it('keeps bitmap subtitles embedded in mkv and never side-loads them', () => {
    const plan = buildPlan({ itemId: 'i2', subtitleStreamIndex: 4 }, [hevcMkv], 'ps2', BASELINE_CAPABILITIES, ctx);
    expect(plan.method).toBe('DirectPlay');
    expect(plan.selectedSubtitleIndex).toBe(4);
    expect(plan.subtitleTracks.map(s => s.delivery)).toEqual(['external', 'embedded']);
    expect(plan.subtitleTracks[1].url).toBeUndefined();
    expect(plan.subtitleTracks[1].containerPosition).toBe(1);
  });

  it('honours a server refusal and fails clearly when nothing is playable', () => {
    const denied = { ...h264Mp4, SupportsDirectPlay: false };
    expect(buildPlan({ itemId: 'i1' }, [denied], 'p', BASELINE_CAPABILITIES, ctx).reasons).toEqual(['ServerDeniedDirectPlay']);
    const none = { ...aviOld, TranscodingUrl: undefined };
    expect(() => buildPlan({ itemId: 'i3' }, [none], 'p', BASELINE_CAPABILITIES, ctx)).toThrow(/cannot be played/);
    expect(() => buildPlan({ itemId: 'x' }, [], 'p', BASELINE_CAPABILITIES, ctx)).toThrow(/no playable/);
  });
  it('burns a bitmap subtitle into the picture once the server has to transcode anyway', () => {
    const plan = buildPlan({ itemId: 'i2', subtitleStreamIndex: 4 }, [hevcMkv], 'ps2', noAc3HevcSdr, ctx);
    expect(plan.method).toBe('Transcode');
    expect(plan.streamType).toBe('hls');
    expect(plan.url).toContain('SubtitleMethod=Encode');
    expect(plan.url).toContain('SubtitleStreamIndex=4');
    expect(plan.subtitleTracks.find(s => s.index === 4)?.delivery).toBe('burn-in');
    // A text subtitle on the same transcode is not burned in.
    const text = buildPlan({ itemId: 'i2', subtitleStreamIndex: 3 }, [hevcMkv], 'ps2', noAc3HevcSdr, ctx);
    expect(text.url).not.toContain('SubtitleMethod=Encode');
  });
});

describe('withQueryParams', () => {
  it('adds new parameters and replaces existing ones case-insensitively', () => {
    expect(withQueryParams('http://s/a', { A: '1' })).toBe('http://s/a?A=1');
    expect(withQueryParams('http://s/a?x=1&subtitlemethod=Hls', { SubtitleMethod: 'Encode', y: 'a b' })).toBe(
      'http://s/a?x=1&SubtitleMethod=Encode&y=a%20b',
    );
  });
});

describe('transcoding URL origin', () => {
  it('keeps an absolute stream address on the signed-in server', () => {
    const same = { ...aviOld, TranscodingUrl: 'HTTP://SRV:8096/videos/i3/master.m3u8?MediaSourceId=ms3' };
    expect(buildPlan({ itemId: 'i3' }, [same], 'p', BASELINE_CAPABILITIES, ctx).url).toMatch(/^HTTP:\/\/SRV:8096\/.*api_key=tok/);
  });

  it('refuses to send the token to another host', () => {
    for (const TranscodingUrl of ['http://evil.example/videos/i3/master.m3u8', 'https://srv:8096/videos/i3/master.m3u8', 'http://srv:9000/x.m3u8']) {
      expect(() => buildPlan({ itemId: 'i3' }, [{ ...aviOld, TranscodingUrl }], 'p', BASELINE_CAPABILITIES, ctx)).toThrow(/different host/);
    }
  });

  it('normalises default ports and case', () => {
    expect(originOf('HTTP://Media.Lan:80/jf')).toBe('http://media.lan');
    expect(originOf('https://media.lan:443?x')).toBe('https://media.lan');
    expect(originOf('https://media.lan:8920/jf')).toBe('https://media.lan:8920');
    expect(originOf('ftp://media.lan')).toBeUndefined();
  });
});
