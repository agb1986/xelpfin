import { initialOf, letterJumpTarget } from '../../src/ui/letterJump';

// Two rows above the sorted part, like "File default" and the common languages.
const LABELS = [
  'File default',
  'English',
  'Abkhazian',
  'Afar',
  'Basque',
  'Chinese',
  'Czech',
  'Énglish-ish',
  'Zulu',
];
const FROM = 2;

describe('initialOf', () => {
  it('is the first letter, upper case and without accents', () => {
    expect(initialOf('japanese')).toBe('J');
    expect(initialOf('Énglish-ish')).toBe('E');
    expect(initialOf('')).toBe('');
  });
});

describe('letterJumpTarget', () => {
  const jump = (current: number, dir: -1 | 1) =>
    letterJumpTarget(LABELS, FROM, current, dir);

  it('fast-forward goes to the first row of the next letter', () => {
    expect(jump(2, 1)).toBe(4); // A -> B
    expect(jump(3, 1)).toBe(4); // from the middle of A
    expect(jump(4, 1)).toBe(5); // B -> C
    expect(jump(5, 1)).toBe(7); // C -> E, skipping the rest of C
    expect(jump(7, 1)).toBe(8); // E -> Z
  });

  it('fast-forward from the rows above the sorted part goes to the first sorted row', () => {
    expect(jump(0, 1)).toBe(FROM);
    expect(jump(1, 1)).toBe(FROM);
  });

  it('fast-forward on the last letter stays put', () => {
    expect(jump(8, 1)).toBeNull();
  });

  it('rewind goes to the first row of the previous letter', () => {
    expect(jump(8, -1)).toBe(7); // Z -> E
    expect(jump(7, -1)).toBe(5); // E -> C
    expect(jump(6, -1)).toBe(4); // middle of C -> B
    expect(jump(4, -1)).toBe(2); // B -> A
  });

  it('rewind from the first letter or the rows above it goes to the top', () => {
    expect(jump(3, -1)).toBe(0);
    expect(jump(2, -1)).toBe(0);
    expect(jump(1, -1)).toBe(0);
    expect(jump(0, -1)).toBeNull();
  });

  it('works on a list without rows above the sorted part', () => {
    expect(letterJumpTarget(['Ab', 'Ac', 'Ba'], 0, 1, -1)).toBe(0);
    expect(letterJumpTarget(['Ab', 'Ac', 'Ba'], 0, 0, -1)).toBeNull();
    expect(letterJumpTarget(['Ab', 'Ac', 'Ba'], 0, 0, 1)).toBe(2);
    expect(letterJumpTarget([], 0, 0, 1)).toBeNull();
  });
});
