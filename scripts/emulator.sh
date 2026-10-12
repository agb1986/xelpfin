#!/usr/bin/env bash
# Creates and starts the local Android TV-style emulator used for smoke tests.
#   scripts/emulator.sh create   create the AVD "xelpfin_tv" if missing
#   scripts/emulator.sh start    create if needed, boot headless, wait for boot
#   scripts/emulator.sh stop     shut the emulator down
# Only ever talks to the emulator through an explicit serial (default emulator-5554).
set -euo pipefail
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
SDK="$ANDROID_HOME"
AVD="${XELPFIN_AVD:-xelpfin_tv}"
PORT="${XELPFIN_EMU_PORT:-5554}"
SERIAL="emulator-$PORT"
IMAGE="${XELPFIN_SYSIMG:-system-images;android-35;google_apis;x86_64}"
ADB="$SDK/platform-tools/adb"
AVDMANAGER="$SDK/cmdline-tools/latest/bin/avdmanager"

create() {
  if "$SDK/emulator/emulator" -list-avds | grep -qx "$AVD"; then
    return
  fi
  echo no | "$AVDMANAGER" create avd -n "$AVD" -k "$IMAGE" -d tv_1080p --force
  local cfg="$HOME/.android/avd/$AVD.avd/config.ini"
  # TV-like hardware: D-pad, no touch screen, 1080p, enough RAM for a debug build.
  for kv in hw.dPad=yes hw.keyboard=yes hw.mainKeys=yes hw.ramSize=3072 hw.lcd.width=1920 hw.lcd.height=1080 \
            hw.lcd.density=320 hw.gpu.enabled=yes hw.gpu.mode=swiftshader_indirect showDeviceFrame=no; do
    local k="${kv%%=*}"
    sed -i "/^$k=/d" "$cfg"
    echo "$kv" >> "$cfg"
  done
}

start() {
  create
  if "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1; then
    echo "$SERIAL already running"
  else
    nohup "$SDK/emulator/emulator" -avd "$AVD" -port "$PORT" -no-window -no-audio -no-boot-anim \
      -no-snapshot -gpu swiftshader_indirect >"${TMPDIR:-/tmp}/xelpfin-emulator.log" 2>&1 &
    "$ADB" -s "$SERIAL" wait-for-device
  fi
  for _ in $(seq 1 180); do
    if [ "$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; then
      "$ADB" -s "$SERIAL" shell settings put global window_animation_scale 0
      "$ADB" -s "$SERIAL" shell settings put global transition_animation_scale 0
      "$ADB" -s "$SERIAL" shell settings put global animator_duration_scale 0
      echo "$SERIAL booted"
      return
    fi
    sleep 2
  done
  echo "emulator did not boot" >&2
  exit 1
}

stop() {
  "$ADB" -s "$SERIAL" emu kill || true
}

case "${1:-start}" in
  create) create ;;
  start) start ;;
  stop) stop ;;
  *) echo "usage: $0 create|start|stop" >&2; exit 2 ;;
esac
