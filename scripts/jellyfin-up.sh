#!/usr/bin/env bash
# Starts the local Jellyfin test server (127.0.0.1 only), generates sample media on first run,
# completes the setup wizard, creates libraries and test users, and waits for the library scan.
# Usage: scripts/jellyfin-up.sh [version]   (or JF_VERSION=10.10; see jellyfin-env.sh)
set -euo pipefail
if [ -n "${1:-}" ]; then JF_VERSION=$1; fi
source "$(dirname "$0")/jellyfin-env.sh"
mkdir -p "$JF_DIR/config" "$JF_DIR/cache" "$JF_MEDIA"
bash "$APP_DIR/scripts/gen-media.sh" "$JF_MEDIA"

# The versions share the published ports, so stop whichever other test server is running.
for other in $(docker ps --filter name=^xelpfin-jellyfin --format '{{.Names}}'); do
  if [ "$other" != "$JF_NAME" ]; then echo "stopping $other"; docker stop "$other" >/dev/null; fi
done

if ! docker inspect "$JF_NAME" >/dev/null 2>&1; then
  echo "starting $JF_NAME ($JF_IMAGE)"
  docker run -d --name "$JF_NAME" --user "$(id -u):$(id -g)" \
    -p "127.0.0.1:$JF_PORT:8096" -p "127.0.0.1:7359:7359/udp" \
    -v "$JF_DIR/config:/config" -v "$JF_DIR/cache:/cache" -v "$JF_MEDIA:/media:ro" \
    "$JF_IMAGE" >/dev/null
elif [ "$(docker inspect -f '{{.State.Running}}' "$JF_NAME")" != true ]; then
  docker start "$JF_NAME" >/dev/null
fi

echo -n "waiting for $JF_URL"
for _ in $(seq 1 180); do
  if curl -fs "$JF_URL/System/Info/Public" >/dev/null 2>&1; then echo " up"; break; fi
  echo -n .; sleep 1
done
node "$APP_DIR/scripts/jellyfin-setup.mjs" "$JF_URL"
