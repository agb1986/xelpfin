/** The letter a row is grouped under: its first character, upper case, without accents. */
export function initialOf(label: string): string {
  return label.charAt(0).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

/**
 * Where a rewind (-1) or fast-forward (+1) press moves focus in a list whose rows from `from`
 * on are sorted by label, with a block of other rows (the common languages) above them.
 *
 * Fast-forward goes to the first row of the next initial letter; from the block above, that is
 * the first sorted row. Rewind goes to the first row of the previous letter; from the first
 * letter, or from inside the block above, it goes back to the top row. Returns null when there
 * is nowhere to go (already on the last letter, or already at the top).
 */
export function letterJumpTarget(
  labels: readonly string[],
  from: number,
  current: number,
  dir: -1 | 1,
): number | null {
  if (from >= labels.length) {
    return null;
  }
  if (current < from) {
    if (dir > 0) {
      return from;
    }
    return current > 0 ? 0 : null;
  }
  const letter = initialOf(labels[current]);
  if (dir > 0) {
    for (let i = current + 1; i < labels.length; i++) {
      if (initialOf(labels[i]) !== letter) {
        return i;
      }
    }
    return null;
  }
  let start = current;
  while (start > from && initialOf(labels[start - 1]) === letter) {
    start--;
  }
  if (start === from) {
    return current > 0 ? 0 : null;
  }
  const previous = initialOf(labels[start - 1]);
  let target = start - 1;
  while (target > from && initialOf(labels[target - 1]) === previous) {
    target--;
  }
  return target;
}
