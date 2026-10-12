import { JellyfinConnector } from '../../src/backend/jellyfin/JellyfinBackend';
import type { Session } from '../../src/backend/types';
import { BASELINE_CAPABILITIES } from '../../src/player/capabilities';
import { CLIENT, fakeFetch } from '../../test-utils/fakeFetch';

const SERVER = { id: 'srv', name: 'Home', url: 'http://srv:8096' };
const SESSION: Session = { server: SERVER, userId: 'u1', userName: 'xelpfin', accessToken: 'tok', isAdmin: true };

const movieDto = {
  Id: 'm1',
  Name: 'Big Purple Test',
  Type: 'Movie',
  ProductionYear: 2024,
  RunTimeTicks: 400_000_000,
  ImageTags: { Primary: 'p1' },
  BackdropImageTags: ['b1'],
  UserData: { Played: false, PlaybackPositionTicks: 120_000_000, PlayedPercentage: 30, IsFavorite: true },
};
const episodeDto = {
  Id: 'e1',
  Name: 'Pilot',
  Type: 'Episode',
  SeriesId: 's1',
  SeriesName: 'Test Show',
  SeriesPrimaryImageTag: 'sp',
  ParentBackdropItemId: 's1',
  ParentBackdropImageTags: ['sb'],
  IndexNumber: 1,
  ParentIndexNumber: 1,
  ImageTags: { Primary: 'ep' },
};

describe('JellyfinConnector', () => {
  it('probes typed addresses, trying candidates in order', async () => {
    const f = fakeFetch({
      'GET http://nas:8096/System/Info/Public': () => Promise.reject(new TypeError('refused')),
      'GET https://nas:8920/System/Info/Public': { Id: 'srv', ServerName: 'NAS', Version: '10.10.7' },
    });
    const c = new JellyfinConnector({ client: CLIENT, fetch: f.fetch });
    await expect(c.probe('nas')).resolves.toEqual({ id: 'srv', name: 'NAS', url: 'https://nas:8920', version: '10.10.7' });
    await expect(c.probe('')).rejects.toMatchObject({ kind: 'network' });
  });

  it('rejects hosts that are not Jellyfin', async () => {
    const f = fakeFetch({ 'GET http://x:8096/System/Info/Public': { hello: 1 } });
    const c = new JellyfinConnector({ client: CLIENT, fetch: f.fetch });
    await expect(c.probe('x:8096')).rejects.toMatchObject({ kind: 'unsupported' });
  });

  it('lists public users and logs in with a password', async () => {
    const f = fakeFetch({
      'GET /Users/Public': [{ Id: 'u1', Name: 'xelpfin', HasPassword: true, PrimaryImageTag: 't' }, { Id: 'u2', Name: 'guest', HasPassword: false }],
      'POST /Users/AuthenticateByName': (call: any) =>
        call.body.Pw === 'xelpfin-pass'
          ? { json: { AccessToken: 'tok', ServerId: 'srv', User: { Id: 'u1', Name: 'xelpfin', Policy: { IsAdministrator: true } } } }
          : { status: 401 },
    });
    const c = new JellyfinConnector({ client: CLIENT, fetch: f.fetch });
    const users = await c.publicUsers(SERVER);
    expect(users[0]).toEqual({ id: 'u1', name: 'xelpfin', hasPassword: true, imageUrl: 'http://srv:8096/Users/u1/Images/Primary?tag=t&maxWidth=200' });
    expect(users[1].hasPassword).toBe(false);
    await expect(c.login(SERVER, 'xelpfin', 'xelpfin-pass')).resolves.toEqual(SESSION);
    expect(f.calls.at(-1)!.body).toEqual({ Username: 'xelpfin', Pw: 'xelpfin-pass' });
    expect(f.calls.at(-1)!.headers.Authorization).not.toContain('Token=');
    await expect(c.login(SERVER, 'xelpfin', 'nope')).rejects.toMatchObject({ kind: 'auth', message: 'Wrong user name or password' });
  });

  it('runs the Quick Connect flow', async () => {
    let polls = 0;
    const f = fakeFetch({
      'GET /QuickConnect/Enabled': true,
      'POST /QuickConnect/Initiate': { Code: '654321', Secret: 'sec' },
      'GET /QuickConnect/Connect': () => ({ json: { Authenticated: ++polls > 1, Code: '654321', Secret: 'sec' } }),
      'POST /Users/AuthenticateWithQuickConnect': { AccessToken: 'tok', ServerId: 'srv', User: { Id: 'u1', Name: 'xelpfin', Policy: { IsAdministrator: true } } },
    });
    const c = new JellyfinConnector({ client: CLIENT, fetch: f.fetch });
    await expect(c.quickConnectStart(SERVER)).resolves.toEqual({ status: 'pending', code: '654321', secret: 'sec' });
    await expect(c.quickConnectPoll(SERVER, 'sec')).resolves.toMatchObject({ status: 'pending' });
    await expect(c.quickConnectPoll(SERVER, 'sec')).resolves.toEqual({ status: 'authorized', secret: 'sec' });
    expect(f.calls.find(x => x.path === '/QuickConnect/Connect')!.query.secret).toBe('sec');
    await expect(c.quickConnectLogin(SERVER, 'sec')).resolves.toEqual(SESSION);
  });

  it('reports Quick Connect as unavailable when disabled', async () => {
    const f = fakeFetch({ 'GET /QuickConnect/Enabled': false });
    await expect(new JellyfinConnector({ client: CLIENT, fetch: f.fetch }).quickConnectStart(SERVER)).resolves.toEqual({
      status: 'unavailable',
    });
  });
});

