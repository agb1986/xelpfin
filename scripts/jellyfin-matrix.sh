#!/usr/bin/env bash
# Runs the integration suite against several Jellyfin releases, one after the other.
# Usage: scripts/jellyfin-matrix.sh [version...]   (default: JF_VERSIONS from jellyfin-env.sh)
# Each version is started with jellyfin-up.sh, tested, and removed again (its config is kept, so
# a second run skips the setup). Exits non-zero if any version failed.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/jellyfin-env.sh"
versions=("$@")
[ ${#versions[@]} -gt 0 ] || read -ra versions <<<"$JF_VERSIONS"
declare -A result
for v in "${versions[@]}"; do
  printf '\n== Jellyfin %s\n' "$v"
  if ! bash "$HERE/jellyfin-up.sh" "$v"; then
    result[$v]="server did not start"
  elif JF_VERSION=$v npm run -s test:integration; then
    result[$v]=passed
  else
    result[$v]=failed
  fi
  bash "$HERE/jellyfin-down.sh" "$v"
done
printf '\n== summary\n'
status=0
for v in "${versions[@]}"; do
  printf '  %-8s %s\n' "$v" "${result[$v]}"
  [ "${result[$v]}" = passed ] || status=1
done
exit $status
