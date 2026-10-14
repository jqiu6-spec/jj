"""
wood.py — make the CGI blocks in the Always Pan ad read as real painted wood.

Each visible block face is a quad in the source image.  A homography maps every
pixel of the face back to a "wood space" rectangle measured in centimetres, and
a procedural painted-wood model is evaluated there, so the grain, brush texture
and edge wear sit in correct perspective on every face.

Wood logic (grain follows the long axis of each piece of timber):
  * long bar        : face grain along the bar on the yellow side and the top;
                      the red end is END grain, as two triangular pieces glued
                      along the diagonal seam
  * lower-left block: face grain along x on the navy front and the sage top
  * right block     : face grain along z on the sage top and the right face;
                      the front (terra) face is end grain

The modulation is multiplicative, so the render's own shading, cast shadows
and speckle are preserved underneath.
"""
import numpy as np
from PIL import Image, ImageDraw

# ----------------------------------------------------------------------------
# faces: image corners (source 1562x1007 coords) paired with wood-space (u, v)
# in cm, u = along the grain.  'kind' is face or end grain; 'arris' lists the
# polygon edges (i -> i+1) that are real block edges and may show wear.
# ----------------------------------------------------------------------------
FACES = {
    "red": dict(pts=[(680, 165, 0, 0), (1190, 166, 50, 0), (1178, 505, 50, 34), (684, 500, 0, 34)],
                kind="end", arris=[0, 1, 3], hue=(350, 25), sat=(0.45, 1), val=(0.3, 1),
                seam=((680, 165), (1178, 505)), seed=11),
    "yellow": dict(pts=[(1190, 166, 0, 0), (1560, 2, 300, 0), (1560, 121, 300, 34), (1178, 505, 0, 34)],
                   kind="face", arris=[0, 2, 3], hue=(26, 52), sat=(0.55, 1), val=(0.45, 1), seed=12),
    "top": dict(pts=[(680, 165, 0, 0), (1190, 166, 0, 50), (1546, 0, 330, 50), (1525, 0, 330, 0)],
                kind="face", arris=[0, 1, 3], hue=(22, 48), sat=(0.145, 0.45), val=(0.6, 1), seed=13, gain=1.3),
    "sage_L": dict(pts=[(685, 412, 0, 0), (1170, 505, 50, 0), (1075, 660, 50, 50), (539, 501, 0, 50)],
                   kind="face", arris=[0, 1, 2, 3], hue=(45, 110), sat=(0.10, 0.7), val=(0.15, 1), seed=14, gain=1.45),
    "navy": dict(pts=[(539, 501, 0, 0), (1072, 659, 50, 0), (1071, 902, 50, 22), (542, 699, 0, 22)],
                 kind="face", arris=[0, 1, 2, 3], hue=(170, 230), sat=(0.25, 1), val=(0.1, 0.6), seed=15, gain=2.2),
    "sage_R": dict(pts=[(1075, 660, 0, 0), (1170, 505, 50, 0), (1405, 552, 50, 50), (1300, 727, 0, 50)],
                   kind="face", arris=[0, 1, 2, 3], hue=(40, 110), sat=(0.10, 0.5), val=(0.3, 1), seed=16, gain=1.45),
    "terra_F": dict(pts=[(1075, 660, 0, 0), (1300, 727, 50, 0), (1300, 1051, 50, 60), (1075, 960, 0, 60)],
                    kind="end", arris=[0, 1, 2, 3], hue=(8, 24), sat=(0.55, 1), val=(0.3, 1), seed=17, gain=1.2),
    "terra_R": dict(pts=[(1300, 727, 0, 0), (1405, 552, 60, 0), (1405, 866, 60, 60), (1300, 1051, 0, 60)],
                    kind="face", arris=[0, 1, 2, 3], hue=(8, 26), sat=(0.6, 1), val=(0.2, 1), seed=18, gain=1.4),
}
# the pan sits on the lower-left block and its loop handle crosses the red face
PAN_LOOP = (1072, 416, 1120, 452)     # bbox of the loop handle, source coords


# ----------------------------------------------------------------------------
# hash-based value noise (no scipy / opensimplex available)
# ----------------------------------------------------------------------------
def _hash(xi, yi, seed):
    h = (xi.astype(np.uint32) * np.uint32(0x8DA6B343)
         + yi.astype(np.uint32) * np.uint32(0xD8163841)
         + np.uint32((seed * 0xCB1AB31F) & 0xFFFFFFFF))
    h ^= h >> np.uint32(13)
    h *= np.uint32(0x5BD1E995)
    h ^= h >> np.uint32(15)
    return h.astype(np.float32) / np.float32(4294967296.0)


