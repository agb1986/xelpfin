import { BackendError } from '../types';

/** Identifies this client to the server. deviceId must be stable per install. */
export interface ClientInfo {
  client: string;
  device: string;
  deviceId: string;
  version: string;
}

export type FetchFn = typeof fetch;

function quote(v: string): string {
  return v.replace(/"/g, "'");
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

export type QueryValue = string | number | boolean | undefined | null | string[];

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
    return new JellyfinHttp(this.baseUrl, this.client, token, this.fetchFn, this.defaultTimeoutMs);
  }

  url(path: string, query: Record<string, QueryValue> = {}): string {
    return `${this.baseUrl}${path}${buildQuery(query)}`;
  }

  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = this.url(path, opts.query);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: authHeader(this.client, this.token),
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new BackendError(`Request timed out: ${path}`, 'timeout')),
        timeoutMs,
      );
    });
    let res: Response;
    try {
      res = await Promise.race([
        this.fetchFn(url, { method: opts.method ?? 'GET', headers, body }),
        timeout,
      ]);
    } catch (e) {
      if (e instanceof BackendError) {
        throw e;
      }
      throw new BackendError(`Cannot reach server: ${(e as Error)?.message ?? e}`, 'network');
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
    if (opts.allow?.includes(res.status)) {
      return undefined as T;
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
      throw new BackendError(`${opts.method ?? 'GET'} ${path} failed: HTTP ${res.status}`, kind, res.status, detail || undefined);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    const text = await res.text();
    if (!text) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new BackendError(`Invalid JSON from ${path}`, 'server', res.status);
    }
  }

  get<T>(path: string, query?: Record<string, QueryValue>, timeoutMs?: number): Promise<T> {
    return this.request<T>(path, { query, timeoutMs });
  }

  post<T>(path: string, body?: unknown, query?: Record<string, QueryValue>): Promise<T> {
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
  return [`http://${host}:8096${path}`, `https://${host}:8920${path}`, `http://${host}${path}`];
}
