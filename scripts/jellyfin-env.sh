# Shared settings for the local Jellyfin test server. Sourced by the other scripts.
APP_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
JF_DIR=${JF_DIR:-$(cd "$APP_DIR/.." && pwd)/work/jellyfin-test}
JF_NAME=${JF_NAME:-xelpfin-jellyfin}
JF_IMAGE=${JF_IMAGE:-jellyfin/jellyfin:12.1}
JF_PORT=${JF_PORT:-8096}
JF_URL=${JF_URL:-http://127.0.0.1:$JF_PORT}
