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
  type SortField,
} from '../types';
import type { DeviceCapabilities } from '../../player/capabilities';
import {
  jellyfinTypes,
  mapDetail,
  mapItem,
  mapLibraries,
  mapSegments,
  msToTicks,
  type AuthResultDto,
  type BaseItemDto,
  type ImageType,
  type ImageUrlFn,
  type ItemsResultDto,
  type MediaSegmentsResultDto,
  type PlaybackInfoResponseDto,
  type PublicSystemInfoDto,
  type UserDto,
} from './dto';
import { buildDeviceProfile } from './deviceProfile';
import { DISCOVERY_MESSAGE, DISCOVERY_PORT, parseDiscoveryReplies, type UdpTransport } from './discovery';
import { buildQuery, candidateUrls, JellyfinHttp, type ClientInfo, type FetchFn } from './http';
import { buildPlan } from './playback';

/** Fields requested on list endpoints: enough for cards and rows, nothing heavy. */
const LIST_FIELDS = ['PrimaryImageAspectRatio', 'Overview', 'Genres', 'ProductionYear', 'ChildCount', 'RecursiveItemCount'];
const DETAIL_FIELDS = [...LIST_FIELDS, 'People', 'Studios', 'Taglines', 'MediaSources', 'MediaStreams', 'PremiereDate', 'Chapters'];
const IMAGE_TYPES = ['Primary', 'Backdrop', 'Thumb'];

const SORT: Record<SortField, string> = {
  name: 'SortName',
  dateAdded: 'DateCreated,SortName',
  year: 'ProductionYear,PremiereDate,SortName',
  rating: 'CommunityRating,SortName',
};

export interface JellyfinOptions {
  client: ClientInfo;
  fetch?: FetchFn;
  udp?: UdpTransport;
  timeoutMs?: number;
}

function serverInfoFrom(dto: PublicSystemInfoDto, url: string): ServerInfo {
  return { id: dto.Id, name: dto.ServerName || 'Jellyfin', url, version: dto.Version };
}

export class JellyfinConnector implements ServerConnector {
  readonly backendType = 'jellyfin';
  private readonly fetchFn: FetchFn;

  constructor(private readonly opts: JellyfinOptions) {
    this.fetchFn = opts.fetch ?? ((...a: Parameters<FetchFn>) => fetch(...a));
  }

  private http(baseUrl: string, token?: string, timeoutMs?: number): JellyfinHttp {
    return new JellyfinHttp(baseUrl, this.opts.client, token, this.fetchFn, timeoutMs ?? this.opts.timeoutMs);
  }

  private async info(baseUrl: string, timeoutMs = 4000): Promise<ServerInfo> {
    const dto = await this.http(baseUrl).get<PublicSystemInfoDto>('/System/Info/Public', undefined, timeoutMs);
    if (!dto?.Id) {
      throw new BackendError(`${baseUrl} is not a Jellyfin server`, 'unsupported');
    }
    return serverInfoFrom(dto, baseUrl);
  }

  async discover(timeoutMs = 2500, extraHosts: string[] = []): Promise<DiscoveredServer[]> {
    if (!this.opts.udp) {
      return [];
    }
    const replies = await this.opts.udp.broadcast(DISCOVERY_MESSAGE, DISCOVERY_PORT, timeoutMs, extraHosts);
    const answers = parseDiscoveryReplies(replies);
    const found = await Promise.all(
      answers.map(async a => {
        for (const url of a.candidates) {
          try {
            const info = await this.info(url, 2500);
            return { ...info, name: info.name || a.name, candidates: a.candidates } as DiscoveredServer;
          } catch {
            // try next candidate
          }
        }
        return undefined;
      }),
    );
    return found.filter((s): s is DiscoveredServer => !!s);
  }

  async probe(address: string): Promise<ServerInfo> {
    const cands = candidateUrls(address);
    if (!cands.length) {
      throw new BackendError('Enter a server address', 'network');
    }
    const errors: unknown[] = [];
    for (const url of cands) {
      try {
        return await this.info(url);
      } catch (e) {
        errors.push(e);
      }
    }
    // "Something answered but it is not Jellyfin" is more useful than the fallbacks' failures.
    const notJellyfin = errors.find(e => e instanceof BackendError && e.kind === 'unsupported');
    throw notJellyfin ?? new BackendError(`No Jellyfin server found at ${address}`, 'network');
  }

