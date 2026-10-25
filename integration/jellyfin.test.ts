/**
 * Runs the real JellyfinConnector/JellyfinBackend against the local test container
 * (npm run jellyfin:up). Only talks to 127.0.0.1.
 */
import { JellyfinConnector } from '../src/backend/jellyfin/JellyfinBackend';
import type { Backend } from '../src/backend/Backend';
import type { MediaItem, ServerInfo } from '../src/backend/types';
import {
  BASELINE_CAPABILITIES,
  type DeviceCapabilities,
} from '../src/player/capabilities';
import { nodeUdp } from '../test-utils/nodeUdp';

const HOST = process.env.JF_HOST ?? '127.0.0.1';
const URL_ = `http://${HOST}:8096`;
const CLIENT = {
  client: 'xelpfin',
  device: 'xelpfin-integration',
  deviceId: 'xelpfin-integration-1',
  version: '0.1.0',
};
const connector = new JellyfinConnector({ client: CLIENT, udp: nodeUdp() });
// Jellyfin keeps one session per device id and revokes the previous token on a new login,
// so each signed-in user in this suite pretends to be a separate device.
const as = (n: number) =>
  new JellyfinConnector({
    client: { ...CLIENT, deviceId: `${CLIENT.deviceId}-${n}` },
    udp: nodeUdp(),
  });

let server: ServerInfo;
let admin: Backend;
let guest: Backend;
let movies: MediaItem[];
const byName = (name: string) => movies.find(m => m.name === name)!;

beforeAll(async () => {
  server = await connector.probe(`${HOST}:8096`);
  admin = as(1).open(await as(1).login(server, 'xelpfin', 'xelpfin-pass'));
  guest = as(2).open(await as(2).login(server, 'guest', ''));
  const libs = await admin.libraries();
  const page = await admin.items({
    libraryId: libs.find(l => l.collectionType === 'movies')!.id,
    sort: 'name',
  });
  movies = page.items;
});

describe('connect', () => {
  it('discovers the server over UDP (unicast to localhost)', async () => {
    const found = await connector.discover(1000, [HOST]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      id: server.id,
      name: 'xelpfin-test',
      url: URL_,
    });
    // The container advertises its Docker bridge address; the source-IP candidate is what works.
    expect(found[0].candidates[0]).toBe(URL_);
  });

  it('probes a typed address', () => {
    expect(server).toMatchObject({ name: 'xelpfin-test', url: URL_ });
    expect(server.version).toMatch(/^\d+\.\d+/);
  });

  it('lists public users', async () => {
    const users = await connector.publicUsers(server);
    expect(users.map(u => u.name).sort()).toEqual(['bulk', 'guest', 'xelpfin']);
    expect(users.find(u => u.name === 'xelpfin')!.hasPassword).toBe(true);
    // Recent servers report HasPassword=true for everyone so the public list leaks nothing;
    // the login screen therefore always offers an (optional) password field.
  });

  it('rejects a wrong password', async () => {
    await expect(as(3).login(server, 'xelpfin', 'wrong')).rejects.toMatchObject(
      { kind: 'auth' },
    );
  });

  it('signs in with Quick Connect once an admin approves the code', async () => {
    const qc = as(4);
    const start = await qc.quickConnectStart(server);
    expect(start.status).toBe('pending');
    if (start.status !== 'pending') {
      return;
    }
    expect(start.code).toMatch(/^\d{6}$/);
    expect((await qc.quickConnectPoll(server, start.secret)).status).toBe(
      'pending',
    );
    // Approve as the admin, as a user would on another device.
    const res = await fetch(
      `${URL_}/QuickConnect/Authorize?code=${start.code}`,
      {
        method: 'POST',
        headers: {
          Authorization: `MediaBrowser Client="xelpfin", Device="t", DeviceId="t", Version="0", Token="${admin.session.accessToken}"`,
        },
      },
    );
    expect(res.ok).toBe(true);
    expect((await qc.quickConnectPoll(server, start.secret)).status).toBe(
      'authorized',
    );
    const session = await qc.quickConnectLogin(server, start.secret);
    expect(session.userName).toBe('xelpfin');
    await qc.open(session).validate();
  });
});

