import { streamUrlWithToken } from '../../src/player/vega/streamUrl';

describe('streamUrlWithToken', () => {
  const headers = { Authorization: 'MediaBrowser Token="abc 123"' };

  it('adds the token from the Authorization header as api_key', () => {
    expect(
      streamUrlWithToken('http://h/Videos/1/stream?static=true', headers),
    ).toBe('http://h/Videos/1/stream?static=true&api_key=abc%20123');
  });

  it('starts a query string when there is none', () => {
    expect(streamUrlWithToken('http://h/v.mkv', headers)).toBe(
      'http://h/v.mkv?api_key=abc%20123',
    );
  });

  it('matches the header name case-insensitively', () => {
    expect(
      streamUrlWithToken('http://h/v', {
        authorization: 'MediaBrowser Token="t"',
      }),
    ).toBe('http://h/v?api_key=t');
  });

  it('keeps a URL that already has api_key', () => {
    const url = 'http://h/master.m3u8?api_key=x';
    expect(streamUrlWithToken(url, headers)).toBe(url);
  });

  it('keeps the URL when there is no token', () => {
    expect(streamUrlWithToken('http://h/v', {})).toBe('http://h/v');
    expect(streamUrlWithToken('http://h/v', { Authorization: 'Basic x' })).toBe(
      'http://h/v',
    );
  });
});
