/**
 * Vega's W3C media element takes a bare URL and cannot send request headers, so a direct-play
 * stream that authenticates with the plan's `Authorization: MediaBrowser Token="..."` header
 * has to carry the token as `api_key` instead. A URL that already has one is left alone.
 */
export function streamUrlWithToken(
  url: string,
  headers: Record<string, string>,
): string {
  if (/[?&]api_key=/.test(url)) {
    return url;
  }
  const auth = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === 'authorization',
  )?.[1];
  const token = auth?.match(/Token="([^"]+)"/)?.[1];
  if (!token) {
    return url;
  }
  return `${url}${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(token)}`;
}