describe('JellyfinBackend', () => {
  function setup(routes: Record<string, any>) {
    const f = fakeFetch(routes);
    const b = new JellyfinConnector({ client: CLIENT, fetch: f.fetch }).open(SESSION);
    return { f, b };
  }

  it('lists only video libraries', async () => {
    const { b } = setup({
      'GET /Users/u1/Views': {
        Items: [
          { Id: 'l1', Name: 'Movies', CollectionType: 'movies', ImageTags: { Primary: 'x' } },
          { Id: 'l2', Name: 'Music', CollectionType: 'music' },
          { Id: 'l3', Name: 'Shows', CollectionType: 'tvshows' },
          { Id: 'l4', Name: 'TV', CollectionType: 'livetv' },
        ],
        TotalRecordCount: 4,
      },
    });
    const libs = await b.libraries();
    expect(libs.map(l => l.name)).toEqual(['Movies', 'Shows']);
    expect(libs[0].imageUrl).toBe('http://srv:8096/Items/l1/Images/Primary?maxWidth=480&quality=90&tag=x');
  });

  it('pages items with sort, filter and jump letter', async () => {
    const { b, f } = setup({ 'GET /Items': { Items: [movieDto], TotalRecordCount: 31 } });
    const page = await b.items({ libraryId: 'l1', kinds: ['movie'], sort: 'dateAdded', descending: true, nameStartsWith: 'B', unplayedOnly: true, startIndex: 30, limit: 30 });
    expect(page.totalCount).toBe(31);
    expect(page.startIndex).toBe(30);
    const q = f.calls[0].query;
    expect(q).toMatchObject({
      userId: 'u1',
      parentId: 'l1',
      includeItemTypes: 'Movie',
      recursive: 'true',
      sortBy: 'DateCreated,SortName',
      sortOrder: 'Descending',
      nameStartsWith: 'B',
      filters: 'IsUnplayed',
      startIndex: '30',
      limit: '30',
    });
    await b.items({ libraryId: 'l1', nameStartsWith: '#' });
    expect(f.calls[1].query.nameLessThan).toBe('A');
    expect(f.calls[1].query.nameStartsWith).toBeUndefined();
  });

  it('maps items with user data and TV-sized images', async () => {
    const { b } = setup({ 'GET /Users/u1/Items/Resume': { Items: [movieDto, episodeDto], TotalRecordCount: 2 } });
    const [m, e] = await b.resume();
    expect(m).toMatchObject({
      id: 'm1',
      kind: 'movie',
      year: 2024,
      runtimeMs: 40_000,
      userData: { played: false, playbackPositionMs: 12_000, playedPercentage: 30, favorite: true },
      posterUrl: 'http://srv:8096/Items/m1/Images/Primary?maxWidth=300&quality=90&tag=p1',
      backdropUrl: 'http://srv:8096/Items/m1/Images/Backdrop?maxWidth=1280&quality=90&tag=b1',
    });
    expect(e).toMatchObject({
      kind: 'episode',
      posterUrl: 'http://srv:8096/Items/s1/Images/Primary?maxWidth=300&quality=90&tag=sp',
      thumbUrl: 'http://srv:8096/Items/e1/Images/Primary?maxWidth=480&quality=90&tag=ep',
      backdropUrl: 'http://srv:8096/Items/s1/Images/Backdrop?maxWidth=1280&quality=90&tag=sb',
    });
  });

  it('loads detail, attaching next up for series', async () => {
    const { b, f } = setup({
      'GET /Items/s1': { Id: 's1', Name: 'Test Show', Type: 'Series', People: [{ Name: 'A', Type: 'Actor', Role: 'B' }], Taglines: ['T'] },
      'GET /Shows/NextUp': { Items: [episodeDto], TotalRecordCount: 1 },
    });
    const d = await b.item('s1');
    expect(d.kind).toBe('series');
    expect(d.tagline).toBe('T');
    expect(d.people).toEqual([{ name: 'A', role: 'B', type: 'Actor' }]);
    expect(d.nextUp?.id).toBe('e1');
    expect(f.calls[1].query.seriesId).toBe('s1');
  });

  it('searches, gets next up, latest, seasons and episodes', async () => {
    const { b, f } = setup({
      'GET /Items': { Items: [movieDto], TotalRecordCount: 1 },
      'GET /Shows/NextUp': { Items: [episodeDto], TotalRecordCount: 1 },
      'GET /Users/u1/Items/Latest': [movieDto],
      'GET /Shows/s1/Seasons': { Items: [{ Id: 'se1', Name: 'Season 1', Type: 'Season', IndexNumber: 1 }], TotalRecordCount: 1 },
      'GET /Shows/s1/Episodes': { Items: [episodeDto], TotalRecordCount: 1 },
    });
    expect(await b.search('  ')).toEqual([]);
    expect((await b.search('purple')).map(i => i.id)).toEqual(['m1']);
    expect(f.calls[0].query.searchTerm).toBe('purple');
    expect((await b.nextUp()).map(i => i.id)).toEqual(['e1']);
    expect((await b.latest('l1')).map(i => i.id)).toEqual(['m1']);
    expect((await b.seasons('s1'))[0]).toMatchObject({ kind: 'season', indexNumber: 1 });
    expect((await b.episodes('s1', 'se1'))[0].id).toBe('e1');
    expect(f.calls.at(-1)!.query.seasonId).toBe('se1');
  });

  it('negotiates playback with a device profile', async () => {
    const { b, f } = setup({
      'POST /Items/m1/PlaybackInfo': {
        PlaySessionId: 'ps',
        MediaSources: [
          {
            Id: 'ms1',
            Container: 'mp4',
            SupportsDirectPlay: true,
            MediaStreams: [
              { Index: 0, Type: 'Video', Codec: 'h264', Width: 1280, Height: 720 },
              { Index: 1, Type: 'Audio', Codec: 'aac', Channels: 2 },
            ],
          },
        ],
      },
    });
    const plan = await b.playback({ itemId: 'm1', startPositionMs: 12_000, maxBitrate: 8_000_000 }, BASELINE_CAPABILITIES);
    expect(plan.method).toBe('DirectPlay');
    expect(plan.playSessionId).toBe('ps');
    const body = f.calls[0].body;
    expect(body.UserId).toBe('u1');
    expect(body.MaxStreamingBitrate).toBe(8_000_000);
    expect(body.DeviceProfile.DirectPlayProfiles.length).toBeGreaterThan(0);
  });

  it('surfaces server playback errors', async () => {
    const { b } = setup({ 'POST /Items/m1/PlaybackInfo': { ErrorCode: 'NoCompatibleStream', MediaSources: [] } });
    await expect(b.playback({ itemId: 'm1' }, BASELINE_CAPABILITIES)).rejects.toMatchObject({ kind: 'unsupported' });
  });

  it('reports progress in ticks and stops transcodes', async () => {
    const ok = () => ({ status: 204 });
    const { b, f } = setup({
      'POST /Sessions/Playing': ok,
      'POST /Sessions/Playing/Progress': ok,
      'POST /Sessions/Playing/Stopped': ok,
      'DELETE /Videos/ActiveEncodings': ok,
    });
    const plan = { itemId: 'm1', mediaSourceId: 'ms1', playSessionId: 'ps', method: 'Transcode' as const };
    await b.reportStart({ plan, positionMs: 0, isPaused: false });
    await b.reportProgress({ plan, positionMs: 1500, isPaused: true, audioStreamIndex: 1 });
    await b.reportStop({ plan, positionMs: 2000, isPaused: false });
    expect(f.calls.map(c => `${c.method} ${c.path}`)).toEqual([
      'POST /Sessions/Playing',
      'POST /Sessions/Playing/Progress',
      'POST /Sessions/Playing/Stopped',
      'DELETE /Videos/ActiveEncodings',
    ]);
    expect(f.calls[1].body).toMatchObject({ ItemId: 'm1', PositionTicks: 15_000_000, IsPaused: true, PlayMethod: 'Transcode', AudioStreamIndex: 1, EventName: 'timeupdate' });
    expect(f.calls[3].query).toEqual({ deviceId: 'dev-1', playSessionId: 'ps' });
  });

  it('marks played/unplayed and favourites', async () => {
    const ok = () => ({ json: {} });
    const { b, f } = setup({ 'POST /UserPlayedItems/m1': ok, 'DELETE /UserPlayedItems/m1': ok, 'POST /UserFavoriteItems/m1': ok });
    await b.setPlayed('m1', true);
    await b.setPlayed('m1', false);
    await b.setFavorite('m1', true);
    expect(f.calls.map(c => `${c.method} ${c.path}?userId=${c.query.userId}`)).toEqual([
      'POST /UserPlayedItems/m1?userId=u1',
      'DELETE /UserPlayedItems/m1?userId=u1',
      'POST /UserFavoriteItems/m1?userId=u1',
    ]);
  });

  it('validates the token', async () => {
    const { b } = setup({ 'GET /Users/u1': () => ({ status: 401 }) });
    await expect(b.validate()).rejects.toMatchObject({ kind: 'auth' });
  });
});
