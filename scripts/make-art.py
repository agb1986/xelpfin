"""Generate xelpfin launcher icons and the TV banner (white x / wordmark on purple).

Run: python3 scripts/make-art.py   (needs Pillow). Output goes into android/app/src/main/res.
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'android', 'app', 'src', 'main', 'res')
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
PURPLE = (0x8E, 0x5C, 0xF7, 255)
DEEP = (0x5B, 0x34, 0xC4, 255)
WHITE = (255, 255, 255, 255)


def text_on(im, txt, color, frac):
    d = ImageDraw.Draw(im)
    w, h = im.size
    size = h
    while True:
        f = ImageFont.truetype(BOLD, size)
        b = d.textbbox((0, 0), txt, font=f)
        if (b[2] - b[0]) <= w * frac and (b[3] - b[1]) <= h * frac:
            break
        size -= 2
    tw, th = b[2] - b[0], b[3] - b[1]
    d.text(((w - tw) / 2 - b[0], (h - th) / 2 - b[1]), txt, font=f, fill=color)
    return im


def icon(px, circle):
    s = 4
    big = Image.new('RGBA', (px * s, px * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    if circle:
        d.ellipse((0, 0, px * s - 1, px * s - 1), fill=PURPLE)
    else:
        d.rounded_rectangle((0, 0, px * s - 1, px * s - 1), radius=int(px * s * 0.22), fill=PURPLE)
    text_on(big, 'x', WHITE, 0.62)
    return big.resize((px, px), Image.LANCZOS)


for dn, k in {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}.items():
    d = os.path.join(RES, 'mipmap-' + dn)
    os.makedirs(d, exist_ok=True)
    icon(int(48 * k), False).save(os.path.join(d, 'ic_launcher.png'))
    icon(int(48 * k), True).save(os.path.join(d, 'ic_launcher_round.png'))

banner = Image.new('RGBA', (320, 180), DEEP)
text_on(banner, 'xelpfin', WHITE, 0.6)
banner.convert('RGB').save(os.path.join(RES, 'drawable', 'tv_banner.png'))
print('art written to', os.path.normpath(RES))
