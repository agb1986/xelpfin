#!/usr/bin/env python3
"""Checks a screenshot for subtitle-like pixels in the lower part of the screen.

  pixels.py FILE dark            exit 0 if the bottom band has a dark subtitle box
  pixels.py FILE colour R G B    exit 0 if the bottom band has text of roughly that colour
  pixels.py FILE stats           print the fraction of dark / white / yellow pixels

Any of these takes --box X1,Y1,X2,Y2 (say, the bounds of the subtitle view from ui.py bounds)
to look only inside that rectangle instead of the default band.

The band is the middle half of the screen width between 70 % and 97 % of the height, where
both the app's own subtitle view and bitmap subtitles drawn by the player end up.
"""
import sys

from PIL import Image


def band(path: str, box=None):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    crop = im.crop(box or (w // 6, int(h * 0.70), 5 * w // 6, int(h * 0.97)))
    b = crop.tobytes()
    return [tuple(b[i:i + 3]) for i in range(0, len(b), 3)]


def share(px, test) -> float:
    return sum(1 for p in px if test(*p)) / max(1, len(px))


def dark(r, g, b):
    return r + g + b < 120


def near(c):
    return lambda r, g, b: abs(r - c[0]) < 60 and abs(g - c[1]) < 60 and abs(b - c[2]) < 60


def main() -> int:
    args = sys.argv[1:]
    box = None
    if '--box' in args:
        at = args.index('--box')
        box = tuple(int(v) for v in args[at + 1].split(','))
        del args[at:at + 2]
    path, kind = args[0], args[1]
    px = band(path, box)
    if kind == 'dark':
        return 0 if share(px, dark) > 0.02 else 1
    if kind == 'colour':
        c = tuple(int(v) for v in args[2:5])
        return 0 if share(px, near(c)) > 0.003 else 1
    if kind == 'stats':
        print(f'dark {share(px, dark):.3f} white {share(px, near((255, 255, 255))):.3f} yellow {share(px, near((255, 230, 0))):.3f}')
        return 0
    return 2


sys.exit(main())
