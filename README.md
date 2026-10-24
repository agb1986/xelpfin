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
  subtitle size, colour and background, autoplay, the playback info overlay, signing out,
  switching user and changing server.
- A screen that throws while rendering shows an error with Retry instead of taking down the app.

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
# Older releases: npm run jellyfin:up -- 10.10, then JF_VERSION=10.10 npm run test:integration.
# npm run jellyfin:matrix runs the suite against 10.9, 10.10 and 10.11 in turn, each with its
# own container and data directory (../work/jellyfin-test-<version>).

# 3. Debug APK. The JS bundle is embedded, so Metro is not needed.
#    Output: android/app/build/outputs/apk/debug/app-debug.apk
npm run apk:debug

# 4. Android TV-style emulator (AVD "xelpfin_tv": 1080p, D-pad, x86_64, headless).
npm run emu:start

# 5. End-to-end smoke test on the emulator. It installs the APK and drives the app
#    with D-pad key events. Screenshots go to docs/screens.
npm run smoke               # or: scripts/smoke.sh --no-install

# 6. Scenario tests on the emulator (Quick Connect, audio and subtitle switching, burn-in,
#    subtitle styling, resume, watched/favourite, autoplay, BACK, seek taps and scene navigator, switch user/server, empty
#    library, token expiry, server going away). "offline" restarts the Jellyfin container.
npm run e2e                 # or: scripts/e2e.sh [--install] [scenario ...]
scripts/e2e.sh perf         # cold start, 2000-item grid scrolling and memory (not in the default run)

# All of typecheck, lint and unit tests in one go:
npm run verify
```

`smoke.sh` and `e2e.sh` install `XELPFIN_APK` when it is set, so the same tests run against a
release build: `XELPFIN_APK=dist/xelpfin-0.1.0-x86_64.apk scripts/smoke.sh`. If the installed build is
signed with another key, the scripts uninstall it first (on the emulator only).

## Release build

```sh
npm run apk:release         # or: scripts/release.sh [arm|x86_64]
```

This writes two APKs to `dist/`. Both are minified with R8 and resource shrinking, use Hermes
bytecode, and are signed with the release key:

- `xelpfin-<version>-arm.apk` contains armeabi-v7a and arm64-v8a. Install this one on the Fire TV.
- `xelpfin-<version>-x86_64.apk` is the same build for the x86_64 emulator.
- `*-mapping.txt` is the R8 mapping that turns obfuscated stack traces back into readable ones.

On first use the script creates `signing/xelpfin-release.keystore` and
`signing/keystore.properties`, with a random password. git ignores `signing/` and `dist/`.
**Back up `signing/`.** Android only accepts an update signed with the same key as the installed
app. If the key is lost, you have to uninstall the app (losing its settings and sign-in) before
installing a build signed with a new key. Without `keystore.properties` a release build fails;
pass `-Pxelpfin.allowDebugSignedRelease=true` to Gradle to sign a throwaway release build with the
debug key instead.

The keep rules for R8 are in `android/app/proguard-rules.pro`. If you add a native module, add
its package there too, and check `adb logcat` for `ClassNotFoundException` on a release build.

### Versioning

`package.json` is the only place the version is set. `android/app/build.gradle` reads it:
`versionName` is the semver string and `versionCode` is `major*10000 + minor*100 + patch`, so it
always rises with the version (minor and patch must stay below 100). `scripts/release.sh` names
the APKs from it too.

Releases use Conventional Commits (`feat:` bumps minor, `fix:` bumps patch, `feat!:` or a
`BREAKING CHANGE:` footer bumps major). From a clean `main`:

```sh
npm run version:dry-run     # shows the next version and changelog without changing anything
npm run version:bump        # bumps package.json and the lockfile, writes CHANGELOG.md, commits, tags vX.Y.Z
git push --follow-tags
```

Use `npm run version:bump -- --release-as minor` (or `major`, `patch`, or `1.0.0`) to override.

### Changing the app id

The app id is `com.xelpfin.app`. The stripped reference APK built in an earlier phase uses the same
id, so only one of the two can be installed on a device at a time. Uninstalling the other one first
also removes its data. To give xelpfin its own id (for example `com.xelpfin.tv`):

1. In `android/app/build.gradle`, change `applicationId`. This is the only change Android needs.
   You can leave `namespace` as `com.xelpfin.app`, because it only names the generated `R` and
   `BuildConfig` classes.
2. In `scripts/lib.sh`, change `PKG`, which the emulator scripts use for `am start`,
   `force-stop` and `uninstall`.
3. Optionally, to keep everything consistent, also rename `namespace` and the Kotlin package.
   - The Kotlin package is the `package` line in the four files under
     `android/app/src/main/java/com/xelpfin/app/`, and their directory.
   - Also update the `com.xelpfin.app.**` keep rule in `proguard-rules.pro`.

The launcher activity then becomes `<new id>/com.xelpfin.app.MainActivity`. It is still the same
class, so `adb shell am start -n <new id>/com.xelpfin.app.MainActivity` works.

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
scripts        Jellyfin, media, emulator, smoke/e2e test and release scripts
docs           ARCHITECTURE.md, screens/ (smoke and e2e screenshots)
signing, dist  release keystore and release APKs (git-ignored, created by scripts/release.sh)
```

## Screenshots

`docs/screens/01-servers.png` through `12-settings.png` come from `scripts/smoke.sh`. The test
covers server discovery, login, home, detail, playback (with the server confirming direct play),
the controls, the subtitle picker, subtitles on screen, Continue Watching, search, the Shows
library and settings. `13-transcode-old-codec.png` shows an msmpeg4 AVI that the server
transcodes to HLS. `14-hevc10-embedded-subs.png` shows a direct-played HEVC 10-bit MKV with
embedded subtitles.

The `e2e-*.png` files come from `scripts/e2e.sh`, one or more per scenario:

- Quick Connect code: `e2e-quickconnect`.
- Audio track switch: `e2e-audio`.
- PGS, ASS and burned-in subtitles: `e2e-subtitles-pgs`, `-ass` and `-burnin`.
- Subtitle style settings and the result: `e2e-substyle-settings` and `e2e-substyle`.
- Resume offer: `e2e-resume-detail`.
- Watched and favourite: `e2e-watched`.
- Next episode autoplay: `e2e-autoplay`.
- Switch user and change server: `e2e-switch-user` and `e2e-change-server`.
- A 2000-item library and an empty one: `e2e-bulk` and `e2e-empty`.
- Revoked token: `e2e-token-expired`.
- Server stopped before and during playback: `e2e-offline-error` and `e2e-offline-midplay`.
- The 2000-item grid after fast scrolling, still focused (`scripts/e2e.sh perf`): `e2e-perf-scrolled`.
