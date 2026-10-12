#!/usr/bin/env bash
# Stops and removes the local Jellyfin test container. Pass --wipe to also delete its data dir.
set -euo pipefail
source "$(dirname "$0")/jellyfin-env.sh"
docker rm -f "$JF_NAME" >/dev/null 2>&1 || true
if [ "${1:-}" = "--wipe" ]; then rm -rf "$JF_DIR/config" "$JF_DIR/cache"; echo "wiped config/cache in $JF_DIR"; fi
