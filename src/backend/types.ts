/**
 * Backend-neutral domain model. UI and state code only see these types; each backend
 * (Jellyfin today) maps its own DTOs onto them.
 */

export type ItemKind =
  | 'movie'
  | 'series'
  | 'season'
  | 'episode'
  | 'folder'
  | 'collection'
  | 'video'
  | 'other';

export interface ServerInfo {
  id: string;
  name: string;
  /** Base URL without trailing slash, e.g. http://192.168.1.10:8096 */
  url: string;
  version?: string;
  /**
   * SHA-256 fingerprint ("AB:CD:…", 32 bytes) of the self-signed certificate the user accepted
   * for this server's https host and port. Unset for http servers and publicly trusted ones.
   */
  certSha256?: string;
}

export interface DiscoveredServer extends ServerInfo {
  /** All candidate URLs that were offered for this server; `url` is the one that answered. */
  candidates: string[];
}

export interface PublicUser {
  id: string;
  name: string;
  hasPassword: boolean;
  imageUrl?: string;
}

export interface Session {
  server: ServerInfo;
  userId: string;
  userName: string;
  accessToken: string;
  isAdmin: boolean;
}

export interface Library {
  id: string;
  name: string;
  /** movies | tvshows | ... ; libraries with unsupported types are filtered out by the backend. */
  collectionType: string;
  imageUrl?: string;
}

export interface UserData {
  played: boolean;
  /** 0..100 */
  playedPercentage?: number;
  playbackPositionMs: number;
  favorite: boolean;
  unplayedItemCount?: number;
}

export interface MediaItem {
  id: string;
  name: string;
  kind: ItemKind;
  year?: number;
  overview?: string;
  runtimeMs?: number;
  officialRating?: string;
  communityRating?: number;
  genres?: string[];
  seriesId?: string;
  seriesName?: string;
  seasonId?: string;
  indexNumber?: number;
  parentIndexNumber?: number;
  childCount?: number;
  userData?: UserData;
  /** Image URLs are absolute and already sized for TV; empty when the item has no such image. */
  posterUrl?: string;
  backdropUrl?: string;
  thumbUrl?: string;
}

/** `rating` is the community rating. */
export type SortField =
  | 'name'
  | 'dateAdded'
  | 'year'
  | 'rating'
  | 'runtime'
  | 'premiereDate'
  | 'playCount'
  | 'datePlayed'
  | 'criticRating'
  | 'random';

/**
 * Video resolution filter. `hd` means HD or better, so it includes 4K: Jellyfin cannot ask for
 * "HD but not 4K" (its `is4K=false` matches nothing).
 */
export type Resolution = '4k' | 'hd' | 'sd';

export interface ItemQuery {
  libraryId?: string;
  parentId?: string;
  kinds?: ItemKind[];
  sort?: SortField;
  descending?: boolean;
  /** Only items whose name starts with this letter (jump-letter); '#' means non-letters. */
  nameStartsWith?: string;
  unplayedOnly?: boolean;
  startIndex?: number;
  limit?: number;
  /** Items with any of these genres. */
  genres?: string[];
  /** Items from any of these production years. */
  years?: number[];
  /** Items with any of these parental ratings, such as `PG-13`. */
  officialRatings?: string[];
  tags?: string[];
  studios?: string[];
  /** True for watched items only, false for unwatched only. Wins over `unplayedOnly`. */
  played?: boolean;
  /** Only videos of this resolution. Applies to movies and episodes, not to series. */
  resolution?: Resolution;
}

export interface Page<T> {
  items: T[];
  totalCount: number;
  startIndex: number;
}

export interface ItemDetail extends MediaItem {
  people?: { name: string; role?: string; type: string }[];
  studios?: string[];
  tagline?: string;
  premiereDate?: string;
  /** For series: the next episode to watch. */
  nextUp?: MediaItem;
  mediaSources?: MediaSourceSummary[];
  /** Chapter marks embedded in the file or added by the server; empty when there are none. */
  chapters?: Chapter[];
}

export interface Chapter {
  name: string;
  startMs: number;
  /** Absolute thumbnail URL when the server has an image for this chapter. */
  imageUrl?: string;
}

