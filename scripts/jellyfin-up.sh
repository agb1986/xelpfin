#!/usr/bin/env bash
# Starts the local Jellyfin test server (127.0.0.1 only), generates sample media on first run,
# completes the setup wizard, creates libraries and test users, and waits for the library scan.
set -euo pipefail
source "$(dirname "$0")/jellyfin-env.sh"
mkdir -p "$JF_DIR/config" "$JF_DIR/cache" "$JF_DIR/media"
bash "$APP_DIR/scripts/gen-media.sh" "$JF_DIR/media"

if ! docker inspect "$JF_NAME" >/dev/null 2>&1; then
  docker run -d --name "$JF_NAME" --user "$(id -u):$(id -g)" \
    -p "127.0.0.1:$JF_PORT:8096" -p "127.0.0.1:7359:7359/udp" \
    -v "$JF_DIR/config:/config" -v "$JF_DIR/cache:/cache" -v "$JF_DIR/media:/media:ro" \
    "$JF_IMAGE" >/dev/null
elif [ "$(docker inspect -f '{{.State.Running}}' "$JF_NAME")" != true ]; then
  docker start "$JF_NAME" >/dev/null
fi

echo -n "waiting for $JF_URL"
for _ in $(seq 1 120); do
  if curl -fs "$JF_URL/System/Info/Public" >/dev/null 2>&1; then echo " up"; break; fi
  echo -n .; sleep 1
done
node "$APP_DIR/scripts/jellyfin-setup.mjs" "$JF_URL"
