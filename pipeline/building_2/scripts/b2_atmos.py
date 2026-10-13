#!/usr/bin/env python3
"""Atmosphere + fine detail for building 2 (between composite and lens).

usage: python3 -I scripts/b2_atmos.py IN_2x.png OUT_2x.png [--fog 1.0] [--seed 7]
  1. fine surface texture: local-contrast recovery on the photographed concrete (not on the signs)
  2. distant megacity beyond the ring's rim: hazy tower silhouettes with floors of lit window strips (sky only)
  3. flying vehicles circling inside the well on the ring's own ellipses, with running lights and faint trails
  4. two searchlight beams sweeping the sky above the rim
  5. layered, textured haze that thickens with depth into the well and is lit by the signs around it
"""
import argparse, json, numpy as np, cv2
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

ap = argparse.ArgumentParser(); ap.add_argument('inp'); ap.add_argument('out')
ap.add_argument('--fog', type=float, default=1.0); ap.add_argument('--seed', type=int, default=7)
a = ap.parse_args(); rng = np.random.default_rng(a.seed)
img = np.asarray(Image.open(a.inp).convert('RGB'), np.float32) / 255
base = np.asarray(Image.open('scene/base.png').convert('RGB'), np.float32) / 255
H, W = img.shape[:2]; sc = W / 1455.0
geo = np.load('out/geo.npz'); cls = cv2.resize(geo['cls'], (W, H), interpolation=cv2.INTER_NEAREST)
z = cv2.resize(geo['P'][..., 2], (W, H), interpolation=cv2.INTER_LINEAR)
o = json.load(open('out/b2_ortho.json')); s_th = o['s']
xc, R, y0w = o['well'][0] * 1.37926 * sc, o['well'][1] * 1.37926 * sc, o['well'][2] * 1.37926 * sc
lin = s2l(img); yy, xx = np.mgrid[0:H, 0:W]

# ---- 1. fine texture ----
L = lum(lin); detail = l2s(L) - l2s(blur(L, 5 * sc / 2))
sg = np.load('out/signgeo.npz')['SM']
changed = blur(cv2.resize(sg, (W, H), interpolation=cv2.INTER_LINEAR), 2.0)        # 1 on the new signage
lin = s2l(np.clip(img + (0.9 * detail * (1 - changed))[..., None], 0, 1))

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

# ---- 3. flying vehicles circling inside the well (on the ring's ellipses) ----
veh = np.zeros((H, W, 4), np.float32); drawn = 0
for i in range(400):
    px, py = rng.uniform(0.05, 0.62) * W, rng.uniform(0.08, 0.75) * H
    if cls[int(py), int(px)] != 1 or changed[int(py), int(px)] > 0.1: continue
    if lum(lin[int(py), int(px)]) > 0.08: continue
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
dens = (0.01 + 0.16 * zn ** 1.8 + 0.05 * sky) * (0.75 + 0.35 * noise) * a.fog
dens = np.clip(dens, 0, 0.5)[..., None]
fog_col = np.array([0.012, 0.017, 0.019], np.float32)
lit_fog = fog_col + blur(lin, 40 * sc / 2) * 0.45 + blur(lin, 120 * sc / 2) * 0.08
lin = lin * (1 - dens) + lit_fog * dens

out = l2s(lin); lo = lum(out); out = out + (0.6 * (lo - blur(lo, 1.4 * sc / 2)))[..., None]
Image.fromarray((np.clip(out, 0, 1) * 255 + .5).astype(np.uint8)).save(a.out)
print(f'atmos: vehicles {drawn}')
