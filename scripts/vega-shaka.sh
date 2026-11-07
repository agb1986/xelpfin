#!/usr/bin/env bash
# Copies the Vega build of Shaka Player and its polyfills into vega/vendor/ (git-ignored).
#
# Amazon patches Shaka Player 4.8.5 for Vega and ships it only inside its sample app, whose
# `npm install` builds it. That code is not redistributable here, so this repo does not hold a
# copy: point VEGA_SAMPLE_DIR at a checked-out, installed vega-video-sample.
set -euo pipefail

sample="${VEGA_SAMPLE_DIR:-$HOME/workspace/repos/vega-video-sample}"
src="$sample/src/w3cmedia"
dest="$(cd "$(dirname "$0")/.." && pwd)/vega/vendor"

for need in "$src/polyfills" "$src/shakaplayer/dist/shaka-player.compiled.js"; do
  [ -e "$need" ] || { echo "missing $need: run npm install in $sample first" >&2; exit 1; }
done

rm -rf "$dest"
mkdir -p "$dest/shakaplayer"
cp -R "$src/polyfills" "$dest/polyfills"
cp "$src/shakaplayer/dist/shaka-player.compiled.js" "$dest/shakaplayer/"
echo "Shaka Player copied to $dest"
