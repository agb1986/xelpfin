import { BackendError } from '../types';

/** Identifies this client to the server. deviceId must be stable per install. */
export interface ClientInfo {
  client: string;
  device: string;
  deviceId: string;
  version: string;
}

export type FetchFn = typeof fetch;

/** Makes a value safe inside a quoted header parameter: no line breaks, quotes or backslashes. */
function quote(v: string): string {
  return v
    .replace(/[\r\n]/g, ' ')
    .replace(/\\/g, '/')
    .replace(/"/g, "'");
}

/** Jellyfin's `Authorization: MediaBrowser ...` header value. */
export function authHeader(info: ClientInfo, token?: string): string {
  const parts = [
    `Client="${quote(info.client)}"`,
    `Device="${quote(info.device)}"`,
    `DeviceId="${quote(info.deviceId)}"`,
    `Version="${quote(info.version)}"`,
  ];
  if (token) {
    parts.push(`Token="${quote(token)}"`);
  }
  return `MediaBrowser ${parts.join(', ')}`;
}

export type QueryValue =
  string | number | boolean | undefined | null | string[];

export function buildQuery(params: Record<string, QueryValue>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') {
      continue;
    }
    const s = Array.isArray(v) ? v.join(',') : String(v);
    if (s === '') {
      continue;
    }
    out.push(`${encodeURIComponent(k)}=${encodeURIComponent(s)}`);
  }
  return out.length ? `?${out.join('&')}` : '';
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  query?: Record<string, QueryValue>;
  body?: unknown;
  timeoutMs?: number;
  /** Return undefined for these statuses instead of throwing. */
  allow?: number[];
}

/** Options for `send`, which can also make a conditional request. */
export interface SendOptions extends RequestOptions {
  /**
   * ETag from an earlier response. It is sent as `If-None-Match`, and a 304 answer is
   * reported through `HttpResponse.notModified` instead of being parsed or thrown.
   */
  etag?: string;
}

/** A parsed response plus the metadata a cache needs. */
export interface HttpResponse<T> {
  status: number;
  /**
   * Parsed JSON body. Undefined on 304, 204, an empty body or a status listed in `allow`.
   */
  data: T | undefined;
  /** ETag the server attached to this answer, if any. Pass it back as `etag` next time. */
  etag?: string;
  /** True when the server answered 304 to the supplied ETag: the cached copy is still current. */
  notModified: boolean;
}

/**
 * Only GET is retried: it is idempotent, so a second attempt after a dropped connection or a
 * 5xx cannot double-apply anything. 4xx answers are never retried, and neither is a timeout,
 * because the request already waited the full timeout and a repeat would double it.
 */
const RETRY_DELAY_MS = 200;
const RETRY_JITTER_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Thin JSON-over-HTTP client bound to one server base URL and (optionally) a user token. */
export class JellyfinHttp {
  constructor(
    readonly baseUrl: string,
    readonly client: ClientInfo,
    readonly token: string | undefined,
    private readonly fetchFn: FetchFn,
    private readonly defaultTimeoutMs = 15000,
  ) {}

  withToken(token: string): JellyfinHttp {
    return new JellyfinHttp(
      this.baseUrl,
      this.client,
      token,
      this.fetchFn,
      this.defaultTimeoutMs,
    );
  }

