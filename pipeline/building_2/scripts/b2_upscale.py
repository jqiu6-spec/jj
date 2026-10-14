#!/usr/bin/env python3
"""Super-resolve the building-2 photo: scene/photo_native.png (1055x1491) -> scene/base_sr.png (2910x4112).

usage (needs opencv-contrib for cv2.dnn_superres, i.e. the venv; run from the b2 root):
  ../venv_sr/bin/python -I scripts/b2_upscale.py [--model edsr|espcn] [--tile 128] [--overlap 16]
         [--lum-only] [--clamp 0.03] [--detail 0.0] [--raw RAW_x3.png | --from-raw RAW_x3.png]
         [--in scene/photo_native.png] [--out scene/base_sr.png]
  timing on this 4-vCPU box: EDSR x3 ~0.4-0.5 ms per LR px -> 108 tiles, ~1360 s (22.6 min, with other
  jobs running); ESPCN x3 ~7 s.  --lum-only does not save time (the networks always take 3 channels).
  --raw saves the network output so that --from-raw can redo steps 2-3 in seconds.

  1. cv2.dnn_superres x3 (EDSR by default, ESPCN as the fast fallback) in overlapping tiles; every tile is
     run with `overlap` px of real context on each interior side and the tiles are blended with linear
     feathers across the overlap, so there are no seams.  --lum-only runs the network on a grey (Y) image
     and puts the photo's Lanczos chroma back (YCrCb) - same cost per pixel, no colour fringes.
  2. resize the x3 result (3165x4473) to exactly 2910x4112 with Lanczos (ratio 0.919 - a mild downsample,
     which also hides any residual network texture at the pixel level).
  3. guard against SR artefacts: per pixel, the SR result is limited to the local min/max envelope of the
     Lanczos upscale widened by `--clamp` (kills halo overshoot/ringing around lit windows), and an
     optional `--detail` adds a little extra high frequency (0 = off).
"""
import argparse, os, time
import numpy as np, cv2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument('--in', dest='inp', default=os.path.join(ROOT, 'scene', 'photo_native.png'))
ap.add_argument('--out', default=os.path.join(ROOT, 'scene', 'base_sr.png'))
ap.add_argument('--model', default='edsr', choices=['edsr', 'espcn'])
ap.add_argument('--models', default=os.path.join(ROOT, 'models'))
ap.add_argument('--tile', type=int, default=128, help='LR tile size (core, without overlap)')
ap.add_argument('--overlap', type=int, default=16, help='LR px of context on each interior side (feather = overlap)')
ap.add_argument('--lum-only', action='store_true', help='run SR on luminance only, chroma from Lanczos')
ap.add_argument('--size', default='2910x4112')
ap.add_argument('--clamp', type=float, default=0.03, help='allowed overshoot beyond the local Lanczos envelope (0..1, -1 = off)')
ap.add_argument('--detail', type=float, default=0.0, help='extra high-frequency gain on the SR result (e.g. 0.15)')
ap.add_argument('--threads', type=int, default=0)
ap.add_argument('--crop', default=None, help='x,y,w,h on the LR image: process only this window (benchmark)')
ap.add_argument('--raw', default=None, help='also save the raw x3 network output here')
ap.add_argument('--from-raw', default=None, help='skip the network: load a raw x3 output saved with --raw')
a = ap.parse_args()

if a.threads: cv2.setNumThreads(a.threads)
OW, OH = map(int, a.size.lower().split('x'))
img = cv2.imread(a.inp, cv2.IMREAD_COLOR)                    # BGR uint8, what dnn_superres expects
if a.crop:
    cx, cy, cw, ch = map(int, a.crop.split(','))
    img = img[cy:cy + ch, cx:cx + cw].copy()
    OW, OH = int(round(cw * OW / 1055)), int(round(ch * OH / 1491))
h, w = img.shape[:2]
S = 3
sr = cv2.dnn_superres.DnnSuperResImpl_create()
sr.readModel(os.path.join(a.models, {'edsr': 'EDSR_x3.pb', 'espcn': 'ESPCN_x3.pb'}[a.model]))
sr.setModel(a.model, S)

if a.lum_only:
    ycc = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
    src = cv2.cvtColor(ycc[..., 0], cv2.COLOR_GRAY2BGR)
else:
    src = img


