import type { ServerInfo, Session } from '../backend/types';
import type {
  CertificatePin,
  KeyValueStore,
  TlsInspection,
} from '../platform/types';

const SERVERS = 'xelpfin.servers';
const SESSION = 'xelpfin.session';

async function readJson<T>(
  store: KeyValueStore,
  key: string,
): Promise<T | undefined> {
  try {
    const raw = await store.get(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** Servers the user has connected to before, most recent first. */
export async function loadServers(store: KeyValueStore): Promise<ServerInfo[]> {
  const list = await readJson<ServerInfo[]>(store, SERVERS);
  return Array.isArray(list)
    ? list
        .filter(s => s && typeof s.url === 'string' && typeof s.id === 'string')
        .map(dropBadPin)
    : [];
}

/** A stored pin that is not a well-formed fingerprint is ignored rather than trusted. */
function dropBadPin(s: ServerInfo): ServerInfo {
  if (s.certSha256 === undefined || isFingerprint(s.certSha256)) {
    return s;
  }
  const rest = { ...s };
  delete rest.certSha256;
  return rest;
}

const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** True for a SHA-256 fingerprint in the "AB:CD:…" form the platform reports. */
export function isFingerprint(s: unknown): s is string {
  return typeof s === 'string' && FINGERPRINT.test(s);
}

export interface TlsEndpoint {
  /** Lower case, IPv6 without brackets. */
  host: string;
  port: number;
}

/** Host and port of an https URL; undefined for http or anything unparseable. */
export function tlsEndpoint(url: string): TlsEndpoint | undefined {
  const m = /^https:\/\/(\[[^\]]+\]|[^/:?#]+)(?::(\d+))?(?:[/?#]|$)/i.exec(
    url.trim(),
  );
  if (!m) {
    return undefined;
  }
  const port = m[2] ? Number(m[2]) : 443;
  if (!(port > 0 && port < 65536)) {
    return undefined;
  }
  return { host: m[1].replace(/^\[|\]$/g, '').toLowerCase(), port };
}

const endpointKey = (e: TlsEndpoint) => `${e.host}:${e.port}`;

/** True when both URLs are https on the same host and port, i.e. share a pin. */
export function sameTlsEndpoint(a: string, b: string): boolean {
  const ea = tlsEndpoint(a);
  const eb = tlsEndpoint(b);
  return !!ea && !!eb && endpointKey(ea) === endpointKey(eb);
}

/**
 * One pin per https host and port from the given servers. Later entries win, so pass the
 * sources oldest first (persisted session, saved list, certificates accepted just now).
 */
export function pinsFor(
  servers: ReadonlyArray<ServerInfo | undefined>,
): CertificatePin[] {
  const byKey = new Map<string, CertificatePin>();
  for (const s of servers) {
    const e = s && isFingerprint(s.certSha256) ? tlsEndpoint(s.url) : undefined;
    if (e) {
      byKey.set(endpointKey(e), { ...e, sha256: s!.certSha256! });
    }
  }
  return [...byKey.values()];
}

/** The pin in `pins` for this URL's https host and port. */
export function pinForUrl(
  pins: ReadonlyArray<CertificatePin>,
  url: string,
): string | undefined {
  const e = tlsEndpoint(url);
  return e
    ? pins.find(p => p.host === e.host && p.port === e.port)?.sha256
    : undefined;
}

/** Sets (or, with undefined, clears) the pin of every saved server on this https endpoint. */
export function withCertificate(
  list: ServerInfo[],
  url: string,
  sha256: string | undefined,
): ServerInfo[] {
  return list.map(s => {
    if (!sameTlsEndpoint(s.url, url)) {
      return s;
    }
    const rest = { ...s };
    delete rest.certSha256;
    return sha256 ? { ...rest, certSha256: sha256 } : rest;
  });
}

/**
 * What to do with an inspected chain:
 *  - `trusted`: the system trust store accepts it, no pin is involved;
 *  - `pinned`: the leaf is the one already pinned, so the failure was something else;
 *  - `new`: never seen, ask the user;
 *  - `changed`: differs from the pinned certificate, warn loudly before asking again.
 */
export function assessCertificate(
  inspection: TlsInspection,
  pinned: string | undefined,
): 'trusted' | 'pinned' | 'new' | 'changed' | 'invalid' {
  const leaf = inspection.chain[0];
  if (inspection.trusted) {
    return 'trusted';
  }
  if (!leaf || !isFingerprint(leaf.sha256)) {
    return 'invalid';
  }
  if (!pinned) {
    return 'new';
  }
  return leaf.sha256 === pinned ? 'pinned' : 'changed';
}

/** A fingerprint in two lines of 16 bytes, which fits a TV screen at reading size. */
export function fingerprintLines(sha256: string): string[] {
  const bytes = sha256.split(':');
  return [bytes.slice(0, 16).join(':'), bytes.slice(16).join(':')].filter(
    Boolean,
  );
}

export function rememberServer(
  list: ServerInfo[],
  server: ServerInfo,
): ServerInfo[] {
  return [server, ...list.filter(s => s.id !== server.id)].slice(0, 8);
}

export async function saveServers(
  store: KeyValueStore,
  list: ServerInfo[],
): Promise<void> {
  await store.set(SERVERS, JSON.stringify(list)).catch(() => undefined);
}

export async function loadSession(
  store: KeyValueStore,
): Promise<Session | undefined> {
  const s = await readJson<Session>(store, SESSION);
  return s && s.accessToken && s.userId && s.server?.url ? s : undefined;
}

export async function saveSession(
  store: KeyValueStore,
  session: Session | undefined,
): Promise<void> {
  await (
    session
      ? store.set(SESSION, JSON.stringify(session))
      : store.remove(SESSION)
  ).catch(() => undefined);
}

/**
 * The https endpoints a typed address may mean, for certificate inspection after a failed
 * connect. Follows the order the connector tries: an explicit https URL is the only target,
 * an explicit http URL has none, host:port is that port, and a bare host is Jellyfin's https
 * port 8920 and then 443.
 */
export function tlsTargets(address: string): TlsEndpoint[] {
  const s = address.trim();
  if (/^https:\/\//i.test(s)) {
    const e = tlsEndpoint(s);
    return e ? [e] : [];
  }
  if (!s || /^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    return [];
  }
  const m = /^(\[[^\]]+\]|[^/:?#]+)(?::(\d+))?(?:[/?#].*)?$/.exec(s);
  if (!m) {
    return [];
  }
  const host = m[1].replace(/^\[|\]$/g, '').toLowerCase();
  if (m[2]) {
    const port = Number(m[2]);
    return port > 0 && port < 65536 ? [{ host, port }] : [];
  }
  return [
    { host, port: 8920 },
    { host, port: 443 },
  ];
}
