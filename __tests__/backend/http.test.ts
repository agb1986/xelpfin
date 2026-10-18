import { authHeader, buildQuery, candidateUrls, JellyfinHttp } from '../../src/backend/jellyfin/http';
import { BackendError } from '../../src/backend/types';
import { CLIENT, fakeFetch } from '../../test-utils/fakeFetch';

describe('authHeader', () => {
  it('includes client identity and token', () => {
    expect(authHeader(CLIENT, 'abc')).toBe(
      'MediaBrowser Client="xelpfin", Device="Test TV", DeviceId="dev-1", Version="0.1.0", Token="abc"',
    );
  });
  it('omits token when signed out and neutralises quotes', () => {
    const h = authHeader({ ...CLIENT, device: 'Bob"s TV' });
    expect(h).not.toContain('Token');
    expect(h).toContain(`Device="Bob's TV"`);
  });
});

describe('buildQuery', () => {
  it('drops empty values and joins arrays', () => {
    expect(buildQuery({ a: 1, b: undefined, c: '', d: ['x', 'y'], e: false, f: null })).toBe('?a=1&d=x%2Cy&e=false');
    expect(buildQuery({})).toBe('');
  });
});

describe('candidateUrls', () => {
  it('adds default ports and schemes', () => {
    expect(candidateUrls('nas')).toEqual(['http://nas:8096', 'https://nas:8920', 'http://nas']);
    expect(candidateUrls(' 192.168.1.5:8096 ')).toEqual(['http://192.168.1.5:8096', 'https://192.168.1.5:8096']);
    expect(candidateUrls('host:8920')[0]).toBe('https://host:8920');
    expect(candidateUrls('HTTPS://x.example/jf/')).toEqual(['https://x.example/jf']);
    expect(candidateUrls('')).toEqual([]);
  });
});

describe('JellyfinHttp', () => {
  it('sends auth header and parses JSON', async () => {
    const f = fakeFetch({ 'GET /x': { ok: 1 } });
    const http = new JellyfinHttp('http://s', CLIENT, 'tok', f.fetch);
    await expect(http.get('/x', { a: 1 })).resolves.toEqual({ ok: 1 });
    expect(f.calls[0].url).toBe('http://s/x?a=1');
    expect(f.calls[0].headers.Authorization).toContain('Token="tok"');
  });

  it('maps status codes to error kinds', async () => {
    const f = fakeFetch({
      'GET /a': () => ({ status: 401 }),
      'GET /b': () => ({ status: 500, text: 'boom' }),
      'GET /c': () => ({ status: 403 }),
    });
    const http = new JellyfinHttp('http://s', CLIENT, undefined, f.fetch);
    await expect(http.get('/a')).rejects.toMatchObject({ kind: 'auth', status: 401 });
    await expect(http.get('/c')).rejects.toMatchObject({ kind: 'forbidden', status: 403 });
    await expect(http.get('/b')).rejects.toMatchObject({ kind: 'server', status: 500, message: 'GET /b failed: HTTP 500', detail: 'boom' });
    await expect(http.get('/missing')).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('reports network failures and timeouts', async () => {
    const failing = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    await expect(new JellyfinHttp('http://s', CLIENT, undefined, failing).get('/x')).rejects.toMatchObject({
      kind: 'network',
    });
    const hanging = jest.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const err = await new JellyfinHttp('http://s', CLIENT, undefined, hanging, 20).get('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err).toMatchObject({ kind: 'timeout' });
  });

  it('treats 204 and empty bodies as undefined', async () => {
    const f = fakeFetch({ 'POST /p': () => ({ status: 204 }) });
    await expect(new JellyfinHttp('http://s', CLIENT, 't', f.fetch).post('/p', { a: 1 })).resolves.toBeUndefined();
    expect(f.calls[0].body).toEqual({ a: 1 });
    expect(f.calls[0].headers['Content-Type']).toBe('application/json');
  });
});
