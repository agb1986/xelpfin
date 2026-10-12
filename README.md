# xelpfin

A 10-foot media client for Fire TV, written in React Native (react-native-tvos) and TypeScript,
with Jellyfin as its only backend. The shared code is meant to carry over to Vega OS later; the
platform-specific parts sit behind small interfaces (see `docs/ARCHITECTURE.md`).

- App id `com.xelpfin.app`, label `xelpfin`, purple accent `#8E5CF7`.
- Talks only to the Jellyfin server the user picks. There is no telemetry, no account service and
  no other network traffic.
- Personal, local-network use.

## What it does

- Finds Jellyfin servers on the LAN through UDP discovery on port 7359, or connects to a typed address.
- Signs in with a user name and password, or with Quick Connect.
- Home shows Continue Watching, Next Up and the latest items of each library. There are tabs for
  each library, search and settings.
- Library browse uses paged grids with sorting. Detail pages cover movies, series, seasons and
  episodes, and support play, resume, mark watched and favourite.
- Playback chooses between direct play and an HLS transcode based on what the device's decoders
  report. It reports progress to the server, supports seek with the D-pad, and lets you choose
  audio and subtitle tracks. When autoplay is on, the next episode plays automatically.
- Settings cover the maximum streaming quality, the subtitle mode, the preferred language,
  autoplay, the playback info overlay, switching user and changing server.

## Requirements

- Node 22 and npm 10. Dependencies are pinned in `package-lock.json`, so `npm ci` works from a
  warm npm cache.
- JDK 17 or newer (built with 21) and the Android SDK in `~/Android/Sdk`, or set `ANDROID_HOME`.
  You need platform 36, build-tools 36 and an x86_64 system image for the emulator.
- Docker, for the local Jellyfin test server.
- ffmpeg and Python 3 with Pillow, to generate the sample media and poster art.

## Everything runs locally

```sh
npm ci

# 1. Local Jellyfin 12.1 in Docker, bound to 127.0.0.1 only (8096/tcp, 7359/udp).
#    The first run generates sample media with ffmpeg and stores its data in
#    ../work/jellyfin-test. It also completes the setup wizard and creates the
#    libraries and users: admin "xelpfin" / "xelpfin-pass" and "guest" with no password.
npm run jellyfin:up

# 2. Checks.
npm run typecheck
npm run lint
npm test                    # unit tests (mocked fetch and UDP)
npm run test:integration    # against the local Jellyfin container

# 3. Debug APK. The JS bundle is embedded, so Metro is not needed.
#    Output: android/app/build/outputs/apk/debug/app-debug.apk
npm run apk:debug

# 4. Android TV-style emulator (AVD "xelpfin_tv": 1080p, D-pad, x86_64, headless).
npm run emu:start

# 5. End-to-end smoke test on the emulator. It installs the APK and drives the app
#    with D-pad key events. Screenshots go to docs/screens.
npm run smoke               # or: scripts/smoke.sh --no-install
```

Inside the emulator, the host's Jellyfin is reachable at `http://10.0.2.2:8096`. UDP broadcasts
do not leave the emulator's virtual network, so on the emulator only, discovery also asks
10.0.2.2 directly.

Tear down with `npm run jellyfin:down` (this keeps the data directory) and
`scripts/emulator.sh stop`.

### adb safety

Every script passes an explicit emulator serial (`-s emulator-5554` by default; override it with
`XELPFIN_SERIAL`). `smoke.sh` refuses to run against any serial that does not start with
`emulator-`. A physical Fire TV can be connected to the same adb server without being touched.

### Development with Metro

`npm start` and `npm run android` work as in any React Native project. For TV work, the embedded
bundle plus `npm run apk:debug` (about 10 s incremental) is usually simpler.

## Layout

```
src/backend    Backend + ServerConnector interfaces, Jellyfin implementation, mock backend
src/player     PlayerEngine interface, react-native-video engine, codec capabilities, WebVTT subtitles
src/platform   PlatformServices interface, Fire TV adapter (Kotlin module + AsyncStorage), Vega stub
src/state      app state (session, servers, settings), stack navigator, track defaults
src/ui         theme, focus-aware components, screens
__tests__      unit tests            integration/   tests against local Jellyfin
scripts        Jellyfin, media, emulator and smoke test scripts
docs           ARCHITECTURE.md, screens/ (smoke test screenshots)
```

## Smoke test screenshots

`docs/screens/01-servers.png` through `12-settings.png` come from `scripts/smoke.sh`. The test
covers server discovery, login, home, detail, playback (with the server confirming direct play),
the controls, the subtitle picker, subtitles on screen, Continue Watching, search, the Shows
library and settings. `13-transcode-old-codec.png` shows an msmpeg4 AVI that the server
transcodes to HLS. `14-hevc10-embedded-subs.png` shows a direct-played HEVC 10-bit MKV with
embedded subtitles.
