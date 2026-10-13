#!/usr/bin/env bash
# Scenario tests on the local emulator against the local Jellyfin container. Complements
# smoke.sh (the happy path) with the flows that need server-side setup or checks.
#
#   scripts/e2e.sh [--install] [scenario ...]     (default: all scenarios, in order)
#
# Scenarios: quickconnect audio subtitles burnin substyle resume watched autoplay back seek
#            switch empty expiry offline
# Extra, run only when named: perf (cold start, grid scrolling, memory)
#
# Each scenario checks the result on the server (session state, user data) where there is one
# and leaves a screenshot in docs/screens/e2e-*.png. "offline" stops and restarts the
# xelpfin-jellyfin container. Like smoke.sh, it only ever talks to the emulator and 127.0.0.1.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
CONTAINER="${JF_CONTAINER:-xelpfin-jellyfin}"

if [ "${1:-}" = --install ]; then
  shift
  install_apk
fi
ALL=(quickconnect audio subtitles burnin substyle resume watched autoplay back seek switch empty expiry offline)
SCENARIOS=("${@:-${ALL[@]}}")
[ $# -gt 0 ] || SCENARIOS=("${ALL[@]}")

"${ADB[@]}" get-state >/dev/null || fail "emulator $SERIAL not running (scripts/emulator.sh start)"
require_server
ADMIN_TOKEN="$TOKEN"
SIGNED_IN=""

# --- app navigation ---------------------------------------------------------------------------
connect() { # fresh app data, pick the discovered server, end on the login screen
  stop_app
  launch --clear
  SIGNED_IN=""
  wait_for servers 30
  for _ in $(seq 15); do dump; [[ "$(ui focused)" == server-* ]] && break; sleep 1; done
  [[ "$(ui focused)" == server-* ]] || fail "no server discovered"
  key DPAD_CENTER
  wait_for login
}
login() { # login USER [PASSWORD]
  wait_for "user-$1"
  sleep 1
  dump
  tap "user-$1"
  [ "$(focused)" = password ] || fail "password field not focused after choosing $1"
  [ -z "${2:-}" ] || "${ADB[@]}" shell input text "$2"
  key ENTER
  wait_for home 30
  SIGNED_IN="$1"
}
home() { # home USER [PASSWORD]: be on the home screen signed in as USER
  if [ "$SIGNED_IN" = "$1" ]; then
    for _ in $(seq 6); do dump; ui has home && ui has tab-search && return 0; key BACK; done
  fi
  connect
  login "$@"
}
search_open() { # search_open WORD TITLE: open the detail page of TITLE found by searching WORD
  dump
  tap tab-search
  wait_for search
  dump
  tap search-input
  clear_field
  "${ADB[@]}" shell input text "$1"
  key ENTER
  for _ in $(seq 10); do dump; ui find "$2" >/dev/null && break; sleep 1; done
  local xy
  xy="$(ui find "$2")" || fail "search for $1 did not show $2"
  # The keyboard may cover the results; hide it first.
  if "${ADB[@]}" shell dumpsys input_method | grep -q 'mInputShown=true'; then
    key BACK; dump
    ui has search || fail "left search while hiding the keyboard"
  fi
  xy="$(ui find "$2")" || fail "lost $2 after hiding the keyboard"
  "${ADB[@]}" shell input tap $xy
  wait_for detail
  sleep 1
}
play() { # play [resume|start]: start playback from the detail page
  dump
  if [ "${1:-}" = resume ]; then tap resume
  elif ui has play; then tap play
  else tap play-start
  fi
  wait_for player
}
controls() { # pause and show the controls so uiautomator can read the player
  key MEDIA_PLAY_PAUSE
  wait_session '\|True$' 15 name paused
  wait_for player-overlay 10
}
resume_playback() { key MEDIA_PLAY_PAUSE; wait_session '\|False$' 15 name paused; }
pick() { # pick BUTTON PICKER TEXT: open a picker from a button and choose the option with TEXT
  dump
  tap "$1"
  wait_for "$2" 5
  local xy
  xy="$(ui find "$3")" || fail "no option $3 in $2"
  "${ADB[@]}" shell input tap $xy
  wait_gone "$2" 5
}
leave_player() {
  # Two quick BACKs: the first lowers the controls (or asks to confirm), the second leaves.
  for _ in $(seq 3); do dump; ui has player || return 0; key BACK BACK; sleep 1; done
  fail "could not leave the player"
}
setting() { # setting ID OPTION: change a setting through its picker (or toggle when OPTION is empty)
  dump
  ui has settings || { tap tab-settings; wait_for settings; dump; }
  for _ in $(seq 8); do ui has "$1" && break; key DPAD_DOWN DPAD_DOWN; dump; done
  tap "$1"
  if [ -n "${2:-}" ]; then
    sleep 1; dump
    local xy
    xy="$(ui find "$2")" || fail "no option $2 for $1"
    "${ADB[@]}" shell input tap $xy
    sleep 1
  fi
}
grab_subtitle_shot() { # grab_subtitle_shot NAME: screenshot until bottom band shows a subtitle box
  wait_gone player-overlay 15 # the controls are dark too
  for _ in $(seq 20); do
    shot "$1" >/dev/null
    python3 scripts/pixels.py "$SHOTS/$1.png" dark && { echo "  screenshot $SHOTS/$1.png"; return 0; }
    sleep 0.5
  done
  fail "no subtitle box visible in $1"
}
ticks() { python3 -c 'import json,sys; print(json.loads(sys.argv[1])[sys.argv[2]])' "$(user_data "$1")" "$2"; }

# --- scenarios --------------------------------------------------------------------------------
s_quickconnect() {
  connect
  dump
  tap quickconnect
  wait_for qc-code 10
  local code
  # The code box is a layout-only view, so read the code from any text on screen.
  code="$(grep -oE 'text="[0-9]{6}"' "$TMP/ui.xml" | grep -oE '[0-9]{6}' | head -1)"
  [ -n "$code" ] || fail "no Quick Connect code on screen"
  echo "  code on screen: $code"
  shot e2e-quickconnect
  api "/QuickConnect/Authorize?code=$code&userId=$USER_ID" -X POST >/dev/null
  wait_for home 30
  SIGNED_IN=xelpfin
  local who
  who="$(api /Sessions | python3 -c '
import json, sys
print(next((s.get("UserName", "") for s in json.load(sys.stdin) if s.get("Client") == "xelpfin"), ""))')"
  [ "$who" = xelpfin ] || fail "server session after Quick Connect belongs to '$who'"
  echo "  signed in as $who"
}

s_audio() {
  home xelpfin xelpfin-pass
  search_open night "Night Grid"
  play
  wait_session '^Night Grid\|False' 30 name paused
  local before after
  before="$(session audio)"
  controls
  dump
  local label
  label="$(ui text player-audio)"
  echo "  before: stream $before ($label)"
  case "$label" in *German*|*ger*|*Deutsch*) pick player-audio pick-audio English ;; *) pick player-audio pick-audio German ;; esac
  resume_playback
  for _ in $(seq 20); do after="$(session audio)"; [ -n "$after" ] && [ "$after" != "$before" ] && break; sleep 1; done
  [ "$after" != "$before" ] || fail "server still reports audio stream $before"
  echo "  after: stream $after ($(session method))"
  shot e2e-audio
  leave_player
}

