#!/usr/bin/env python3
"""Atmosphere + fine detail for building 2 (between composite and lens).

usage: python3 -I scripts/b2_atmos.py IN_2x.png OUT_2x.png [--fog 1.0] [--seed 7] [--base scene/base_sr.png]
         [--texture 0.9] [--texture-mode envelope|guided|gauss] [--texture-margin 0.012] [--haze-pow 2.6]
         [--haze-floor 0.006] [--sharp 0.6] [--legacy]
  0. (--base) detail transplant: the scene was built on --base-ref (scene/base.png, Lanczos upscale); the
     high-frequency difference (base - base_ref) of a better upscale (e.g. EDSR scene/base_sr.png) is added
     to the photographed parts, scaled by the local relight gain (off the signs).  A no-op when the scene
     was already built on that base.
  1. fine surface texture: local-contrast recovery on the photographed concrete (not on the signs); the
     default 'envelope' mode is the legacy band-pass boost limited to the local 5x5 min/max (+-margin), so
     window frames / railings stay crisp but lit windows get no dark rings ('guided' = edge-aware, texture
     only, noticeably softer edges; 'gauss' = legacy with the rings)
     The flying vehicles are placed using the legacy-textured input, so these options never move them.
  2. distant megacity beyond the ring's rim: hazy tower silhouettes with floors of lit window strips (sky only)
  3. flying vehicles circling inside the well on the ring's own ellipses, with running lights and faint trails
  4. two searchlight beams sweeping the sky above the rim
  5. layered, textured haze that thickens with depth into the well and is lit by the signs around it;
     density ~ floor + 0.16 * depth^haze_pow: same haze at the bottom of the well, less veiling of the
     mid-depth walls (legacy: floor 0.01, pow 1.8)
  --legacy reproduces the pre-clarity output exactly.
"""
import argparse, json, os, numpy as np, cv2
from PIL import Image

def s2l(x): return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4).astype(np.float32)
def l2s(x):
    x = np.clip(x, 0, None); return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055).astype(np.float32)
def blur(a, s): return cv2.GaussianBlur(a, (0, 0), s, borderType=cv2.BORDER_REFLECT) if s > 0 else a
def lum(x): return 0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]
def fbm(h, w, rng, scales=(512, 256, 128, 64), amps=(1, .55, .3, .16)):
    n = np.zeros((h, w), np.float32)
    for sc, a in zip(scales, amps):
        g = rng.standard_normal((h // sc + 3, w // sc + 3)).astype(np.float32)
        n += a * cv2.resize(g, (w + 3 * sc, h + 3 * sc), interpolation=cv2.INTER_CUBIC)[:h, :w]
    return (n - n.mean()) / (n.std() + 1e-6)

def guided(I, r, eps):
    box = lambda x: cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1), borderType=cv2.BORDER_REFLECT)
    m = box(I); v = box(I * I) - m * m
    A = v / (v + eps); B = m - A * m
    return box(A) * I + box(B)

ap = argparse.ArgumentParser(); ap.add_argument('inp'); ap.add_argument('out')
ap.add_argument('--fog', type=float, default=1.0); ap.add_argument('--seed', type=int, default=7)
ap.add_argument('--base', default=None, help='better-upscaled photo to take fine detail from (e.g. scene/base_sr.png)')
ap.add_argument('--base-ref', default='scene/base.png', help='the photo the input scene was built on')
ap.add_argument('--base-amt', type=float, default=1.0, help='strength of the --base detail transplant')
ap.add_argument('--texture', type=float, default=0.9, help='local-contrast recovery on the photo')
ap.add_argument('--texture-mode', default='envelope', choices=['envelope', 'guided', 'gauss'],
                help='envelope: legacy band-pass boost with halo limiting (default); guided: edge-aware, texture only '
                     '(softer edges); gauss: legacy (dark rings round lit windows)')
