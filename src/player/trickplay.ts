import type { Chapter, Trickplay } from '../backend/types';

/** One trickplay thumbnail: which sheet it is on and in which cell. */
export interface TrickplayFrame {
  /** Thumbnail number from the start of the item. */
  index: number;
  sheet: number;
  url: string;
  column: number;
  row: number;
}

/** The thumbnail for a position: the last one taken at or before it. */
export function trickplayFrame(
  tp: Trickplay,
  positionMs: number,
): TrickplayFrame | undefined {
  const perSheet = tp.columns * tp.rows;
  if (perSheet <= 0 || tp.thumbnailCount <= 0 || tp.intervalMs <= 0) {
    return undefined;
  }
  const index = Math.min(
    tp.thumbnailCount - 1,
    Math.max(0, Math.floor(positionMs / tp.intervalMs)),
  );
  const sheet = Math.floor(index / perSheet);
  const url = tp.sheetUrls[sheet];
  if (!url) {
    return undefined;
  }
  const cell = index % perSheet;
  return {
    index,
    sheet,
    url,
    column: cell % tp.columns,
    row: Math.floor(cell / tp.columns),
  };
}

export interface FrameLayout {
  /** The visible box: one thumbnail scaled to the requested width. */
  width: number;
  height: number;
  /** The whole sheet at the same scale, and where to put it so only the frame shows. */
  sheetWidth: number;
  sheetHeight: number;
  left: number;
  top: number;
}

/**
 * How to draw a sheet inside a `boxWidth` wide box so that only `frame` shows. `loaded` is the
 * sheet's size as the image loader reported it, when known: a server may cut the last sheet short
 * instead of padding it to a full grid, and drawing it at the full-grid size would stretch it.
 * Android reports that size in density-independent units rather than pixels, so only its
 * proportions are trusted; the scale comes from the cells the sheet must hold, a full row when it
 * has that many thumbnails, else one row of a single cell's height.
 */
export function frameLayout(
  tp: Trickplay,
  frame: TrickplayFrame,
  boxWidth: number,
  loaded?: { width: number; height: number },
): FrameLayout {
  const scale = boxWidth / tp.width;
  const height = tp.height * scale;
  let sheetPx = { width: tp.columns * tp.width, height: tp.rows * tp.height };
  if (loaded) {
    const perSheet = tp.columns * tp.rows;
    const onSheet = Math.min(
      perSheet,
      tp.thumbnailCount - frame.sheet * perSheet,
    );
    const unit =
      onSheet >= tp.columns
        ? loaded.width / (tp.columns * tp.width)
        : loaded.height / tp.height;
    sheetPx = { width: loaded.width / unit, height: loaded.height / unit };
  }
  return {
    width: boxWidth,
    height,
    sheetWidth: sheetPx.width * scale,
    sheetHeight: sheetPx.height * scale,
    left: -frame.column * boxWidth,
    top: -frame.row * height,
  };
}

/**
 * Sheets to keep warm around a position: its own and the ones either side, so scrubbing across
 * a sheet boundary does not wait for the network.
 */
export function sheetsAround(tp: Trickplay, positionMs: number): string[] {
  const frame = trickplayFrame(tp, positionMs);
  if (!frame) {
    return [];
  }
  return [frame.sheet, frame.sheet - 1, frame.sheet + 1]
    .map(n => tp.sheetUrls[n])
    .filter((u): u is string => !!u);
}

/** Image of the chapter a position falls in, for when there are no trickplay thumbnails. */
export function chapterImageAt(
  chapters: Chapter[] | undefined,
  positionMs: number,
): string | undefined {
  let found: Chapter | undefined;
  for (const c of chapters ?? []) {
    if (c.startMs <= positionMs && (!found || c.startMs >= found.startMs)) {
      found = c;
    }
  }
  return found?.imageUrl;
}
