"""Writes local poster.jpg / backdrop.jpg artwork next to the synthetic test media."""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = sys.argv[1]
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def card(size, title, hue_shift):
    w, h = size
    im = Image.new('RGB', size)
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=(int(40 + 100 * t + hue_shift) % 256, int(20 + 40 * t), int(90 + 150 * (1 - t))))
    size_px = max(18, w // 9)
    f = ImageFont.truetype(BOLD, size_px)
    words, lines, cur = title.split(), [], ''
    for word in words:
        trial = (cur + ' ' + word).strip()
        if d.textlength(trial, font=f) > w * 0.85 and cur:
            lines.append(cur)
            cur = word
        else:
            cur = trial
    lines.append(cur)
    y = h * 0.62
    for line in lines:
        d.text(((w - d.textlength(line, font=f)) / 2, y), line, font=f, fill=(255, 255, 255))
        y += size_px * 1.2
    return im


items = [
    ('movies/Big Purple Test (2024)', 'Big Purple Test', 0),
    ('movies/Night Grid (2023)', 'Night Grid', 60),
    ('movies/Old Codec (2001)', 'Old Codec', 120),
    ('movies/Pixel Subs (2022)', 'Pixel Subs', 180),
    ('movies/Burned Pixels (2020)', 'Burned Pixels', 210),
    ('shows/Test Show', 'Test Show', 30),
]
for rel, title, shift in items:
    d = os.path.join(ROOT, rel)
    if not os.path.isdir(d):
        continue
    card((400, 600), title, shift).save(os.path.join(d, 'poster.jpg'), quality=88)
    card((1280, 720), title, shift + 20).save(os.path.join(d, 'backdrop.jpg'), quality=85)
