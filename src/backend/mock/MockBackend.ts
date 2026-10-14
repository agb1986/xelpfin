/**
 * In-memory backend used by UI tests and for working on screens without a server.
 * Behaves like a tiny Jellyfin: two libraries, a few movies, one series.
 */
import type { Backend, ImageKind, ServerConnector } from '../Backend';
import {
  BackendError,
  type DiscoveredServer,
  type ItemDetail,
  type ItemQuery,
  type Library,
  type MediaItem,
  type MediaSegment,
  type Page,
  type PlaybackPlan,
  type PlaybackRequest,
  type ProgressReport,
  type PublicUser,
  type QuickConnectState,
  type ServerInfo,
  type Session,
} from '../types';
import type { DeviceCapabilities } from '../../player/capabilities';

export const MOCK_SERVER: ServerInfo = { id: 'mock-server', name: 'Mock Server', url: 'http://mock.local:8096', version: '0.0.0' };

const movie = (id: string, name: string, year: number, extra: Partial<MediaItem> = {}): MediaItem => ({
  id,
  name,
  kind: 'movie',
  year,
  runtimeMs: 40_000,
  overview: `${name} overview.`,
  userData: { played: false, playbackPositionMs: 0, favorite: false },
  ...extra,
});

export function mockData() {
  const libraries: Library[] = [
    { id: 'lib-movies', name: 'Movies', collectionType: 'movies' },
    { id: 'lib-shows', name: 'Shows', collectionType: 'tvshows' },
  ];
  const movies = [
    movie('m1', 'Big Purple Test', 2024, { userData: { played: false, playbackPositionMs: 12_000, playedPercentage: 30, favorite: false } }),
    movie('m2', 'Night Grid', 2023),
    movie('m3', 'Old Codec', 2001),
  ];
  const series: MediaItem = { id: 's1', name: 'Test Show', kind: 'series', year: 2022, childCount: 2 };
  const seasons: MediaItem[] = [
    { id: 'se1', name: 'Season 1', kind: 'season', seriesId: 's1', indexNumber: 1 },
    { id: 'se2', name: 'Season 2', kind: 'season', seriesId: 's1', indexNumber: 2 },
  ];
  const ep = (id: string, season: string, s: number, e: number): MediaItem => ({
    id,
    name: `Episode ${e}`,
    kind: 'episode',
    seriesId: 's1',
    seriesName: 'Test Show',
    seasonId: season,
    parentIndexNumber: s,
    indexNumber: e,
    runtimeMs: 20_000,
    userData: { played: false, playbackPositionMs: 0, favorite: false },
  });
  const episodes = [ep('e1', 'se1', 1, 1), ep('e2', 'se1', 1, 2), ep('e3', 'se1', 1, 3), ep('e4', 'se2', 2, 1)];
  return { libraries, movies, series, seasons, episodes };
}

export class MockConnector implements ServerConnector {
  readonly backendType = 'mock';
  users: PublicUser[] = [
    { id: 'u1', name: 'xelpfin', hasPassword: true },
    { id: 'u2', name: 'guest', hasPassword: false },
  ];
  passwords: Record<string, string> = { xelpfin: 'xelpfin-pass', guest: '' };
  private qcPolls = 0;

  async discover(): Promise<DiscoveredServer[]> {
    return [{ ...MOCK_SERVER, candidates: [MOCK_SERVER.url] }];
  }
  async probe(address: string): Promise<ServerInfo> {
    if (!address.trim() || address.includes('bad')) {
      throw new BackendError(`No Jellyfin server at ${address}`, 'network');
    }
    return MOCK_SERVER;
  }
  async publicUsers(): Promise<PublicUser[]> {
    return this.users;
  }
  async login(server: ServerInfo, username: string, password: string): Promise<Session> {
    if (this.passwords[username] !== password) {
      throw new BackendError('Wrong user name or password', 'auth', 401);
    }
    const u = this.users.find(x => x.name === username)!;
    return { server, userId: u.id, userName: u.name, accessToken: `tok-${u.id}`, isAdmin: u.name === 'xelpfin' };
  }
  async quickConnectStart(): Promise<QuickConnectState> {
    this.qcPolls = 0;
    return { status: 'pending', code: '123456', secret: 'qc-secret' };
  }
  async quickConnectPoll(_s: ServerInfo, secret: string): Promise<QuickConnectState> {
    this.qcPolls++;
    return this.qcPolls >= 2 ? { status: 'authorized', secret } : { status: 'pending', code: '123456', secret };
  }
  async quickConnectLogin(server: ServerInfo): Promise<Session> {
    return { server, userId: 'u1', userName: 'xelpfin', accessToken: 'tok-qc', isAdmin: true };
  }
  open(session: Session): Backend {
    return new MockBackend(session);
  }
}

