"""Post-process the browser render: light spill, bloom, night grade, grain.
usage: b2_composite.py relit.png base.png out.png [full.png] [--self-veil 0.8] [--haze-blur 2.5] [--legacy]
  --self-veil  how much of the bloom / glow is kept OFF the sign faces themselves, mostly on their dark
               parts (0 = legacy: every sign was veiled by its own bloom, which washed out dark lettering on
               bright panels; the halo around the signs on the dark architecture is unchanged; the sign
               mask is eroded ~4 px so the wall right at a sign's edge keeps its bloom - no dark outline)
  --haze-blur  blur radius of the far-sign haze veil (legacy 6: it also blurred the far signs)
  --legacy     exact pre-clarity behaviour
"""
import sys, argparse
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('full'); ap.add_argument('base'); ap.add_argument('out'); ap.add_argument('mask', nargs='?')
ap.add_argument('--self-veil', type=float, default=0.8)
ap.add_argument('--haze-blur', type=float, default=2.5)
ap.add_argument('--legacy', action='store_true')
A = ap.parse_args()
if A.legacy: A.self_veil, A.haze_blur = 0.0, 6.0
full_p, base_p, out_p = A.full, A.base, A.out
mask_p = A.mask if A.mask else full_p   # render before relighting, for the sign mask
F = np.asarray(Image.open(full_p).convert('RGB'), np.float32) / 255
Bs = Image.open(base_p).convert('RGB')
if Bs.size != (F.shape[1], F.shape[0]):
    Bs = Bs.resize((F.shape[1], F.shape[0]), Image.LANCZOS)
B = np.asarray(Bs, np.float32) / 255
H, W, _ = F.shape

to_lin = lambda x: np.power(np.clip(x, 0, 1), 2.2)
to_srgb = lambda x: np.power(np.clip(x, 0, 1), 1 / 2.2)


def box(a, r, axis):
    if r < 1:
        return a
    c = np.cumsum(a, axis=axis, dtype=np.float64)
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    c = np.pad(c, pad, mode='edge')
    sl_hi = [slice(None)] * a.ndim
    sl_lo = [slice(None)] * a.ndim
    n = a.shape[axis]
    sl_hi[axis] = slice(2 * r + 1, 2 * r + 1 + n)
    sl_lo[axis] = slice(0, n)
    return ((c[tuple(sl_hi)] - c[tuple(sl_lo)]) / (2 * r + 1)).astype(np.float32)


def gblur(a, sigma):
    """Gaussian approx (3 box passes); large sigmas computed on a downsampled copy."""
    f = 1
    while sigma / f > 12 and min(a.shape[0], a.shape[1]) // (f * 2) > 16:
        f *= 2
    small = a
    if f > 1:
        h2, w2 = a.shape[0] // f * f, a.shape[1] // f * f
        small = a[:h2, :w2].reshape(h2 // f, f, w2 // f, f, -1).mean((1, 3))
    s = sigma / f
    r = max(1, int(round(np.sqrt(12 * s * s / 3 + 1) / 2)))
    for _ in range(3):
        small = box(box(small, r, 0), r, 1)
    if f > 1:
        chans = [np.asarray(Image.fromarray(small[..., i]).resize((a.shape[1], a.shape[0]), Image.BILINEAR)) for i in range(small.shape[2])]
        small = np.stack(chans, -1)
    return small


Fl, Bl = to_lin(F), to_lin(B)
lum = lambda x: (0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2])[..., None]

# where the render differs from the photo = the new signage
Fm = np.asarray(Image.open(mask_p).convert('RGB'), np.float32) / 255
M = np.clip(np.abs(Fm - B).sum(-1, keepdims=True) * 6, 0, 1)
M = np.clip(gblur(M, 1.5), 0, 1)
if not A.legacy:
    # non-emissive sign geometry (panel housing returns, lantern rims, box sides, plinth) is surface, not light:
    # take it out of the sign mask so it gets the same spill, glow and haze as the wall around it and keeps
    # its own shading (otherwise the returns flip to dark outlines or melt into the wall)
    import cv2 as _cv2r, os as _osr
    if _osr.path.exists('out/signgeo.npz'):
        _sg = np.load('out/signgeo.npz')
        RET = _cv2r.resize((_sg['SM'] * (1 - _sg['EM'])).astype(np.float32), (W, H), interpolation=_cv2r.INTER_LINEAR)
        RET = np.clip(_cv2r.dilate(RET, np.ones((3, 3), np.uint8)), 0, 1)[..., None]
        M = M * (1 - RET)
