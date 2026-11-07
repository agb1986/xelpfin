# xelpfin architecture

xelpfin is a single React Native (react-native-tvos 0.81) TypeScript code base. Everything that
depends on the host OS or on the media server sits behind one of three interfaces, so screens and
state can be reused unchanged on Vega OS:

```
            ┌───────────────────────── src/ui (screens, components, theme) ─────────────────────────┐
            │                         src/state (AppState, navigation, settings)                     │
            └──────────────┬──────────────────────────┬──────────────────────────┬─────────────────┘
                           │                          │                          │
                 Backend / ServerConnector      PlayerEngine              PlatformServices
                    (src/backend)               (src/player)               (src/platform)
                           │                          │                          │
            JellyfinBackend │ MockBackend   VideoEngine (react-native-video)   firetv │ vega
```

## Backend (`src/backend`)

`Backend.ts` defines two interfaces:

- `ServerConnector` is used before sign-in: `discover`, `probe(address)`, `publicUsers`, `login`,
  the Quick Connect calls (`quickConnectStart`, `quickConnectPoll`, `quickConnectLogin`), and
  `open(session)`, which returns a `Backend`.
- `Backend` is one signed-in session. It covers libraries, paged `items(query)`, `item(id)`
  detail, `search`, `resume` (Continue Watching), `nextUp`, `resumeEpisode` (the partly watched
  episode of a series), `latest`, `seasons`, `episodes`,
  `imageUrl`, `playback(request, caps)` returning a `PlaybackPlan`, progress reporting
  (`reportStart`, `reportProgress`, `reportStop`), `setPlayed` and `setFavorite`.

All types in `types.ts` are backend-neutral. Errors are `BackendError` with a `kind` (network,
auth, forbidden (HTTP 403), notFound, server, unsupported, timeout), and the UI maps that to its error views.

### Jellyfin implementation (`src/backend/jellyfin`)

- `http.ts` is a thin fetch wrapper. It builds the `Authorization: MediaBrowser Client="xelpfin",
Device=..., DeviceId=..., Version=..., Token=...` header, applies timeouts, and maps HTTP
  failures to `BackendError`. `fetch` is injectable, which is how the unit tests mock it.
- `discovery.ts` sends `Who is JellyfinServer?` to UDP port 7359 through the platform's
  `UdpTransport` (a broadcast plus optional unicast hints), parses the JSON replies, and
  de-duplicates them by server id.
- `deviceProfile.ts` turns `DeviceCapabilities` into a Jellyfin DeviceProfile. Direct play is
  allowed for every container ExoPlayer demuxes with decodable codecs, up to `MaxStaticBitrate`.
  Anything else goes through HLS with fMP4 segments: the profile lists every codec ExoPlayer plays
  from fMP4 (h264, hevc, av1 when decodable; aac, ac3, eac3, ...), so a file with the right codecs
  in the wrong container is remuxed (DirectStream) rather than re-encoded, and a real transcode
  targets h264 and aac. HLS with MPEG-TS segments stays as a fallback. `VideoRangeType` conditions
  per codec allow HDR10, HLG and Dolby Vision only when the display reports them; an 8-bit codec
  or an SDR display is limited to SDR, so the server tone-maps.
- `playback.ts` posts `/Items/{id}/PlaybackInfo` with that profile and then makes its own direct
  play check (`directPlayBlockers`), so the UI can say why a stream is transcoded. It builds
  either a static stream URL (direct play) or the server's HLS transcoding URL. Text subtitle
  tracks are always delivered as server-converted WebVTT URLs. Image subtitles are embedded, or
  burned in when the user picks them and the player cannot render them.
- `dto.ts` maps Jellyfin DTOs to the neutral types (ticks to milliseconds, image URLs, user data).

### Mock backend

`mock/MockBackend.ts` holds an in-memory library used by the UI tests (`__tests__/App.test.tsx`)
and for working on the UI without a server.

## Player (`src/player`)

- `PlayerEngine` is the seam between `PlayerScreen` and the media stack. It has a `View`
  component that takes a `PlaybackPlan`, `paused` and track indexes, reports load, progress,
  buffering, end and error, and exposes `seek`. It also has `canSwitchInStream`, which tells the
  screen whether a track change can happen inside the current stream or needs a new plan from the
  backend (for example another audio track in a transcode, or burning in image subtitles).
- `rnv/VideoEngine.tsx` is the Fire TV engine on react-native-video 6 (ExoPlayer / Media3).
  `trackSelection.ts` maps backend stream indexes onto ExoPlayer's tracks.
