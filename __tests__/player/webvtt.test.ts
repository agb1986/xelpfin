import { cleanText, cueTextAt, parseWebVtt } from '../../src/player/webvtt';

const VTT = `WEBVTT

NOTE a comment that is not a cue

1
00:00:01.000 --> 00:00:04.500 line:90% align:center
<i>Hello</i> &amp; <c.yellow>welcome</c>

00:05.000 --> 00:08.000
<v Narrator>Second</v>
line two

00:00:06.000 --> 00:00:07.000
Overlap
`;

describe('parseWebVtt', () => {
  it('parses cues, settings, short timestamps and markup', () => {
    expect(parseWebVtt(VTT)).toEqual([
      { startMs: 1000, endMs: 4500, text: 'Hello & welcome' },
      { startMs: 5000, endMs: 8000, text: 'Second\nline two' },
      { startMs: 6000, endMs: 7000, text: 'Overlap' },
    ]);
  });

  it('accepts SRT with CRLF line endings and comma milliseconds', () => {
    const srt =
      '1\r\n00:00:01,000 --> 00:00:02,000\r\nOne\r\n\r\n2\r\n01:00:00,250 --> 01:00:01,000\r\nTwo\r\n';
    expect(parseWebVtt(srt)).toEqual([
      { startMs: 1000, endMs: 2000, text: 'One' },
      { startMs: 3600250, endMs: 3601000, text: 'Two' },
    ]);
  });

  it('skips malformed and empty cues', () => {
    expect(
      parseWebVtt(
        'WEBVTT\n\nnot a time --> 00:01.000\nx\n\n00:02.000 --> 00:01.000\nbackwards\n\n00:03.000 --> 00:04.000\n<b></b>\n',
      ),
    ).toEqual([]);
  });
});

describe('cueTextAt', () => {
  const cues = parseWebVtt(VTT);
  it('returns the showing cue, joins overlapping cues, and is empty between cues', () => {
    expect(cueTextAt(cues, 0)).toBe('');
    expect(cueTextAt(cues, 1000)).toBe('Hello & welcome');
    expect(cueTextAt(cues, 4500)).toBe('');
    expect(cueTextAt(cues, 6500)).toBe('Second\nline two\nOverlap');
    expect(cueTextAt(cues, 7500)).toBe('Second\nline two');
    expect(cueTextAt(cues, 9000)).toBe('');
    expect(cueTextAt([], 1000)).toBe('');
  });
});

describe('cleanText', () => {
  it('strips ASS/SSA override tags and drawings so converted subtitles stay readable', () => {
    expect(cleanText('{\\an8}{\\b1}Top{\\b0} line\\Nsecond\\hpart')).toBe(
      'Top line\nsecond part',
    );
    expect(cleanText('{\\p1}m 0 0 l 100 0 100 100{\\p0}Visible')).toBe(
      'Visible',
    );
    expect(cleanText('<i>Hello</i> &amp; {\\c&H00FFFF&}there  ')).toBe(
      'Hello & there',
    );
  });
});
