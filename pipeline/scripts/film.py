#!/usr/bin/env python3
"""Kodak Portra 400 night-shoot emulation + lab scan (Frontier/Noritsu-like).

usage: python3 -I scripts/film.py IN.png OUT.png [--seed N] [--grain 1.0] [--halation 1.0] [--exposure 0.0]

Pipeline (linear light unless noted):
  1. exposure (stops) and film MTF softness
  2. halation: bright sources get a soft halo that turns warm red-orange at its outer edge
     (light bouncing off the film base; Portra's anti-halation layer keeps it subtle) + gentle diffusion
  3. per-channel characteristic curve: long soft shoulder (neon cores roll to pastel instead of clipping),
     soft toe with a slight cyan-green lift typical of underexposed Portra scans
  4. colour: restrained saturation on the most saturated neons, warm creamy highlights, cool shadows
  5. scan: gentle midtone contrast, small-radius unsharp mask
  6. grain: clumpy multi-scale, density-dependent (strongest in shadows/midtones), mostly luminance with a
     little dye-cloud chroma; size scales with output resolution; deterministic with --seed
"""
import argparse
import numpy as np
import cv2
from PIL import Image


def s2l(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4).astype(np.float32)


def l2s(x):
    x = np.clip(x, 0, None)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055).astype(np.float32)


def blur(img, sigma):
    if sigma <= 0:
        return img
    return cv2.GaussianBlur(img, (0, 0), sigma, borderType=cv2.BORDER_REFLECT)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def luma(x):
    return 0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('inp'); ap.add_argument('out')
    ap.add_argument('--seed', type=int, default=400)
    ap.add_argument('--grain', type=float, default=1.0)
    ap.add_argument('--halation', type=float, default=1.0)
    ap.add_argument('--exposure', type=float, default=0.0, help='stops')
    ap.add_argument('--jpeg', default=None, help='also write a JPEG (quality 95) here')
    ap.add_argument('--look', default='portra', choices=['portra', 'cinematic'],
                    help='cinematic = desaturated teal-green night grade, lifted hazy blacks, heavier grain')
    a = ap.parse_args()

    img = np.asarray(Image.open(a.inp).convert('RGB'), np.float32) / 255.0
    H, W = img.shape[:2]
    k = W / 2400.0                                   # resolution scale (tuned at 2400x3600)
    lin = s2l(img) * (2.0 ** a.exposure)

    # 1. film / lens MTF: a touch of softness
    lin = blur(lin, 0.55 * k)

    # 2. halation + diffusion
    L = luma(lin)
    hot = np.clip(lin - 0.35, 0, None) * smoothstep(0.35, 1.2, L)[..., None]
    halo_in = blur(hot, 5 * k)
    halo_out = blur(hot, 16 * k)
    warm = np.array([1.0, 0.36, 0.12], np.float32)       # red-orange at the outer edge
    hal = (halo_in * 0.35 + (halo_out * warm) * 0.55) * a.halation
    diff = blur(lin, 9 * k) * 0.035 * a.halation
    lin = lin + hal + diff

    # 3. characteristic curve per channel (crossover: red shoulder slightly later -> warm highlights)
    shoulder = np.array([1.55, 1.40, 1.25], np.float32)
    y = lin / (1.0 + lin / shoulder)
    y = y * 1.06                                     # unit slope at the toe; slight overall density lift
    toe = np.array([0.0022, 0.0034, 0.0038], np.float32)
    y = y * (1 - toe) + toe * (1 - np.exp(-y / 0.02))  # soft toe with a slight cyan-green lift
    y = np.clip(y, 0, None)

    # 4. colour: tame the most saturated neons, warm highlights, cool shadows
    Ly = luma(y)[..., None]
    C = y - Ly
    sat = np.linalg.norm(C, axis=-1, keepdims=True) / (Ly + 0.02)
    y = Ly + C * (0.93 - 0.14 * smoothstep(0.6, 2.2, sat))
    h = smoothstep(0.08, 0.7, Ly)
    y = y * (1 + h * np.array([0.045, 0.012, -0.05], np.float32)) * (1 + (1 - h) * np.array([-0.02, 0.005, 0.03], np.float32))

    # 4b. cinematic grade (style references): near-monochrome, teal-green shadows, warm sodium highlights
    if a.look == 'cinematic':
        Ly = luma(y)[..., None]
        h = smoothstep(0.02, 0.6, Ly)
        satk = 0.42 + 0.3 * smoothstep(0.25, 1.0, Ly)        # keep a little more colour in bright neon cores
        y = Ly + (y - Ly) * satk
        y = y * (1 + (1 - h) * np.array([-0.16, 0.05, -0.02], np.float32)) * (1 + h * np.array([0.07, 0.015, -0.10], np.float32))

    # 5. scan: back to display, gentle midtone contrast, unsharp mask on luminance
    g = l2s(y)
    g = np.clip(g, 0, 1)
    if a.look == 'cinematic':
        lift = np.array([0.022, 0.031, 0.028], np.float32)      # blacks sit in green-grey haze
        g = lift + g * (1 - lift) * 0.97
        g = g + 0.10 * (g - 0.5) * (1 - np.abs(2 * g - 1))
    else:
        g = g + 0.06 * (g - 0.5) * (1 - np.abs(2 * g - 1))
    lum_s = luma(g)
    usm = lum_s - blur(lum_s, 1.3 * k)
    g = g + (0.45 * usm)[..., None]

    # 6. grain (sRGB domain): clumpy multi-scale, density dependent
    rng = np.random.default_rng(a.seed)
    def octave(sig, shape=(H, W)):
        n = rng.standard_normal(shape).astype(np.float32)
        n = blur(n, sig)
        return n / (n.std() + 1e-6)
    gl = 0.55 * octave(0.75 * k) + 0.35 * octave(1.5 * k) + 0.18 * octave(3.2 * k)
    gl /= gl.std()
    ls = np.clip(luma(np.clip(g, 0, 1)), 0, 1)
    amp = 0.006 + 0.019 * np.exp(-((ls - 0.22) / 0.26) ** 2) + 0.006 * (1 - ls)   # peaks in shadows/midtones
    amp *= a.grain * (1.3 if a.look == 'cinematic' else 1.0)
    chroma = np.stack([octave(1.6 * k) for _ in range(3)], -1)
    chroma -= chroma.mean(-1, keepdims=True)
    g = g + (gl * amp)[..., None] + chroma * (amp * 0.2)[..., None]

    out = (np.clip(g, 0, 1) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(out).save(a.out)
    if a.jpeg:
        Image.fromarray(out).save(a.jpeg, quality=95, subsampling=0)
    print('film:', a.inp, '->', a.out, f'{W}x{H}', f'grain {a.grain} halation {a.halation} exposure {a.exposure:+.2f}')


if __name__ == '__main__':
    main()