- `capabilities.ts` converts the Android decoder list (`MediaCodecList`, read by the platform
  module) into `DeviceCapabilities`, including the maximum resolution and 10-bit support per codec.
  AV1 and VP9 count only with a hardware decoder. It also maps the display's HDR types
  (`Display.getHdrCapabilities`) and the encodings the audio output accepts (`AudioManager`); the
  latter are kept apart as `passthrough` and only merged into the playable audio codecs by
  `withAudioPassthrough` when the `audioPassthrough` setting is on.
- Subtitles: text subtitles are drawn by the app, not by the native player.
  - `useSubtitleCues` fetches the WebVTT for the selected track, `webvtt.ts` parses it (the parser
    also accepts SRT), and `ui/components/SubtitleText` draws the cue for the current position.
  - The text sits above the controls when they are showing.
  - The reason: react-native-video 6 on Android builds its progressive and HLS media sources
    directly, and those drop side-loaded subtitle configurations, so a side-loaded track never
    reaches ExoPlayer. Drawing the cues in shared code also gives Vega the same subtitles,
    styling and switching without native work.
- Remote controls (`PlayerScreen`, with the pure rules in `player/seeking.ts`):
  - Rewind/forward and left/right (while the controls are hidden) escalate with quick taps: one
    tap is 10 s, two are 30 s in total, three are 1 min, and every tap after that adds 5 min. The
    taps are collected into one burst and committed as a single seek once they stop; the pending
    target is shown on the bar meanwhile.
  - Up with the controls showing opens the scene navigator: the item's chapters, or marks every
    five minutes when the file has none (nothing for items of five minutes or less). The card
    for the current scene has focus; choosing one seeks there.
  - Skip Intro / Credits / Recap / Preview is offered while the position is inside a segment
    returned by `Backend.mediaSegments`. Jellyfin 10.10+ serves these at `/MediaSegments/{id}`;
    they exist only when something on the server creates them (for example the Intro Skipper
    plugin). Older servers or empty results simply show no button. While the compact hint is
    up (controls hidden), BACK dismisses it for that segment instead of leaving the player.
  - BACK lowers the controls or seek bar (also when paused) and arms a short window; a second BACK
    inside it leaves the player. With nothing showing, the first BACK only shows "Press back
    again to exit".
  - Down with the controls showing and more episodes in the season opens a reel of the following
    episodes; choosing one replaces the player with that episode. BACK closes it.
  - Progress and stop reports are serialized, so a stop can never be overtaken by a late progress
    report. When playback ends, or stops in the last 15 s, at 97 % or later, or inside an outro
    segment that runs to the end (`playedToEnd`), the item is explicitly marked watched so it
    leaves Continue Watching. Skipping a segment reports progress at once.
  - The title line carries the episode code (`S01E04`) for episodes.

## Platform (`src/platform`)

`PlatformServices` provides:

- `device` (model, OS, ABIs, whether it is an emulator or a Fire TV),
- `storage` (a key/value store),
- `udp` (a discovery transport, which is optional),
- `capabilities()` (the decoders, display HDR formats and audio sink formats),
- `discoveryHints()` and `addressHint()`.

- `firetv/` implements it with AsyncStorage and a small Kotlin module (`android/app/src/main/java/com/xelpfin/app/platform/XelpfinPlatformModule.kt`).
  The module sends and receives UDP for discovery, lists the decoders through `MediaCodecList`,
  and reports the display's HDR types and the audio outputs' encodings; the last two degrade to
  "none" when the query is missing or fails (emulator, tests).
  On the emulator it adds `10.0.2.2` as a unicast discovery hint, because broadcasts do not reach
  the host there.
- `vega/` is the boundary stub. It keeps storage in memory, has no UDP, and reports the baseline
  codec set. Its header comment lists what a Vega port has to supply.

Nothing outside `src/platform` imports `NativeModules`.

## State (`src/state`)

- `AppState.tsx` holds the connector, the current `Backend`, settings and the known servers. It
  restores the last session at startup and validates it with the server.
  - `signOut(leave)` clears the session and leaves for the server or login screen in a single
    state update. Two separate updates rendered the signed-in screens for one frame without a
    backend, which crashed.
  - `authGuard.ts` wraps the backend so that the first call rejected with HTTP 401 (a revoked or
    expired token) sets `authExpired`. The app then returns to the login screen for that server
    and says why. A 403 is not treated as an expiry.
- `settings.ts` and `servers.ts` persist through `PlatformServices.storage`.
- `trackDefaults.ts` picks the initial audio and subtitle tracks from the settings: the preferred
  language, and a subtitle mode of off, forced only, or always.
