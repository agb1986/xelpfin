import type { PlaybackPlan } from '../../src/backend/types';
import { audioSelection, canSwitchInStream, subtitleSelection } from '../../src/player/rnv/trackSelection';

const plan: PlaybackPlan = {
  itemId: 'i',
  mediaSourceId: 'm',
  playSessionId: 'p',
  method: 'DirectPlay',
  reasons: [],
  url: 'http://x/stream',
  streamType: 'progressive',
  startPositionMs: 0,
  audioTracks: [
    { index: 1, label: 'English', language: 'eng', isDefault: true },
    { index: 2, label: 'German', language: 'deu', isDefault: false },
  ],
  subtitleTracks: [
    { index: 3, label: 'English', language: 'eng', isDefault: false, isForced: false, delivery: 'external', url: 'http://x/3.vtt' },
    { index: 4, label: 'French', language: 'fra', isDefault: false, isForced: false, delivery: 'embedded' },
    { index: 5, label: 'PGS', language: 'spa', isDefault: false, isForced: false, delivery: 'burn-in' },
  ],
  selectedAudioIndex: 1,
  headers: {},
};

describe('track selection', () => {
  it('maps audio by position for direct play only', () => {
    expect(audioSelection(plan, 2)).toEqual({ type: 'index', value: 1 });
    expect(audioSelection(plan, 9)).toEqual({ type: 'system' });
    expect(audioSelection({ ...plan, method: 'Transcode' }, 2)).toEqual({ type: 'system' });
  });

  it('maps subtitles by delivery', () => {
    expect(subtitleSelection(plan, 3)).toEqual({ type: 'title', value: 'xelpfin-sub-3' });
    expect(subtitleSelection(plan, 4)).toEqual({ type: 'language', value: 'fra' });
    expect(subtitleSelection(plan, 5)).toEqual({ type: 'disabled' });
    expect(subtitleSelection(plan, -1)).toEqual({ type: 'disabled' });
  });

  it('knows when the server has to make a new stream', () => {
    expect(canSwitchInStream(plan, { audioStreamIndex: 2 })).toBe(true);
    expect(canSwitchInStream({ ...plan, method: 'Transcode' }, { audioStreamIndex: 2 })).toBe(false);
    expect(canSwitchInStream(plan, { subtitleStreamIndex: 4 })).toBe(true);
    expect(canSwitchInStream(plan, { subtitleStreamIndex: 5 })).toBe(false);
    expect(canSwitchInStream({ ...plan, selectedSubtitleIndex: 5 }, { subtitleStreamIndex: -1 })).toBe(false);
  });
});