describe('browse', () => {
  it('lists the two video libraries', async () => {
    const libs = await admin.libraries();
    expect(libs.map(l => [l.name, l.collectionType]).sort()).toEqual([
      ['Movies', 'movies'],
      ['Shows', 'tvshows'],
    ]);
  });

  it('pages movies sorted by name', async () => {
    expect(movies.map(m => m.name)).toEqual([
      'Big Purple Test',
      'Burned Pixels',
      'Long Chapters',
      'Night Grid',
      'Old Codec',
      'Pixel Subs',
    ]);
    const libId = (await admin.libraries()).find(l => l.name === 'Movies')!.id;
    const p1 = await admin.items({ libraryId: libId, limit: 2 });
    const p2 = await admin.items({ libraryId: libId, limit: 2, startIndex: 2 });
    expect(p1.totalCount).toBe(6);
    expect(p1.items).toHaveLength(2);
    expect(p2.items.map(i => i.name)).toEqual(['Long Chapters', 'Night Grid']);
    const n = await admin.items({ libraryId: libId, nameStartsWith: 'N' });
    expect(n.items.map(i => i.name)).toEqual(['Night Grid']);
  });

  it('sorts, filters and lists filter values', async () => {
    const libId = (await admin.libraries()).find(l => l.name === 'Movies')!.id;
    for (const sort of [
      'runtime',
      'premiereDate',
      'playCount',
      'datePlayed',
      'criticRating',
      'random',
    ] as const) {
      const page = await admin.items({ libraryId: libId, sort });
      expect(page.totalCount).toBe(6);
    }
    const years = await admin.years(libId);
    expect(years).toContain(2023);
    expect(Array.isArray(await admin.genres(libId))).toBe(true);
    expect(Array.isArray(await admin.studios(libId))).toBe(true);
    expect(Array.isArray(await admin.tags(libId))).toBe(true);
    const in2023 = await admin.items({ libraryId: libId, years: [2023] });
    expect(in2023.items.map(i => i.name)).toContain('Night Grid');
    expect(in2023.totalCount).toBeLessThan(6);
    // Resolution makes the query recursive; HD includes 4K on the server.
    const hd = await admin.items({ libraryId: libId, resolution: 'hd' });
    expect(hd.totalCount).toBeGreaterThan(0);
    expect(hd.totalCount).toBeLessThanOrEqual(6);
    // Filters combine: a year with no items in it empties any other filter.
    const none = await admin.items({
      libraryId: libId,
      resolution: 'hd',
      years: [1901],
    });
    expect(none.totalCount).toBe(0);
  });

  it('loads detail with tracks and images', async () => {
    const d = await admin.item(byName('Night Grid').id);
    expect(d.kind).toBe('movie');
    expect(d.year).toBe(2023);
    const src = d.mediaSources![0];
    expect(src.videoCodec).toBe('hevc');
    expect(src.audioTracks.map(a => a.language)).toEqual([
      'eng',
      expect.stringMatching(/^(ger|deu)$/),
    ]);
    expect(src.subtitleTracks.map(s => s.language)).toEqual([
      'eng',
      expect.stringMatching(/^(fre|fra)$/),
    ]);
    expect(d.posterUrl).toBeDefined();
    const img = await fetch(d.posterUrl!);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toMatch(/^image\//);
  });

  it('walks series, seasons and episodes', async () => {
    const shows = (await admin.libraries()).find(l => l.name === 'Shows')!;
    const series = (await admin.items({ libraryId: shows.id })).items;
    expect(series.map(s => s.name)).toEqual(['Test Show']);
    const seasons = await admin.seasons(series[0].id);
    expect(seasons.map(s => s.indexNumber)).toEqual([1, 2]);
    const s1 = await admin.episodes(series[0].id, seasons[0].id);
    expect(s1.map(e => e.indexNumber)).toEqual([1, 2, 3]);
    expect((await admin.episodes(series[0].id)).length).toBe(4);
    // Latest hides played items by default, so start from an unwatched series.
    await admin.setPlayed(series[0].id, false);
    expect((await admin.latest(shows.id)).length).toBeGreaterThan(0);
  });

  it('searches across libraries', async () => {
    expect((await admin.search('purple')).map(i => i.name)).toEqual([
      'Big Purple Test',
    ]);
    expect((await admin.search('test show')).map(i => i.kind)).toContain(
      'series',
    );
    expect(await admin.search('zzzz-nothing')).toEqual([]);
  });
});

describe('playback', () => {
  it('direct plays h264/aac mp4 and serves the file', async () => {
    const plan = await admin.playback(
      { itemId: byName('Big Purple Test').id },
      BASELINE_CAPABILITIES,
    );
    expect(plan.method).toBe('DirectPlay');
    expect(plan.durationMs).toBeGreaterThan(30_000);
    // The token is sent as a header, so it never appears in the server's access log (#11).
    expect(plan.url).not.toContain('api_key');
    expect(plan.url).not.toContain(admin.session.accessToken);
    expect(plan.headers.Authorization).toContain('MediaBrowser Token=');
    const res = await fetch(plan.url, {
      headers: { ...plan.headers, Range: 'bytes=0-1023' },
    });
    expect([200, 206]).toContain(res.status);
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(buf.slice(4, 8))).toBe('ftyp');
    // The sidecar .srt is offered as server-converted WebVTT, fetched with the same header.
    const sub = plan.subtitleTracks.find(s => s.delivery === 'external')!;
    expect(sub.url).not.toContain('api_key');
    const vtt = await (await fetch(sub.url!, { headers: plan.headers })).text();
    expect(vtt.startsWith('WEBVTT')).toBe(true);
  });

  it('direct plays HEVC mkv with two audio tracks on a capable device', async () => {
    const plan = await admin.playback(
      { itemId: byName('Night Grid').id, audioStreamIndex: 2 },
      BASELINE_CAPABILITIES,
    );
    expect(plan.method).toBe('DirectPlay');
    expect(plan.audioTracks).toHaveLength(2);
    expect(plan.selectedAudioIndex).toBe(2);
    const embedded = plan.subtitleTracks[0];
    const vtt = await (
      await fetch(embedded.url!, { headers: plan.headers })
    ).text();
    expect(vtt.startsWith('WEBVTT')).toBe(true);
  });

  it('transcodes HEVC to HLS for an h264-only device', async () => {
    const h264Only: DeviceCapabilities = {
      ...BASELINE_CAPABILITIES,
      video: [BASELINE_CAPABILITIES.video[0]],
    };
    const plan = await admin.playback(
      { itemId: byName('Night Grid').id },
      h264Only,
    );
    expect(plan.method).toBe('Transcode');
    expect(plan.streamType).toBe('hls');
    expect(plan.reasons).toContain('VideoCodecNotSupported:hevc');
    const m3u8 = await (await fetch(plan.url)).text();
    expect(m3u8).toContain('#EXTM3U');
    await admin.reportStop({ plan, positionMs: 0, isPaused: false });
  });

  it('transcodes the msmpeg4 avi', async () => {
    const plan = await admin.playback(
      { itemId: byName('Old Codec').id },
      BASELINE_CAPABILITIES,
    );
    expect(plan.method).toBe('Transcode');
    expect(plan.reasons).toContain('VideoCodecNotSupported:msmpeg4v3');
    const m3u8 = await (await fetch(plan.url)).text();
    expect(m3u8).toContain('#EXTM3U');
    await admin.reportStop({ plan, positionMs: 0, isPaused: false });
  });
});