- `localLists.ts` keeps small per-user JSON documents on the device (`xelpfin.<name>.<serverId>.<userId>`
  in `platform.storage`). Screens that show one document share a single instance and stay in step
  through `subscribe`. Two lists use it:
  - `randomizer.ts`: the Randomizer. The user's series ids are stored with the ids of the episodes
    already drawn in the current cycle. The candidate pool is rebuilt from the server's episode
    lists on every draw, so new episodes join by themselves and removed ones fall out. A draw is a
    shuffle bag: only episodes not yet drawn are candidates. When none are left, the drawn list is
    emptied and a new cycle starts, leaving out the episode played last so it is never repeated
    back to back at the boundary. While another series has candidates, the series that just
    played is skipped. The randomizer is episode-weighted: a long series comes up more often.
  - `hiddenNextUp.ts`: Next Up entries cleared in Settings, as series id to the episode that was
    offered. Jellyfin has no call that removes a Next Up entry without marking something watched,
    so the entry is only hidden on this device, and it returns when the series offers a
    different episode.
- `navigation.tsx` is a minimal stack navigator for TV. The top four screens stay mounted
  (hidden below the top), so their data, scroll position and last focused element survive a
  round trip to a detail page. Deeper screens are unmounted to bound memory on a long browse
  chain; they keep their route and last focused element and mount again when popped back to,
  where `Focusable` restores focus by the remembered `testID`. Pushing a detail route for an
  item already in the stack pops back to it instead of stacking a copy. The player is always on
  top and unmounts when it is popped, which stops playback. The hardware BACK key pops the stack.

## UI (`src/ui`)

- `theme.ts` defines the 10-foot design tokens: a dark surface, the purple accent `#8E5CF7`, a type
  scale (34 / 24 / 18 / 15 / 13 dp) and spacing. The emulator and Fire TV both run at 960 x 540 dp.
- `components/Focusable` is the base of every D-pad target. It tracks focus for styling and is
  focusable only while its screen is on top. It remembers the last focused element per screen and
  restores it, and it collapses the double `onPress` that react-native-tvos fires for one remote
  "select".
- `MediaRow` and `Card` draw horizontal rows on virtualized `FlatList`s with fixed item layout.
  Library grids are paged. `TopBar` is a `TVFocusGuideView` that traps LEFT and RIGHT so focus
  cannot leave the tab row sideways. `OptionPicker` is the modal list used for tracks, sort order
  and settings.
- Screens:
  - `ServerSelectScreen`: discovery results and a manual address.
  - `LoginScreen`: user tiles, password and Quick Connect.
  - `HomeScreen`: Continue Watching, Next Up and latest per library.
  - `LibraryScreen`: grid with sort, letter and unwatched filters.
  - `DetailScreen`: movie, series, season and episode pages. A series page has a Resume button
    for the partly watched episode (and Play for the next unwatched one). Choosing a season puts
    focus on its first episode. An episode page lists the episodes after it and has Back to
    season and Back to series buttons.
    A series also has an Add/Remove Randomizer button.
  - `SearchScreen`.
  - `PlayerScreen`: an episode shows Previous and Next buttons in the controls, only the ones
    that exist (the first episode of a series has no Previous, the last no Next). Playback
    started from the Randomizer (route `player` with `shuffle`) has only Next, which draws
    another random episode, and the end of an episode draws one too when autoplay is on.
  - `SettingsScreen`: besides the options, an Actions section. Each action asks for a second
    press within five seconds, then shows its result in place:
    Clear Continue Watching (`Backend.clearProgress` resets the resume position of every
    Continue Watching item on the server), Clear Next Up (hides the current entries, see
    above), and Reset Randomizer history (starts a new cycle, keeps the series).
    HomeScreen shows a Randomizer tab only while the list has series.
  - Every screen has loading, error (with retry) and empty states.
  - `App.tsx` wraps each route in `ScreenBoundary`, an error boundary. A render error shows
    `ErrorView` with Retry for that screen, and BACK still works. The error is logged with
    `console.warn` and does not take down the app.
- Grids (`LibraryScreen` and `SearchScreen`) and rows (`MediaRow`) pass `getItemLayout`, so the
  list never measures cells. Every card has the same height, because its label area has a fixed
  height (`cardHeight`).
  - With `numColumns`, FlatList virtualizes rows, so the index that `getItemLayout` receives is a
    row index.
  - Card images are requested from the server at about twice the card size, and decoded with
    `resizeMethod="resize"`.

### Remote input on the player

react-native-tvos delivers D-pad presses as key-up events, and a long press as repeated
key-downs. `PlayerScreen` acts on key-up and uses the repeats to seek faster. While the controls
are hidden, a full-screen `Focusable` ("player-surface") holds focus so that remote keys still
reach the screen. Media keys (play/pause, rewind, fast forward) work in every overlay state.

## Testing

- Unit tests (`__tests__`, Jest) cover the HTTP layer, discovery parsing, the device profile and
  direct play decision, the Jellyfin backend against a fake fetch, track selection, the WebVTT
  parser, settings, the navigator, and an app render against the mock backend.
