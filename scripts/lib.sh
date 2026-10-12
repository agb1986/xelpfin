# Shared helpers for the emulator scripts (smoke.sh, e2e.sh, perf.sh). Source, do not run.
#
# Safety: every adb call names the emulator serial explicitly, and sourcing this refuses any
# serial that is not an emulator, so the scripts can never reach a physical device.
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
SERIAL="${XELPFIN_SERIAL:-emulator-5554}"
case "$SERIAL" in emulator-*) ;; *) echo "refusing to run against non-emulator serial $SERIAL" >&2; exit 2 ;; esac
ADB=("$ANDROID_HOME/platform-tools/adb" -s "$SERIAL")
JF="${JF_URL:-http://127.0.0.1:8096}"
case "$JF" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "refusing to use non-local server $JF" >&2; exit 2 ;; esac
APK="${XELPFIN_APK:-android/app/build/outputs/apk/debug/app-debug.apk}"
SHOTS="${SHOTS:-docs/screens}"
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
# tap ID: touch the centre of the node with that id (from the last dump).
tap() {
  local xy
  xy="$(ui center "$1")" || fail "no $1 on screen"
  "${ADB[@]}" shell input tap $xy
  sleep 0.6
}
# clear_field: empty the focused text field (cursor to the end, then delete).
clear_field() { "${ADB[@]}" shell input keyevent MOVE_END $(printf 'DEL %.0s' $(seq 40)); }
launch() { # launch [--clear]
  [ "${1:-}" = --clear ] && "${ADB[@]}" shell pm clear "$PKG" >/dev/null
  "${ADB[@]}" shell am start -n "$PKG/.MainActivity" >/dev/null
}
# Installs $APK. A build signed with another key (debug versus release) cannot replace the
# installed one, so on the emulator the old one is removed first, together with its data.
install_apk() {
  [ -f "$APK" ] || fail "missing $APK (npm run apk:debug or npm run apk:release)"
  local out
  out="$("${ADB[@]}" install -r "$APK" 2>&1 | tail -1)"
  if [[ "$out" == *INSTALL_FAILED_UPDATE_INCOMPATIBLE* ]]; then
    echo "  signed with another key: uninstalling the old build first"
    "${ADB[@]}" uninstall "$PKG" >/dev/null
    out="$("${ADB[@]}" install "$APK" 2>&1 | tail -1)"
  fi
  echo "  $out"
  [[ "$out" == Success* ]] || fail "install failed"
}
stop_app() { "${ADB[@]}" shell am force-stop "$PKG"; }
resumed_pkg() { "${ADB[@]}" shell dumpsys activity activities | sed -n 's/.*mResumedActivity.*u0 \([^/ ]*\)\/.*/\1/p;s/.*topResumedActivity.*u0 \([^/ ]*\)\/.*/\1/p' | head -1; }

# --- Jellyfin side. The checks sign in as their own device so they never touch the app's session.
AUTH_BASE='MediaBrowser Client="xelpfin-check", Device="check", Version="0.1.0"'
jf_login() { # jf_login USER PASSWORD DEVICE_ID -> token
  curl -fsS -X POST "$JF/Users/AuthenticateByName" -H "Authorization: $AUTH_BASE, DeviceId=\"$3\"" -H 'Content-Type: application/json' \
    -d "{\"Username\":\"$1\",\"Pw\":\"$2\"}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["AccessToken"])'
}
server_up() { curl -fsS -m 3 "$JF/System/Info/Public" >/dev/null 2>&1; }
require_server() {
  server_up || fail "Jellyfin not reachable at $JF (npm run jellyfin:up)"
  TOKEN=$(jf_login xelpfin xelpfin-pass xelpfin-check)
  USER_ID=$(api /Users/Me | python3 -c 'import json,sys; print(json.load(sys.stdin)["Id"])')
}
api() { curl -fsS "$JF$1" -H "Authorization: $AUTH_BASE, DeviceId=\"xelpfin-check\", Token=\"$TOKEN\"" "${@:2}"; }
item_id() { # item_id NAME [TYPE]
  api "/Items?Recursive=true&searchTerm=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$1")&IncludeItemTypes=${2:-Movie}&userId=$USER_ID" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["Items"][0]["Id"])'
}
user_data() { # user_data ITEM_ID -> JSON of the xelpfin user's data for the item
  api "/Items/$1?userId=$USER_ID" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["UserData"]))'
}
set_user_data() { # set_user_data ITEM_ID JSON
  api "/UserItems/$1/UserData?userId=$USER_ID" -X POST -H 'Content-Type: application/json' -d "$2" >/dev/null
}
# session FIELD...: prints fields of the app's (Client "xelpfin") playing session, "|"-separated.
# Fields: name, paused, method, audio, subtitle, position (s), transcode (video codec or "").
# Only the app's current device counts: "pm clear" gives the app a new device id, and the server
# can keep the old device's session (with a stale NowPlayingItem) around for a while.
session() {
  local dev
  dev="$(app_device_id)"
  api /Sessions | python3 -c '
import json, sys
dev, fields = sys.argv[1], sys.argv[2:]
for s in json.load(sys.stdin):
    if s.get("Client") == "xelpfin" and s.get("DeviceId") == dev and s.get("NowPlayingItem"):
        p = s.get("PlayState", {})
        t = s.get("TranscodingInfo") or {}
        v = {"name": s["NowPlayingItem"]["Name"], "paused": p.get("IsPaused"), "method": p.get("PlayMethod"),
             "audio": p.get("AudioStreamIndex"), "subtitle": p.get("SubtitleStreamIndex"),
             "position": (p.get("PositionTicks") or 0) // 10_000_000, "transcode": t.get("VideoCodec", ""),
             "device": s.get("DeviceId")}
        print("|".join(str(v[f]) for f in fields))
        break' "$dev" "$@"
}
# app_device_id: the device id of the most recently active xelpfin session.
app_device_id() {
  api /Sessions | python3 -c '
import json, sys
xs = [s for s in json.load(sys.stdin) if s.get("Client") == "xelpfin"]
xs.sort(key=lambda s: s.get("LastActivityDate") or "", reverse=True)
print(xs[0]["DeviceId"] if xs else "")'
}
# wait_session PATTERN SECONDS FIELD...: wait until session output matches the extended regex.
wait_session() {
  local pat="$1" t="$2" out=""
  shift 2
  for _ in $(seq "$t"); do out="$(session "$@")"; grep -qE "$pat" <<<"$out" && { echo "  server sees: $out"; return 0; }; sleep 1; done
  fail "server session did not match $pat (last: ${out:-none})"
}
