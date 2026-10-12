/**
 * Jellyfin LAN autodiscovery: a UDP datagram "who is JellyfinServer?" to port 7359; each server
 * answers with JSON {Address, Id, Name, EndpointAddress}. The transport is injected so the same
 * code runs on Fire TV (native module), in Node tests (dgram) and on future platforms.
 */
export const DISCOVERY_PORT = 7359;
export const DISCOVERY_MESSAGE = 'who is JellyfinServer?';

export interface UdpReply {
  /** Source IP of the datagram. */
  address: string;
  payload: string;
}

export interface UdpTransport {
  /** Broadcasts `message` (and unicasts to `extraHosts`), collecting replies until timeout. */
  broadcast(message: string, port: number, timeoutMs: number, extraHosts?: string[]): Promise<UdpReply[]>;
}

export interface DiscoveryAnswer {
  id: string;
  name: string;
  /** Candidate base URLs, most specific first. */
  candidates: string[];
}

interface ReplyDto {
  Address?: string;
  Id?: string;
  Name?: string;
  EndpointAddress?: string | null;
}

/**
 * Parses replies and merges duplicates by server id. The advertised Address is often unusable
 * (Docker bridge IP, wrong interface), so a candidate built from the datagram's source IP with
 * the advertised port and scheme is added too.
 */
export function parseDiscoveryReplies(replies: UdpReply[]): DiscoveryAnswer[] {
  const byId = new Map<string, DiscoveryAnswer>();
  for (const r of replies) {
    let dto: ReplyDto;
    try {
      dto = JSON.parse(r.payload) as ReplyDto;
    } catch {
      continue;
    }
    if (!dto?.Id || !dto.Address) {
      continue;
    }
    const cands: string[] = [];
    const add = (u?: string | null) => {
      if (u) {
        const clean = u.replace(/\/+$/, '');
        if (!cands.includes(clean)) {
          cands.push(clean);
        }
      }
    };
    add(dto.Address);
    add(dto.EndpointAddress);
    const m = /^(https?):\/\/(?:\[[^\]]+\]|[^/:]+)(?::(\d+))?(\/.*)?$/i.exec(dto.Address);
    if (m && r.address) {
      const host = r.address.includes(':') ? `[${r.address}]` : r.address;
      const port = m[2] ? `:${m[2]}` : '';
      const fromSource = `${m[1].toLowerCase()}://${host}${port}${m[3] ?? ''}`;
      // Prefer the address the reply actually came from.
      const clean = fromSource.replace(/\/+$/, '');
      const idx = cands.indexOf(clean);
      if (idx >= 0) {
        cands.splice(idx, 1);
      }
      cands.unshift(clean);
    }
    const prev = byId.get(dto.Id);
    if (prev) {
      for (const c of cands) {
        if (!prev.candidates.includes(c)) {
          prev.candidates.push(c);
        }
      }
    } else {
      byId.set(dto.Id, { id: dto.Id, name: dto.Name ?? 'Jellyfin', candidates: cands });
    }
  }
  return [...byId.values()];
}