  url(path: string, query: Record<string, QueryValue> = {}): string {
    return `${this.baseUrl}${path}${buildQuery(query)}`;
  }

  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const r = await this.send<T>(path, opts);
    return r.data as T;
  }

  /**
   * Like `request`, but returns the status and ETag with the body and accepts a conditional
   * `etag`. GET is retried once, after a short jittered delay, when the connection fails or
   * the server answers 5xx.
   */
  async send<T>(
    path: string,
    opts: SendOptions = {},
  ): Promise<HttpResponse<T>> {
    const method = opts.method ?? 'GET';
    const url = this.url(path, opts.query);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: authHeader(this.client, this.token),
    };
    if (opts.etag) {
      headers['If-None-Match'] = opts.etag;
    }
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    const attempt = () =>
      this.fetchOnce(path, url, method, headers, body, timeoutMs);

    let res: Response;
    for (let tries = 0; ; tries++) {
      const mayRetry = tries === 0 && method === 'GET';
      try {
        res = await attempt();
      } catch (e) {
        if (mayRetry && e instanceof BackendError && e.kind === 'network') {
          await sleep(RETRY_DELAY_MS + Math.random() * RETRY_JITTER_MS);
          continue;
        }
        throw e;
      }
      if (mayRetry && res.status >= 500 && !opts.allow?.includes(res.status)) {
        await sleep(RETRY_DELAY_MS + Math.random() * RETRY_JITTER_MS);
        continue;
      }
      break;
    }

    const etag = res.headers.get('ETag') ?? undefined;
    const base = { status: res.status, etag, notModified: false };
    if (opts.etag && res.status === 304) {
      return {
        ...base,
        etag: etag ?? opts.etag,
        data: undefined,
        notModified: true,
      };
    }
    if (opts.allow?.includes(res.status)) {
      return { ...base, data: undefined };
    }
    if (!res.ok) {
      const kind =
        res.status === 401
          ? 'auth'
          : res.status === 403
            ? 'forbidden'
            : res.status === 404
              ? 'notFound'
              : 'server';
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        // ignore
      }
      throw new BackendError(
        `${method} ${path} failed: HTTP ${res.status}`,
        kind,
        res.status,
        detail || undefined,
      );
    }
    if (res.status === 204) {
      return { ...base, data: undefined };
    }
    const text = await res.text();
    if (!text) {
      return { ...base, data: undefined };
    }
    try {
      return { ...base, data: JSON.parse(text) as T };
    } catch {
      throw new BackendError(`Invalid JSON from ${path}`, 'server', res.status);
    }
  }

  /** One attempt with its own timeout; a timeout aborts the request itself. */
  private async fetchOnce(
    path: string,
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | undefined,
    timeoutMs: number,
  ): Promise<Response> {
    // The abort cancels the request itself, so a server that never answers does not keep a
    // connection open after the caller has been told it timed out.
    const abort =
      typeof AbortController === 'function' ? new AbortController() : undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new BackendError(`Request timed out: ${path}`, 'timeout'));
        abort?.abort();
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        this.fetchFn(url, { method, headers, body, signal: abort?.signal }),
        timeout,
      ]);
    } catch (e) {
      if (e instanceof BackendError) {
        throw e;
      }
      throw new BackendError(
        `Cannot reach server: ${(e as Error)?.message ?? e}`,
        'network',
      );
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  get<T>(
    path: string,
    query?: Record<string, QueryValue>,
    timeoutMs?: number,
  ): Promise<T> {
    return this.request<T>(path, { query, timeoutMs });
  }

  post<T>(
    path: string,
    body?: unknown,
    query?: Record<string, QueryValue>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, query });
  }

  delete<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', query });
  }
}

/**
 * Turns user input into candidate base URLs, most likely first.
 * "nas" -> http://nas:8096, https://nas:8920 ; "https://x/jf/" -> https://x/jf
 */
export function candidateUrls(input: string): string[] {
  let s = input.trim().replace(/\/+$/, '');
  if (!s) {
    return [];
  }
  if (/^https?:\/\//i.test(s)) {
    return [s.replace(/^https?/i, m => m.toLowerCase())];
  }
  // host[:port][/path]
  const m = /^([^/:]+|\[[^\]]+\])(?::(\d+))?(\/.*)?$/.exec(s);
  if (!m) {
    return [`http://${s}`];
  }
  const [, host, port, path = ''] = m;
  if (port) {
    const p = Number(port);
    return p === 443 || p === 8920
      ? [`https://${host}:${port}${path}`, `http://${host}:${port}${path}`]
      : [`http://${host}:${port}${path}`, `https://${host}:${port}${path}`];
  }
  return [
    `http://${host}:8096${path}`,
    `https://${host}:8920${path}`,
    `http://${host}${path}`,
  ];
}