  async publicUsers(server: ServerInfo): Promise<PublicUser[]> {
    const users = await this.http(server.url).get<UserDto[]>('/Users/Public');
    return (users ?? []).map(u => ({
      id: u.Id,
      name: u.Name,
      hasPassword: !!(u.HasPassword ?? u.HasConfiguredPassword),
      imageUrl: u.PrimaryImageTag
        ? `${server.url}/Users/${encodeURIComponent(u.Id)}/Images/Primary${buildQuery({ tag: u.PrimaryImageTag, maxWidth: 200 })}`
        : undefined,
    }));
  }

  private session(server: ServerInfo, r: AuthResultDto): Session {
    return {
      server: { ...server, id: r.ServerId || server.id },
      userId: r.User.Id,
      userName: r.User.Name,
      accessToken: r.AccessToken,
      isAdmin: !!r.User.Policy?.IsAdministrator,
    };
  }

  async login(server: ServerInfo, username: string, password: string): Promise<Session> {
    try {
      const r = await this.http(server.url).post<AuthResultDto>('/Users/AuthenticateByName', {
        Username: username,
        Pw: password,
      });
      return this.session(server, r);
    } catch (e) {
      if (e instanceof BackendError && (e.kind === 'auth' || e.status === 400)) {
        throw new BackendError('Wrong user name or password', 'auth', e.status);
      }
      if (e instanceof BackendError && e.kind === 'forbidden') {
        throw new BackendError('This account is not allowed to sign in right now.', 'forbidden', e.status);
      }
      throw e;
    }
  }

  async quickConnectStart(server: ServerInfo): Promise<QuickConnectState> {
    const http = this.http(server.url);
    const enabled = await http.get<boolean>('/QuickConnect/Enabled').catch(() => false);
    if (!enabled) {
      return { status: 'unavailable' };
    }
    const r = await http.request<{ Code: string; Secret: string } | undefined>('/QuickConnect/Initiate', {
      method: 'POST',
      allow: [401, 403],
    });
    if (!r) {
      return { status: 'unavailable' };
    }
    return { status: 'pending', code: r.Code, secret: r.Secret };
  }

  async quickConnectPoll(server: ServerInfo, secret: string): Promise<QuickConnectState> {
    const r = await this.http(server.url).get<{ Authenticated: boolean; Code: string; Secret: string }>(
      '/QuickConnect/Connect',
      { secret },
    );
    return r.Authenticated ? { status: 'authorized', secret } : { status: 'pending', code: r.Code, secret };
  }

  async quickConnectLogin(server: ServerInfo, secret: string): Promise<Session> {
    const r = await this.http(server.url).post<AuthResultDto>('/Users/AuthenticateWithQuickConnect', { Secret: secret });
    return this.session(server, r);
  }

  open(session: Session): Backend {
    return new JellyfinBackend(session, this.http(session.server.url, session.accessToken), this.opts.client);
  }
}

export class JellyfinBackend implements Backend {
  private readonly img: ImageUrlFn;

  constructor(readonly session: Session, private readonly http: JellyfinHttp, private readonly client: ClientInfo) {
    const base = session.server.url;
    this.img = (id: string, type: ImageType, maxWidth: number, tag?: string) =>
      `${base}/Items/${encodeURIComponent(id)}/Images/${type}${buildQuery({ maxWidth, quality: 90, tag })}`;
  }

  private get user(): string {
    return `/Users/${encodeURIComponent(this.session.userId)}`;
  }

  private mapAll(r: ItemsResultDto | BaseItemDto[] | undefined): MediaItem[] {
    const items = Array.isArray(r) ? r : r?.Items ?? [];
    return items.map(i => mapItem(i, this.img));
  }

  async validate(): Promise<void> {
    await this.http.get<UserDto>(this.user);
  }

  async logout(): Promise<void> {
    await this.http.post('/Sessions/Logout').catch(() => undefined);
  }

  async libraries(): Promise<Library[]> {
    const r = await this.http.get<ItemsResultDto>(`${this.user}/Views`);
    return mapLibraries(r.Items ?? [], this.img);
  }