E = Fl * M
# sign faces incl. their dark lettering (M misses dark letters drawn over the dark photo): the self-veil
# reduction below uses this so dark strokes on bright panels stay dark
if not A.legacy:
    import cv2 as _cv2, os as _os
    Ms = M
    if _os.path.exists('out/signgeo.npz'):
        _sg2 = np.load('out/signgeo.npz')
        SMu = _cv2.resize((_sg2['SM'] * _sg2['EM']).astype(np.float32), (W, H), interpolation=_cv2.INTER_LINEAR)   # emitting faces only
        Ms = np.maximum(M, np.clip(gblur(SMu[..., None], 1.5), 0, 1))
    # keep the reduction INSIDE the sign faces: both masks are blurred and reach a few px out over the dark
    # wall, which then lost its bloom while the wall just beyond kept it -> a dark outline round every sign.
    # Erode ~4 px (at 2x) and feather inwards so the wall at the sign edge keeps the legacy bloom.
    _er = max(1, int(round(4 * W / 2910)))
    _k = _cv2.getStructuringElement(_cv2.MORPH_ELLIPSE, (2 * _er + 1, 2 * _er + 1))
    Ms = _cv2.erode((Ms[..., 0] > 0.5).astype(np.float32), _k)
    Ms = np.clip(gblur(Ms[..., None], 1.5 * W / 2910), 0, 1)
    # strongest on the DARK parts of a sign face (lettering, outlines, pupils); the bright panel areas keep
    # most of their glow, so the signs still read as luminous
    dark = 1 - np.clip((lum(Fl) - 0.03) / (0.30 - 0.03), 0, 1)
    dark = dark * dark * (3 - 2 * dark)
    R = A.self_veil * Ms * (0.3 + 0.7 * dark)

# 1) coloured light spill onto the surrounding architecture
# light spill: falls off fast, mostly lights surfaces that are actually lit/reflective in the photo
S = gblur(E, 45) * 0.55 + gblur(E, 14) * 0.6
surface = 0.02 + 2.6 * np.sqrt(lum(Bl))
out = Fl + 0.22 * S * surface * (1 - 0.9 * M)   # rough-surface scatter; direct light comes from relight.py

# 2) bloom (signs + the photo's own practical lights)
# bloom only from genuinely bright sources, total weight well below 1 so flat signs do not bloom onto themselves
bright = np.maximum(out - 0.3, 0)
bloom_s = gblur(bright, 3) * 0.22 + gblur(bright, 10) * 0.18
bloom_l = gblur(bright, 32) * 0.12 + gblur(bright, 100) * 0.03
if A.legacy:
    out = out + (bloom_s + bloom_l)
else:   # keep the tight bloom on the architecture/photo lights, mostly not on the sign faces themselves
    out = out + bloom_s * (1 - R) + bloom_l * (1 - 0.75 * R)

# 2b) diffuse light bloom: big bright posters scatter light into the night haze and the lens.
#     Emission convolved with a wide multi-scale PSF -> large emitters get large soft halos, small neon stays tight.
yy0 = np.linspace(1, 0, H, dtype=np.float32)[:, None, None]
k2 = W / 2910.0
glow_s = gblur(E, 12 * k2) * 0.32
glow_l = gblur(E, 40 * k2) * 0.22 + gblur(E, 120 * k2) * 0.05
if A.legacy:
    out = out + glow_s * (1 - 0.6 * M) + glow_l * (1 - 0.6 * M)
else:
    out = out + (glow_s * (1 - R) + glow_l * (1 - 0.75 * R)) * (1 - 0.6 * M)

# 3) atmospheric perspective from the geometry proxy: the deeper into the ring well (farther along the view
#    ray), the more the new signage is veiled by the night haze
import cv2
geo = np.load('out/geo.npz'); z = geo['z'] if 'z' in geo else geo['P'][..., 2]; cls = geo['cls']
zn = (z - np.percentile(z[cls > 0], 2)) / (np.percentile(z[cls > 0], 98) - np.percentile(z[cls > 0], 2))
far = cv2.resize(np.clip(zn, 0, 1).astype(np.float32), (W, H), interpolation=cv2.INTER_LINEAR)[..., None] ** 1.4
haze_col = np.array([0.010, 0.016, 0.024], np.float32)
a = 0.16 * far * M
out = out * (1 - a) + (haze_col + gblur(out, A.haze_blur) * 0.5) * a

# 4) match the softness of the upscaled photograph on the new signage
# (no extra softening of the signs: keep their detail)

g = to_srgb(out)
Image.fromarray((np.clip(g, 0, 1) * 255 + 0.5).astype(np.uint8)).save(out_p)
print('saved', out_p, g.shape)
