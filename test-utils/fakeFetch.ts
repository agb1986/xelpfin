export interface Call {
  method: string;
  url: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: any;
}

type Handler = (
  call: Call,
) => { status?: number; json?: unknown; text?: string } | Promise<never>;
type Route = Handler | object | boolean | string | number;

/** Route table fake for `fetch`: keys are "METHOD /path" (query ignored). Records every call. */
export function fakeFetch(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const fn = jest.fn(async (input: any, init: any = {}) => {
    const url = String(input);
    // Parsed by hand: React Native's URL typings lack pathname/origin/searchParams.
    const m = /^(https?:\/\/[^/?#]+)([^?#]*)(?:\?([^#]*))?/.exec(url)!;
    const u = { origin: m[1], pathname: m[2] || '/' };
    const query: Record<string, string> = {};
    for (const pair of (m[3] ?? '').split('&').filter(Boolean)) {
      const [k, v = ''] = pair.split('=');
      query[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    }
    const call: Call = {
      method: init.method ?? 'GET',
      url,
      path: u.pathname,
      query,
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const key = `${call.method} ${u.origin}${call.path}`;
    const short = `${call.method} ${call.path}`;
    const route = routes[key] ?? routes[short];
    if (route === undefined) {
      return new Response('not found', { status: 404 });
    }
    const r =
      typeof route === 'function'
        ? await (route as Handler)(call)
        : { json: route };
    const status = r.status ?? 200;
    const body = r.text ?? (r.json === undefined ? '' : JSON.stringify(r.json));
    return new Response(status === 204 ? null : body, { status });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

export const CLIENT = {
  client: 'xelpfin',
  device: 'Test TV',
  deviceId: 'dev-1',
  version: '0.1.0',
};
