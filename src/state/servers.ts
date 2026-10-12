import type { ServerInfo, Session } from '../backend/types';
import type { KeyValueStore } from '../platform/types';

const SERVERS = 'xelpfin.servers';
const SESSION = 'xelpfin.session';

async function readJson<T>(store: KeyValueStore, key: string): Promise<T | undefined> {
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
  return Array.isArray(list) ? list.filter(s => s && typeof s.url === 'string' && typeof s.id === 'string') : [];
}

export function rememberServer(list: ServerInfo[], server: ServerInfo): ServerInfo[] {
  return [server, ...list.filter(s => s.id !== server.id)].slice(0, 8);
}

export async function saveServers(store: KeyValueStore, list: ServerInfo[]): Promise<void> {
  await store.set(SERVERS, JSON.stringify(list)).catch(() => undefined);
}

export async function loadSession(store: KeyValueStore): Promise<Session | undefined> {
  const s = await readJson<Session>(store, SESSION);
  return s && s.accessToken && s.userId && s.server?.url ? s : undefined;
}

export async function saveSession(store: KeyValueStore, session: Session | undefined): Promise<void> {
  await (session ? store.set(SESSION, JSON.stringify(session)) : store.remove(SESSION)).catch(() => undefined);
}