export class MockBackend implements Backend {
  data = mockData();
  reports: { type: 'start' | 'progress' | 'stop'; report: ProgressReport }[] = [];

  constructor(readonly session: Session) {}

  private all(): MediaItem[] {
    return [...this.data.movies, this.data.series, ...this.data.seasons, ...this.data.episodes];
  }

  async validate(): Promise<void> {}
  async logout(): Promise<void> {}
  async libraries(): Promise<Library[]> {
    return this.data.libraries;
  }
  async items(q: ItemQuery): Promise<Page<MediaItem>> {
    let list = q.libraryId === 'lib-shows' || q.parentId === 'lib-shows' ? [this.data.series] : this.data.movies;
    if (q.nameStartsWith) {
      list = list.filter(i => i.name.toUpperCase().startsWith(q.nameStartsWith!.toUpperCase()));
    }
    list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (q.descending) {
      list.reverse();
    }
    const start = q.startIndex ?? 0;
    return { items: list.slice(start, start + (q.limit ?? 60)), totalCount: list.length, startIndex: start };
  }
  async item(id: string): Promise<ItemDetail> {
    const it = this.all().find(i => i.id === id);
    if (!it) {
      throw new BackendError('Not found', 'notFound', 404);
    }
    return {
      ...it,
      nextUp: it.kind === 'series' ? this.data.episodes[0] : undefined,
      mediaSources: [
        {
          id: `${id}-src`,
          container: 'mkv',
          videoCodec: 'h264',
          audioTracks: [{ index: 1, label: 'English', language: 'eng', codec: 'aac', isDefault: true }],
          subtitleTracks: [],
        },
      ],
    };
  }
  async search(term: string): Promise<MediaItem[]> {
    const t = term.trim().toLowerCase();
    return t ? this.all().filter(i => i.name.toLowerCase().includes(t) && i.kind !== 'season') : [];
  }
  async resume(): Promise<MediaItem[]> {
    return this.data.movies.filter(m => (m.userData?.playbackPositionMs ?? 0) > 0);
  }
  async resumeEpisode(): Promise<MediaItem | undefined> {
    return this.data.episodes.find(e => (e.userData?.playbackPositionMs ?? 0) > 0);
  }
  async nextUp(): Promise<MediaItem[]> {
    return [this.data.episodes[1]];
  }
  async latest(libraryId: string): Promise<MediaItem[]> {
    return libraryId === 'lib-shows' ? [this.data.series] : this.data.movies;
  }
  async seasons(): Promise<MediaItem[]> {
    return this.data.seasons;
  }
  async episodes(_seriesId: string, seasonId?: string): Promise<MediaItem[]> {
    return this.data.episodes.filter(e => !seasonId || e.seasonId === seasonId);
  }
  imageUrl(itemId: string, kind: ImageKind, maxWidth: number): string {
    return `${this.session.server.url}/img/${itemId}/${kind}?w=${maxWidth}`;
  }
  async playback(req: PlaybackRequest, _caps: DeviceCapabilities): Promise<PlaybackPlan> {
    return {
      itemId: req.itemId,
      mediaSourceId: `${req.itemId}-src`,
      playSessionId: 'ps1',
      method: 'DirectPlay',
      reasons: [],
      url: `${this.session.server.url}/stream/${req.itemId}`,
      streamType: 'progressive',
      startPositionMs: req.startPositionMs ?? 0,
      durationMs: 40_000,
      audioTracks: [{ index: 1, label: 'English', language: 'eng', codec: 'aac', isDefault: true }],
      subtitleTracks: [],
      selectedAudioIndex: 1,
      headers: {},
    };
  }
  async reportStart(report: ProgressReport): Promise<void> {
    this.reports.push({ type: 'start', report });
  }
  async reportProgress(report: ProgressReport): Promise<void> {
    this.reports.push({ type: 'progress', report });
  }
  async reportStop(report: ProgressReport): Promise<void> {
    this.reports.push({ type: 'stop', report });
  }
  async mediaSegments(): Promise<MediaSegment[]> {
    return [];
  }
  async setPlayed(itemId: string, played: boolean): Promise<void> {
    const it = this.all().find(i => i.id === itemId);
    if (it) {
      it.userData = { ...(it.userData ?? { playbackPositionMs: 0, favorite: false }), played };
    }
  }
  async clearProgress(itemId: string): Promise<void> {
    const it = this.all().find(i => i.id === itemId);
    if (it?.userData) {
      it.userData = { ...it.userData, playbackPositionMs: 0 };
    }
  }
  async setFavorite(itemId: string, favorite: boolean): Promise<void> {
    const it = this.all().find(i => i.id === itemId);
    if (it) {
      it.userData = { ...(it.userData ?? { playbackPositionMs: 0, played: false }), favorite };
    }
  }
}