ap.add_argument('--texture-margin', type=float, default=0.012, help='envelope mode: allowed overshoot (sRGB)')
ap.add_argument('--haze-pow', type=float, default=2.6, help='depth exponent of the haze density (legacy 1.8)')
ap.add_argument('--haze-floor', type=float, default=0.006, help='haze density everywhere (legacy 0.01)')
ap.add_argument('--sharp', type=float, default=0.6, help='final small-radius luminance sharpening')
ap.add_argument('--legacy', action='store_true')
a = ap.parse_args(); rng = np.random.default_rng(a.seed)
if a.legacy: a.texture, a.texture_mode, a.haze_pow, a.haze_floor, a.sharp, a.base = 0.9, 'gauss', 1.8, 0.01, 0.6, None
img = np.asarray(Image.open(a.inp).convert('RGB'), np.float32) / 255
H, W = img.shape[:2]; sc = W / 1455.0
geo = np.load('out/geo.npz'); cls = cv2.resize(geo['cls'], (W, H), interpolation=cv2.INTER_NEAREST)
z = cv2.resize(geo['P'][..., 2], (W, H), interpolation=cv2.INTER_LINEAR)
o = json.load(open('out/b2_ortho.json')); s_th = o['s']
xc, R, y0w = o['well'][0] * 1.37926 * sc, o['well'][1] * 1.37926 * sc, o['well'][2] * 1.37926 * sc
lin = s2l(img); yy, xx = np.mgrid[0:H, 0:W]

sg = np.load('out/signgeo.npz')['SM']
changed = blur(cv2.resize(sg, (W, H), interpolation=cv2.INTER_LINEAR), 2.0)        # 1 on the new signage

# where the flying vehicles may go is decided on the legacy-textured input (not on whatever --texture-mode /
# --base produce), so the clarity options never reshuffle the vehicles (or the rng-driven haze noise after them)
_L0 = lum(lin)
place_lin = s2l(np.clip(img + (0.9 * (l2s(_L0) - l2s(blur(_L0, 5 * sc / 2))) * (1 - changed))[..., None], 0, 1))
del _L0

# ---- 0. detail transplant from a better upscale of the photo ----
if a.base and os.path.abspath(a.base) != os.path.abspath(a.base_ref):
    def ld(p):
        im = Image.open(p).convert('RGB')
        if im.size != (W, H): im = im.resize((W, H), Image.LANCZOS)
        return s2l(np.asarray(im, np.float32) / 255)
    Bn, Br = ld(a.base), ld(a.base_ref)
    eps = 0.003
    gain = np.clip((blur(lum(lin), 4) + eps) / (blur(lum(Br), 4) + eps), 0.3, 3.0)[..., None]   # local relight gain
    keep = (1 - np.clip(changed * 1.5, 0, 1))[..., None]
    # safety: was the scene actually built on base_ref?  Compare the scene's fine detail (photo areas) with
    # both photos; if it already matches --base better (chain re-run on base_sr), adding the delta again
    # would double it -> skip.
    hp = lambda x: (lambda l: l - blur(l, 2.0))(l2s(lum(x)))[::2, ::2]
    w_ = (keep[..., 0] > 0.99)[::2, ::2]
    g_ = gain[::2, ::2, 0] ** (1 / 2.4)                       # gain in the sRGB-ish domain of hp()
    hs = hp(lin)
    e_ref = np.abs(hs - g_ * hp(Br))[w_].mean(); e_new = np.abs(hs - g_ * hp(Bn))[w_].mean()
    if e_new < e_ref:
        print(f'atmos: scene already matches {a.base} better than {a.base_ref} ({e_new:.5f} < {e_ref:.5f}): no transplant')
    else:
        lin = np.clip(lin + a.base_amt * gain * (Bn - Br) * keep, 0, None)
        img = np.clip(l2s(lin), 0, 1)
        print(f'atmos: detail transplant from {a.base} (ref {a.base_ref}), mean |delta| {np.abs(Bn - Br).mean():.5f}, '
              f'match ref {e_ref:.5f} / new {e_new:.5f}')

# ---- 1. fine texture ----
L = lum(lin)
if a.texture_mode == 'gauss':
    detail = l2s(L) - l2s(blur(L, 5 * sc / 2))