def ramp(lo, hi, n_out, full_lo, full_hi, O):
    """feather weights along one axis of a tile: linear ramp over O LR px centred on the core edge (the
    outer O/2 px of context, where the network sees the zero padding, get weight 0); flat 1 at image borders"""
    r = np.ones(n_out)
    p = (np.arange(n_out) + 0.5) / S + lo                      # LR coordinate of each HR sample
    if not full_lo: r = np.minimum(r, np.clip((p - lo - O / 2) / O, 0, 1))
    if not full_hi: r = np.minimum(r, np.clip((hi - p - O / 2) / O, 0, 1))
    return np.maximum(r, 1e-4)


def run_tiles(sr, src, T, O, t0):
    h, w = src.shape[:2]
    acc = np.zeros((h * S, w * S, 3), np.float64)
    wacc = np.zeros((h * S, w * S, 1), np.float64)
    xs, ys = list(range(0, w, T)), list(range(0, h, T))
    n = len(xs) * len(ys); k = 0
    for ty in ys:
        for tx in xs:
            x0, y0 = max(0, tx - O), max(0, ty - O)
            x1, y1 = min(w, tx + T + O), min(h, ty + T + O)
            out = sr.upsample(src[y0:y1, x0:x1]).astype(np.float64)
            wt = (ramp(y0, y1, out.shape[0], y0 == 0, y1 == h, O)[:, None]
                  * ramp(x0, x1, out.shape[1], x0 == 0, x1 == w, O)[None, :])[..., None]
            acc[y0 * S:y1 * S, x0 * S:x1 * S] += out * wt
            wacc[y0 * S:y1 * S, x0 * S:x1 * S] += wt
            k += 1
            if k == 1 or k % 10 == 0 or k == n:
                el = time.time() - t0
                print(f'  tile {k}/{n}  {el:.0f}s elapsed, ~{el / k * (n - k):.0f}s left', flush=True)
    return (acc / wacc).astype(np.float32), n                   # BGR, 0..255, x3


T, O = a.tile, a.overlap
t0 = time.time()
if a.from_raw:
    hr = cv2.imread(a.from_raw, cv2.IMREAD_COLOR).astype(np.float32); n = 0
    assert hr.shape[:2] == (h * S, w * S), hr.shape
else:
    hr, n = run_tiles(sr, src, T, O, t0)
t_sr = time.time() - t0
if a.raw:
    cv2.imwrite(a.raw, np.clip(hr + .5, 0, 255).astype(np.uint8))

if a.lum_only:
    up_ycc = cv2.resize(ycc, (w * S, h * S), interpolation=cv2.INTER_LANCZOS4).astype(np.float32)
    up_ycc[..., 0] = hr.mean(-1)
    # float YCrCb in OpenCV is 0..1 with a chroma offset of 0.5 (not 128): convert in that range
    hr = cv2.cvtColor(np.clip(up_ycc / 255, 0, 1).astype(np.float32), cv2.COLOR_YCrCb2BGR) * 255

# to the page canvas size, Lanczos
res = cv2.resize(hr, (OW, OH), interpolation=cv2.INTER_LANCZOS4)
lz = cv2.resize(img.astype(np.float32), (OW, OH), interpolation=cv2.INTER_LANCZOS4)

if a.clamp >= 0:
    # clamp to the local envelope of the source (3x3 LR neighbourhood ~ 7x7 HR px), with a small margin
    ker = np.ones((7, 7), np.uint8)
    up_nn = cv2.resize(img.astype(np.float32), (OW, OH), interpolation=cv2.INTER_LINEAR)
    lo = cv2.erode(np.minimum(up_nn, lz), ker); hi = cv2.dilate(np.maximum(up_nn, lz), ker)
    m = a.clamp * 255
    res = np.clip(res, lo - m, hi + m)
if a.detail:
    hp = res - cv2.GaussianBlur(res, (0, 0), 1.2)
    res = res + a.detail * hp

cv2.imwrite(a.out, np.clip(res + .5, 0, 255).astype(np.uint8))
print(f'upscale: {a.model}{" (Y only)" if a.lum_only else ""} x3 tiles {T}+{O} on {w}x{h}: {n} tiles, '
      f'SR {t_sr:.1f}s, total {time.time() - t0:.1f}s -> {a.out} {OW}x{OH}')
