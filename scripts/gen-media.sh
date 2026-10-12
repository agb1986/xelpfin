#!/usr/bin/env bash
# Generates a small synthetic media library for the local Jellyfin test server.
# Usage: scripts/gen-media.sh <media-dir>
set -euo pipefail
OUT=${1:?media dir}
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT/movies" "$OUT/shows"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
label() { echo "drawtext=fontfile=$FONT:text='$1':fontcolor=white:fontsize=$2:x=(w-tw)/2:y=h*0.4,drawtext=fontfile=$FONT:text='%{pts\\:hms}':fontcolor=white:fontsize=$(( $2 / 2 )):x=(w-tw)/2:y=h*0.6"; }

srt() { # srt <file> <lang-word>
  cat > "$1" <<SRT
1
00:00:01,000 --> 00:00:06,000
[$2] xelpfin subtitle line one

2
00:00:07,000 --> 00:00:14,000
[$2] second line, still purple
SRT
}

# 1. H.264/AAC MP4 with a sidecar English SRT: direct play everywhere.
d="$OUT/movies/Big Purple Test (2024)"; mkdir -p "$d"
if [ ! -f "$d/Big Purple Test (2024).mp4" ]; then
  ff -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=40" -f lavfi -i "sine=frequency=440:duration=40" \
     -vf "hue=h=260:s=1.4,$(label 'Big Purple Test' 64)" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 96k \
     -movflags +faststart "$d/Big Purple Test (2024).mp4"
  srt "$d/Big Purple Test (2024).en.srt" EN
fi

# 2. HEVC MKV, two audio tracks (AAC eng, AC3 ger), two embedded subtitle tracks.
d="$OUT/movies/Night Grid (2023)"; mkdir -p "$d"
if [ ! -f "$d/Night Grid (2023).mkv" ]; then
  srt /tmp/xelpfin-en.srt EN; srt /tmp/xelpfin-fr.srt FR
  ff -f lavfi -i "smptehdbars=size=1280x720:rate=25:duration=40" -f lavfi -i "sine=frequency=330:duration=40" \
     -f lavfi -i "sine=frequency=550:duration=40" -i /tmp/xelpfin-en.srt -i /tmp/xelpfin-fr.srt \
     -map 0:v -map 1:a -map 2:a -map 3 -map 4 -vf "$(label 'Night Grid' 64)" \
     -c:v libx265 -preset ultrafast -x265-params log-level=error -pix_fmt yuv420p -c:a:0 aac -b:a:0 96k -c:a:1 ac3 -b:a:1 192k -c:s srt \
     -metadata:s:a:0 language=eng -metadata:s:a:0 title="English Stereo" \
     -metadata:s:a:1 language=ger -metadata:s:a:1 title="Deutsch AC3" \
     -metadata:s:s:0 language=eng -metadata:s:s:1 language=fre \
     "$d/Night Grid (2023).mkv"
  rm -f /tmp/xelpfin-en.srt /tmp/xelpfin-fr.srt
fi

# 3. MS-MPEG4v3 in AVI: no Android decoder, so the server must transcode.
d="$OUT/movies/Old Codec (2001)"; mkdir -p "$d"
if [ ! -f "$d/Old Codec (2001).avi" ]; then
  ff -f lavfi -i "mandelbrot=size=640x360:rate=25" -f lavfi -i "sine=frequency=660:duration=30" -t 30 \
     -vf "$(label 'Old Codec' 40)" -c:v msmpeg4 -q:v 5 -c:a libmp3lame -b:a 96k "$d/Old Codec (2001).avi"
fi

# 4. A small TV show: one season, three H.264 episodes, plus a VP9 WebM special.
d="$OUT/shows/Test Show/Season 01"; mkdir -p "$d"
for e in 1 2 3; do
  f="$d/Test Show - S01E0$e - Episode $e.mkv"
  [ -f "$f" ] && continue
  ff -f lavfi -i "testsrc=size=960x540:rate=25:duration=25" -f lavfi -i "sine=frequency=$(( 300 + e * 100 )):duration=25" \
     -vf "hue=h=$(( 200 + e * 30 )),$(label "Test Show S01E0$e" 48)" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 96k "$f"
done
d="$OUT/shows/Test Show/Season 02"; mkdir -p "$d"
f="$d/Test Show - S02E01 - Season Two.webm"
if [ ! -f "$f" ]; then
  ff -f lavfi -i "rgbtestsrc=size=960x540:rate=25:duration=20" -f lavfi -i "sine=frequency=500:duration=20" \
     -vf "$(label 'Test Show S02E01' 48)" -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 800k -c:a libopus -b:a 64k "$f" 2>/dev/null \
  || ff -f lavfi -i "rgbtestsrc=size=960x540:rate=25:duration=20" -f lavfi -i "sine=frequency=500:duration=20" \
     -vf "$(label 'Test Show S02E01' 48)" -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 800k -c:a libvorbis "$f"
fi

python3 "$HERE/gen-posters.py" "$OUT"
echo "media ready in $OUT"
