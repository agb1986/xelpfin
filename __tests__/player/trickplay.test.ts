import type { Chapter, Trickplay } from '../../src/backend/types';
import {
  chapterImageAt,
  frameLayout,
  sheetsAround,
  trickplayFrame,
} from '../../src/player/trickplay';

/** 2x2 thumbnails of 320x180 per sheet, one every 10 s, 10 thumbnails over 3 sheets. */
const TP: Trickplay = {
  width: 320,
  height: 180,
  columns: 2,
  rows: 2,
  thumbnailCount: 10,
  intervalMs: 10_000,
  sheetUrls: ['s0', 's1', 's2'],
  headers: { Authorization: 'x' },
};

describe('trickplayFrame', () => {
  it('finds the last thumbnail taken at or before the position', () => {
    expect(trickplayFrame(TP, 0)).toEqual({
      index: 0,
      sheet: 0,
      url: 's0',
      column: 0,
      row: 0,
    });
    expect(trickplayFrame(TP, 9_999)?.index).toBe(0);
    expect(trickplayFrame(TP, 10_000)).toMatchObject({ column: 1, row: 0 });
    expect(trickplayFrame(TP, 35_000)).toMatchObject({
      index: 3,
      sheet: 0,
      column: 1,
      row: 1,
    });
  });

  it('moves to the next sheet after a full grid', () => {
    expect(trickplayFrame(TP, 40_000)).toEqual({
      index: 4,
      sheet: 1,
      url: 's1',
      column: 0,
      row: 0,
    });
    expect(trickplayFrame(TP, 85_000)).toMatchObject({
      index: 8,
      sheet: 2,
      url: 's2',
    });
  });

  it('clamps positions before the start and past the last thumbnail', () => {
    expect(trickplayFrame(TP, -5_000)?.index).toBe(0);
    expect(trickplayFrame(TP, 10_000_000)).toMatchObject({
      index: 9,
      sheet: 2,
      column: 1,
      row: 0,
    });
  });

  it('has no frame for a sheet without a URL or a layout that makes no sense', () => {
    expect(trickplayFrame({ ...TP, sheetUrls: ['s0'] }, 50_000)).toBe(
      undefined,
    );
    expect(trickplayFrame({ ...TP, columns: 0 }, 0)).toBe(undefined);
    expect(trickplayFrame({ ...TP, intervalMs: 0 }, 0)).toBe(undefined);
    expect(trickplayFrame({ ...TP, thumbnailCount: 0 }, 0)).toBe(undefined);
  });
});

describe('frameLayout', () => {
  it('scales the full grid and offsets it so only the frame shows', () => {
    const frame = trickplayFrame(TP, 35_000)!;
    expect(frameLayout(TP, frame, 160)).toEqual({
      width: 160,
      height: 90,
      sheetWidth: 320,
      sheetHeight: 180,
      left: -160,
      top: -90,
    });
  });

  it('draws a short sheet at its real size instead of stretching it', () => {
    const frame = trickplayFrame(TP, 85_000)!;
    expect(frameLayout(TP, frame, 160, { width: 640, height: 180 })).toEqual({
      width: 160,
      height: 90,
      sheetWidth: 320,
      sheetHeight: 90,
      left: -0,
      top: -0,
    });
  });
});

describe('sheetsAround', () => {
  it('lists the sheet at the position and the ones either side', () => {
    expect(sheetsAround(TP, 50_000)).toEqual(['s1', 's0', 's2']);
  });

  it('stops at the first and last sheets', () => {
    expect(sheetsAround(TP, 0)).toEqual(['s0', 's1']);
    expect(sheetsAround(TP, 99_000)).toEqual(['s2', 's1']);
  });

  it('is empty without a frame', () => {
    expect(sheetsAround({ ...TP, rows: 0 }, 0)).toEqual([]);
  });
});

describe('chapterImageAt', () => {
  const chapters: Chapter[] = [
    { name: 'Two', startMs: 60_000, imageUrl: 'c2' },
    { name: 'Zero', startMs: 0, imageUrl: 'c0' },
    { name: 'One', startMs: 30_000 },
  ];

  it('picks the latest chapter that started by the position, in any order', () => {
    expect(chapterImageAt(chapters, 10_000)).toBe('c0');
    expect(chapterImageAt(chapters, 60_000)).toBe('c2');
    expect(chapterImageAt(chapters, 99_000)).toBe('c2');
  });

  it('has no image in a chapter without one, before the first, or without chapters', () => {
    expect(chapterImageAt(chapters, 45_000)).toBe(undefined);
    expect(chapterImageAt(chapters.slice(0, 1), 10_000)).toBe(undefined);
    expect(chapterImageAt(undefined, 10_000)).toBe(undefined);
    expect(chapterImageAt([], 10_000)).toBe(undefined);
  });
});
