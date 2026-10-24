#!/usr/bin/env bash
# Stops and removes the local Jellyfin test container.
# Usage: scripts/jellyfin-down.sh [version|--all] [--wipe]
#   version  the release to remove (default JF_VERSION, see jellyfin-env.sh)
#   --all    every xelpfin-jellyfin* test container, whatever its version
#   --wipe   also delete the config and cache of the removed version(s); media is kept
set -euo pipefail
all=false wipe=false
for a in "$@"; do
  case "$a" in
    --all) all=true ;;
    --wipe) wipe=true ;;
    *) JF_VERSION=$a ;;
  esac
done
source "$(dirname "$0")/jellyfin-env.sh"
if $all; then
  versions="$JF_DEFAULT_VERSION $JF_VERSIONS"
else
  versions=$JF_VERSION
fi
for v in $versions; do
  (
    # Per-version names and paths are derived again for each version in --all.
    if $all; then unset JF_DIR JF_NAME JF_IMAGE; fi
    JF_VERSION=$v
    source "$(dirname "$0")/jellyfin-env.sh"
    docker rm -f "$JF_NAME" >/dev/null 2>&1 || true
    if $wipe; then rm -rf "$JF_DIR/config" "$JF_DIR/cache"; echo "wiped config/cache in $JF_DIR"; fi
  )
done
if $all; then
  # Anything else with the prefix, for example a version that is no longer in the list.
  for c in $(docker ps -a --filter name=^xelpfin-jellyfin --format '{{.Names}}'); do docker rm -f "$c" >/dev/null; done
fi