- Integration tests (`integration/`) run the real `JellyfinBackend` against the local Jellyfin
  container. They cover discovery over UDP, password and Quick Connect sign-in, browsing, search,
  direct play and transcode decisions for each sample file, progress, Continue Watching, mark
  watched, Next Up and favourites.
- `scripts/smoke.sh` is the end-to-end test on the emulator. It drives the APK with key events,
  checks the server's view of the session (item, pause state, play method), and saves screenshots.
- `scripts/e2e.sh` runs the scenarios that need setup or checks on the server:
  - Quick Connect, and audio and subtitle switching (text, ASS, PGS and burn-in).
  - Subtitle styling and position, resume, watched and favourite, and autoplay on and off.
  - Series resume, episode navigation, Previous/Next buttons, the Randomizer and the Settings
    actions.
  - BACK on every screen.
  - Switching user, changing server and signing out.
  - An empty library and a 2000-item one.
  - A revoked token, and the server stopping before and during playback.

  It reads the UI with `uiautomator dump` (`scripts/ui.py`). It compares the result with the
  server's sessions and user data, and samples subtitle pixels (`scripts/pixels.py`).

- Both scripts only talk to `emulator-*` serials and 127.0.0.1. `XELPFIN_APK` selects the APK, so
  they run unchanged against the release build.

## Release build

`scripts/release.sh` builds the `release` variant:

- R8 minification and resource shrinking, with keep rules in `proguard-rules.pro`.
- Hermes bytecode.
- The ABIs are selected with `-PreactNativeArchitectures`. armeabi-v7a and arm64-v8a go to the
  Fire TV APK, and x86_64 to the emulator APK.
- It is signed with a local keystore in `signing/` (git-ignored).

The debug build embeds the JS bundle too (`debuggableVariants` is empty), so the debug and
release APKs differ in minification, the native libraries they include, and the signing key, but
not in how the JS is loaded. Pass `-PxelpfinDev=true` for a Metro-backed debug build.

## Privacy

The only network peers are the Jellyfin server the user selects and the UDP broadcast used to
find it. There is no analytics, crash reporting, update check or account service. The Android
manifest requests only `INTERNET`. Cleartext HTTP is allowed so that LAN servers without TLS work.

## Vega OS app (`vega/`)

`vega/` is a second app that shares `App.tsx` and `src/` with the Fire TV app. It has its own
`package.json` and `node_modules` because Vega needs `@amazon-devices/react-native-kepler` on
RN 0.83 while the root uses react-native-tvos 0.81. `vega/metro.config.js` watches the repo root
but resolves every package from `vega/node_modules` and blocks the root's `node_modules`,
`android/`, `src/player/rnv` and `src/platform/firetv`.

Each entry point registers its own adapters before rendering: `index.js` calls
`setPlatform(createFireTvPlatform())` and `setEngine(VideoEngine)`; `vega/index.js` calls
`setPlatform(createVegaPlatform())` and `setEngine(VegaEngine)`. The `@react-native-async-storage`
import is an npm alias to Vega's AsyncStorage package in the Vega bundle.

The Vega engine (`vega/player/VegaEngine.tsx`) plays on `@amazon-devices/react-native-w3cmedia`.
Progressive direct-play streams load from the media element's `src`; HLS transcodes go through
Amazon's patched Shaka Player. The element cannot send request headers, so
`src/player/vega/streamUrl.ts` moves the access token into an `api_key` query parameter for
direct play, and the HLS path adds the headers in a Shaka request filter. Track-switch rules are
shared with Fire TV through `src/player/trackSelection.ts`. Embedded subtitles are not rendered
on Vega yet.

Amazon's Shaka and polyfill sources are not redistributable, so they are not committed.
`npm run shaka` (`scripts/vega-shaka.sh`) copies them from a `vega-video-sample` checkout
(`VEGA_SAMPLE_DIR`, default `~/workspace/repos/vega-video-sample`, `npm install`ed) into the
git-ignored `vega/vendor/`. Run it once before the first build.

Build and run (needs the Vega SDK on `PATH`, `~/vega/bin`):

```
cd vega && npm install && npm run shaka
npm run build:debug                      # .vpkg for aarch64, armv7 and x86_64
vega virtual-device start
vega device install-app -b Debug --dir .
vega device start-port-forwarding -p 8081 -f false && npm start    # Metro for debug builds
vega device launch-app --appName com.xelpfin.app
```

Status: the shared UI and the engine build, install and launch on the Vega virtual device against
the mock backend. Playback has not been exercised against a real stream yet. Still to do: Jellyfin
sign-in on Vega (once deployed), a Vega codec query and device profile, LAN discovery, embedded
subtitles, and a real-stick test.
