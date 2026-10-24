# Shared settings for the local Jellyfin test server. Sourced by the other scripts.
#
# JF_VERSION picks the server release (a jellyfin/jellyfin image tag such as 10.9, 10.10 or
# 10.11); it can also be passed as the first argument to jellyfin-up.sh and jellyfin-down.sh.
# Unset, it is the default below, with the container name and data directory used before
# versions could be chosen. Every other version gets its own container and config directory,
# because a server migrates its database on start and cannot open a newer release's data.
# The generated media is shared and mounted read-only. All versions publish the same 127.0.0.1
# ports, so only one runs at a time; jellyfin-up.sh stops the others.
JF_DEFAULT_VERSION=12.1
JF_VERSIONS="10.9 10.10 10.11"
APP_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
JF_ROOT=${JF_ROOT:-$(cd "$APP_DIR/.." && pwd)/work}
JF_MEDIA=${JF_MEDIA:-$JF_ROOT/jellyfin-test/media}
JF_VERSION=${JF_VERSION:-$JF_DEFAULT_VERSION}
case "$JF_VERSION" in
  *[!0-9.]* | "") echo "JF_VERSION must be a release number like 10.10, not '$JF_VERSION'" >&2; exit 2 ;;
esac
if [ "$JF_VERSION" = "$JF_DEFAULT_VERSION" ]; then
  JF_DIR=${JF_DIR:-$JF_ROOT/jellyfin-test}
  JF_NAME=${JF_NAME:-xelpfin-jellyfin}
else
  JF_DIR=${JF_DIR:-$JF_ROOT/jellyfin-test-$JF_VERSION}
  JF_NAME=${JF_NAME:-xelpfin-jellyfin-$JF_VERSION}
fi
JF_IMAGE=${JF_IMAGE:-jellyfin/jellyfin:$JF_VERSION}
JF_PORT=${JF_PORT:-8096}
JF_URL=${JF_URL:-http://127.0.0.1:$JF_PORT}
