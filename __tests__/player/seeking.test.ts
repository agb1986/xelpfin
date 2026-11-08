import {
  activeSegment,
  currentSceneIndex,
  episodeCode,
  playedToEnd,
  scenesFor,
  skipLabel,
  tapOffsetMs,
} from '../../src/player/seeking';

describe('tapOffsetMs', () => {
  it('climbs 10 s, 30 s, 1 min, then 1 min per further tap', () => {
    expect([1, 2, 3, 4, 5].map(tapOffsetMs)).toEqual([
      10_000, 30_000, 60_000, 120_000, 180_000,
    ]);
    expect(tapOffsetMs(0)).toBe(0);
  });
});

describe('scenesFor', () => {
  it('uses chapters when there is more than one', () => {
    const chapters = [
      { name: 'B', startMs: 60_000 },
      { name: 'A', startMs: 0 },
    ];
    expect(scenesFor(chapters, 600_000).map(s => s.name)).toEqual(['A', 'B']);
  });
  it('falls back to five-minute marks', () => {
    const scenes = scenesFor([{ name: 'Chapter 1', startMs: 0 }], 17 * 60_000);
    expect(scenes.map(s => s.startMs)).toEqual([0, 300_000, 600_000, 900_000]);
    expect(scenesFor(undefined, 120_000)).toEqual([]);
  });
  it('finds the scene under the playhead', () => {
    const scenes = scenesFor(undefined, 17 * 60_000);
    expect(currentSceneIndex(scenes, 0)).toBe(0);
    expect(currentSceneIndex(scenes, 650_000)).toBe(2);
  });
});

describe('activeSegment', () => {
  const segs = [
    { kind: 'intro' as const, startMs: 10_000, endMs: 70_000 },
    { kind: 'outro' as const, startMs: 1_200_000, endMs: 1_300_000 },
    { kind: 'commercial' as const, startMs: 500_000, endMs: 560_000 },
  ];
  it('matches only while inside a skippable segment', () => {
    expect(activeSegment(segs, 5_000)).toBeUndefined();
    expect(activeSegment(segs, 10_000)?.kind).toBe('intro');
    expect(activeSegment(segs, 70_000)).toBeUndefined();
    expect(activeSegment(segs, 520_000)).toBeUndefined();
    expect(skipLabel(activeSegment(segs, 1_250_000)!.kind)).toBe(
      'Skip Credits',
    );
  });
});

describe('episodeCode', () => {
  it('pads season and episode', () => {
    expect(episodeCode(1, 4)).toBe('S01E04');
    expect(episodeCode(12, 103)).toBe('S12E103');
    expect(episodeCode(undefined, 4)).toBeUndefined();
  });
});

describe('playedToEnd', () => {
  const outro = [
    { kind: 'outro' as const, startMs: 1_300_000, endMs: 1_500_000 },
  ];
  it('is true at the end and in the last 15 s', () => {
    expect(playedToEnd(1_490_000, 1_500_000, [])).toBe(true);
    expect(playedToEnd(1_485_000, 1_500_000, [])).toBe(true);
  });
  it('is true past 97 %', () => {
    expect(playedToEnd(1_460_000, 1_500_000, [])).toBe(true);
  });
  it('is true inside credits that run to the end', () => {
    expect(playedToEnd(1_350_000, 1_500_000, outro)).toBe(true);
  });
  it('is false mid-episode, including right after an intro skip', () => {
    expect(playedToEnd(90_000, 1_500_000, outro)).toBe(false);
    expect(playedToEnd(700_000, 1_500_000, outro)).toBe(false);
  });
  it('is false with no known duration', () => {
    expect(playedToEnd(10_000, 0, [])).toBe(false);
  });
});