  async items(q: ItemQuery): Promise<Page<MediaItem>> {
    const startIndex = q.startIndex ?? 0;
    const types = jellyfinTypes(q.kinds);
    const r = await this.http.get<ItemsResultDto>('/Items', {
      userId: this.session.userId,
      parentId: q.parentId ?? q.libraryId,
      includeItemTypes: types,
      recursive: !!types?.length,
      sortBy: SORT[q.sort ?? 'name'],
      sortOrder: q.descending ? 'Descending' : 'Ascending',
      nameStartsWith: q.nameStartsWith && q.nameStartsWith !== '#' ? q.nameStartsWith : undefined,
      nameLessThan: q.nameStartsWith === '#' ? 'A' : undefined,
      filters: q.unplayedOnly ? 'IsUnplayed' : undefined,
      startIndex,
      limit: q.limit ?? 60,
      fields: LIST_FIELDS,
      enableImageTypes: IMAGE_TYPES,
      imageTypeLimit: 1,
      enableTotalRecordCount: true,
    });
    return { items: this.mapAll(r), totalCount: r.TotalRecordCount ?? 0, startIndex };
  }

  async item(id: string): Promise<ItemDetail> {
    const dto = await this.http.get<BaseItemDto>(`/Items/${encodeURIComponent(id)}`, {
      userId: this.session.userId,
      fields: DETAIL_FIELDS,
    });
    const detail = mapDetail(dto, this.img, this.session.server.url);
    if (detail.kind === 'series') {
      const next = await this.nextUp(1, id).catch(() => []);
      detail.nextUp = next[0];
    }
    return detail;
  }

  async search(term: string, limit = 40): Promise<MediaItem[]> {
    if (!term.trim()) {
      return [];
    }
    const r = await this.http.get<ItemsResultDto>('/Items', {
      userId: this.session.userId,
      searchTerm: term.trim(),
      recursive: true,
      includeItemTypes: ['Movie', 'Series', 'Episode', 'Video', 'BoxSet'],
      limit,
      fields: LIST_FIELDS,
      enableImageTypes: IMAGE_TYPES,
      imageTypeLimit: 1,
    });
    return this.mapAll(r);
  }

  async resume(limit = 20): Promise<MediaItem[]> {
    const r = await this.http.get<ItemsResultDto>(`${this.user}/Items/Resume`, {
      limit,
      mediaTypes: 'Video',
      fields: LIST_FIELDS,
      enableImageTypes: IMAGE_TYPES,
      imageTypeLimit: 1,
    });
    return this.mapAll(r);
  }

  async resumeEpisode(seriesId: string): Promise<MediaItem | undefined> {
    const r = await this.http.get<ItemsResultDto>(`${this.user}/Items/Resume`, {
      parentId: seriesId,
      includeItemTypes: 'Episode',
      limit: 1,
      fields: LIST_FIELDS,
      enableImageTypes: IMAGE_TYPES,
      imageTypeLimit: 1,
    });
    return this.mapAll(r)[0];
  }

  async nextUp(limit = 20, seriesId?: string): Promise<MediaItem[]> {
    const r = await this.http.get<ItemsResultDto>('/Shows/NextUp', {
      userId: this.session.userId,
      seriesId,
      limit,
      fields: LIST_FIELDS,
      enableImageTypes: IMAGE_TYPES,
      imageTypeLimit: 1,
      enableResumable: false,
    });
    return this.mapAll(r);
  }

  async latest(libraryId: string, limit = 20): Promise<MediaItem[]> {
    const r = await this.http.get<BaseItemDto[]>(`${this.user}/Items/Latest`, {
      parentId: libraryId,
      limit,
      fields: LIST_FIELDS,
      enableImageTypes: IMAGE_TYPES,
      imageTypeLimit: 1,
      groupItems: true,
    });
    return this.mapAll(r);
  }

  async seasons(seriesId: string): Promise<MediaItem[]> {
    const r = await this.http.get<ItemsResultDto>(`/Shows/${encodeURIComponent(seriesId)}/Seasons`, {
      userId: this.session.userId,
      fields: LIST_FIELDS,
    });
    return this.mapAll(r);
  }

  async episodes(seriesId: string, seasonId?: string): Promise<MediaItem[]> {
    const r = await this.http.get<ItemsResultDto>(`/Shows/${encodeURIComponent(seriesId)}/Episodes`, {
      userId: this.session.userId,
      seasonId,
      fields: [...LIST_FIELDS, 'Overview'],
      enableImageTypes: IMAGE_TYPES,
      imageTypeLimit: 1,
    });
    return this.mapAll(r);
  }