def vnoise(x, y, seed):
    xi = np.floor(x)
    yi = np.floor(y)
    fx = x - xi
    fy = y - yi
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    xi = xi.astype(np.int64)
    yi = yi.astype(np.int64)
    a = _hash(xi, yi, seed)
    b = _hash(xi + 1, yi, seed)
    c = _hash(xi, yi + 1, seed)
    d = _hash(xi + 1, yi + 1, seed)
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(x, y, seed, octaves=4, lac=2.0, gain=0.5):
    out = np.zeros_like(x, dtype=np.float32)
    amp, tot, f = 1.0, 0.0, 1.0
    for o in range(octaves):
        out += amp * vnoise(x * f, y * f, seed + 97 * o)
        tot += amp
        amp *= gain
        f *= lac
    return out / tot                       # ~[0,1], mean ~0.5


# ----------------------------------------------------------------------------
# geometry helpers
# ----------------------------------------------------------------------------
def homography(src_pts, dst_pts):
    """3x3 H with dst ~ H @ src for 4 point pairs (DLT)."""
    A = []
    for (x, y), (u, v) in zip(src_pts, dst_pts):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    b = np.array([c for p in dst_pts for c in p], np.float64)
    h = np.linalg.solve(np.array(A, np.float64), b)
    return np.append(h, 1.0).reshape(3, 3)


