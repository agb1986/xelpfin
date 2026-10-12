#!/usr/bin/env bash
# End-to-end smoke test on the local emulator against the local Jellyfin container.
#
#   scripts/smoke.sh [--no-install]
#
# Drives the debug APK with D-pad key events only (as a remote would): picks the discovered
# server, signs in as "xelpfin", browses to "Big Purple Test", plays it, checks on the server that
# the session is playing that item, opens the player controls and the subtitle picker, pauses,
# exits and checks Continue Watching, then visits search, a library and settings. Screenshots
# go to docs/screens.
#
# Safety: every adb call names the emulator serial explicitly, and the script refuses to run
# against anything that is not an emulator, so it can never reach a physical device.
set -euo pipefail
cd "$(dirname "$0")/.."
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
SERIAL="${XELPFIN_SERIAL:-emulator-5554}"
case "$SERIAL" in emulator-*) ;; *) echo "refusing to run against non-emulator serial $SERIAL" >&2; exit 2 ;; esac
ADB=("$ANDROID_HOME/platform-tools/adb" -s "$SERIAL")
JF="${JF_URL:-http://127.0.0.1:8096}"
APK=android/app/build/outputs/apk/debug/app-debug.apk
SHOTS=docs/screens
PKG=com.xelpfin.app
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$SHOTS"

step() { printf '\n== %s\n' "$*"; }
fail() { echo "FAIL: $*" >&2; shot "failure" || true; exit 1; }
key() { for k in "$@"; do "${ADB[@]}" shell input keyevent "$k"; sleep 0.4; done; }
dump() {
  "${ADB[@]}" shell uiautomator dump /sdcard/xelpfin-ui.xml >/dev/null 2>&1 || true
  "${ADB[@]}" exec-out cat /sdcard/xelpfin-ui.xml > "$TMP/ui.xml"
}
ui() { python3 scripts/ui.py "$@" < "$TMP/ui.xml"; }
shot() { "${ADB[@]}" exec-out screencap -p > "$SHOTS/$1.png"; echo "  screenshot $SHOTS/$1.png"; }
wait_for() { # wait_for ID [seconds]
  local id="$1" t="${2:-20}"
  for _ in $(seq "$t"); do dump; if ui has "$id"; then return 0; fi; sleep 1; done
  fail "timed out waiting for $id"
}
wait_gone() {
  local id="$1" t="${2:-20}"
  for _ in $(seq "$t"); do dump; if ! ui has "$id"; then return 0; fi; sleep 1; done
  fail "timed out waiting for $id to disappear"
}
focused() { dump; ui focused; }
# move_until KEY PATTERN [max]: press KEY until the focused element's id or text matches PATTERN.
move_until() {
  local k="$1" pat="$2" max="${3:-12}" here
  for _ in $(seq "$max"); do
    dump
    here="$(ui focused; ui focustext 2>/dev/null || true)"
    if grep -qE "$pat" <<<"$here"; then return 0; fi
    key "$k"
  done
  dump
  here="$(ui focused; ui focustext 2>/dev/null || true)"
  grep -qE "$pat" <<<"$here" || fail "could not focus $pat with $k (focus: ${here//$'\n'/ / })"
}

# --- Jellyfin side: the server must be up; the checks below use a separate device id. ---
step "server"
curl -fsS "$JF/System/Info/Public" >/dev/null || fail "Jellyfin not reachable at $JF (npm run jellyfin:up)"
AUTH='MediaBrowser Client="xelpfin-smoke", Device="smoke", DeviceId="xelpfin-smoke", Version="0.1.0"'
TOKEN=$(curl -fsS -X POST "$JF/Users/AuthenticateByName" -H "Authorization: $AUTH" -H 'Content-Type: application/json' \
  -d '{"Username":"xelpfin","Pw":"xelpfin-pass"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["AccessToken"])')
api() { curl -fsS "$JF$1" -H "Authorization: $AUTH, Token=\"$TOKEN\""; }
USER_ID=$(api /Users/Me | python3 -c 'import json,sys; print(json.load(sys.stdin)["Id"])')
ITEM_ID=$(api "/Items?Recursive=true&searchTerm=Big%20Purple%20Test&IncludeItemTypes=Movie" | python3 -c 'import json,sys; print(json.load(sys.stdin)["Items"][0]["Id"])')
# Start from a clean watch state for this item so Continue Watching is a real result.
curl -fsS -X POST "$JF/UserItems/$ITEM_ID/UserData?userId=$USER_ID" -H "Authorization: $AUTH, Token=\"$TOKEN\"" \
  -H 'Content-Type: application/json' -d '{"PlaybackPositionTicks":0,"Played":false}' >/dev/null
now_playing() { # prints "<item name>|<paused>|<play method>" for the xelpfin app session, if any
  api /Sessions | python3 -c '
import json, sys
for s in json.load(sys.stdin):
    if s.get("Client") == "xelpfin" and s.get("NowPlayingItem"):
        p = s.get("PlayState", {})
        print(s["NowPlayingItem"]["Name"], p.get("IsPaused"), p.get("PlayMethod"), sep="|")
        break'
}

step "install and launch"
"${ADB[@]}" get-state >/dev/null || fail "emulator $SERIAL not running (scripts/emulator.sh start)"
if [ "${1:-}" != "--no-install" ]; then
  [ -f "$APK" ] || fail "missing $APK (npm run apk:debug)"
  "${ADB[@]}" install -r "$APK" | tail -1
