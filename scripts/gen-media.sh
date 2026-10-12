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

srt() { # srt <file> <lang-word>: one cue every 4 seconds for the whole 40 s clip
  local i n=1
  : > "$1"
  for i in $(seq 1 4 37); do
    printf '%d\n00:00:%02d,000 --> 00:00:%02d,500\n[%s] xelpfin subtitle line %d\n\n' "$n" "$i" $((i + 3)) "$2" "$n" >> "$1"
    n=$((n + 1))
  done
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

# 5. H.264 MKV with bitmap (PGS) and styled ASS subtitles: the player renders PGS itself on
#    direct play; the ASS track is converted to WebVTT by the server and cleaned up by the app.
d="$OUT/movies/Pixel Subs (2022)"; mkdir -p "$d"
if [ ! -f "$d/Pixel Subs (2022).mkv" ]; then
  tmp=$(mktemp -d)
  python3 "$HERE/make-pgs.py" "$tmp/pgs.sup" 1280 720 40 PGS
  cat > "$tmp/styled.ass" <<'ASS'
[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,40,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
ASS
  for i in $(seq 1 4 37); do
    printf 'Dialogue: 0,0:00:%02d.00,0:00:%02d.50,Default,,0,0,0,,{\\an2}{\\b1}[ASS]{\\b0} styled {\\c&H00FFFF&}line{\\r} %d\\Nsecond\\hrow\n' "$i" $((i + 3)) $(( (i + 3) / 4 )) >> "$tmp/styled.ass"
  done
  ff -f lavfi -i "testsrc2=size=1280x720:rate=25:duration=40" -f lavfi -i "sine=frequency=380:duration=40" \
     -i "$tmp/pgs.sup" -i "$tmp/styled.ass" -map 0:v -map 1:a -map 2 -map 3 \
     -vf "hue=h=120,$(label 'Pixel Subs' 64)" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 96k -c:s copy \
     -metadata:s:a:0 language=eng -metadata:s:s:0 language=eng -metadata:s:s:0 title="PGS bitmap" \
     -metadata:s:s:1 language=eng -metadata:s:s:1 title="Styled ASS" "$d/Pixel Subs (2022).mkv"
  rm -rf "$tmp"
fi

# 6. MS-MPEG4v3 in MKV with a VOBSUB (DVD bitmap) track: the server has to transcode, so a
#    selected bitmap subtitle has to be burned into the picture.
d="$OUT/movies/Burned Pixels (2020)"; mkdir -p "$d"
if [ ! -f "$d/Burned Pixels (2020).mkv" ]; then
  tmp=$(mktemp -d)
  python3 "$HERE/make-pgs.py" "$tmp/pgs.sup" 640 360 30 VOBSUB
  ff -f lavfi -i "mandelbrot=size=640x360:rate=25" -f lavfi -i "sine=frequency=720:duration=30" -i "$tmp/pgs.sup" -t 30 \
     -map 0:v -map 1:a -map 2 -vf "$(label 'Burned Pixels' 40)" -c:v msmpeg4 -q:v 5 -c:a libmp3lame -b:a 96k -c:s dvdsub \
     -metadata:s:s:0 language=eng -metadata:s:s:0 title="VOBSUB bitmap" "$d/Burned Pixels (2020).mkv"
  rm -rf "$tmp"
fi

# 7. A 2000-title library for list performance (one tiny clip and a few posters, hard-linked),
#    and an empty library. Both are only visible to the "bulk" test user.
if [ ! -d "$OUT/bulk/Bulk Title 2000 (1999)" ]; then
  tmp="$OUT/.bulk-src"; mkdir -p "$tmp" "$OUT/bulk"
  ff -f lavfi -i "color=c=0x6b3fa0:size=320x180:rate=10:duration=2" -f lavfi -i "sine=frequency=440:duration=2" \
     -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 32k "$tmp/clip.mp4"
  python3 - "$tmp" <<'PY'
import sys
from PIL import Image, ImageDraw, ImageFont
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 64)
for n in range(12):
    img = Image.new('RGB', (400, 600), (40 + n * 15, 20, 90 + n * 12))
    ImageDraw.Draw(img).text((200, 300), f'B{n:02d}', fill='white', font=font, anchor='mm')
    img.save(f'{sys.argv[1]}/poster{n}.jpg', quality=80)
PY
  for i in $(seq 1 2000); do
    name=$(printf 'Bulk Title %04d' "$i"); year=$(( 1970 + i % 30 ))
    b="$OUT/bulk/$name ($year)"; mkdir -p "$b"
    ln -f "$tmp/clip.mp4" "$b/$name ($year).mp4"
    ln -f "$tmp/poster$(( i % 12 )).jpg" "$b/poster.jpg"
  done
fi
mkdir -p "$OUT/empty"

# NFO files give deterministic titles and plots without any internet metadata lookups.
nfo_movie() { # nfo_movie <dir> <title> <year> <plot>
  printf '<?xml version="1.0" encoding="utf-8"?>\n<movie><title>%s</title><year>%s</year><plot>%s</plot><genre>Test</genre></movie>\n' "$2" "$3" "$4" > "$1/movie.nfo"
}
nfo_movie "$OUT/movies/Big Purple Test (2024)" "Big Purple Test" 2024 "An H.264 and AAC MP4 with a sidecar English subtitle. Direct plays everywhere."
nfo_movie "$OUT/movies/Night Grid (2023)" "Night Grid" 2023 "HEVC in Matroska with English AAC and German AC3 audio and two embedded subtitle tracks."
nfo_movie "$OUT/movies/Old Codec (2001)" "Old Codec" 2001 "MS-MPEG4v3 video in AVI. No Android decoder exists, so the server has to transcode."
nfo_movie "$OUT/movies/Pixel Subs (2022)" "Pixel Subs" 2022 "H.264 in Matroska with a PGS bitmap subtitle and a styled ASS subtitle."
nfo_movie "$OUT/movies/Burned Pixels (2020)" "Burned Pixels" 2020 "MS-MPEG4v3 in Matroska with a VOBSUB bitmap subtitle that has to be burned in while transcoding."
printf '<?xml version="1.0" encoding="utf-8"?>\n<tvshow><title>Test Show</title><year>2024</year><plot>A synthetic two-season show for testing seasons, episodes and next up.</plot><genre>Test</genre></tvshow>\n' \
  > "$OUT/shows/Test Show/tvshow.nfo"
nfo_ep() { # nfo_ep <media-file> <season> <episode> <title>
  printf '<?xml version="1.0" encoding="utf-8"?>\n<episodedetails><title>%s</title><season>%s</season><episode>%s</episode><plot>Synthetic episode %s of season %s.</plot></episodedetails>\n' \
    "$4" "$2" "$3" "$3" "$2" > "${1%.*}.nfo"
}
for e in 1 2 3; do nfo_ep "$OUT/shows/Test Show/Season 01/Test Show - S01E0$e - Episode $e.mkv" 1 $e "Episode $e"; done
nfo_ep "$OUT/shows/Test Show/Season 02/Test Show - S02E01 - Season Two.webm" 2 1 "Season Two"

python3 "$HERE/gen-posters.py" "$OUT"
echo "media ready in $OUT"
