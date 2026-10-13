#!/usr/bin/env python3
"""Light transport from every screen/lightbox/neon of building 2 onto the photographed ring structure.

usage: python3 -I scripts/b2_relight.py SIGNS_2x.png OUT_2x.png [--gain 3] [--debug out/light.png]

Lights: every emitting sign pixel (out/signgeo.npz EM) grouped into 8x8-px cells; each cell is an area light at its
3-D position on the sign's own surface (curved wall, box face, blade...), with that face's normal, its rendered
colour as radiance (linear) and its true 3-D area (pixel area / |n.view|). Wall signs emit one-sided, blades and
neon two-sided.
Receivers: the photo's surfaces from the geometry proxy (out/geo.npz: concave well wall, convex near walls,
horizontal walkway tops, deep courtyard) plus the non-emitting sign parts (box returns, frames), every 7 px.
E(x) = sum L * max(0,n.w) * max(0,n_l.-w) * A / max(d^2, d0^2) (Lambertian, inverse square, cosine at both ends),
reflected with an albedo taken from the photo's own texture (so added light reveals real surface detail), plus a
glossy lobe on the walkway tops and the box returns.
"""
import argparse, numpy as np, cv2
from PIL import Image

def s2l(x): return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4).astype(np.float32)
def l2s(x):
    x = np.clip(x, 0, None); return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055).astype(np.float32)

ap = argparse.ArgumentParser(); ap.add_argument('inp'); ap.add_argument('out')
ap.add_argument('--gain', type=float, default=3.0); ap.add_argument('--spec', type=float, default=1.0)
ap.add_argument('--cell', type=int, default=8); ap.add_argument('--stride', type=int, default=7)
ap.add_argument('--debug', default=None); ap.add_argument('--ext', type=float, default=260.0, help='haze extinction length (page px)')
a = ap.parse_args()

F = s2l(np.asarray(Image.open(a.inp).convert('RGB'), np.float32) / 255)            # 2x
B = s2l(np.asarray(Image.open('scene/base.png').convert('RGB'), np.float32) / 255)
H2, W2 = F.shape[:2]; H, W = H2 // 2, W2 // 2
F1 = cv2.resize(F, (W, H), interpolation=cv2.INTER_AREA)
geo = np.load('out/geo.npz'); P, N, cls = geo['P'][:H, :W], geo['N'][:H, :W], geo['cls'][:H, :W]; th = float(geo['th'])
sg = np.load('out/signgeo.npz'); EM, TWO, SN, SP, SM = (sg[k][:H, :W] for k in ('EM', 'TWO', 'SN', 'SP', 'SM'))
up = np.array([0, -np.cos(th), -np.sin(th)], np.float32)

