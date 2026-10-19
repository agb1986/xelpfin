import {
  authHeader,
  buildQuery,
  candidateUrls,
  JellyfinHttp,
} from '../../src/backend/jellyfin/http';
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
  it('keeps line breaks and backslashes out of the header', () => {
    const h = authHeader({
      ...CLIENT,
      device: 'TV\r\nX-Evil: 1',
      deviceId: 'a\\", Token="x',
    });
    expect(h).not.toMatch(/[\r\n\\]/);
    expect(h).toContain('Device="TV  X-Evil: 1"');
    expect(h).toContain(`DeviceId="a/', Token='x"`);
  });
});

describe('buildQuery', () => {
  it('drops empty values and joins arrays', () => {
    expect(
      buildQuery({
        a: 1,
        b: undefined,
        c: '',
        d: ['x', 'y'],
        e: false,
        f: null,
      }),
    ).toBe('?a=1&d=x%2Cy&e=false');
    expect(buildQuery({})).toBe('');
  });
});

describe('candidateUrls', () => {
  it('adds default ports and schemes', () => {
    expect(candidateUrls('nas')).toEqual([
      'http://nas:8096',
      'https://nas:8920',
      'http://nas',
    ]);
    expect(candidateUrls(' 192.168.1.5:8096 ')).toEqual([
      'http://192.168.1.5:8096',
      'https://192.168.1.5:8096',
    ]);
    expect(candidateUrls('host:8920')[0]).toBe('https://host:8920');
    expect(candidateUrls('HTTPS://x.example/jf/')).toEqual([
      'https://x.example/jf',
    ]);
    expect(candidateUrls('')).toEqual([]);
  });
});