fi
"${ADB[@]}" shell pm clear "$PKG" >/dev/null
"${ADB[@]}" shell am start -n "$PKG/.MainActivity" >/dev/null

step "connect: pick the server found by UDP discovery"
wait_for servers 30
for _ in $(seq 15); do dump; [[ "$(ui focused)" == server-* ]] && break; sleep 1; done
if [[ "$(ui focused)" == server-* ]]; then
  echo "  discovered: $(ui focustext)"
else
  echo "  nothing discovered, typing the address"
  move_until DPAD_DOWN '^address$'
  key DPAD_CENTER; "${ADB[@]}" shell input text '10.0.2.2:8096'; key ENTER
fi
shot 01-servers
key DPAD_CENTER

step "login as xelpfin"
wait_for login
wait_for user-xelpfin
sleep 1
move_until DPAD_RIGHT '^user-xelpfin$' 4
shot 02-login
key DPAD_CENTER
[ "$(focused)" = password ] || fail "password field not focused after choosing the user"
"${ADB[@]}" shell input text 'xelpfin-pass'
key ENTER
wait_for home 30
sleep 2
shot 03-home

step "browse to Big Purple Test"
move_until DPAD_RIGHT 'Big Purple Test' 6
key DPAD_CENTER
wait_for detail
sleep 1
[ "$(focused)" = play ] || fail "play button not focused on the detail screen"
shot 04-detail

step "play"
key DPAD_CENTER
wait_for player
for _ in $(seq 20); do np=$(now_playing); [ -n "$np" ] && break; sleep 1; done
echo "  server sees: ${np:-nothing}"
case "$np" in "Big Purple Test|False|"*) ;; *) fail "server does not report Big Purple Test playing" ;; esac
sleep 4
shot 05-player

step "controls, subtitles and pause"
# uiautomator waits for the UI to go idle, which takes several seconds while video plays, so the
# auto-hiding controls are checked while paused (paused keeps them up). A screenshot is fast,
# so the playing controls are captured right after the key press.
key DPAD_CENTER
shot 06-player-controls
key MEDIA_PLAY_PAUSE
for _ in $(seq 15); do np=$(now_playing); case "$np" in *"|True|"*) break ;; esac; sleep 1; done
echo "  after pause: $np"
case "$np" in "Big Purple Test|True|"*) ;; *) fail "server does not see the pause" ;; esac
wait_for player-overlay 10
[ "$(focused)" = player-playpause ] || fail "play/pause not focused when controls open"
move_until DPAD_RIGHT '^player-subtitles$' 6
key DPAD_CENTER
wait_for pick-subtitle 5
shot 07-subtitle-picker
move_until DPAD_DOWN 'English' 4
key DPAD_CENTER
wait_gone pick-subtitle 5
key MEDIA_PLAY_PAUSE
for _ in $(seq 15); do np=$(now_playing); case "$np" in *"|False|"*) break ;; esac; sleep 1; done
echo "  after resume: $np"
case "$np" in "Big Purple Test|False|"*) ;; *) fail "server does not see playback resume" ;; esac
sleep 4
# The sample has a cue on screen 3.5 s of every 4 s, drawn by the app's own subtitle view.
wait_for player-subtitle-text 4
# Screenshots are fast, so keep the first one that shows the dark subtitle box near the bottom.
for _ in $(seq 10); do
  shot 08-player-subtitles >/dev/null
  python3 - "$SHOTS/08-player-subtitles.png" <<'PY' && break
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
w, h = im.size
band = im.crop((w // 4, int(h * 0.82), 3 * w // 4, int(h * 0.97))).getdata()
dark = sum(1 for r, g, b in band if r + g + b < 120)
sys.exit(0 if dark > len(band) // 20 else 1)
PY
  sleep 0.5
done
echo "  screenshot $SHOTS/08-player-subtitles.png"

step "exit and continue watching"
sleep 3
key BACK
# The first back may only close the controls; keep going until the player is gone.
for _ in $(seq 3); do dump; ui has player || break; key BACK; done
wait_for detail
key BACK
wait_for home
for _ in $(seq 10); do dump; ui has row-resume && break; sleep 1; done
ui has row-resume || fail "Continue Watching row missing after playback"
key DPAD_UP DPAD_UP
shot 09-home-continue

step "search"
move_until DPAD_UP '^tab-' 4
move_until DPAD_RIGHT '^tab-search$' 6
key DPAD_CENTER
wait_for search
move_until DPAD_DOWN '^search-input$' 3
key DPAD_CENTER
"${ADB[@]}" shell input text 'night'
key ENTER
sleep 2
dump
grep -q 'Night Grid' "$TMP/ui.xml" || fail "search for night did not show Night Grid"
shot 10-search

step "library and settings"
# Search is its own screen; BACK (twice if the keyboard is still up) returns home.
for _ in $(seq 3); do dump; ui has screen-home && break; key BACK; done
wait_for screen-home
move_until DPAD_UP '^tab-' 6
move_until DPAD_LEFT '^tab-home$' 8
move_until DPAD_RIGHT '^tab-lib-Shows$' 6
key DPAD_CENTER
wait_for library
sleep 2
shot 11-library-shows
key BACK
wait_for screen-home
move_until DPAD_UP '^tab-' 6
move_until DPAD_RIGHT '^tab-settings$' 8
key DPAD_CENTER
wait_for settings
sleep 1
shot 12-settings

np=$(now_playing || true)
[ -z "$np" ] || fail "server still reports a playing session after exit: $np"
echo
echo "SMOKE TEST PASSED"