s_subtitles() {
  home xelpfin xelpfin-pass
  search_open pixel "Pixel Subs"
  play
  wait_session '^Pixel Subs\|False\|DirectPlay\|2$' 30 name paused method subtitle
  # The PGS track is the file's default; ExoPlayer draws the bitmap itself.
  sleep 2
  grab_subtitle_shot e2e-subtitles-pgs
  controls
  pick player-subtitles pick-subtitle "Styled ASS"
  resume_playback
  wait_session '\|3$' 15 name subtitle
  local text=""
  for _ in $(seq 12); do
    sleep 1
    key MEDIA_PLAY_PAUSE; sleep 1; dump
    text="$(ui text player-subtitle-text 2>/dev/null || true)"
    [ -n "$text" ] && break
    key MEDIA_PLAY_PAUSE
  done
  echo "  ASS cue as shown: ${text//$'\n'/ / }"
  [[ "$text" == *"[ASS] styled line"* ]] || fail "ASS cue not shown as plain text"
  [[ "$text" != *'{'* && "$text" != *'\'* ]] || fail "ASS override tags left in the cue"
  shot e2e-subtitles-ass
  key MEDIA_PLAY_PAUSE
  leave_player
}

s_burnin() {
  home xelpfin xelpfin-pass
  search_open burned "Burned Pixels"
  play
  wait_session '^Burned Pixels\|False\|Transcode' 40 name paused method
  controls
  pick player-subtitles pick-subtitle "VOBSUB"
  resume_playback
  wait_session '^Burned Pixels\|Transcode\|2$' 40 name method subtitle
  local info
  info="$(api /Sessions | python3 -c '
import json, sys
for s in json.load(sys.stdin):
    if s.get("Client") == "xelpfin" and s.get("TranscodingInfo"):
        t = s["TranscodingInfo"]; print(t.get("VideoCodec"), t.get("IsVideoDirect"), ",".join(t.get("TranscodeReasons") or []))')"
  echo "  transcode: $info"
  [[ "$info" == *"False"* ]] || fail "video is not being re-encoded, so the subtitle cannot be burned in"
  sleep 3
  grab_subtitle_shot e2e-subtitles-burnin
  leave_player
}

s_substyle() {
  home xelpfin xelpfin-pass
  setting set-subsize "Extra large"
  setting set-subcolor "Yellow"
  setting set-subbg "Solid box"
  dump
  [[ "$(ui text set-subsize)" == *"Extra large"* && "$(ui text set-subcolor)" == *Yellow* && "$(ui text set-subbg)" == *Solid* ]] \
    || fail "subtitle settings not applied: $(ui text set-subsize) / $(ui text set-subcolor) / $(ui text set-subbg)"
  shot e2e-substyle-settings
  key BACK
  wait_for home
  search_open purple "Big Purple Test"
  play start
  wait_session '^Big Purple Test\|False' 30 name paused
  controls
  pick player-subtitles pick-subtitle English
  resume_playback
  local box=""
  for _ in $(seq 12); do
    sleep 1
    key MEDIA_PLAY_PAUSE; sleep 1; dump
    box="$(ui bounds player-subtitle-text 2>/dev/null || true)"
    [ -n "$box" ] && break
    key MEDIA_PLAY_PAUSE
  done
  [ -n "$box" ] || fail "no subtitle cue on screen"
  # The overlay is up while paused; it does not cover the subtitle area.
  shot e2e-substyle
  python3 scripts/pixels.py "$SHOTS/e2e-substyle.png" stats --box "$box"
  python3 scripts/pixels.py "$SHOTS/e2e-substyle.png" colour 255 225 77 --box "$box" || fail "subtitle text is not yellow"
  local h
  h=$(awk -F, '{print $4 - $2}' <<<"$box")
  echo "  subtitle box $box (height $h px)"
  [ "$h" -ge 70 ] || fail "subtitle box too small for extra large text"
  key MEDIA_PLAY_PAUSE
  leave_player
  home xelpfin xelpfin-pass
  setting set-subsize "Medium"
  setting set-subcolor "White"
  setting set-subbg "Translucent box"
  key BACK
}

s_resume() {
  home xelpfin xelpfin-pass
  local id
  id=$(item_id "Big Purple Test")
  set_user_data "$id" '{"PlaybackPositionTicks":0,"Played":false}'
  search_open purple "Big Purple Test"
  play
  wait_session '^Big Purple Test\|False\|([0-9]{2})$' 40 name paused position
  local pos
  pos=$(session position)
  leave_player
  wait_for detail
  local saved
  saved=$(( $(ticks "$id" PlaybackPositionTicks) / 10000000 ))
  echo "  played to ${pos}s, server saved ${saved}s"
  [ "$saved" -ge 9 ] || fail "server did not save a resume position"
  wait_for resume 10
  dump
  echo "  detail offers: $(ui text resume)"
  shot e2e-resume-detail
  play resume
  local first
  for _ in $(seq 20); do first=$(session position); [ -n "$first" ] && [ "$first" -gt 0 ] && break; sleep 1; done
  echo "  resumed at ${first}s"
  [ "${first:-0}" -ge $(( saved - 2 )) ] || fail "playback did not resume near ${saved}s"
  leave_player
  set_user_data "$id" '{"PlaybackPositionTicks":0,"Played":false}'
  key BACK
}

s_watched() {
  home xelpfin xelpfin-pass
  local id
  id=$(item_id "Night Grid")
  set_user_data "$id" '{"Played":false,"IsFavorite":false}'
  search_open night "Night Grid"
  dump
  echo "  buttons: $(ui text toggle-played) / $(ui text toggle-favorite)"
  tap toggle-played
  for _ in $(seq 10); do [ "$(ticks "$id" Played)" = True ] && break; sleep 1; done
  [ "$(ticks "$id" Played)" = True ] || fail "mark watched did not reach the server"
  dump
  tap toggle-favorite
  for _ in $(seq 10); do [ "$(ticks "$id" IsFavorite)" = True ] && break; sleep 1; done
  [ "$(ticks "$id" IsFavorite)" = True ] || fail "favourite did not reach the server"
  dump
  echo "  after: $(ui text toggle-played) / $(ui text toggle-favorite)"
  shot e2e-watched
  tap toggle-played
  sleep 1; dump
  tap toggle-favorite
  for _ in $(seq 10); do [ "$(ticks "$id" Played)/$(ticks "$id" IsFavorite)" = False/False ] && break; sleep 1; done
  [ "$(ticks "$id" Played)/$(ticks "$id" IsFavorite)" = False/False ] || fail "unmark did not reach the server"
  echo "  watched and favourite toggled on and off on the server"
  key BACK
}

autoplay_once() { # autoplay_once E1: play the last 10 s of the 25 s episode 1 from a resume point
  local e1="$1"
  set_user_data "$e1" '{"PlaybackPositionTicks":150000000,"Played":false}'
  search_open episode "Episode 1"
  wait_for resume 10
  dump
  tap resume
  # uiautomator stalls for seconds while video plays, so do not wait for the player view here.
  wait_session '^Episode [12]\|False' 20 name paused
}
s_autoplay() {
  home xelpfin xelpfin-pass
  local e1 e2
  e1=$(item_id "Episode 1" Episode)
  e2=$(item_id "Episode 2" Episode)
  set_user_data "$e2" '{"PlaybackPositionTicks":0,"Played":false}'
  autoplay_once "$e1"
  wait_session '^Episode 2\|False' 30 name paused
  [ "$(ticks "$e1" Played)" = True ] || fail "episode 1 was not marked played when it ended"
  shot e2e-autoplay
  leave_player
  for _ in $(seq 4); do dump; ui has home && break; key BACK; done
  setting set-autoplay
  dump
  [[ "$(ui text set-autoplay)" == *Off* ]] || fail "autoplay setting did not switch off"
  key BACK
  wait_for home
  autoplay_once "$e1"
  wait_gone player 30
  dump
  ui has detail || fail "player did not return to the detail page at the end"
  sleep 3
  [ -z "$(session name)" ] || fail "something is still playing with autoplay off: $(session name)"
  echo "  autoplay off: back on the detail page, nothing playing"
  for _ in $(seq 4); do key BACK; dump; ui has home && break; done
  setting set-autoplay
  key BACK
  set_user_data "$e1" '{"PlaybackPositionTicks":0,"Played":false}'
  set_user_data "$e2" '{"PlaybackPositionTicks":0,"Played":false}'
}

bar_seconds() { # seconds shown by the player's position label once a pending seek has been applied
  sleep 2
  dump
  ui has player-position || fail "no position label on the player bar"
  ui text player-position | python3 -c '
import re, sys
parts = [int(x) for x in re.findall(r"\d+", sys.stdin.read())]
t = 0
for x in parts:
    t = t * 60 + x
print(t)'
}
s_seek() {
  home xelpfin xelpfin-pass
  # Escalating rewind/forward taps, the scene navigator and the episode code in the title.
  local id
  id=$(item_id "Long Chapters")
  set_user_data "$id" '{"PlaybackPositionTicks":0,"Played":false}'
  search_open long "Long Chapters"
  play
  sleep 4
  # Seek while paused so the bar position read from the screen is exact. The server session can
  # still show an earlier run of this scenario, so everything here is read from the screen.
  key MEDIA_PLAY_PAUSE
  wait_for player-overlay 10
  local p0 p1 p2
  p0=$(bar_seconds)
  key BACK # lowers the controls, the video stays paused
  key DPAD_RIGHT # one tap: +10 s
  p1=$(bar_seconds)
  echo "  one tap: ${p0}s -> ${p1}s"
  [ "$p1" -eq $(( p0 + 10 )) ] || fail "one forward tap did not move 10 s"
  key DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT # three taps in a burst: +1 min in one seek
  p2=$(bar_seconds)
  echo "  three taps: ${p1}s -> ${p2}s"
  [ "$p2" -eq $(( p1 + 60 )) ] || fail "three quick forward taps did not move a minute"
  key DPAD_CENTER # controls up
  wait_for player-overlay 10
  key DPAD_UP # scene navigator
  wait_for player-scenes 10
  dump
  for i in 0 1 2 3; do ui has "player-scene-$i" || fail "scene $i missing from the navigator"; done
  echo "  navigator lists 4 chapters"
  shot e2e-scenes
  tap player-scene-3
  wait_gone player-scenes 10
  local p3
  p3=$(bar_seconds)
  echo "  third-last chapter: ${p3}s"
  [ "$p3" -ge 268 ] || fail "choosing the last chapter did not seek to it"
  leave_player
  wait_for detail
  for _ in $(seq 3); do key BACK; dump; ui has home && break; done
  search_open Episode "Episode 1"
  play
  sleep 4
  key MEDIA_PLAY_PAUSE
  wait_for player-overlay 10
  dump
  ui find S01E01 >/dev/null || fail "title does not show S01E01"
  echo "  title shows S01E01"
  shot e2e-episode-code
  leave_player
  set_user_data "$id" '{"PlaybackPositionTicks":0,"Played":false}'
}

s_back() {
  home xelpfin xelpfin-pass
  # Every screen returns to where it came from, and pickers close before their screen.
  dump; tap tab-settings; wait_for settings; key BACK; wait_for home
  dump; tap tab-lib-Movies; wait_for library; dump; tap sort; wait_for sort-picker 5
  key BACK; wait_gone sort-picker 5; dump; ui has library || fail "BACK on the sort picker left the library"
  key BACK; wait_for home
  search_open night "Night Grid"
  play
  wait_session '^Night Grid' 30 name
  key DPAD_CENTER
  key BACK # hides the controls
  dump; ui has player || fail "first BACK in the player left it instead of hiding the controls"
  sleep 4 # the double-tap window has passed: a lone BACK now only asks for confirmation
  key BACK
  dump; ui has player || fail "a lone BACK on the bare video left the player"
  ui has player-exit-hint || fail "no exit hint after a lone BACK on the bare video"
  key BACK # second BACK inside the window leaves
  wait_for detail
  key BACK
  wait_for search
  # The search field may still hold the soft keyboard, which takes the first BACK.
  for _ in 1 2 3; do key BACK; dump; ui has home && break; done
  wait_for home
  # BACK on the home screen leaves the app; the session survives a restart.
  key BACK
  sleep 2
  [ "$(resumed_pkg)" != "$PKG" ] || fail "BACK on the home screen did not leave the app"
  echo "  BACK at the root left the app (now: $(resumed_pkg))"
  launch
  wait_for home 30
  echo "  relaunch went straight to home"
}

s_switch() {
  home xelpfin xelpfin-pass
  setting set-switch-user
  wait_for login 10
  login guest
  dump; tap tab-settings; wait_for settings; dump
  for _ in $(seq 8); do ui has set-switch-user && break; key DPAD_DOWN DPAD_DOWN; dump; done
  [[ "$(ui text set-switch-user)" == *guest* ]] || fail "settings do not show the guest user"
  shot e2e-switch-user
  setting set-change-server
  wait_for servers 10
  shot e2e-change-server
  SIGNED_IN=""
}

s_empty() {
  home bulk
  dump
  tap tab-lib-Bulk
  wait_for library
  sleep 2
  dump
  ui find "2000 items" >/dev/null || fail "bulk library does not show 2000 items"
  shot e2e-bulk
  key BACK
  wait_for home
  dump
  tap tab-lib-Empty
  wait_for empty 15
  shot e2e-empty
  echo "  empty library shows: $(ui text empty)"
  key BACK
}

s_expiry() {
  home xelpfin xelpfin-pass
  local dev
  dev="$(app_device_id)"
  [ -n "$dev" ] || fail "no app session on the server"
  api "/Devices?id=$dev" -X DELETE >/dev/null
  echo "  revoked device $dev"
  dump
  tap tab-lib-Movies
  wait_for login-expired 20
  shot e2e-token-expired
  login xelpfin xelpfin-pass
}

# Starts the container again and waits for Jellyfin. During start-up it answers 200 once and then
# 503 for a few seconds, so it counts as back only after three good answers in a row.
server_restart() {
  local i ok=0
  for i in $(seq 180); do
    if server_up; then ok=$((ok + 1)); [ "$ok" -ge 3 ] && break; else ok=0; fi
    [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" = true ] || docker start "$CONTAINER" >/dev/null
    sleep 1
  done
  [ "$ok" -ge 3 ] || fail "server did not come back"
  echo "  server back after ${i}s"
  require_server
}

s_offline() {
  home xelpfin xelpfin-pass
  search_open purple "Big Purple Test"
  # Server down before playback starts: an error with a retry, which works once it is back.
  docker stop "$CONTAINER" >/dev/null
  play start
  wait_for error 40
  shot e2e-offline-error
  dump; echo "  error: $(ui text error)"
  server_restart
  dump; tap retry
  wait_session '^Big Purple Test\|False' 40 name paused
  echo "  retry after the server came back plays"
  # Server down in the middle of playback: playback carries on from the buffer and the app
  # must not crash; once the server is back, progress reports resume.
  sleep 3
  docker stop "$CONTAINER" >/dev/null
  sleep 15
  "${ADB[@]}" shell pidof "$PKG" >/dev/null || fail "app died while the server was down"
  shot e2e-offline-midplay
  dump
  if ui has error; then echo "  mid-playback: error view: $(ui text error)"; elif ui has player; then echo "  mid-playback: still playing from buffer"; else echo "  mid-playback: player closed at the end"; fi
  server_restart
  leave_player
  for _ in $(seq 4); do dump; ui has home && break; key BACK; done
  dump; tap tab-lib-Movies; wait_for library 30
  echo "  browsing works again after the restart"
  key BACK
}

# Not part of the default run (scripts/e2e.sh perf): measures cold start, scrolling through the
# 2000-item library and memory on the emulator. Emulator numbers are only comparable with each
# other, not with a Fire TV.
pss_mb() { "${ADB[@]}" shell dumpsys meminfo "$PKG" | awk '/TOTAL PSS:/ {printf "%.0f", $3/1024; exit} /^ *TOTAL / {printf "%.0f", $2/1024; exit}'; }
gfx_summary() {
  "${ADB[@]}" shell dumpsys gfxinfo "$PKG" | awk '
    /Total frames rendered/ {f=$4} /Janky frames:/ && !j {j=$3" "$4} /50th percentile/ && !p50 {p50=$3}
    /90th percentile/ && !p90 {p90=$3} /99th percentile/ && !p99 {p99=$3}
    END {printf "frames %s, janky %s, p50 %s, p90 %s, p99 %s", f, j, p50, p90, p99}'
}
s_perf() {
  home bulk
  local i t0 t1 total ms=()
  for i in 1 2 3 4 5; do
    stop_app
    sleep 2
    t0=$(date +%s%N)
    total="$("${ADB[@]}" shell am start -W -n "$PKG/.MainActivity" | sed -n 's/TotalTime: //p' | tr -d '\r')"
    for _ in $(seq 60); do dump; ui has tab-search && break; done
    t1=$(date +%s%N)
    ms+=("$total/$(( (t1 - t0) / 1000000 ))")
  done
  echo "  cold start, first frame / home with data (ms): ${ms[*]}"
  SIGNED_IN=bulk
  sleep 3
  echo "  memory on home: $(pss_mb) MB PSS"
  dump
  tap tab-lib-Bulk
  wait_for library
  sleep 3
  dump
  ui find "2000 items" >/dev/null || fail "bulk library does not show 2000 items"
  "${ADB[@]}" shell dumpsys gfxinfo "$PKG" reset >/dev/null
  local codes
  codes="$(printf '20 %.0s' $(seq 40))"
  for _ in 1 2 3; do "${ADB[@]}" shell input keyevent $codes; done
  sleep 2
  echo "  120 x DOWN through the grid: $(gfx_summary)"
  dump
  echo "  focused after scrolling: $(ui focustext)"
  shot e2e-perf-scrolled
  echo "  memory after scrolling: $(pss_mb) MB PSS"
  key BACK
}

for s in "${SCENARIOS[@]}"; do
  step "$s"
  "s_$s"
done
echo
echo "E2E PASSED: ${SCENARIOS[*]}"
