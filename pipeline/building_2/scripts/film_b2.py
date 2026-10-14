#!/usr/bin/env python3
"""Kodak Portra 400 night-shoot emulation + lab scan (Frontier/Noritsu-like).

usage: python3 -I scripts/film.py IN.png OUT.png [--seed N] [--grain 1.0] [--halation 1.0] [--exposure 0.0]
          [--look portra|cinematic] [--mtf 0.12] [--halo-size 0.75] [--diffusion 0.006] [--sharpen 1.0]
          [--clarity 0.35] [--grain-size 0.8] [--grain-shadow 0.55] [--legacy]
  --legacy reproduces the pre-clarity version exactly (MTF 0.25, full halation spread, 1.2% diffusion,
  single-radius USM, coarser/heavier shadow grain).

Pipeline (linear light unless noted):
  1. exposure (stops) and film MTF softness
  2. halation: bright sources get a soft halo that turns warm red-orange at its outer edge
     (light bouncing off the film base; Portra's anti-halation layer keeps it subtle) + gentle diffusion
  3. per-channel characteristic curve: long soft shoulder (neon cores roll to pastel instead of clipping),
     soft toe with a slight cyan-green lift typical of underexposed Portra scans
  4. colour: restrained saturation on the most saturated neons, warm creamy highlights, cool shadows
  5. scan: gentle midtone contrast; capture sharpening on luminance at two radii (fine + medium) with
     noise coring, highlight protection and overshoot limiting (no halos round neon), then an edge-aware
     (guided-filter) clarity boost in the shadows/midtones
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


def guided(I, r, eps):
    """self-guided filter (He et al.): edge-preserving smooth base of a single-channel image"""
    box = lambda x: cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1), borderType=cv2.BORDER_REFLECT)
    m = box(I); v = box(I * I) - m * m
    A = v / (v + eps); B = m - A * m
    return box(A) * I + box(B)


def sharpen(ls, k, amount):
    """two-radius luminance capture sharpening with coring, highlight protection and overshoot limit"""
    d1 = ls - blur(ls, 0.55 * k)                      # fine: edges of windows, railings, letter strokes
    d2 = ls - blur(ls, 1.5 * k)                       # medium: acutance of larger structures
    u = 0.85 * d1 + 0.45 * d2
    t = 0.0035                                        # coring: leave flat noise / JPEG mush alone
    u = u * (u * u / (u * u + t * t))
    u *= 1 - 0.75 * smoothstep(0.62, 0.95, ls)        # protect bright neon / highlights
    sh = ls + amount * u
    ker = np.ones((3, 3), np.uint8)                   # limit over/undershoot to a small margin: no halos
    mx, mn = cv2.dilate(ls, ker), cv2.erode(ls, ker)
    m = 0.018
    sh = np.minimum(sh, mx + m + 0.25 * np.maximum(sh - mx - m, 0))
    sh = np.maximum(sh, mn - m - 0.25 * np.maximum(mn - m - sh, 0))
    return sh - ls


def clarity(ls, k, amount):
    """local contrast vs an edge-aware base, strongest in the shadows/midtones, off in highlights"""
    base = guided(ls, max(2, int(round(12 * k))), 0.03 ** 2)
    d = ls - base
    w = smoothstep(0.03, 0.14, ls) * (1 - smoothstep(0.5, 0.85, ls))
    return amount * np.clip(d, -0.08, 0.08) * w


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
    ap.add_argument('--mtf', type=float, default=0.12, help='film/lens MTF blur sigma (px at 2400 wide); legacy 0.25')
    ap.add_argument('--halo-size', type=float, default=0.75, help='halation radius scale; legacy 1.0')
    ap.add_argument('--diffusion', type=float, default=0.006, help='diffusion veil weight; legacy 0.012')
    ap.add_argument('--sharpen', type=float, default=1.0, help='two-radius capture sharpening amount')
    ap.add_argument('--clarity', type=float, default=0.35, help='edge-aware local contrast in shadows/mids')
    ap.add_argument('--grain-size', type=float, default=0.8, help='grain size scale; legacy 1.0')
    ap.add_argument('--grain-shadow', type=float, default=0.55, help='grain strength in the shadows; legacy 1.0')
    ap.add_argument('--legacy', action='store_true', help='pre-clarity behaviour (overrides the flags above)')
    a = ap.parse_args()
    if a.legacy:
        a.mtf, a.halo_size, a.diffusion, a.grain_size, a.grain_shadow = 0.25, 1.0, 0.012, 1.0, 1.0

    img = np.asarray(Image.open(a.inp).convert('RGB'), np.float32) / 255.0
    H, W = img.shape[:2]
    k = W / 2400.0                                   # resolution scale (tuned at 2400x3600)
    lin = s2l(img) * (2.0 ** a.exposure)

    # 1. film / lens MTF: a touch of softness
    lin = blur(lin, a.mtf * k)

    # 2. halation + diffusion
    L = luma(lin)
    hot = np.clip(lin - 0.35, 0, None) * smoothstep(0.35, 1.2, L)[..., None]
    halo_in = blur(hot, 5 * k * a.halo_size)
    halo_out = blur(hot, 16 * k * a.halo_size)
    warm = np.array([1.0, 0.36, 0.12], np.float32)       # red-orange at the outer edge
    hal = (halo_in * 0.35 + (halo_out * warm) * 0.55) * a.halation
    diff = blur(lin, 9 * k) * a.diffusion * a.halation
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
        satk = 0.62 + 0.22 * smoothstep(0.25, 1.0, Ly)        # keep a little more colour in bright neon cores
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
    if a.legacy:
        usm = lum_s - blur(lum_s, 1.1 * k)
        g = g + (0.75 * usm)[..., None]
    else:
        d = np.zeros_like(lum_s)
        if a.sharpen: d += sharpen(lum_s, k, a.sharpen)
        if a.clarity: d += clarity(lum_s + d, k, a.clarity)
        g = g + d[..., None]

    # 6. grain (sRGB domain): clumpy multi-scale, density dependent
    rng = np.random.default_rng(a.seed)
    def octave(sig, shape=(H, W)):
        n = rng.standard_normal(shape).astype(np.float32)
        n = blur(n, sig)
        return n / (n.std() + 1e-6)
    gs = a.grain_size
    gl = 0.7 * octave(0.6 * k * gs) + 0.3 * octave(1.2 * k * gs) + 0.08 * gs * octave(2.6 * k * gs)
    gl /= gl.std()
    ls = np.clip(luma(np.clip(g, 0, 1)), 0, 1)
    if a.legacy:
        amp = 0.006 + 0.019 * np.exp(-((ls - 0.22) / 0.26) ** 2) + 0.006 * (1 - ls)   # peaks in shadows/midtones
    else:
        # same midtone grain, less in the deep shadows (where it read as noise over the dark concrete)
        sh = a.grain_shadow + (1 - a.grain_shadow) * smoothstep(0.08, 0.32, ls)
        amp = (0.006 + 0.019 * np.exp(-((ls - 0.24) / 0.26) ** 2)) * sh + 0.006 * a.grain_shadow * (1 - ls)
    amp *= a.grain * (0.85 if a.look == 'cinematic' else 0.8)
    chroma = np.stack([octave(1.6 * k * gs) for _ in range(3)], -1)
    chroma -= chroma.mean(-1, keepdims=True)
    g = g + (gl * amp)[..., None] + chroma * (amp * 0.2)[..., None]

    out = (np.clip(g, 0, 1) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(out).save(a.out)
    if a.jpeg:
        Image.fromarray(out).save(a.jpeg, quality=95, subsampling=0)
    print('film:', a.inp, '->', a.out, f'{W}x{H}', f'grain {a.grain} halation {a.halation} exposure {a.exposure:+.2f}',
          'legacy' if a.legacy else f'mtf {a.mtf} halo {a.halo_size} diff {a.diffusion} sharpen {a.sharpen} '
          f'clarity {a.clarity} grain-size {a.grain_size} grain-shadow {a.grain_shadow}')


if __name__ == '__main__':
    main()