describe('JellyfinHttp', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  /** Resolves the request while advancing the fake clock past any retry delay or timeout. */
  async function settle<T>(p: Promise<T>): Promise<T | unknown> {
    const guarded = p.catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(1000);
    return guarded;
  }

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
    await expect(http.get('/a')).rejects.toMatchObject({
      kind: 'auth',
      status: 401,
    });
    await expect(http.get('/c')).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403,
    });
    expect(await settle(http.get('/b'))).toMatchObject({
      kind: 'server',
      status: 500,
      message: 'GET /b failed: HTTP 500',
      detail: 'boom',
    });
    await expect(http.get('/missing')).rejects.toMatchObject({
      kind: 'notFound',
    });
  });

  it('reports network failures and timeouts', async () => {
    const failing = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    expect(
      await settle(
        new JellyfinHttp('http://s', CLIENT, undefined, failing).get('/x'),
      ),
    ).toMatchObject({ kind: 'network' });
    let signal: AbortSignal | undefined;
    const hanging = jest.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch;
    const err = await settle(
      new JellyfinHttp('http://s', CLIENT, undefined, hanging, 20).get('/x'),
    );
    expect(err).toBeInstanceOf(BackendError);
    expect(err).toMatchObject({ kind: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });

  describe('retry', () => {
    it('retries a GET once after a network error', async () => {
      let n = 0;
      const flaky = jest.fn(async () => {
        n += 1;
        if (n === 1) {
          throw new TypeError('Network request failed');
        }
        return new Response('{"ok":true}', { status: 200 });
      }) as unknown as typeof fetch;
      const http = new JellyfinHttp('http://s', CLIENT, undefined, flaky);
      await expect(settle(http.get('/x'))).resolves.toEqual({ ok: true });
      expect(flaky).toHaveBeenCalledTimes(2);
    });

    it('retries a GET once after a 5xx with a jittered delay', async () => {
      let n = 0;
      const f = fakeFetch({
        'GET /x': () => {
          n += 1;
          return n === 1 ? { status: 503, text: 'busy' } : { json: { n } };
        },
      });
      // Fake timers are installed, so this wraps the fake setTimeout and only records.
      const delays: number[] = [];
      const fakeSetTimeout = globalThis.setTimeout;
      const spy = jest.spyOn(globalThis, 'setTimeout').mockImplementation(((
        fn: () => void,
        ms?: number,
      ) => {
        delays.push(ms ?? 0);
        return fakeSetTimeout(fn, ms);
      }) as unknown as typeof setTimeout);
      try {
        const http = new JellyfinHttp('http://s', CLIENT, undefined, f.fetch);
        await expect(settle(http.get('/x'))).resolves.toEqual({ n: 2 });
      } finally {
        spy.mockRestore();
      }
      expect(f.calls).toHaveLength(2);
      // Two per-attempt timeouts plus one retry delay in the 200-500 ms jitter window.
      const retryDelays = delays.filter(ms => ms !== 15000);
      expect(retryDelays).toHaveLength(1);
      expect(retryDelays[0]).toBeGreaterThanOrEqual(200);
      expect(retryDelays[0]).toBeLessThan(500);
    });

    it('gives up after the second failure and keeps the server error', async () => {
      const f = fakeFetch({ 'GET /x': () => ({ status: 502, text: 'bad' }) });
      const http = new JellyfinHttp('http://s', CLIENT, undefined, f.fetch);
      expect(await settle(http.get('/x'))).toMatchObject({
        kind: 'server',
        status: 502,
        detail: 'bad',
      });
      expect(f.calls).toHaveLength(2);

      const dead = jest.fn(async () => {
        throw new TypeError('Network request failed');
      }) as unknown as typeof fetch;
      expect(
        await settle(
          new JellyfinHttp('http://s', CLIENT, undefined, dead).get('/x'),
        ),
      ).toMatchObject({ kind: 'network' });
      expect(dead).toHaveBeenCalledTimes(2);
    });

    it('never retries POST or DELETE', async () => {
      const f = fakeFetch({
        'POST /p': () => ({ status: 500 }),
        'DELETE /d': () => ({ status: 503 }),
      });
      const http = new JellyfinHttp('http://s', CLIENT, 't', f.fetch);
      expect(await settle(http.post('/p', { a: 1 }))).toMatchObject({
        kind: 'server',
        status: 500,
      });
      expect(await settle(http.delete('/d'))).toMatchObject({
        kind: 'server',
        status: 503,
      });
      expect(f.calls).toHaveLength(2);

      const dead = jest.fn(async () => {
        throw new TypeError('Network request failed');
      }) as unknown as typeof fetch;
      expect(
        await settle(
          new JellyfinHttp('http://s', CLIENT, 't', dead).post('/p', {}),
        ),
      ).toMatchObject({ kind: 'network' });
      expect(dead).toHaveBeenCalledTimes(1);
    });

    it('never retries 4xx or a timeout', async () => {
      const f = fakeFetch({
        'GET /a': () => ({ status: 401 }),
        'GET /b': () => ({ status: 404 }),
        'GET /c': () => ({ status: 429 }),
      });
      const http = new JellyfinHttp('http://s', CLIENT, undefined, f.fetch);
      expect(await settle(http.get('/a'))).toMatchObject({ kind: 'auth' });
      expect(await settle(http.get('/b'))).toMatchObject({ kind: 'notFound' });
      expect(await settle(http.get('/c'))).toMatchObject({
        kind: 'server',
        status: 429,
      });
      expect(f.calls).toHaveLength(3);

      const hanging = jest.fn(
        () => new Promise<Response>(() => {}),
      ) as unknown as typeof fetch;
      expect(
        await settle(
          new JellyfinHttp('http://s', CLIENT, undefined, hanging, 20).get(
            '/x',
          ),
        ),
      ).toMatchObject({ kind: 'timeout' });
      expect(hanging).toHaveBeenCalledTimes(1);
    });

    it('still honours allowed statuses without retrying', async () => {
      const f = fakeFetch({ 'GET /x': () => ({ status: 500 }) });
      const http = new JellyfinHttp('http://s', CLIENT, undefined, f.fetch);
      await expect(
        settle(http.request('/x', { allow: [500] })),
      ).resolves.toBeUndefined();
      expect(f.calls).toHaveLength(1);
    });
  });

  describe('ETags', () => {
    it('exposes the ETag and status of a fresh answer', async () => {
      const f = fakeFetch({
        'GET /x': () => ({ json: { v: 1 }, headers: { ETag: '"abc"' } }),
      });
      const http = new JellyfinHttp('http://s', CLIENT, 't', f.fetch);
      await expect(http.send('/x')).resolves.toEqual({
        status: 200,
        data: { v: 1 },
        etag: '"abc"',
        notModified: false,
      });
      expect(f.calls[0].headers['If-None-Match']).toBeUndefined();
    });

    it('sends If-None-Match and reports 304 as not modified', async () => {
      const f = fakeFetch({
        'GET /x': call =>
          call.headers['If-None-Match'] === '"abc"'
            ? { status: 304 }
            : { json: { v: 2 }, headers: { ETag: '"def"' } },
      });
      const http = new JellyfinHttp('http://s', CLIENT, 't', f.fetch);
      await expect(http.send('/x', { etag: '"abc"' })).resolves.toEqual({
        status: 304,
        data: undefined,
        etag: '"abc"',
        notModified: true,
      });
      expect(f.calls[0].headers['If-None-Match']).toBe('"abc"');
      await expect(http.send('/x', { etag: '"old"' })).resolves.toMatchObject({
        status: 200,
        data: { v: 2 },
        etag: '"def"',
        notModified: false,
      });
      expect(f.calls).toHaveLength(2);
    });

    it('treats an unsolicited 304 as a server error', async () => {
      const f = fakeFetch({ 'GET /x': () => ({ status: 304 }) });
      const http = new JellyfinHttp('http://s', CLIENT, 't', f.fetch);
      await expect(http.send('/x')).rejects.toMatchObject({
        kind: 'server',
        status: 304,
      });
    });
  });

  it('treats 204 and empty bodies as undefined', async () => {
    const f = fakeFetch({ 'POST /p': () => ({ status: 204 }) });
    await expect(
      new JellyfinHttp('http://s', CLIENT, 't', f.fetch).post('/p', { a: 1 }),
    ).resolves.toBeUndefined();
    expect(f.calls[0].body).toEqual({ a: 1 });
    expect(f.calls[0].headers['Content-Type']).toBe('application/json');
  });
});