# ---------------- lights ----------------
c = a.cell
hh, ww = H // c * c, W // c * c
def cells(x): return x[:hh, :ww].reshape(hh // c, c, ww // c, c, *x.shape[2:])
em = cells(EM).mean((1, 3))
rad = (cells(F1 * EM[..., None]).sum((1, 3)) / (cells(EM).sum((1, 3))[..., None] + 1e-6))
cy, cx = np.mgrid[c // 2:hh:c, c // 2:ww:c]
sel = em > 0.2
Lp = SP[cy[sel], cx[sel]]; Ln = SN[cy[sel], cx[sel]]; Lr = rad[sel] * 1.0
Lt = TWO[cy[sel], cx[sel]] > 0.5
Ln /= np.linalg.norm(Ln, axis=1, keepdims=True) + 1e-9
La = em[sel] * c * c / np.clip(np.abs(Ln[:, 2]), 0.25, 1)
keep = Lr.sum(1) > 1e-4
Lp, Ln, Lr, Lt, La = Lp[keep], Ln[keep], Lr[keep], Lt[keep], La[keep]
print('light cells', len(Lp))

# ---------------- receivers ----------------
s = a.stride
ry, rx = np.mgrid[s // 2:H:s, s // 2:W:s]
Rm = (cls[ry, rx] > 0) & (EM[ry, rx] < 0.5)
use_sign = (SM[ry, rx] > 0.5) & (EM[ry, rx] < 0.5)
Rp = np.where(use_sign[..., None], SP[ry, rx], P[ry, rx]); Rn = np.where(use_sign[..., None], SN[ry, rx], N[ry, rx])
Rp, Rn = Rp[Rm].astype(np.float32), Rn[Rm].astype(np.float32)
Rn /= np.linalg.norm(Rn, axis=1, keepdims=True) + 1e-9
Rc = np.where(use_sign, 9, cls[ry, rx])[Rm]
# micro-geometry: balcony slabs, ledges and railings stand ~15 px proud of the smooth wall and face every way,
# so receivers sit slightly in front of the proxy surface and use a wrapped cosine on the structured walls
Rp = Rp + Rn * np.where(Rc == 9, 0, 15)[:, None].astype(np.float32)
wrap = np.where(Rc == 1, 0.35, np.where(Rc == 2, 0.2, 0.0)).astype(np.float32)[:, None]
view = np.array([0, 0, -1.0], np.float32)                         # orthographic camera looks along +z
Ed = np.zeros((len(Rp), 3), np.float32); Es = np.zeros((len(Rp), 3), np.float32)
d0 = 22.0
for i in range(0, len(Rp), 1500):
    p, n, k = Rp[i:i + 1500, None, :], Rn[i:i + 1500, None, :], wrap[i:i + 1500]
    w = Lp[None] - p
    d2 = (w ** 2).sum(-1); d = np.sqrt(d2) + 1e-6; wn = w / d[..., None]
    cr = np.clip(((wn * n).sum(-1) + k) / (1 + k), 0, None)
    cl = -(wn * Ln[None]).sum(-1)
    cl = np.where(Lt[None], np.abs(cl), np.clip(cl, 0, None))
    att = np.exp(-d / a.ext)                                     # light scattered out by the night haze
    geo_t = cr * cl * La[None] / np.maximum(d2, d0 * d0) * att
    Ed[i:i + 1500] = geo_t @ Lr
    hv = wn + view; hv /= np.linalg.norm(hv, axis=-1, keepdims=True)
    lobe = np.clip((hv * n).sum(-1), 0, None) ** 30
    Es[i:i + 1500] = (lobe * cl * La[None] / np.maximum(d2, d0 * d0) * att * (cr > 0)) @ Lr
gridE = np.zeros(ry.shape + (3,), np.float32); gridE[Rm] = Ed
gridS = np.zeros(ry.shape + (3,), np.float32); gridS[Rm] = Es
# fill gaps (non-receiver cells) by normalized convolution, then upsample to 2x
wgt = Rm.astype(np.float32)
def fill(g):
    num = cv2.GaussianBlur(g, (0, 0), 1.0); den = cv2.GaussianBlur(wgt, (0, 0), 1.0)[..., None]
    return np.where(wgt[..., None] > 0, g, num / (den + 1e-6))
Ed2 = cv2.resize(fill(gridE), (W2, H2), interpolation=cv2.INTER_CUBIC) / np.pi
Es2 = cv2.resize(fill(gridS), (W2, H2), interpolation=cv2.INTER_CUBIC)
Ed2, Es2 = np.clip(Ed2, 0, None), np.clip(Es2, 0, None)
print('irradiance p99 %.4f' % np.percentile(Ed2, 99))

# ---------------- albedo / gloss ----------------
Lb = 0.2126 * B[..., 0] + 0.7152 * B[..., 1] + 0.0722 * B[..., 2]
local = cv2.GaussianBlur(Lb, (0, 0), 10) + 0.0015
tex = np.clip(Lb / local, 0.25, 2.5)
chroma = (B + 0.002) / (Lb[..., None] + 0.002); chroma = 0.6 + 0.4 * np.clip(chroma, 0, 2)
albedo = 0.32 * tex[..., None] * chroma
SM2 = cv2.resize(SM, (W2, H2), interpolation=cv2.INTER_NEAREST); EM2 = cv2.resize(EM, (W2, H2), interpolation=cv2.INTER_LINEAR)
albedo = np.where((SM2 > 0.5)[..., None], 0.22, albedo)               # sign returns / frames: painted metal
cls2 = cv2.resize(cls, (W2, H2), interpolation=cv2.INTER_NEAREST)
gloss = np.where(cls2 == 3, 0.10, 0.03).astype(np.float32); gloss[SM2 > 0.5] = 0.25
recv = (1 - np.clip(EM2 * 1.2, 0, 1))[..., None] * (cls2 > 0)[..., None]
add = (albedo * Ed2 * a.gain + gloss[..., None] * Es2 * 0.02 * a.spec) * recv
out = F + add
Image.fromarray((np.clip(l2s(out), 0, 1) * 255 + .5).astype(np.uint8)).save(a.out)
if a.debug: Image.fromarray((np.clip(l2s(add * 4), 0, 1) * 255 + .5).astype(np.uint8)).save(a.debug)
print('relight: added mean %.5f p99 %.4f' % (add.mean(), np.percentile(add, 99)))