describe('subtitles', () => {
  it('direct plays a PGS track by its position in the file', async () => {
    const item = byName('Pixel Subs');
    const plan = await admin.playback(
      { itemId: item.id },
      BASELINE_CAPABILITIES,
    );
    expect(plan.method).toBe('DirectPlay');
    const pgs = plan.subtitleTracks.find(t =>
      t.label.startsWith('PGS bitmap'),
    )!;
    const ass = plan.subtitleTracks.find(t =>
      t.label.startsWith('Styled ASS'),
    )!;
    expect(pgs).toMatchObject({ delivery: 'embedded', containerPosition: 0 });
    // Text tracks are converted to WebVTT by the server so the app can style them.
    expect(ass.delivery).toBe('external');
    const vtt = await (await fetch(ass.url!, { headers: plan.headers })).text();
    expect(vtt).toContain('WEBVTT');
    await admin.reportStop({ plan, positionMs: 0, isPaused: false });
  });

  it('burns a VOBSUB track into a transcode', async () => {
    const item = byName('Burned Pixels');
    const first = await admin.playback(
      { itemId: item.id },
      BASELINE_CAPABILITIES,
    );
    await admin.reportStop({ plan: first, positionMs: 0, isPaused: false });
    const sub = first.subtitleTracks[0];
    const plan = await admin.playback(
      { itemId: item.id, subtitleStreamIndex: sub.index },
      BASELINE_CAPABILITIES,
    );
    expect(plan.method).toBe('Transcode');
    expect(plan.url).toContain('SubtitleMethod=Encode');
    expect(plan.subtitleTracks.find(t => t.index === sub.index)!.delivery).toBe(
      'burn-in',
    );
    expect(await (await fetch(plan.url)).text()).toContain('#EXTM3U');
    await admin.reportStop({ plan, positionMs: 0, isPaused: false });
  });
});

describe('bulk user', () => {
  let bulk: Backend;
  beforeAll(async () => {
    bulk = as(5).open(await as(5).login(server, 'bulk', ''));
  });

  it('pages through a 2000 item library', async () => {
    const lib = (await bulk.libraries()).find(l => l.name === 'Bulk')!;
    const p = await bulk.items({
      libraryId: lib.id,
      startIndex: 1940,
      limit: 60,
    });
    expect(p.totalCount).toBe(2000);
    expect(p.items).toHaveLength(60);
    expect(p.items[59].name).toMatch(/^Bulk Title 2000/);
  });

  it('sees an empty library as empty', async () => {
    const lib = (await bulk.libraries()).find(l => l.name === 'Empty')!;
    const p = await bulk.items({ libraryId: lib.id });
    expect(p).toMatchObject({ totalCount: 0, items: [] });
  });
});

