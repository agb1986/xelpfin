import { LANGUAGES, SPECIAL_LANGUAGE_CODES } from '../../src/state/languages';
import {
  COMMON_LANGUAGE_CODES,
  LANGUAGE_CHOICES,
  SUBTITLE_LANGUAGE_CHOICES,
  canonicalLanguage,
  languageCodes,
  languageLabel,
  languageMatches,
} from '../../src/state/settings';

describe('ISO 639-2 table', () => {
  it('has the full code list with unique codes and names', () => {
    expect(LANGUAGES.length).toBeGreaterThan(480);
    const all = LANGUAGES.flatMap(languageCodes);
    expect(new Set(all).size).toBe(all.length);
    for (const l of LANGUAGES) {
      expect(l.code).toMatch(/^[a-z]{3}$/);
      expect(l.terminologic ?? 'abc').toMatch(/^[a-z]{3}$/);
      expect(l.alpha2 ?? 'ab').toMatch(/^[a-z]{2}$/);
      expect(l.name.trim()).toBe(l.name);
      expect(l.name).not.toBe('');
    }
    for (const code of [...COMMON_LANGUAGE_CODES, ...SPECIAL_LANGUAGE_CODES]) {
      expect(LANGUAGES.some(l => l.code === code)).toBe(true);
    }
  });

  it('resolves every B, T and 639-1 code to its B code', () => {
    for (const l of LANGUAGES) {
      for (const code of languageCodes(l)) {
        expect(canonicalLanguage(code)).toBe(l.code);
        expect(canonicalLanguage(code.toUpperCase())).toBe(l.code);
        expect(languageMatches(code, l.code)).toBe(true);
      }
    }
    expect(canonicalLanguage('deu')).toBe('ger');
    expect(canonicalLanguage('fra')).toBe('fre');
    expect(canonicalLanguage('nld')).toBe('dut');
    expect(canonicalLanguage('zho')).toBe('chi');
    expect(canonicalLanguage('ja')).toBe('jpn');
    expect(canonicalLanguage('xxx')).toBeUndefined();
    expect(canonicalLanguage('')).toBeUndefined();
    expect(canonicalLanguage(undefined)).toBeUndefined();
  });

  it('lists the first published name', () => {
    expect(languageLabel({ code: 'dut', name: 'Dutch; Flemish' })).toBe(
      'Dutch',
    );
    expect(languageLabel({ code: 'jpn', name: 'Japanese' })).toBe('Japanese');
  });
});

describe('language choices', () => {
  const values = LANGUAGE_CHOICES.map(c => c.value);

  it('starts with the file default and the common languages, then the rest alphabetically', () => {
    expect(values.slice(0, 1 + COMMON_LANGUAGE_CODES.length)).toEqual([
      '',
      ...COMMON_LANGUAGE_CODES,
    ]);
    const rest = LANGUAGE_CHOICES.slice(1 + COMMON_LANGUAGE_CODES.length).map(
      c => c.label,
    );
    expect(rest).toEqual([...rest].sort());
    expect(rest.length).toBeGreaterThan(400);
  });

  it('offers Japanese and Polish', () => {
    const japanese = LANGUAGE_CHOICES.find(c => c.value === 'jpn');
    const polish = LANGUAGE_CHOICES.find(c => c.value === 'pol');
    expect(japanese).toEqual({
      label: 'Japanese',
      detail: 'jpn / ja',
      value: 'jpn',
    });
    expect(polish).toEqual({
      label: 'Polish',
      detail: 'pol / pl',
      value: 'pol',
    });
    expect(LANGUAGE_CHOICES.find(c => c.value === 'ger')).toEqual({
      label: 'German',
      detail: 'ger / deu / de',
      value: 'ger',
    });
  });

  it('stores one entry per language under its B code and leaves out the special codes', () => {
    expect(new Set(values).size).toBe(values.length);
    for (const v of values.slice(1)) {
      expect(canonicalLanguage(v)).toBe(v);
    }
    for (const code of SPECIAL_LANGUAGE_CODES) {
      expect(values).not.toContain(code);
    }
    expect(values).not.toContain('deu');
    expect(values).not.toContain('de');
  });
});

describe('subtitle language choices', () => {
  it('offers the same languages, with the first entry following the audio language', () => {
    expect(SUBTITLE_LANGUAGE_CHOICES[0]).toEqual({
      label: 'Same as audio',
      value: '',
    });
    expect(SUBTITLE_LANGUAGE_CHOICES.slice(1)).toEqual(
      LANGUAGE_CHOICES.slice(1),
    );
  });
});