elif a.texture_mode == 'envelope':
    # legacy band-pass boost (keeps the acutance of window frames, railings, slab edges), but the result may
    # leave the local 5x5 min/max envelope only by a small margin: no dark rings round the lit windows
    Ls = l2s(L)
    e = Ls + a.texture * (Ls - l2s(blur(L, 5 * sc / 2)))
    kk = 2 * max(1, int(round(2 * sc / 2))) + 1; ker = np.ones((kk, kk), np.uint8)
    lo, hi = cv2.erode(Ls, ker), cv2.dilate(Ls, ker); m = a.texture_margin
    e = np.minimum(e, hi + m + 0.2 * np.maximum(e - hi - m, 0))
    e = np.maximum(e, lo - m - 0.2 * np.maximum(lo - m - e, 0))
    detail = (e - Ls) / max(a.texture, 1e-6); del e, lo, hi
else:   # edge-aware base: concrete texture is recovered, strong edges (lit windows) get no halos
    Ls = l2s(L)
    detail = np.clip(Ls - guided(Ls, max(2, int(round(5 * sc / 2))), 0.025 ** 2), -0.06, 0.06)
lin = s2l(np.clip(img + (a.texture * detail * (1 - changed))[..., None], 0, 1))

# ---- 2. distant city beyond the rim (sky only) ----
sky = (cls == 0).astype(np.float32)
sky = blur(cv2.erode(sky, np.ones((5, 5), np.uint8)), 1.5)
city = np.zeros((H, W, 3), np.float32) + np.array([0.010, 0.016, 0.024], np.float32) * (1.4 - yy / H * 0.4)[..., None]
for layer, (haze, hmin, hmax, wmin, wmax) in enumerate(((0.85, 30, 140, 14, 40), (0.72, 50, 200, 18, 50), (0.6, 70, 260, 22, 64))):
    sil = np.zeros((H, W), np.float32); win = np.zeros((H, W, 3), np.float32)
    x = -50
    horizon = 330 * sc / 2 + layer * 30
    while x < W:
        tw = rng.uniform(wmin, wmax) * sc / 2; th_ = rng.uniform(hmin, hmax) * sc / 2
        top = int(horizon - th_); x0, x1 = int(x), int(x + tw)
        cv2.rectangle(sil, (x0, top), (x1, H), 1.0, -1)
        if rng.random() < .3: cv2.line(sil, ((x0 + x1) // 2, top), ((x0 + x1) // 2, top - int(40 * sc / 2)), 1.0, 2)
        fh = max(2, int((2.4 + 0.5 * layer) * sc / 2)); ww_ = max(2, int(2 * sc / 2))
        for fy in range(top + fh, int(horizon + 60 * sc), fh):
            if rng.random() < .22:
                fx = x0 + ww_
                while fx < x1 - ww_:
                    run = int(rng.integers(2, 9)) if rng.random() < .4 else 0
                    col = (1.0, .74, .42) if rng.random() < .7 else (.72, .86, 1.0)
                    if rng.random() < .06: col = (1.0, .3, .8)
                    for _ in range(run):
                        if fx >= x1 - ww_: break
                        win[fy:fy + max(1, fh // 3), fx:fx + ww_ - 1] = np.array(col) * rng.uniform(.5, 1)
                        fx += ww_
                    fx += ww_ * int(rng.integers(1, 6))
        x += tw + rng.uniform(10, 80) * sc / 2
    k = 1 - haze
    city = city * (1 - sil[..., None] * (0.5 + 0.35 * k)) + win * 0.9 * k + blur(win, 2.5) * 0.6 * k
city = city * (1 - sky[..., None] * 0) 
lin = lin * (1 - 0.6 * sky[..., None]) + (city * 0.8 + lin * 0.2) * sky[..., None]
place_L = lum(place_lin * (1 - 0.6 * sky[..., None]) + (city * 0.8 + place_lin * 0.2) * sky[..., None]); del place_lin

# ---- 3. flying vehicles circling inside the well (on the ring's ellipses) ----
veh = np.zeros((H, W, 4), np.float32); drawn = 0
for i in range(400):
    px, py = rng.uniform(0.05, 0.62) * W, rng.uniform(0.08, 0.75) * H
    if cls[int(py), int(px)] != 1 or changed[int(py), int(px)] > 0.1: continue
    if place_L[int(py), int(px)] > 0.08: continue
    t = np.clip((px - xc) / R, -0.97, 0.97)
    slope = s_th * t / np.sqrt(1 - t * t)                       # tangent of the far-side ellipse through this point
    d = np.array([1.0, slope]); d /= np.linalg.norm(d)
    if rng.random() < .5: d = -d
    size = rng.uniform(9, 20) * sc / 2 * (0.7 + 0.6 * py / H)
    nrm = np.array([-d[1], d[0]])
    head = np.array([px, py]) + d * size; tail = np.array([px, py]) - d * size
    hull = np.array([tail, tail - nrm * size * .25, head - nrm * size * .18, head + nrm * size * .12, tail + nrm * size * .15]).astype(np.int32)
    cv2.fillPoly(veh, [hull], (0.010, 0.011, 0.013, 1.0), lineType=cv2.LINE_AA)
    hx, hy = head.astype(int); tx, ty = tail.astype(int)
    cv2.circle(veh, (hx, hy), max(1, int(sc * .9)), (1.0, .95, .85, 1.0), -1, cv2.LINE_AA)
    cv2.circle(veh, (tx, ty), max(1, int(sc * .7)), (1.0, .12, .08, 1.0), -1, cv2.LINE_AA)
    if rng.random() < .5: cv2.circle(veh, tuple(((head + tail) / 2 - nrm * size * .2).astype(int)), max(1, int(sc * .5)), (.4, .8, 1.0, 1.0), -1, cv2.LINE_AA)
    trail = tail - d * size * 6
    cv2.line(veh, (tx, ty), tuple(trail.astype(int)), (.35, .04, .03, .15), max(1, int(sc * .5)), cv2.LINE_AA)
    drawn += 1
    if drawn >= 14: break
va = veh[..., 3:4]; lights = np.clip(veh[..., :3] - 0.02, 0, None) * va
lin = lin * (1 - va) + veh[..., :3] * va + blur(lights, 3 * sc / 2) * 1.5

# ---- 4. searchlights over the rim (sky) ----
beams = np.zeros((H, W), np.float32)
for (x0, y0, x1, y1, w0, w1) in ((0.12, 0.13, -0.05, -0.1, 4, 70), (0.55, 0.06, 0.78, -0.12, 4, 60)):
    p0, p1 = np.array([x0 * W, y0 * H]), np.array([x1 * W, y1 * H])
    dv = p1 - p0; Lb = np.linalg.norm(dv); dn = dv / Lb; nn = np.array([-dn[1], dn[0]])
    rel = np.stack([xx - p0[0], yy - p0[1]], -1).astype(np.float32)
    al = rel @ dn; ac = rel @ nn; t = np.clip(al / Lb, 0, 1); wdt = (w0 + (w1 - w0) * t) * sc
    beams += np.exp(-(ac / (wdt + 1e-3)) ** 2 * 2.0) * (al > 0) * (0.6 + 0.4 * (1 - t))
lin = lin + (beams * (0.75 + 0.25 * fbm(H, W, rng, (256, 64), (1, .5))) * sky * 0.05)[..., None] * np.array([.75, .9, 1.0], np.float32)

# ---- 5. textured haze: thicker deeper into the well, lit by the signs ----
zn = np.clip((z - np.percentile(z, 3)) / (np.percentile(z, 97) - np.percentile(z, 3)), 0, 1)
noise = fbm(H, W, rng)
dens = (a.haze_floor + 0.16 * zn ** a.haze_pow + 0.05 * sky) * (0.75 + 0.35 * noise) * a.fog
dens = np.clip(dens, 0, 0.5)[..., None]
fog_col = np.array([0.012, 0.017, 0.019], np.float32)
lit_fog = fog_col + blur(lin, 40 * sc / 2) * 0.45 + blur(lin, 120 * sc / 2) * 0.08
lin = lin * (1 - dens) + lit_fog * dens

out = l2s(lin); lo = lum(out); out = out + (a.sharp * (lo - blur(lo, 1.4 * sc / 2)))[..., None]
Image.fromarray((np.clip(out, 0, 1) * 255 + .5).astype(np.uint8)).save(a.out)
print(f'atmos: vehicles {drawn}')