describe('watch state (guest user)', () => {
  const movie = () => byName('Big Purple Test');

  afterAll(async () => {
    await guest.setPlayed(movie().id, false).catch(() => undefined);
  });

  it('reports progress and shows the item in continue watching', async () => {
    const plan = await guest.playback(
      { itemId: movie().id },
      BASELINE_CAPABILITIES,
    );
    await guest.reportStart({ plan, positionMs: 0, isPaused: false });
    await guest.reportProgress({ plan, positionMs: 10_000, isPaused: false });
    await guest.reportStop({ plan, positionMs: 12_000, isPaused: false });
    const resume = await guest.resume();
    const hit = resume.find(i => i.id === movie().id);
    expect(hit).toBeDefined();
    expect(hit!.userData!.playbackPositionMs).toBeGreaterThanOrEqual(11_000);
  });

  it('marks watched and unwatched', async () => {
    await guest.setPlayed(movie().id, true);
    expect((await guest.item(movie().id)).userData!.played).toBe(true);
    expect(
      (await guest.resume()).find(i => i.id === movie().id),
    ).toBeUndefined();
    await guest.setPlayed(movie().id, false);
    expect((await guest.item(movie().id)).userData!.played).toBe(false);
  });

  it('computes next up after an episode is watched', async () => {
    const show = (await guest.search('test show')).find(
      i => i.kind === 'series',
    )!;
    const eps = await guest.episodes(show.id);
    await guest.setPlayed(eps[0].id, true);
    try {
      const next = await guest.nextUp(10);
      expect(next.map(e => e.id)).toContain(eps[1].id);
      const detail = await guest.item(show.id);
      expect(detail.nextUp?.id).toBe(eps[1].id);
    } finally {
      await guest.setPlayed(eps[0].id, false);
    }
  });

  it('toggles favourite', async () => {
    await guest.setFavorite(movie().id, true);
    expect((await guest.item(movie().id)).userData!.favorite).toBe(true);
    await guest.setFavorite(movie().id, false);
  });
});

// The suite runs against several server releases (npm run jellyfin:matrix). Expectations that
// differ between releases are keyed on the version the server reports.
describe('server version', () => {
  const atLeast = (major: number, minor: number) => {
    const [a, b] = server.version!.split('.').map(Number);
    return a > major || (a === major && b >= minor);
  };
  const authHeader = () => ({
    Authorization: `MediaBrowser Client="xelpfin", Device="t", DeviceId="t", Version="0", Token="${admin.session.accessToken}"`,
  });

  it('is the release that was asked for', () => {
    const wanted = process.env.JF_VERSION;
    if (wanted) {
      expect(`${server.version}.`.startsWith(`${wanted}.`)).toBe(true);
    }
  });

  it('serves media segments from 10.10 and falls back to none before', async () => {
    const show = (await admin.search('test show')).find(
      i => i.kind === 'series',
    )!;
    const episode = (await admin.episodes(show.id))[0];
    const res = await fetch(`${URL_}/MediaSegments/${episode.id}`, {
      headers: authHeader(),
    });
    if (atLeast(10, 10)) {
      expect(res.status).toBe(200);
      expect(Array.isArray((await res.json()).Items)).toBe(true);
    } else {
      // No such endpoint: the backend swallows the 404, so the player shows no skip button.
      expect(res.status).toBe(404);
    }
    await expect(admin.mediaSegments(episode.id)).resolves.toEqual([]);
  });

  // #31 asks for images filled to the card size and encoded as WebP. Every supported release
  // must honour that, and the older maxWidth form must keep working.
  it.each([
    [
      'fill + webp',
      'fillWidth=253&fillHeight=379&quality=85&format=Webp',
      /^image\/webp/,
    ],
    ['maxWidth', 'maxWidth=253&quality=90', /^image\//],
  ])('serves a resized primary image (%s)', async (_label, query, type) => {
    const id = byName('Night Grid').id;
    const res = await fetch(`${URL_}/Items/${id}/Images/Primary?${query}`, {
      headers: authHeader(),
    });
    const bytes = (await res.arrayBuffer()).byteLength;
    console.info(
      `Jellyfin ${server.version} ${query}: ${res.status} ${res.headers.get('content-type')} ${bytes} bytes`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(type);
    expect(bytes).toBeGreaterThan(0);
  });
});
