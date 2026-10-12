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
source "$(dirname "$0")/lib.sh"

step "server"
require_server
ITEM_ID=$(item_id "Big Purple Test")
# Start from a clean watch state for this item so Continue Watching is a real result.
set_user_data "$ITEM_ID" '{"PlaybackPositionTicks":0,"Played":false}'
now_playing() { session name paused method; } # "<item name>|<paused>|<play method>"

step "install and launch"
"${ADB[@]}" get-state >/dev/null || fail "emulator $SERIAL not running (scripts/emulator.sh start)"
if [ "${1:-}" != "--no-install" ]; then
  install_apk
fi
launch --clear

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
  python3 scripts/pixels.py "$SHOTS/08-player-subtitles.png" dark && break
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