  imageUrl(itemId: string, kind: ImageKind, maxWidth: number): string {
    const type: ImageType = kind === 'poster' ? 'Primary' : kind === 'backdrop' ? 'Backdrop' : 'Thumb';
    return this.img(itemId, type, maxWidth);
  }

  async playback(req: PlaybackRequest, caps: DeviceCapabilities): Promise<PlaybackPlan> {
    const maxBitrate = Math.min(caps.maxStreamingBitrate, req.maxBitrate ?? Infinity);
    const r = await this.http.post<PlaybackInfoResponseDto>(
      `/Items/${encodeURIComponent(req.itemId)}/PlaybackInfo`,
      {
        UserId: this.session.userId,
        MaxStreamingBitrate: maxBitrate,
        MediaSourceId: req.mediaSourceId,
        AudioStreamIndex: req.audioStreamIndex,
        SubtitleStreamIndex: req.subtitleStreamIndex,
        EnableDirectPlay: true,
        EnableDirectStream: true,
        EnableTranscoding: true,
        AllowVideoStreamCopy: true,
        AllowAudioStreamCopy: true,
        AutoOpenLiveStream: false,
        DeviceProfile: buildDeviceProfile(caps),
      },
    );
    if (r.ErrorCode) {
      throw new BackendError(`Server refused playback: ${r.ErrorCode}`, 'unsupported');
    }
    return buildPlan(req, r.MediaSources ?? [], r.PlaySessionId ?? '', caps, {
      baseUrl: this.session.server.url,
      token: this.session.accessToken,
      deviceId: this.client.deviceId,
    });
  }

  private progressBody(p: ProgressReport) {
    return {
      ItemId: p.plan.itemId,
      MediaSourceId: p.plan.mediaSourceId,
      PlaySessionId: p.plan.playSessionId,
      PlayMethod: p.plan.method,
      PositionTicks: msToTicks(p.positionMs),
      IsPaused: p.isPaused,
      CanSeek: true,
      AudioStreamIndex: p.audioStreamIndex,
      SubtitleStreamIndex: p.subtitleStreamIndex ?? -1,
    };
  }

  async reportStart(p: ProgressReport): Promise<void> {
    await this.http.post('/Sessions/Playing', this.progressBody(p));
  }

  async reportProgress(p: ProgressReport): Promise<void> {
    await this.http.post('/Sessions/Playing/Progress', { ...this.progressBody(p), EventName: 'timeupdate' });
  }

  async reportStop(p: ProgressReport): Promise<void> {
    await this.http.post('/Sessions/Playing/Stopped', this.progressBody(p));
    if (p.plan.method !== 'DirectPlay') {
      // Lets the server kill the ffmpeg process right away instead of after its idle timeout.
      await this.http
        .delete('/Videos/ActiveEncodings', { deviceId: this.client.deviceId, playSessionId: p.plan.playSessionId })
        .catch(() => undefined);
    }
  }

  async mediaSegments(itemId: string): Promise<MediaSegment[]> {
    try {
      const r = await this.http.get<MediaSegmentsResultDto>(`/MediaSegments/${encodeURIComponent(itemId)}`);
      return mapSegments(r.Items);
    } catch {
      // Servers before 10.10 have no such endpoint; a missing skip button is not an error.
      return [];
    }
  }

  async setPlayed(itemId: string, played: boolean): Promise<void> {
    const path = `/UserPlayedItems/${encodeURIComponent(itemId)}`;
    const q = { userId: this.session.userId };
    if (played) {
      await this.http.post(path, undefined, q);
    } else {
      await this.http.delete(path, q);
    }
  }

  async clearProgress(itemId: string): Promise<void> {
    await this.http.post(`/UserItems/${encodeURIComponent(itemId)}/UserData`, { PlaybackPositionTicks: 0 }, { userId: this.session.userId });
  }

  async setFavorite(itemId: string, favorite: boolean): Promise<void> {
    const path = `/UserFavoriteItems/${encodeURIComponent(itemId)}`;
    const q = { userId: this.session.userId };
    if (favorite) {
      await this.http.post(path, undefined, q);
    } else {
      await this.http.delete(path, q);
    }
  }
}
