#!/usr/bin/env python3
"""Camera/lens stage for building 2: Nikon F3 + 20mm f/2.8 look on a 2:3 frame.

usage: python3 -I scripts/b2_lens.py IN_2x.png OUT.png [--tilt 5] [--width 2400] [--soft 0.5] [--glare 0.005]
       [--veil 0.002] [--interp lanczos|cubic] [--legacy]
  1. downward re-tilt (pure camera rotation through a 20mm-class virtual pinhole): the walls' verticals
     converge toward the bottom of the well, as when pointing the camera down into it
  2. 2:3 portrait crop of the valid area
  3. slight barrel distortion (Brown k1,k2), lateral chromatic aberration, natural + mechanical vignetting,
     corner softness and a touch of veiling glare (linear light)
  The re-tilt, crop, distortion and CA are composed into ONE resampling of the input (Lanczos by default);
  --legacy restores the old two-pass cubic resampling (warp, then remap) and the old softness/glare values.
"""
import argparse, numpy as np, cv2
from PIL import Image

def s2l(x): return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4).astype(np.float32)
def l2s(x):
    x = np.clip(x, 0, None); return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055).astype(np.float32)

ap = argparse.ArgumentParser(); ap.add_argument('inp'); ap.add_argument('out')
ap.add_argument('--tilt', type=float, default=5.0); ap.add_argument('--fmul', type=float, default=0.9)
ap.add_argument('--width', type=int, default=2400)
ap.add_argument('--k1', type=float, default=-0.016); ap.add_argument('--k2', type=float, default=0.002)
ap.add_argument('--ca', type=float, default=0.0006); ap.add_argument('--vn', type=float, default=0.75); ap.add_argument('--vm', type=float, default=0.25)
ap.add_argument('--soft', type=float, default=0.5, help='corner softness (legacy 0.9)')
ap.add_argument('--soft-pow', type=float, default=3.0, help='radial falloff exponent of the softness (legacy 2.5)')
ap.add_argument('--glare', type=float, default=0.005, help='veiling glare weight (legacy 0.008)')
ap.add_argument('--veil', type=float, default=0.002, help='flat veil, fraction of mean (legacy 0.004)')
ap.add_argument('--interp', default='lanczos', choices=['lanczos', 'cubic'])
ap.add_argument('--legacy', action='store_true', help='pre-clarity behaviour (two-pass cubic, 0.9/2.5/0.008/0.004)')
a = ap.parse_args()
if a.legacy: a.soft, a.soft_pow, a.glare, a.veil = 0.9, 2.5, 0.008, 0.004
img = s2l(np.asarray(Image.open(a.inp).convert('RGB'), np.float32) / 255)
H, W = img.shape[:2]
f = a.fmul * W; K = np.array([[f, 0, W / 2], [0, f, H / 2], [0, 0, 1]])
t = np.radians(a.tilt)
Rx = np.array([[1, 0, 0], [0, np.cos(t), -np.sin(t)], [0, np.sin(t), np.cos(t)]])     # camera pitched further down
Hm = K @ Rx @ np.linalg.inv(K)
def ph(p): q = Hm @ np.array([p[0], p[1], 1.0]); return q[:2] / q[2]
top, bot = ph((W / 2, 0)), ph((W / 2, H))
Hm = np.array([[1, 0, W / 2 - top[0]], [0, 1, -top[1]], [0, 0, 1]]) @ Hm          # original top edge stays at the top
Hs = min(H, bot[1] - top[1])
# valid region after warping, then the largest centred 2:3 window inside it
corners = cv2.perspectiveTransform(np.float32([[[0, 0], [W, 0], [W, H], [0, H]]]), Hm)[0]
if a.legacy:
    warped = cv2.warpPerspective(img, Hm, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
Hinv = np.linalg.inv(Hm)
# full-height centred 2:3 window (keeps every drawn block); the thin slivers the mild keystone leaves at the
# bottom corners are filled by reflection and sit under the vignette
h = Hs; w = h * 2 / 3; x0, y0 = (W - w) / 2, 0.0
# 1.5% margin so the barrel distortion never samples outside the frame
m = 0.012; x0 += w * m / 2; y0 += h * m * 0.15; w *= 1 - m; h *= 1 - m
OW, OH = a.width, int(a.width * 1.5)
yy, xx = np.mgrid[0:OH, 0:OW].astype(np.float32)
cxo, cyo = (OW - 1) / 2, (OH - 1) / 2; rc = np.hypot(cxo, cyo)
xn, yn = (xx - cxo) / rc, (yy - cyo) / rc; rd = np.hypot(xn, yn)
ru = rd.copy()
for _ in range(8): ru = rd / (1 + a.k1 * ru ** 2 + a.k2 * ru ** 4)
scale_u = np.where(rd > 0, ru / np.maximum(rd, 1e-6), 1)
out = np.zeros((OH, OW, 3), np.float32)
interp = cv2.INTER_LANCZOS4 if a.interp == 'lanczos' else cv2.INTER_CUBIC
for ch, cmag in enumerate((1 + a.ca / 2, 1.0, 1 - a.ca / 2)):
    sx = x0 + (cxo + xn * scale_u * cmag * rc) * (w / OW)
    sy = y0 + (cyo + yn * scale_u * cmag * rc) * (h / OH)
    if a.legacy:
        out[..., ch] = cv2.remap(warped[..., ch], sx.astype(np.float32), sy.astype(np.float32), cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
    else:
        # warped-frame coords -> input coords through the inverse homography: a single resampling pass
        q = Hinv[2, 0] * sx + Hinv[2, 1] * sy + Hinv[2, 2]
        ux = (Hinv[0, 0] * sx + Hinv[0, 1] * sy + Hinv[0, 2]) / q
        uy = (Hinv[1, 0] * sx + Hinv[1, 1] * sy + Hinv[1, 2]) / q
        out[..., ch] = cv2.remap(img[..., ch], ux.astype(np.float32), uy.astype(np.float32), interp, borderMode=cv2.BORDER_REFLECT)
out = np.clip(out, 0, None)
rho = np.clip(rd / rd.max(), 0, 1)
if a.soft > 0:
    soft = cv2.GaussianBlur(out, (0, 0), a.soft * OW / 2400 * 1.6)
    out = out + (soft - out) * (rho ** a.soft_pow)[..., None]
vig = 2.0 ** (-(a.vn * rho ** 2 + a.vm * np.clip((rho - 0.7) / 0.3, 0, 1) ** 2))
out = out * vig[..., None]
glare = cv2.GaussianBlur(out, (0, 0), OW / 12)
out = out * (1 - a.glare) + glare * a.glare + out.mean((0, 1)) * a.veil
Image.fromarray((np.clip(l2s(out), 0, 1) * 255 + .5).astype(np.uint8)).save(a.out)
vp = Hm @ np.array([0, 1.0, 0]); 
print('lens: tilt %.1f deg, crop %dx%d at (%d,%d) of %dx%d -> %dx%d' % (a.tilt, w, h, x0, y0, W, H, OW, OH))