def seg_dist(px, py, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1)
    return np.sqrt((px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2)


def hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(2)
    mn = rgb.min(2)
    d = np.maximum(mx - mn, 1e-6)
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    return h, s, mx


def in_range(h, lo, hi):
    return ((h >= lo) & (h <= hi)) if lo <= hi else ((h >= lo) | (h <= hi))


# ----------------------------------------------------------------------------
# procedural painted wood, evaluated in wood space (cm)
# ----------------------------------------------------------------------------
def _box3(a):
    """3x3 box blur with edge replication (softens the relief as paint does)."""
    p = np.pad(a, 1, mode="edge")
    return (p[:-2, :-2] + p[:-2, 1:-1] + p[:-2, 2:] + p[1:-1, :-2] + p[1:-1, 1:-1] + p[1:-1, 2:]
            + p[2:, :-2] + p[2:, 1:-1] + p[2:, 2:]) / 9.0


def _fade(freq_u, freq_v, fp_u, fp_v):
    """1 where a term of these frequencies (cycles/cm) is well sampled, 0 near Nyquist."""
    cyc_per_px = np.maximum(freq_u * fp_u, freq_v * fp_v)
    return np.clip(1.4 - 2.2 * cyc_per_px, 0, 1)


def ring_table(seed, n=600, mean=1.0):
    """
    Radii of successive growth rings with natural ring-to-ring width
    variation (autocorrelated log-normal) and a per-ring darkness.
    """
    r = np.random.default_rng(seed)
    x = np.zeros(n)
    for i in range(1, n):
        x[i] = 0.7 * x[i - 1] + 0.3 * r.normal()
    widths = np.clip(mean * np.exp(0.55 * x), 0.3 * mean, 3.0 * mean)
    radii = np.concatenate([[0.0], np.cumsum(widths)])
    y = np.zeros(n + 1)
    for i in range(1, n + 1):
        y[i] = 0.5 * y[i - 1] + 0.5 * r.normal()
    dark = np.clip(0.55 + 0.35 * y, 0.15, 1.0)
    return radii, dark


def ring_phase(rr, radii, dark):
    """Continuous ring index for radius rr, plus that ring's darkness."""
    idx = np.arange(len(radii), dtype=np.float32)
    phase = np.interp(rr, radii, idx).astype(np.float32)
    n = np.clip(np.floor(phase).astype(np.int64), 0, len(dark) - 1)
    return phase, dark[n].astype(np.float32)


def streaks(u, v, freq, seed, wander=0.2, break_freq=0.12):
    """Continuous streaks along u (pores, brush hairs) that wander and fade."""
    vv = v + wander * (fbm(u * 0.15, v * 0.4, seed + 1, octaves=2) - 0.5)
    line = vnoise(np.zeros_like(u) + 0.37, vv * freq, seed)            # 1-D noise across v
    fine = vnoise(np.zeros_like(u) + 0.91, vv * freq * 2.7, seed + 2)
    gate = 0.35 + 0.65 * fbm(u * break_freq, v * 1.0, seed + 3, octaves=2)
    return (0.7 * line + 0.3 * fine - 0.5) * gate


def face_grain(u, v, seed, length, height, fp_u, fp_v, ring_gain=1.0):
    """
    Luminance modulation for paint over flat-sawn face grain, u along grain.
    The growth cones of the log cut by the board plane give nested "flame"
    loops centred near the board's midline that straighten out further along
    the piece.  Modelled as ellipses strongly elongated along u, with real
    ring-to-ring width variation, a softwood ring profile (slow darkening,
    sharp drop) and per-ring darkness.
    """
    r = np.random.default_rng(seed)
    k = r.uniform(10.0, 18.0) if length > 60 else r.uniform(6.0, 10.0)   # loop elongation
    uc = length * r.uniform(0.2, 0.8)
    vc = height * r.uniform(0.3, 0.7)
    radii, dark = ring_table(seed + 1, mean=r.uniform(0.7, 1.1))
    rr = np.sqrt(((u - uc) / k) ** 2 + (v - vc) ** 2)
    rr = rr + 0.25 * (fbm(u * 0.08, v * 0.3, seed + 3, octaves=2) - 0.5)   # gentle wiggle, cm
    phase, ring_dark = ring_phase(rr, radii, dark)
    f = phase - np.floor(phase)
    ramp = np.clip(f / 0.80, 0, 1) ** 2.2                       # earlywood -> latewood
    drop = np.clip((1 - f) / 0.20, 0, 1)                        # sharp ring boundary
    band = ramp * drop
    patchy = np.clip(0.35 + 0.9 * fbm(u * 0.05, v * 0.4, seed + 4, octaves=3), 0, 1)
    rings = band * ring_dark * patchy * _fade(1.0 / (k * 0.9), 1.0 / 0.9, fp_u, fp_v)
    pores = streaks(u, v, 5.0, seed + 5) * _fade(1.0, 14.0, fp_u, fp_v)
    brush = streaks(u, v + 0.04 * u, 2.6, seed + 6, wander=0.4, break_freq=0.08) * _fade(0.6, 8.0, fp_u, fp_v)
    peel = (fbm(u * 2.5 + v * 0.7, v * 2.5, seed + 7, octaves=2) - 0.5) * _fade(5.0, 5.0, fp_u, fp_v)
    return (ring_gain * (-0.075 * rings + 0.016 * patchy * ring_dark)
            + 0.012 * pores + 0.014 * brush + 0.006 * peel)


def end_grain(u, v, seed, centre, fp_u, fp_v, ring_gain=1.0):
    """Paint over end grain: concentric rings plus rough matte texture."""
    uc, vc = centre
    radii, dark = ring_table(seed + 1, mean=0.8)
    rr = np.sqrt((u - uc) ** 2 + ((v - vc) * 1.25) ** 2)
    rr = rr + 0.5 * (fbm(u * 0.06, v * 0.06, seed + 2, octaves=2) - 0.5)
    phase, ring_dark = ring_phase(rr, radii, dark)
    f = phase - np.floor(phase)
    band = np.clip(f / 0.75, 0, 1) ** 2.0 * np.clip((1 - f) / 0.25, 0, 1)
    rings = band * ring_dark * (0.5 + 0.5 * fbm(u * 0.1, v * 0.1, seed + 4)) \
        * _fade(1.0 / 0.8, 1.0 / 0.8, fp_u, fp_v)
    rough = (fbm(u * 2.5, v * 2.5, seed + 5, octaves=3) - 0.5) * _fade(10.0, 10.0, fp_u, fp_v)
    fine = (fbm(u * 6, v * 6, seed + 6, octaves=2) - 0.5) * _fade(12.0, 12.0, fp_u, fp_v)
    return ring_gain * (-0.055 * rings + 0.012 * ring_dark) + 0.025 * rough + 0.010 * fine


WORN = np.array([0.88, 0.80, 0.66], np.float32)      # pale primer / bare wood at chips


def apply_wood(scene, src_full, top, scale_x, scale_y, verbose=True):
    """
    scene    : float32 HxWx3, the upscaled 16:9 frame (OUT_W x OUT_H)
    src_full : float32 source image (1562x1007) used for the colour masks
    top      : rows cropped off the top of the source before upscaling
    scale_x/y: output px per source px
    """
    H, W = scene.shape[:2]
    Hs, Ws = src_full.shape[:2]
    h, s, v = hsv(src_full)

    # occluder: the pan (peach body, grey interior and rim, loop handle)
    pan = ((h > 12) & (h < 32) & (s > 0.28) & (s < 0.6) & (v > 0.55)) | ((s < 0.14) & (v < 0.5))
    x0, y0, x1, y1 = PAN_LOOP
    pan[y0:y1, x0:x1] = True
    pan_im = Image.fromarray((pan * 255).astype(np.uint8)).filter(__import__("PIL.ImageFilter", fromlist=["MaxFilter"]).MaxFilter(5))
    pan = np.asarray(pan_im) > 0

    def to_out(x, y):
        return x * scale_x, (y - top) * scale_y

    out = scene.copy()
    for name, F in FACES.items():
        pts = F["pts"]
        poly_src = [(p[0], p[1]) for p in pts]
        # colour mask at source res inside a generous polygon, pan excluded
        m = Image.new("L", (Ws, Hs), 0)
        ImageDraw.Draw(m).polygon(poly_src, fill=255)
        m = (np.asarray(m) > 0) & in_range(h, *F["hue"]) & (s >= F["sat"][0]) & (s <= F["sat"][1]) \
            & (v >= F["val"][0]) & (v <= F["val"][1]) & ~pan
        m = m[top: top + int(round(H / scale_y))].astype(np.float32)
        mask = np.asarray(Image.fromarray(m, mode="F").resize((W, H), Image.BILINEAR), np.float32)
        mask = np.clip((mask - 0.35) / 0.3, 0, 1)
        if mask.max() == 0:
            continue

        # bounding box of the face in output coords
        ys, xs = np.nonzero(mask > 0)
        by0, by1, bx0, bx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        mk = mask[by0:by1, bx0:bx1]
        yy, xx = np.mgrid[by0:by1, bx0:bx1].astype(np.float32)

        # homography output px -> wood cm
        poly_out = [to_out(p[0], p[1]) for p in pts]
        Hm = homography(poly_out, [(p[2], p[3]) for p in pts])
        den = Hm[2, 0] * xx + Hm[2, 1] * yy + Hm[2, 2]
        u = (Hm[0, 0] * xx + Hm[0, 1] * yy + Hm[0, 2]) / den
        vv = (Hm[1, 0] * xx + Hm[1, 1] * yy + Hm[1, 2]) / den

        seed = F["seed"]
        length = max(p[2] for p in pts)
        height = max(p[3] for p in pts)
        # pixel footprint in cm, to keep fine terms from aliasing far down the bar
        gy, gx = np.gradient(u)
        fp_u = np.sqrt(gx * gx + gy * gy)
        gy, gx = np.gradient(vv)
        fp_v = np.sqrt(gx * gx + gy * gy)
        rg = F.get("gain", 1.0)
        if F["kind"] == "face":
            mod = face_grain(u, vv, seed, length, height, fp_u, fp_v, rg)
        else:
            if "seam" in F:                       # two pieces glued along the diagonal
                (ax, ay), (bx, by) = [to_out(*p) for p in F["seam"]]
                side = (bx - ax) * (yy - ay) - (by - ay) * (xx - ax) > 0
                m1 = end_grain(u, vv, seed, (-10, 60), fp_u, fp_v, rg)
                m2 = end_grain(u, vv, seed + 50, (70, -20), fp_u, fp_v, rg)
                mod = np.where(side, m1, m2)
                # the glue line itself: a hair darker
                dseam = seg_dist(xx, yy, (ax, ay), (bx, by))
                mod = mod - 0.06 * np.exp(-(dseam / 1.6) ** 2)
            else:
                mod = end_grain(u, vv, seed, (25, 95), fp_u, fp_v, rg)

        # edge wear on real arrises: intermittent chips of pale primer, plus a
        # faint highlight where the softened edge catches light
        d = np.full_like(xx, 1e9)
        for i in F["arris"]:
            a = poly_out[i]
            b = poly_out[(i + 1) % 4]
            d = np.minimum(d, seg_dist(xx, yy, a, b))
        chip_noise = fbm(u * 0.45, vv * 0.45, seed + 20, octaves=3)      # chips every few cm, irregular
        chips = np.exp(-d / 7.0) * np.clip((chip_noise - 0.62) * 6.0, 0, 1)
        edge_light = 0.05 * np.exp(-(d / 2.2) ** 2)

        mod = _box3(mod)
        region = out[by0:by1, bx0:bx1]
        tex = region * (1.0 + mod + edge_light)[..., None]
        tex = tex + (chips * 0.6)[..., None] * (WORN - tex)
        out[by0:by1, bx0:bx1] = region * (1 - mk[..., None]) + tex * mk[..., None]
        if verbose:
            print(f"    wood: {name:8s} {F['kind']:4s} px={int((mk > 0).sum()):8d}")

    return np.clip(out, 0, 1)
