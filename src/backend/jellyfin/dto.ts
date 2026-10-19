/**
 * The subset of Jellyfin API DTOs xelpfin reads, and mappers onto the backend-neutral model.
 * Field names follow the server's JSON (PascalCase).
 */
import type {
  AudioTrack,
  ItemDetail,
  ItemKind,
  Library,
  MediaItem,
  MediaSegment,
  MediaSourceSummary,
  SegmentKind,
  SubtitleTrack,
  UserData,
} from '../types';
import { buildQuery } from './http';

export interface PublicSystemInfoDto {
  Id: string;
  ServerName?: string;
  Version?: string;
  ProductName?: string;
  LocalAddress?: string;
  StartupWizardCompleted?: boolean;
}

export interface UserDto {
  Id: string;
  Name: string;
  HasPassword?: boolean;
  HasConfiguredPassword?: boolean;
  PrimaryImageTag?: string;
  Policy?: { IsAdministrator?: boolean };
}

export interface AuthResultDto {
  User: UserDto;
  AccessToken: string;
  ServerId: string;
}

export interface UserDataDto {
  Played?: boolean;
  PlayedPercentage?: number;
  PlaybackPositionTicks?: number;
  IsFavorite?: boolean;
  UnplayedItemCount?: number;
}

export interface MediaStreamDto {
  Index: number;
  Type: 'Video' | 'Audio' | 'Subtitle' | 'EmbeddedImage' | 'Data' | string;
  Codec?: string;
  Language?: string;
  Title?: string;
  DisplayTitle?: string;
  IsDefault?: boolean;
  IsForced?: boolean;
  IsExternal?: boolean;
  IsTextSubtitleStream?: boolean;
  DeliveryMethod?: 'Encode' | 'Embed' | 'External' | 'Hls' | 'Drop' | string;
  DeliveryUrl?: string;
  Channels?: number;
  Width?: number;
  Height?: number;
  BitDepth?: number;
  BitRate?: number;
  Profile?: string;
  VideoRange?: string;
}

export interface MediaSourceDto {
  Id: string;
  Name?: string;
  Path?: string;
  Container?: string;
  Size?: number;
  Bitrate?: number;
  RunTimeTicks?: number;
  SupportsDirectPlay?: boolean;
  SupportsDirectStream?: boolean;
  SupportsTranscoding?: boolean;
  TranscodingUrl?: string;
  TranscodingSubProtocol?: string;
  TranscodingContainer?: string;
  DefaultAudioStreamIndex?: number;
  DefaultSubtitleStreamIndex?: number;
  MediaStreams?: MediaStreamDto[];
}

export interface BaseItemDto {
  Id: string;
  Name?: string;
  Type?: string;
  CollectionType?: string;
  ProductionYear?: number;
  Overview?: string;
  Taglines?: string[];
  RunTimeTicks?: number;
  OfficialRating?: string;
  CommunityRating?: number;
  Genres?: string[];
  Studios?: { Name: string }[];
  People?: { Name: string; Role?: string; Type: string }[];
  PremiereDate?: string;
  SeriesId?: string;
  SeriesName?: string;
  SeasonId?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ChildCount?: number;
  RecursiveItemCount?: number;
  UserData?: UserDataDto;
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ParentBackdropImageTags?: string[];
  ParentThumbItemId?: string;
  ParentThumbImageTag?: string;
  SeriesPrimaryImageTag?: string;
  MediaSources?: MediaSourceDto[];
  MediaType?: string;
  IsFolder?: boolean;
  Chapters?: ChapterDto[];
}

export interface ChapterDto {
  Name?: string;
  StartPositionTicks?: number;
  ImageTag?: string;
}

export interface MediaSegmentDto {
  Type?: string;
  StartTicks?: number;
  EndTicks?: number;
}

export interface MediaSegmentsResultDto {
  Items?: MediaSegmentDto[];
}

const SEGMENT_KINDS: Record<string, SegmentKind> = {
  intro: 'intro',
  outro: 'outro',
  recap: 'recap',
  preview: 'preview',
  commercial: 'commercial',
};

export function mapSegments(
  dtos: MediaSegmentDto[] | undefined,
): MediaSegment[] {
  return (dtos ?? [])
    .map(d => ({
      kind:
        SEGMENT_KINDS[(d.Type ?? '').toLowerCase()] ??
        ('unknown' as SegmentKind),
      startMs: ticksToMs(d.StartTicks) ?? 0,
      endMs: ticksToMs(d.EndTicks) ?? 0,
    }))
    .filter(s => s.endMs > s.startMs)
    .sort((a, b) => a.startMs - b.startMs);
}

export interface ItemsResultDto {
  Items: BaseItemDto[];
  TotalRecordCount: number;
  StartIndex?: number;
}

