"""Post-process the browser render: light spill, bloom, night grade, grain.
usage: composite.py full.png base.png out.png
"""
import sys
import numpy as np
from PIL import Image

full_p, base_p, out_p = sys.argv[1:4]
mask_p = sys.argv[4] if len(sys.argv) > 4 else full_p   # render before relighting, for the sign mask
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
E = Fl * M

# 1) coloured light spill onto the surrounding architecture
# light spill: falls off fast, mostly lights surfaces that are actually lit/reflective in the photo
S = gblur(E, 45) * 0.55 + gblur(E, 14) * 0.6
surface = 0.02 + 2.6 * np.sqrt(lum(Bl))
out = Fl + 0.22 * S * surface * (1 - 0.9 * M)   # rough-surface scatter; direct light comes from relight.py

# 2) bloom (signs + the photo's own practical lights)
# bloom only from genuinely bright sources, total weight well below 1 so flat signs do not bloom onto themselves
bright = np.maximum(out - 0.3, 0)
bloom = gblur(bright, 3) * 0.22 + gblur(bright, 10) * 0.18 + gblur(bright, 32) * 0.12 + gblur(bright, 100) * 0.03
out = out + bloom

# 2b) diffuse light bloom: big bright posters scatter light into the night haze and the lens.
#     Emission convolved with a wide multi-scale PSF -> large emitters get large soft halos, small neon stays tight.
yy0 = np.linspace(1, 0, H, dtype=np.float32)[:, None, None]
k2 = W / 2910.0
glow = gblur(E, 12 * k2) * 0.32 + gblur(E, 40 * k2) * 0.22 + gblur(E, 120 * k2) * 0.05
out = out + glow * (0.85 + 0.45 * yy0) * (1 - 0.6 * M)

# 3) atmospheric perspective: the tower is ~2 km tall, so signs higher in frame are farther away
#    -> lower contrast, lifted toward the night-haze colour, softer
yy = np.linspace(1, 0, H, dtype=np.float32)[:, None, None]   # 1 at top (far), 0 at bottom
far = np.power(yy, 1.3)
haze_col = np.array([0.010, 0.016, 0.024], np.float32)
a = 0.12 * far * M
out = out * (1 - a) + (haze_col + gblur(out, 6) * 0.5) * a

# 4) match the softness of the upscaled photograph on the new signage
# (no extra softening of the signs: keep their detail)

g = to_srgb(out)
Image.fromarray((np.clip(g, 0, 1) * 255 + 0.5).astype(np.uint8)).save(out_p)
print('saved', out_p, g.shape)
