// Idempotent first-run setup for the local Jellyfin test server.
// Creates admin "xelpfin" (password "xelpfin-pass"), user "guest" (no password), the Movies and
// Shows libraries with internet metadata providers off, and waits until the scan has finished.
const base = process.argv[2] ?? 'http://127.0.0.1:8096';
const AUTH = 'MediaBrowser Client="xelpfin-setup", Device="setup", DeviceId="xelpfin-setup", Version="0.1.0"';
export const ADMIN = { user: 'xelpfin', pass: 'xelpfin-pass' };

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = { Authorization: AUTH + (token ? `, Token="${token}"` : '') };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const info = await call('/System/Info/Public');
if (!info.StartupWizardCompleted) {
  // The wizard endpoints can 503 for a moment right after boot.
  for (let i = 0; i < 30; i++) {
    try { await call('/Startup/Configuration', { method: 'POST', body: { UICulture: 'en-US', MetadataCountryCode: 'US', PreferredMetadataLanguage: 'en' } }); break; }
    catch (e) { if (i === 29) throw e; await sleep(1000); }
  }
  await call('/Startup/User');
  await call('/Startup/User', { method: 'POST', body: { Name: ADMIN.user, Password: ADMIN.pass } });
  await call('/Startup/RemoteAccess', { method: 'POST', body: { EnableRemoteAccess: true, EnableAutomaticPortMapping: false } }).catch(() => {});
  await call('/Startup/Complete', { method: 'POST' });
  console.log('wizard completed');
}

const auth = await call('/Users/AuthenticateByName', { method: 'POST', body: { Username: ADMIN.user, Pw: ADMIN.pass } });
const token = auth.AccessToken;

// Quick Connect on (default in recent servers, but make sure).
const cfg = await call('/System/Configuration', { token });
// The sample clips are under a minute, so lower the resume threshold (default 300 s) to make
// Continue Watching testable.
if (!cfg.QuickConnectAvailable || cfg.ServerName !== 'xelpfin-test' || cfg.MinResumeDurationSeconds !== 5) {
  cfg.QuickConnectAvailable = true;
  cfg.ServerName = 'xelpfin-test';
  cfg.MinResumeDurationSeconds = 5;
  await call('/System/Configuration', { method: 'POST', body: cfg, token });
}

let users = await call('/Users', { token });
if (!users.some(u => u.Name === 'guest')) {
  const guest = await call('/Users/New', { method: 'POST', body: { Name: 'guest' }, token });
  console.log('created user guest', guest.Id);
  users = await call('/Users', { token });
}
// Recent servers hide users from the login screen by default; show both so the user picker has something to list.
for (const u of users) {
  if (u.Policy.IsHidden) {
    await call(`/Users/${u.Id}/Policy`, { method: 'POST', body: { ...u.Policy, IsHidden: false }, token });
    console.log('unhid user', u.Name);
  }
}

const folders = await call('/Library/VirtualFolders', { token });
const libOptions = path => ({
  PathInfos: [{ Path: path }],
  EnableRealtimeMonitor: false,
  EnableInternetProviders: false,
  SaveLocalMetadata: false,
  MetadataSavers: [],
  DisabledLocalMetadataReaders: [],
  // No remote metadata or image fetchers: titles come from the NFO files next to the media,
  // and the server never looks anything up on the internet.
  TypeOptions: ['Movie', 'Series', 'Season', 'Episode'].map(Type => ({
    Type, MetadataFetchers: [], MetadataFetcherOrder: [], ImageFetchers: [], ImageFetcherOrder: [],
  })),
});
let replaceAll = false;
for (const [name, type, path] of [['Movies', 'movies', '/media/movies'], ['Shows', 'tvshows', '/media/shows']]) {
  const existing = folders.find(f => f.Name === name);
  if (existing) {
    const opts = existing.LibraryOptions;
    if (opts.TypeOptions.some(t => t.MetadataFetchers.length || t.ImageFetchers.length) || !opts.TypeOptions.length) {
      await call('/Library/VirtualFolders/LibraryOptions', { method: 'POST', body: { Id: existing.ItemId, LibraryOptions: { ...opts, ...libOptions(path) } }, token });
      console.log('disabled remote metadata for', name);
      replaceAll = true;
    }
    continue;
  }
  const q = new URLSearchParams({ name, collectionType: type, refreshLibrary: 'false' });
  await call(`/Library/VirtualFolders?${q}`, { method: 'POST', body: { LibraryOptions: libOptions(path) }, token });
  console.log('created library', name);
}

await call('/Library/Refresh', { method: 'POST', token });
if (replaceAll) {
  // Re-read metadata from the NFO files, dropping anything fetched earlier.
  await sleep(3000);
  const q = new URLSearchParams({ Recursive: 'true', IncludeItemTypes: 'Movie,Series,Season,Episode' });
  for (const item of (await call(`/Items?${q}`, { token })).Items) {
    const r = new URLSearchParams({ metadataRefreshMode: 'FullRefresh', imageRefreshMode: 'FullRefresh', replaceAllMetadata: 'true', replaceAllImages: 'false' });
    await call(`/Items/${item.Id}/Refresh?${r}`, { method: 'POST', token });
  }
}
// Wait for the scan task to go idle and the expected items to show up.
for (let i = 0; i < 180; i++) {
  await sleep(1000);
  const tasks = await call('/ScheduledTasks?isHidden=false', { token });
  const scan = tasks.find(t => t.Key === 'RefreshLibrary');
  const counts = await call('/Items/Counts', { token });
  if (scan && scan.State === 'Idle' && counts.MovieCount >= 3 && counts.EpisodeCount >= 4) {
    console.log(`library ready: ${counts.MovieCount} movies, ${counts.SeriesCount} series, ${counts.EpisodeCount} episodes`);
    process.exit(0);
  }
}
throw new Error('library scan did not finish in time');