export interface PlaybackInfoResponseDto {
  MediaSources: MediaSourceDto[];
  PlaySessionId?: string;
  ErrorCode?: string;
}

export const TICKS_PER_MS = 10_000;

export const ticksToMs = (t?: number): number | undefined =>
  t === undefined || t === null ? undefined : Math.round(t / TICKS_PER_MS);

export const msToTicks = (ms: number): number =>
  Math.max(0, Math.round(ms)) * TICKS_PER_MS;

const KIND: Record<string, ItemKind> = {
  Movie: 'movie',
  Series: 'series',
  Season: 'season',
  Episode: 'episode',
  Folder: 'folder',
  CollectionFolder: 'folder',
  BoxSet: 'collection',
  Video: 'video',
  MusicVideo: 'video',
};

const KIND_TO_JF: Record<ItemKind, string | undefined> = {
  movie: 'Movie',
  series: 'Series',
  season: 'Season',
  episode: 'Episode',
  folder: 'Folder',
  collection: 'BoxSet',
  video: 'Video',
  other: undefined,
};

export function kindOf(type?: string): ItemKind {
  return (type && KIND[type]) || 'other';
}

export function jellyfinTypes(kinds?: ItemKind[]): string[] | undefined {
  if (!kinds?.length) {
    return undefined;
  }
  return kinds.map(k => KIND_TO_JF[k]).filter((t): t is string => !!t);
}

export function mapUserData(u?: UserDataDto): UserData | undefined {
  if (!u) {
    return undefined;
  }
  return {
    played: !!u.Played,
    playedPercentage: u.PlayedPercentage,
    playbackPositionMs: ticksToMs(u.PlaybackPositionTicks) ?? 0,
    favorite: !!u.IsFavorite,
    unplayedItemCount: u.UnplayedItemCount,
  };
}

export type ImageType = 'Primary' | 'Backdrop' | 'Thumb';

/** Builds an absolute, sized image URL. */
export type ImageUrlFn = (
  itemId: string,
  type: ImageType,
  maxWidth: number,
  tag?: string,
) => string;

export const POSTER_WIDTH = 300;
export const BACKDROP_WIDTH = 1280;
export const THUMB_WIDTH = 480;

function posterOf(i: BaseItemDto, img: ImageUrlFn): string | undefined {
  const tag = i.ImageTags?.Primary;
  if (i.Type === 'Episode') {
    return i.SeriesId && i.SeriesPrimaryImageTag
      ? img(i.SeriesId, 'Primary', POSTER_WIDTH, i.SeriesPrimaryImageTag)
      : undefined;
  }
  return tag ? img(i.Id, 'Primary', POSTER_WIDTH, tag) : undefined;
}

function backdropOf(i: BaseItemDto, img: ImageUrlFn): string | undefined {
  if (i.BackdropImageTags?.length) {
    return img(i.Id, 'Backdrop', BACKDROP_WIDTH, i.BackdropImageTags[0]);
  }
  if (i.ParentBackdropItemId && i.ParentBackdropImageTags?.length) {
    return img(
      i.ParentBackdropItemId,
      'Backdrop',
      BACKDROP_WIDTH,
      i.ParentBackdropImageTags[0],
    );
  }
  return undefined;
}

function thumbOf(i: BaseItemDto, img: ImageUrlFn): string | undefined {
  if (i.Type === 'Episode' && i.ImageTags?.Primary) {
    return img(i.Id, 'Primary', THUMB_WIDTH, i.ImageTags.Primary);
  }
  if (i.ImageTags?.Thumb) {
    return img(i.Id, 'Thumb', THUMB_WIDTH, i.ImageTags.Thumb);
  }
  if (i.ParentThumbItemId && i.ParentThumbImageTag) {
    return img(
      i.ParentThumbItemId,
      'Thumb',
      THUMB_WIDTH,
      i.ParentThumbImageTag,
    );
  }
  if (i.BackdropImageTags?.length) {
    return img(i.Id, 'Backdrop', THUMB_WIDTH, i.BackdropImageTags[0]);
  }
  if (i.ParentBackdropItemId && i.ParentBackdropImageTags?.length) {
    return img(
      i.ParentBackdropItemId,
      'Backdrop',
      THUMB_WIDTH,
      i.ParentBackdropImageTags[0],
    );
  }
  return undefined;
}

