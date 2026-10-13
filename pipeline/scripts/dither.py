#!/usr/bin/env python3
"""Retro dithered variant (gold/black/blue, ordered Bayer dither on a visible pixel grid).

usage: python3 -I scripts/dither.py IN.png OUT.png [--cell 3] [--width 2400]
Reads a clean (pre-grain) frame, maps it onto two short palettes - a gold ramp for lights and
architecture and a blue ramp for sky/voids - and dithers between neighbouring levels with an 8x8 Bayer
matrix at a coarse pixel size, then scales up with nearest-neighbour so the pixel grid stays crisp.
"""
import argparse
import numpy as np
from PIL import Image, ImageFilter

GOLD = np.array([[0, 0, 0], [38, 32, 12], [92, 76, 30], [160, 132, 58], [214, 186, 104], [246, 228, 160]], np.float32)
BLUE = np.array([[0, 0, 0], [22, 30, 54], [48, 66, 110], [92, 112, 156], [150, 168, 200]], np.float32)


def bayer(n):
    m = np.array([[0, 2], [3, 1]])
    while m.shape[0] < n:
        m = np.block([[4 * m, 4 * m + 2], [4 * m + 3, 4 * m + 1]])
    return (m + 0.5) / m.size


def ramp_dither(t, pal, thr):
    """t in [0,1] -> index along palette with ordered dithering"""
    x = t * (len(pal) - 1)
    lo = np.floor(x).astype(int); fr = x - lo
    idx = np.clip(lo + (fr > thr), 0, len(pal) - 1)
    return pal[idx]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('inp'); ap.add_argument('out')
    ap.add_argument('--cell', type=int, default=3); ap.add_argument('--width', type=int, default=2400)
    a = ap.parse_args()
    im = Image.open(a.inp).convert('RGB')
    W0, H0 = im.size
    w, h = a.width // a.cell, int(round(H0 * (a.width / W0))) // a.cell
    small = np.asarray(im.resize((w, h), Image.LANCZOS), np.float32) / 255
    R, G, B = small[..., 0], small[..., 1], small[..., 2]
    L = 0.2126 * R + 0.7152 * G + 0.0722 * B
    t = np.clip((np.maximum(L - 0.025, 0) / 0.62) ** 0.85, 0, 1)   # night stays mostly black; light reads gold
    sm = np.asarray(Image.fromarray((small * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6)), np.float32) / 255
    bl = sm[..., 2] - np.maximum(sm[..., 0], sm[..., 1])
    blue = (bl > 0.012) & (sm.mean(-1) < 0.09) & (L < 0.12)     # only the darkest blue: sky gap / deep voids
    thr = np.tile(bayer(8), (h // 8 + 1, w // 8 + 1))[:h, :w]
    out = np.where(blue[..., None], ramp_dither(np.clip(t * 0.9, 0, 1), BLUE, thr), ramp_dither(t, GOLD, thr))
    img = Image.fromarray(out.astype(np.uint8)).resize((w * a.cell, h * a.cell), Image.NEAREST)
    img.save(a.out)
    print('dither:', a.inp, '->', a.out, img.size)


if __name__ == '__main__':
    main()