export type SegmentKind =
  'intro' | 'outro' | 'recap' | 'preview' | 'commercial' | 'unknown';

/** A stretch of an item the server has tagged, such as the opening titles or the end credits. */
export interface MediaSegment {
  kind: SegmentKind;
  startMs: number;
  endMs: number;
}

export interface MediaSourceSummary {
  id: string;
  name?: string;
  container?: string;
  sizeBytes?: number;
  bitrate?: number;
  videoCodec?: string;
  width?: number;
  height?: number;
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
}

export interface AudioTrack {
  /** Backend stream index. */
  index: number;
  label: string;
  language?: string;
  codec?: string;
  channels?: number;
  isDefault: boolean;
}

export interface SubtitleTrack {
  index: number;
  label: string;
  language?: string;
  codec?: string;
  isDefault: boolean;
  isForced: boolean;
  /** Embedded in the container vs. a separate file the player loads by URL. */
  delivery: 'embedded' | 'external' | 'burn-in';
  /** For external delivery: absolute URL and MIME type. */
  url?: string;
  mimeType?: string;
  /**
   * Position among the subtitle tracks stored inside the media file (sidecar files excluded),
   * which is how the native player numbers its text tracks. Set for embedded tracks only.
   */
  containerPosition?: number;
}

export type PlayMethod = 'DirectPlay' | 'DirectStream' | 'Transcode';

export interface PlaybackRequest {
  itemId: string;
  mediaSourceId?: string;
  audioStreamIndex?: number;
  subtitleStreamIndex?: number;
  startPositionMs?: number;
  /** Cap in bits/s; undefined means use the profile default. */
  maxBitrate?: number;
  /**
   * Ask for MPEG-TS HLS segments instead of fMP4. A retry after the player could not parse the
   * fMP4 stream the server built.
   */
  avoidFmp4?: boolean;
}

export interface PlaybackPlan {
  itemId: string;
  mediaSourceId: string;
  playSessionId: string;
  method: PlayMethod;
  /** Why the plan is not DirectPlay (codec, container, bitrate...). Empty for DirectPlay. */
  reasons: string[];
  url: string;
  /** Hint for the player (e.g. 'm3u8' for HLS transcodes). */
  streamType: 'progressive' | 'hls';
  container?: string;
  startPositionMs: number;
  durationMs?: number;
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
  selectedAudioIndex?: number;
  selectedSubtitleIndex?: number;
  /** Headers the player must send with media requests. */
  headers: Record<string, string>;
  /**
   * Frame rate and size of the source's video stream, when the server reports them, for
   * matching the display mode. For a transcode the server may scale the picture, so the size is
   * that of the source, not of the stream.
   */
  videoFrameRate?: number;
  videoWidth?: number;
  videoHeight?: number;
}

export interface ProgressReport {
  plan: Pick<
    PlaybackPlan,
    'itemId' | 'mediaSourceId' | 'playSessionId' | 'method'
  >;
  positionMs: number;
  isPaused: boolean;
  audioStreamIndex?: number;
  subtitleStreamIndex?: number;
}

export type QuickConnectState =
  | { status: 'pending'; code: string; secret: string }
  | { status: 'authorized'; secret: string }
  | { status: 'unavailable' };

/** Error type all backends throw, so UI can map to error states without knowing HTTP details. */
export class BackendError extends Error {
  constructor(
    message: string,
    readonly kind:
      | 'network'
      | 'auth'
      | 'forbidden'
      | 'notFound'
      | 'server'
      | 'unsupported'
      | 'timeout',
    readonly status?: number,
    /** Text the server sent with the failure. For logs only: it is never shown to the user. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

/**
 * Seek preview frames: thumbnails taken every `intervalMs`, packed left to right and top to
 * bottom into JPEG sheets of `columns` by `rows` tiles. Thumbnail n is on sheet
 * floor(n / (columns * rows)).
 */
export interface Trickplay {
  /** Size of one thumbnail, in pixels of the sheet. */
  width: number;
  height: number;
  columns: number;
  rows: number;
  thumbnailCount: number;
  intervalMs: number;
  /** One absolute URL per sheet, in order. */
  sheetUrls: string[];
  /** Headers to send with each sheet request (the sheets are not public). */
  headers: Record<string, string>;
}
