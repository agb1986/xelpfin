import type {
  DiscoveredServer,
  ItemDetail,
  ItemQuery,
  Library,
  MediaItem,
  Page,
  PlaybackPlan,
  PlaybackRequest,
  ProgressReport,
  PublicUser,
  QuickConnectState,
  ServerInfo,
  Session,
} from './types';
import type { DeviceCapabilities } from '../player/capabilities';

/**
 * Everything that happens before a user is signed in: finding servers and authenticating.
 * One connector per backend type; it hands out a {@link Backend} bound to a session.
 */
export interface ServerConnector {
  readonly backendType: string;
  /**
   * LAN discovery. Resolves with the servers that answered and could be reached.
   * `extraHosts` are also asked directly (unicast), for networks that drop broadcasts.
   */
  discover(timeoutMs?: number, extraHosts?: string[]): Promise<DiscoveredServer[]>;
  /** Normalises a manually typed address ("192.168.1.5", "nas:8096", "https://x") and checks it. */
  probe(address: string): Promise<ServerInfo>;
  publicUsers(server: ServerInfo): Promise<PublicUser[]>;
  login(server: ServerInfo, username: string, password: string): Promise<Session>;
  quickConnectStart(server: ServerInfo): Promise<QuickConnectState>;
  quickConnectPoll(server: ServerInfo, secret: string): Promise<QuickConnectState>;
  quickConnectLogin(server: ServerInfo, secret: string): Promise<Session>;
  /** Binds a stored or fresh session; does not do network I/O. */
  open(session: Session): Backend;
}

export type ImageKind = 'poster' | 'backdrop' | 'thumb';

/** An authenticated connection to one server as one user. */
export interface Backend {
  readonly session: Session;
  /** Checks the stored token still works. Throws BackendError('auth') if not. */
  validate(): Promise<void>;
  logout(): Promise<void>;

  libraries(): Promise<Library[]>;
  items(query: ItemQuery): Promise<Page<MediaItem>>;
  item(id: string): Promise<ItemDetail>;
  search(term: string, limit?: number): Promise<MediaItem[]>;
  /** Continue watching: partially watched movies and episodes. */
  resume(limit?: number): Promise<MediaItem[]>;
  /** Next episode per in-progress series. */
  nextUp(limit?: number, seriesId?: string): Promise<MediaItem[]>;
  latest(libraryId: string, limit?: number): Promise<MediaItem[]>;
  seasons(seriesId: string): Promise<MediaItem[]>;
  episodes(seriesId: string, seasonId?: string): Promise<MediaItem[]>;
  imageUrl(itemId: string, kind: ImageKind, maxWidth: number): string;

  /** Negotiates how to play an item given what this device can decode. */
  playback(request: PlaybackRequest, caps: DeviceCapabilities): Promise<PlaybackPlan>;
  reportStart(report: ProgressReport): Promise<void>;
  reportProgress(report: ProgressReport): Promise<void>;
  reportStop(report: ProgressReport): Promise<void>;
  setPlayed(itemId: string, played: boolean): Promise<void>;
  setFavorite(itemId: string, favorite: boolean): Promise<void>;
}
