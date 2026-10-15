#!/usr/bin/env bash
# Builds the release APKs into dist/:
#   xelpfin-<version>-arm.apk     armeabi-v7a + arm64-v8a, for the Fire TV stick
#   xelpfin-<version>-x86_64.apk  the same release build for the x86_64 emulator
# Both are minified with R8, use Hermes bytecode and are signed with the key in signing/.
# On first use a local keystore is generated there (git ignores the folder). Keep a copy of it:
# an update to an installed APK has to be signed with the same key.
#
#   scripts/release.sh            both APKs
#   scripts/release.sh arm|x86_64 one of them
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
SIGN="$ROOT/signing"
PROPS="$SIGN/keystore.properties"

if [ ! -f "$PROPS" ]; then
  mkdir -p "$SIGN"
  chmod 700 "$SIGN"
  PASS="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
  keytool -genkeypair -v -noprompt -keystore "$SIGN/xelpfin-release.keystore" -storetype PKCS12 \
    -alias xelpfin -keyalg RSA -keysize 3072 -validity 10000 \
    -dname "CN=xelpfin, O=xelpfin" -storepass "$PASS" -keypass "$PASS" >/dev/null
  cat > "$PROPS" <<PROPS
storeFile=xelpfin-release.keystore
storePassword=$PASS
keyAlias=xelpfin
keyPassword=$PASS
PROPS
  chmod 600 "$PROPS" "$SIGN/xelpfin-release.keystore"
  echo "Created a release keystore in signing/. Back it up."
fi

VERSION="$(node -p "require('./package.json').version")"
mkdir -p dist
build() { # build NAME ABIS
  (cd android && ./gradlew --quiet assembleRelease -PreactNativeArchitectures="$2")
  cp android/app/build/outputs/apk/release/app-release.apk "dist/xelpfin-$VERSION-$1.apk"
  cp android/app/build/outputs/mapping/release/mapping.txt "dist/xelpfin-$VERSION-$1-mapping.txt"
  printf '%-28s %s\n' "xelpfin-$VERSION-$1.apk" "$(du -h "dist/xelpfin-$VERSION-$1.apk" | cut -f1)"
}
case "${1:-all}" in
  arm) build arm armeabi-v7a,arm64-v8a ;;
  x86_64) build x86_64 x86_64 ;;
  all) build arm armeabi-v7a,arm64-v8a; build x86_64 x86_64 ;;
  *) echo "usage: $0 [arm|x86_64]" >&2; exit 2 ;;
esac
