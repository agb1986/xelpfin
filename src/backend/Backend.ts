import type {
  DiscoveredServer,
  ItemDetail,
  ItemQuery,
  Library,
  MediaItem,
  MediaSegment,
  Page,
  PlaybackPlan,
  PlaybackRequest,
  ProgressReport,
  PublicUser,
  QuickConnectState,
  ServerInfo,
  Session,
  Trickplay,
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
  discover(
    timeoutMs?: number,
    extraHosts?: string[],
  ): Promise<DiscoveredServer[]>;
  /** Normalises a manually typed address ("192.168.1.5", "nas:8096", "https://x") and checks it. */
  probe(address: string): Promise<ServerInfo>;
  publicUsers(server: ServerInfo): Promise<PublicUser[]>;
  login(
    server: ServerInfo,
    username: string,
    password: string,
  ): Promise<Session>;
  quickConnectStart(server: ServerInfo): Promise<QuickConnectState>;
  quickConnectPoll(
    server: ServerInfo,
    secret: string,
  ): Promise<QuickConnectState>;
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
  /** The most recently played, partly watched episode of a series, if any. */
  resumeEpisode(seriesId: string): Promise<MediaItem | undefined>;
  /** Next episode per in-progress series. */
  nextUp(limit?: number, seriesId?: string): Promise<MediaItem[]>;
  latest(libraryId: string, limit?: number): Promise<MediaItem[]>;
  seasons(seriesId: string): Promise<MediaItem[]>;
  episodes(seriesId: string, seasonId?: string): Promise<MediaItem[]>;
  imageUrl(itemId: string, kind: ImageKind, maxWidth: number): string;

  /** Negotiates how to play an item given what this device can decode. */
  playback(
    request: PlaybackRequest,
    caps: DeviceCapabilities,
  ): Promise<PlaybackPlan>;
  reportStart(report: ProgressReport): Promise<void>;
  reportProgress(report: ProgressReport): Promise<void>;
  reportStop(report: ProgressReport): Promise<void>;
  /**
   * Keeps the server's transcode for an unreported session alive without recording progress.
   * A no-op for direct play.
   */
  pingPlayback(plan: ProgressReport['plan']): Promise<void>;
  /**
   * Ends the server's transcode for an unreported session without recording a stop. A no-op for
   * direct play. `reportStop` already does this for reported sessions.
   */
  stopEncoding(plan: ProgressReport['plan']): Promise<void>;
  /** Tagged intro/credits ranges. Resolves empty when the server has none or does not support it. */
  mediaSegments(itemId: string): Promise<MediaSegment[]>;
  /** Forgets the resume position, which takes a partly watched item off Continue Watching. */
  clearProgress(itemId: string): Promise<void>;
  setPlayed(itemId: string, played: boolean): Promise<void>;
  setFavorite(itemId: string, favorite: boolean): Promise<void>;
  /**
   * Seek preview thumbnails for one media source (the item's own when omitted). Resolves
   * undefined when the server has not generated any or does not support them.
   */
  trickplay(
    itemId: string,
    mediaSourceId?: string,
  ): Promise<Trickplay | undefined>;

  // Values the library screen offers as filters, each sorted for display.
  /** Genre names used in a library, A to Z. */
  genres(libraryId: string): Promise<string[]>;
  /** Production years present in a library, newest first. */
  years(libraryId: string): Promise<number[]>;
  /** Studio names used in a library, A to Z. */
  studios(libraryId: string): Promise<string[]>;
  /** Tags used in a library, A to Z. */
  tags(libraryId: string): Promise<string[]>;
  /** Parental ratings used in a library, such as `PG-13`, A to Z. */
  officialRatings(libraryId: string): Promise<string[]>;
}
