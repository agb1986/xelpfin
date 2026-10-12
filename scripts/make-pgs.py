#!/usr/bin/env python3
"""Writes a Blu-ray PGS (.sup) bitmap subtitle stream for the synthetic test media.

  make-pgs.py OUT.sup WIDTH HEIGHT DURATION_S LABEL

ffmpeg cannot turn text into bitmap subtitles, so this renders one cue every 4 seconds
("[LABEL] bitmap subtitle N", white on a dark box) with Pillow and encodes it by hand:
each cue is a display set (PCS, WDS, PDS, ODS, END) followed by a clearing display set.
"""
import struct
import sys

from PIL import Image, ImageDraw, ImageFont

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def segment(kind: int, pts_ms: int, payload: bytes) -> bytes:
    pts = pts_ms * 90
    return b'PG' + struct.pack('>IIBH', pts, 0, kind, len(payload)) + payload


def rle(img: Image.Image) -> bytes:
    """PGS run-length encoding of a palettised image, line by line."""
    w, h = img.size
    px = img.load()
    out = bytearray()
    for y in range(h):
        x = 0
        while x < w:
            c = px[x, y]
            n = 1
            while x + n < w and px[x + n, y] == c and n < 16383:
                n += 1
            if c != 0 and n < 3:
                out += bytes([c]) * n
            elif c == 0:
                out += bytes([0, n]) if n < 64 else bytes([0, 0x40 | (n >> 8), n & 0xFF])
            else:
                out += bytes([0, 0x80 | n, c]) if n < 64 else bytes([0, 0xC0 | (n >> 8), n & 0xFF, c])
            x += n
        out += b'\x00\x00'
    return bytes(out)


def cue_image(text: str, size: int) -> Image.Image:
    font = ImageFont.truetype(FONT, size)
    l, t, r, b = font.getbbox(text)
    w, h = r - l + 40, b - t + 24  # widths stay well inside the frame at height // 18
    img = Image.new('P', (w, h), 2)  # 2 = dark box
    ImageDraw.Draw(img).text((20 - l, 12 - t), text, fill=1, font=font)  # 1 = white
    return img


def display_set(pts_ms: int, number: int, width: int, height: int, img: Image.Image | None) -> bytes:
    if img is None:  # clear the screen
        pcs = struct.pack('>HHBHBBBB', width, height, 0x10, number, 0x00, 0, 0, 0)
        wds = struct.pack('>BBHHHH', 1, 0, 0, 0, 1, 1)
        return segment(0x16, pts_ms, pcs) + segment(0x17, pts_ms, wds) + segment(0x80, pts_ms, b'')
    w, h = img.size
    x, y = (width - w) // 2, height - h - height // 12
    pcs = struct.pack('>HHBHBBBB', width, height, 0x10, number, 0x80, 0, 0, 1) + struct.pack('>HBBHH', 0, 0, 0, x, y)
    wds = struct.pack('>BBHHHH', 1, 0, x, y, w, h)
    # Palette entries: id, Y, Cr, Cb, alpha. 0 transparent, 1 white, 2 near-black box.
    pds = struct.pack('>BB', 0, 0) + bytes([0, 16, 128, 128, 0, 1, 235, 128, 128, 255, 2, 16, 128, 128, 200])
    data = rle(img)
    ods = struct.pack('>HBB', 0, 0, 0xC0) + (len(data) + 4).to_bytes(3, 'big') + struct.pack('>HH', w, h) + data
    return segment(0x16, pts_ms, pcs) + segment(0x17, pts_ms, wds) + segment(0x14, pts_ms, pds) + segment(0x15, pts_ms, ods) + segment(0x80, pts_ms, b'')


def main() -> None:
    out, width, height, duration, label = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
    data = bytearray()
    number = 0
    for n, start in enumerate(range(1, duration - 2, 4), 1):
        data += display_set(start * 1000, number, width, height, cue_image(f'[{label}] bitmap subtitle {n}', max(16, height // 18)))
        data += display_set(start * 1000 + 3500, number + 1, width, height, None)
        number += 2
    with open(out, 'wb') as f:
        f.write(data)


if __name__ == '__main__':
    main()