export function mapItem(i: BaseItemDto, img: ImageUrlFn): MediaItem {
  return {
    id: i.Id,
    name: i.Name ?? '',
    kind: kindOf(i.Type),
    year: i.ProductionYear,
    overview: i.Overview,
    runtimeMs: ticksToMs(i.RunTimeTicks),
    officialRating: i.OfficialRating,
    communityRating: i.CommunityRating,
    genres: i.Genres,
    seriesId: i.SeriesId,
    seriesName: i.SeriesName,
    seasonId: i.SeasonId,
    indexNumber: i.IndexNumber,
    parentIndexNumber: i.ParentIndexNumber,
    childCount: i.ChildCount ?? i.RecursiveItemCount,
    userData: mapUserData(i.UserData),
    posterUrl: posterOf(i, img),
    backdropUrl: backdropOf(i, img),
    thumbUrl: thumbOf(i, img),
  };
}

export function streamLabel(s: MediaStreamDto): string {
  return s.DisplayTitle || s.Title || s.Language || `${s.Type} ${s.Index}`;
}

export function mapAudio(s: MediaStreamDto): AudioTrack {
  return {
    index: s.Index,
    label: streamLabel(s),
    language: s.Language,
    codec: s.Codec,
    channels: s.Channels,
    isDefault: !!s.IsDefault,
  };
}

export function mapSubtitle(
  s: MediaStreamDto,
  baseUrl?: string,
): SubtitleTrack {
  const delivery: SubtitleTrack['delivery'] =
    s.DeliveryMethod === 'External'
      ? 'external'
      : s.DeliveryMethod === 'Encode'
        ? 'burn-in'
        : s.IsExternal
          ? 'external'
          : 'embedded';
  let url: string | undefined;
  if (s.DeliveryUrl) {
    url = /^https?:/i.test(s.DeliveryUrl)
      ? s.DeliveryUrl
      : `${baseUrl ?? ''}${s.DeliveryUrl}`;
  }
  return {
    index: s.Index,
    label: streamLabel(s),
    language: s.Language,
    codec: s.Codec,
    isDefault: !!s.IsDefault,
    isForced: !!s.IsForced,
    delivery,
    url,
    mimeType: url ? subtitleMime(url, s.Codec) : undefined,
  };
}

export function subtitleMime(url: string, codec?: string): string {
  const ext = (/\.(\w+)(?:\?|$)/.exec(url)?.[1] ?? codec ?? '').toLowerCase();
  switch (ext) {
    case 'vtt':
    case 'webvtt':
      return 'text/vtt';
    case 'ttml':
      return 'application/ttml+xml';
    default:
      return 'application/x-subrip';
  }
}

export function mapMediaSource(
  ms: MediaSourceDto,
  baseUrl?: string,
): MediaSourceSummary {
  const streams = ms.MediaStreams ?? [];
  const video = streams.find(s => s.Type === 'Video');
  return {
    id: ms.Id,
    name: ms.Name,
    container: ms.Container,
    sizeBytes: ms.Size,
    bitrate: ms.Bitrate,
    videoCodec: video?.Codec,
    width: video?.Width,
    height: video?.Height,
    audioTracks: streams.filter(s => s.Type === 'Audio').map(mapAudio),
    subtitleTracks: streams
      .filter(s => s.Type === 'Subtitle')
      .map(s => mapSubtitle(s, baseUrl)),
  };
}

export function mapDetail(
  i: BaseItemDto,
  img: ImageUrlFn,
  baseUrl?: string,
): ItemDetail {
  return {
    ...mapItem(i, img),
    people: i.People?.map(p => ({ name: p.Name, role: p.Role, type: p.Type })),
    studios: i.Studios?.map(s => s.Name),
    tagline: i.Taglines?.[0],
    premiereDate: i.PremiereDate,
    mediaSources: i.MediaSources?.map(ms => mapMediaSource(ms, baseUrl)),
    chapters: i.Chapters?.map((c, n) => ({
      name: c.Name || `Chapter ${n + 1}`,
      startMs: ticksToMs(c.StartPositionTicks) ?? 0,
      imageUrl:
        c.ImageTag && baseUrl
          ? `${baseUrl}/Items/${encodeURIComponent(i.Id)}/Images/Chapter/${n}${buildQuery({ maxWidth: 320, tag: c.ImageTag })}`
          : undefined,
    })),
  };
}

const SUPPORTED_LIBRARY_TYPES = new Set([
  'movies',
  'tvshows',
  'homevideos',
  'boxsets',
  'mixed',
  '',
]);

/** Keeps only video libraries (music, photos, live TV are out of scope). */
export function mapLibraries(items: BaseItemDto[], img: ImageUrlFn): Library[] {
  return items
    .filter(i =>
      SUPPORTED_LIBRARY_TYPES.has((i.CollectionType ?? '').toLowerCase()),
    )
    .map(i => ({
      id: i.Id,
      name: i.Name ?? '',
      collectionType: i.CollectionType ?? 'mixed',
      imageUrl: i.ImageTags?.Primary
        ? img(i.Id, 'Primary', THUMB_WIDTH, i.ImageTags.Primary)
        : undefined,
    }));
}
