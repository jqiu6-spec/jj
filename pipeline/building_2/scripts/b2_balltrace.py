#!/usr/bin/env python3
"""Ray-traced light of the spherical LED balls of building 2 (they shine on their surroundings).

usage: python3 -I scripts/b2_balltrace.py IN_relit_2x.png OUT_2x.png [--gain 1.0] [--debug out/bt_light.png]

IN is normally the ball-free relight (b2_relight.py ... --no-balls); OUT = IN + the light of every ball in out/balls.json.
Reads out/balls.json, out/geo.npz, out/signgeo.npz, scene/base.png and the ball textures; ~3 min, peak ~2.2 GB RAM.

Emitters   the WHOLE sphere surface of each ball: Fibonacci samples (1500-4000 per ball) with outward normal, 3-D position
           (centre = proxy surface point at the ball's page position (Pf for anchor 'far', Pn for 'near') pushed toward
           the camera by hover_1x + r_1x) and radiance = linear LED colour of the equirect texture averaged over the
           sample's own Voronoi cell on the sphere (box filter of the texture), in the ball frame of b2_sphere.py (tilt
           about ex, lon = atan2(X,-Z)+rot). LED emission profile as in b2_sphere.py (0.35 + 0.65 cos^0.6). Mounted
           balls emit only from the part of the sphere in front of their panel plane (the centre sits ~0.75 r above
           the panel, so this includes the belt facing the panel: contact glow). A ball resting on a roof gets that roof as its
           analytic support plane (the proxy stores roofs as decals on the convex wall, which would bury the ball).
Receivers  proxy surfaces (out/geo.npz P/N, sky skipped) and sign parts (out/signgeo.npz SM, SP/SN) on a grid every
           --stride px (1x page), micro-geometry offset / wrapped cosine as in b2_relight.py.
Transport  Lambert with cosine at both ends, 1/(d^2 + d0^2) (soft near-field clamp), haze extinction exp(-d/ext).
Visibility shadow rays from every receiver of a coarser grid (--vstride) to one jittered sample of each of the
           --clusters light clusters of a ball, marched in 3-D through a 2.5-D depth buffer: the proxy geometry (solid,
           infinitely thick) plus the sign layer (slabs of finite thickness, so rays can pass behind a hovering
           blade), the support plane, plus an analytic test against the other balls. A receiver is never shadowed by
           its own depth-continuous surface patch (the proxy is only roughly consistent with its normals; smooth
           cylinders/planes/convex boxes cannot self-shadow a light in front of them). The shadowed/unshadowed ratio
           is upsampled depth/normal-aware to the transport grid, and the transport grid to the page, again
           depth/normal-aware.
Glossy     walkway tops (gloss 0.10), sign metal returns (0.25) and the cover glass of emissive LED panels (Schlick,
           F0 --f0) reflect the balls: the mirror direction of the orthographic view ray (+z), roughness-blurred by a
           Gaussian lobe of --spp directions (+ a wide haze lobe on cover glass), traced analytically against the
           spheres; occlusion by 4 rays per pixel and ball (lobe sectors), smoothed per surface patch.
Albedo     the photo's own local texture (0.32*tex*chroma, b2_relight.py, lit windows capped before the local mean);
           sign returns 0.22; the black face of emissive LED panels --em-albedo (0.10; 0 = reflection only).
The diffuse term carries the same exaggeration factor (--base 3) as b2_relight.py --gain 3, so --gain 1 is consistent
with the sign lights. Debug: --only NAME[,NAME], --no-diffuse, --no-glossy, --dump maps.npz.
"""

import argparse, json, math, time
import numpy as np, cv2
from PIL import Image
from scipy.spatial import cKDTree
from scipy import ndimage

T0 = time.time()
def log(*a): print('[%6.1fs]' % (time.time() - T0), *a, flush=True)

def s2l(x): return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4).astype(np.float32)
def l2s(x):
    x = np.clip(x, 0, None); return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055).astype(np.float32)
def unit(v): return (v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-12)).astype(np.float32)

ap = argparse.ArgumentParser()
ap.add_argument('inp'); ap.add_argument('out')
ap.add_argument('--gain', type=float, default=1.0, help='overall strength of the ball light')
ap.add_argument('--spec', type=float, default=1.0, help='extra factor on the glossy reflections')
ap.add_argument('--base', type=float, default=3.0, help='diffuse exaggeration (b2_relight.py uses --gain 3)')
ap.add_argument('--debug', default=None, help='write the added light only (x4, sRGB) here')
ap.add_argument('--stride', type=int, default=3, help='transport receiver grid (1x px)')
ap.add_argument('--vstride', type=int, default=6, help='visibility receiver grid (1x px, multiple of --stride)')
ap.add_argument('--clusters', type=int, default=96, help='light clusters per big ball (shadow rays per receiver)')
ap.add_argument('--clusters-small', type=int, default=64)
ap.add_argument('--samples', type=int, default=4000, help='max emitter samples per ball')
ap.add_argument('--step', type=float, default=2.0, help='shadow-ray march step (1x px, image space)')
ap.add_argument('--ext', type=float, default=260.0, help='haze extinction length (page px), as b2_relight.py')
ap.add_argument('--d0', type=float, default=8.0, help='soft near-field clamp (page px)')
ap.add_argument('--thr', type=float, default=6e-5, help='skip receivers whose unshadowed upper bound is below this')
ap.add_argument('--f0', type=float, default=0.04, help='LED cover glass reflectance at normal incidence')
ap.add_argument('--rough-cover', type=float, default=0.10, help='cover glass lobe width (rad)')
ap.add_argument('--haze-cover', type=float, default=0.25, help='fraction of the cover reflection in a wide haze lobe')
ap.add_argument('--spp', type=int, default=48, help='glossy reflection directions per pixel')
ap.add_argument('--gsmooth', type=float, default=2.0, help='per-surface smoothing of the glossy reflections (1x px)')
ap.add_argument('--em-albedo', type=float, default=0.10, help='diffuse albedo of the black face of emissive LED panels (0 = reflection only)')
ap.add_argument('--seed', type=int, default=7)
ap.add_argument('--only', default=None, help='comma-separated ball names to light with (debugging; all balls still occlude)')
ap.add_argument('--no-diffuse', action='store_true', help='skip the diffuse transport (debugging)')
ap.add_argument('--no-glossy', action='store_true', help='skip the glossy reflections (debugging)')
ap.add_argument('--dump', default=None, help='save intermediate maps (npz: per-ball grid irradiance, page irradiance, reflections)')
a = ap.parse_args()
rng = np.random.default_rng(a.seed)

# ----------------------------------------------------------------------------------------------------------- inputs
S2L = s2l(np.arange(256, dtype=np.float32) / 255)                                          # sRGB8 -> linear LUT
F8 = np.asarray(Image.open(a.inp).convert('RGB'))                                          # 2x, sRGB (linear per strip)
H2, W2 = F8.shape[:2]; H, W = H2 // 2, W2 // 2
geo = np.load('out/geo.npz')
P = geo['P'][:H, :W].astype(np.float32); N = unit(geo['N'][:H, :W].astype(np.float32)); cls = geo['cls'][:H, :W]
Pf, Pn = geo['Pf'][:H, :W], geo['Pn'][:H, :W]; th = float(geo['th'])
sg = np.load('out/signgeo.npz')
EM, SM, SP, SN = sg['EM'][:H, :W], sg['SM'][:H, :W], sg['SP'][:H, :W].astype(np.float32), unit(sg['SN'][:H, :W].astype(np.float32))
BALLm = sg['BALL'][:H, :W] > 0.5 if 'BALL' in sg.files else np.zeros((H, W), bool)
meta = json.load(open('out/balls.json'))
up = np.array([0, -math.cos(th), -math.sin(th)], np.float32)                               # world up (camera coords)
hv = np.array([0, -math.sin(th), math.cos(th)], np.float32)                                # horizontal forward
ex = np.array([1.0, 0, 0], np.float32)
Bw = np.stack([ex, up, hv]).astype(np.float64)                                             # world = Bw @ cam
SMm = (SM > 0.5) & ~BALLm
EMm = (EM > 0.5) & ~BALLm
YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)
log('inputs %dx%d (2x), page %dx%d' % (W2, H2, W, H))

# ----------------------------------------------------------------------------------------------------------- balls
def build_pyr(lin):
    """linear-light mip pyramid of an equirect texture, each level wrap-padded by 2 columns"""
    lv, cur = [], lin
    while True:
        h, w = cur.shape[:2]
        lv.append((np.ascontiguousarray(np.concatenate([cur[:, -2:], cur, cur[:, :2]], 1)), w, h))
        if min(w, h) <= 4: break
        cur = cv2.resize(cur, (w // 2, h // 2), interpolation=cv2.INTER_AREA)
    return lv

def _remap(img, X, Y):
    n = X.size; cols = 4096; rows = (n + cols - 1) // cols
    mx = np.zeros(rows * cols, np.float32); my = np.zeros(rows * cols, np.float32); mx[:n] = X; my[:n] = Y
    return cv2.remap(img, mx.reshape(rows, cols), my.reshape(rows, cols), cv2.INTER_LINEAR,
                     borderMode=cv2.BORDER_REPLICATE).reshape(rows * cols, -1)[:n]

def sample_pyr(pyr, u, v, lod):
    """trilinear lookup; u, v in level-0 texel units (u wraps)"""
    out = np.zeros((len(u), 3), np.float32)
    if len(u) == 0: return out
    W0, H0 = pyr[0][1], pyr[0][2]
    lod = np.clip(lod, 0, len(pyr) - 1 - 1e-3); l0 = np.floor(lod).astype(int); fr = (lod - l0).astype(np.float32)
    for k in range(int(l0.min()), int(l0.max()) + 2):
        wk = np.where(l0 == k, 1 - fr, 0) + np.where(l0 + 1 == k, fr, 0)
        m = np.nonzero(wk > 1e-6)[0]
        if len(m) == 0 or k >= len(pyr): continue
        pad, w, h = pyr[k]
        X = np.mod(u[m] * (w / W0), w) - 0.5 + 2; Y = v[m] * (h / H0) - 0.5
        out[m] += _remap(pad, X.astype(np.float32), Y.astype(np.float32)) * wk[m][:, None]
    return out

def fib(n):
    i = np.arange(n) + 0.5; y = 1 - 2 * i / n; rr = np.sqrt(1 - y * y); ph = i * math.pi * (3 - math.sqrt(5))
    return np.stack([rr * np.cos(ph), y, rr * np.sin(ph)], 1)

def zsample(img, x, y):
    x0, y0 = int(math.floor(x)), int(math.floor(y)); fx, fy = x - x0, y - y0
    g = lambda yy, xx: float(img[min(max(yy, 0), H - 1), min(max(xx, 0), W - 1), 2])
    return (g(y0, x0) * (1 - fx) + g(y0, x0 + 1) * fx) * (1 - fy) + (g(y0 + 1, x0) * (1 - fx) + g(y0 + 1, x0 + 1) * fx) * fy

class Ball: pass
balls = []
for bi, b in enumerate(meta['balls']):
    o = Ball(); o.name = b['name']
    o.x, o.y, o.r = (b['cx'] - 0.5) / 2, (b['cy'] - 0.5) / 2, b['r'] / 2                # 1x page px
    zs = zsample(Pf if b.get('anchor', 'far') == 'far' else Pn, o.x, o.y)
    o.c = np.array([o.x, o.y, zs - b.get('hover_1x', 0.0) - o.r], np.float32)
    t = math.radians(b.get('tilt_deg', 0.0)); ct, st = math.cos(t), math.sin(t)
    R = np.array([[1, 0, 0], [0, ct, st], [0, -st, ct]])                                  # ball -> world
    o.M = (R.T @ Bw)                                                                      # camera -> ball frame
    o.rot = math.radians(b.get('rot_deg', 0.0)); o.mounted = bool(b.get('mounted', False))
    im = np.asarray(Image.open(b['texture']).convert('RGBA'), np.float32) / 255
    lin = np.ascontiguousarray(s2l(im[..., :3]) * im[..., 3:4])
    o.pyr = build_pyr(lin); o.W0, o.H0 = lin.shape[1], lin.shape[0]
    # ring of page pixels around the ball: panel normal (mounted) / support detection (resting)
    dist = np.hypot(XX - o.x, YY - o.y)
    ring = (dist > 1.15 * o.r) & (dist < 1.8 * o.r) & SMm
    o.np_ = None; o.support = None; o.cut = 0.0
    if o.mounted and ring.sum() > 10:
        o.np_ = unit(SN[ring].mean(0))
        # the sphere emits wherever it is in front of the PANEL PLANE: the centre sits hover_1x + r in front of the
        # wall along the view axis, i.e. ~0.75 r above the panel, so the belt facing the panel (the contact glow) is
        # outside the panel too; only the small cap behind the panel plane is dark
        o.hpan = float((o.c - SP[ring].mean(0)) @ o.np_)
        o.cut = float(np.clip(-o.hpan / o.r, -1.0, 1.0))
    elif (not o.mounted) and ring.sum() > 10 and b.get('hover_1x', 0) < 2.5 * o.r:
        nr = unit(SN[ring].mean(0))
        if float(nr @ up) > 0.9:                                                          # rests on a horizontal top
            o.support = (up.copy(), o.c - o.r * up)
    # emitter samples (ball frame), Voronoi-averaged LED colour
    nfull = int(np.clip(round(4 * math.pi * o.r ** 2 / 5.0), 1500, a.samples))
    db = fib(nfull)
    pl = o.pyr[1] if o.W0 >= 1024 else o.pyr[0]
    tw, thh = pl[1], pl[2]; tex = pl[0][:, 2:-2]
    vv, uu = np.mgrid[0:thh, 0:tw]
    lon = ((uu + 0.5) / tw - 0.5) * 2 * math.pi - o.rot; lat = (0.5 - (vv + 0.5) / thh) * math.pi
    pb = np.stack([np.cos(lat) * np.sin(lon), np.sin(lat), -np.cos(lat) * np.cos(lon)], -1).reshape(-1, 3)
    _, j = cKDTree(db).query(pb, workers=-1)
    wt = np.cos(lat).ravel()
    rad = np.stack([np.bincount(j, wt * tex[..., k].ravel(), minlength=nfull) for k in range(3)], 1)
    rad /= np.maximum(np.bincount(j, wt, minlength=nfull), 1e-9)[:, None]
    ncam = db @ o.M                                                                       # (M maps cam->ball)
    keep = np.ones(nfull, bool)
    if o.np_ is not None: keep = ncam @ o.np_ > o.cut                                     # in front of its panel plane
    K = a.clusters if o.r > 60 else a.clusters_small
    _, cl = cKDTree(fib(K)).query(db[keep])
    order = np.argsort(cl, kind='stable')
    o.Ln = ncam[keep][order].astype(np.float32); o.Lr = rad[keep][order].astype(np.float32)
    o.Lp = (o.c[None] + o.r * o.Ln).astype(np.float32); o.A = 4 * math.pi * o.r ** 2 / nfull
    cnt = np.bincount(cl, minlength=K); cnt = cnt[cnt > 0]
    o.cstart = np.concatenate([[0], np.cumsum(cnt)[:-1]]).astype(np.int64); o.ccount = cnt.astype(np.int64)
    o.K = len(cnt)
    lum = o.Lr @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    o.Lbound = float(np.percentile(lum, 97))
    log('%s: centre (%.1f, %.1f, %.1f) r %.1f, %d emitters (%d of %d), %d clusters, mean radiance %s%s%s' % (
        o.name, *o.c, o.r, len(o.Lp), keep.sum(), nfull, o.K, np.round(o.Lr.mean(0), 3),
        ', panel n %s, centre %.1f px above the panel' % (np.round(o.np_, 3), o.hpan) if o.np_ is not None else '',
        ', resting on a top' if o.support else ''))
    balls.append(o)

# ----------------------------------------------------------------------------------------------------------- scene
# sign positions, with the roof a resting ball sits on replaced by its true plane (the proxy stores that roof as a
# decal on the convex wall, which would put the ball inside it)
SPo = SP.copy(); SUP = np.full((H, W), -1, np.int16); planes = []
for o in balls:
    if o.support is None: continue
    ns, p0 = o.support
    m = (SMm | BALLm) & ((SN @ ns) > 0.95) | (np.hypot(XX - o.x, YY - o.y) < o.r * 1.05)
    nl, lab = cv2.connectedComponents(m.astype(np.uint8), connectivity=8)
    dist = np.hypot(XX - o.x, YY - o.y)
    ids = np.unique(lab[(dist < 1.8 * o.r) & m]); ids = ids[ids > 0]
    reg = np.isin(lab, ids)
    zpl = p0[2] - (ns[0] * (XX - p0[0]) + ns[1] * (YY - p0[1])) / ns[2]
    SPo[reg, 2] = zpl[reg]; SPo[reg, :2] = np.stack([XX, YY], -1)[reg]
    SUP[reg] = len(planes); planes.append(np.concatenate([ns, [-float(ns @ p0)]]))
    log('%s: support plane region %d px' % (o.name, reg.sum()))
planes = np.array(planes, np.float32).reshape(-1, 4)

def slope(n): return np.clip(2.5 + 1.0 * np.hypot(n[..., 0], n[..., 1]) / np.maximum(np.abs(n[..., 2]), 0.15), 2.5, 12)
INF = np.float32(1e9)
Zg = np.where(cls > 0, P[..., 2] - slope(N), INF)
Zs = np.where(SMm, SPo[..., 2] - slope(SN), INF)
Zb = np.where(SMm, SPo[..., 2] + np.clip(P[..., 2] - SPo[..., 2], 8, 60), -INF)
Zg[SUP >= 0] = INF; Zs[SUP >= 0] = INF

def patches(z, kind, valid, thr):
    """labels of depth-continuous surface patches: 4-connected pixels of the same kind whose depth steps stay below thr.
    The proxy surfaces are smooth cylinders/planes (or convex sign boxes), which cannot shadow themselves for a light in
    front of them (the receiver cosine already handles a convex surface turning away), but the 2.5-D proxy is only
    approximately consistent with its normals (walkway tops are stored as decals on vertical cylinders), so a ray that
    grazes its own patch must not count it as an occluder."""
    e = ~valid.copy()
    dx = (np.abs(np.diff(z, axis=1)) > thr) | (kind[:, 1:] != kind[:, :-1])
    dy = (np.abs(np.diff(z, axis=0)) > thr) | (kind[1:] != kind[:-1])
    e[:, 1:] |= dx; e[1:] |= dy
    n_, lab = cv2.connectedComponents((~e).astype(np.uint8), connectivity=4)
    lab = lab.astype(np.int32)
    holes = valid & (lab == 0)                                                            # 1-px seams: nearest patch
    if holes.any():
        _, (iy, ix) = ndimage.distance_transform_edt(lab == 0, return_indices=True)
        lab[holes] = lab[iy[holes], ix[holes]]
    lab[~valid] = -1
    return lab, n_

LabG, nG = patches(P[..., 2], cls.astype(np.int32), cls > 0, 16.0)
LabS, nS = patches(SPo[..., 2], (SUP + 2).astype(np.int32), SMm, 16.0)
LabS = np.where(LabS >= 0, LabS + 1_000_000, -1)
log('surface patches: %d proxy, %d sign' % (nG, nS))
DB = np.ascontiguousarray(np.stack([Zg, Zs, Zb, SUP.astype(np.float32), LabG.astype(np.float32), LabS.astype(np.float32)],
                                   -1).reshape(-1, 6).astype(np.float32))
HAS_SUP = len(planes) > 0

def seg_sphere(R, Q, c, r):
    d = Q - R; f = R - c
    aa = (d * d).sum(1); bb = 2 * (f * d).sum(1); cc = (f * f).sum(1) - r * r
    disc = bb * bb - 4 * aa * cc
    sq = np.sqrt(np.maximum(disc, 0)); t1 = (-bb - sq) / (2 * aa + 1e-12); t2 = (-bb + sq) / (2 * aa + 1e-12)
    return (disc > 0) & (t1 < 0.999) & (t2 > 0.001)

def march(R, Q, rl=None, skip=None, chunk=3_000_000):
    """True where the segment R->Q (page px, camera space) is unoccluded; rl = surface patch label of the receiver
    end (its own patch never occludes it)"""
    n = len(R); vis = np.ones(n, bool)
    if n == 0: return vis
    if rl is None: rl = np.full(n, -2, np.float32)
    for bj, o in enumerate(balls):
        if bj != skip: vis &= ~seg_sphere(R, Q, o.c, o.r)
    for s0 in range(0, n, chunk):
        idx = np.nonzero(vis[s0:s0 + chunk])[0] + s0
        if len(idx) == 0: continue
        r0 = R[idx]; d = Q[idx] - r0; lab = rl[idx].astype(np.float32)
        L3 = np.linalg.norm(d, axis=1) + 1e-6
        ns = np.maximum(np.ceil(np.hypot(d[:, 0], d[:, 1]) / a.step), 2).astype(np.int32)
        t0 = np.minimum(0.4, 2.5 / L3).astype(np.float32); span = (1 - t0 - np.minimum(0.4, 1.5 / L3)).astype(np.float32)
        jit = rng.random(len(idx), dtype=np.float32)
        ids = idx; k = 0
        while len(ids):
            t = t0 + span * (k + jit) / ns
            p = r0 + t[:, None] * d
            xi = np.rint(p[:, 0]).astype(np.int32); yi = np.rint(p[:, 1]).astype(np.int32)
            inb = (xi >= 0) & (xi < W) & (yi >= 0) & (yi < H)
            q = DB[np.clip(yi, 0, H - 1) * W + np.clip(xi, 0, W - 1)]
            z = p[:, 2]
            occ = inb & (((q[:, 0] < z) & (q[:, 4] != lab)) | ((q[:, 1] < z) & (z < q[:, 2]) & (q[:, 5] != lab)))
            if HAS_SUP:
                sm = inb & (q[:, 3] >= 0)
                if sm.any():
                    pl = planes[q[sm, 3].astype(int)]
                    occ[sm] |= (p[sm] * pl[:, :3]).sum(1) + pl[:, 3] < -1.0
            vis[ids[occ]] = False
            k += 1
            keep = ~occ & (k < ns)
            if not keep.all():
                ids, r0, d, ns, t0, span, jit, lab = ids[keep], r0[keep], d[keep], ns[keep], t0[keep], span[keep], jit[keep], lab[keep]
    return vis

# ----------------------------------------------------------------------------------------------------------- receivers
def surf(ys, xs):
    """receiver position (with the micro-geometry offset of b2_relight.py), normal, wrap, surface id at page pixels"""
    isS = SMm[ys, xs]; isE = EMm[ys, xs]; c_ = cls[ys, xs]
    p = np.where(isS[..., None], SPo[ys, xs], P[ys, xs]); n = np.where(isS[..., None], SN[ys, xs], N[ys, xs])
    off = np.where(isS, 2.0, 15.0).astype(np.float32)
    wrap = np.where(isS, 0.0, np.where(c_ == 1, 0.35, np.where(c_ == 2, 0.2, 0.0))).astype(np.float32)
    sid = np.where(isS, np.where(isE, 20, 9), c_).astype(np.int16)
    valid = ((c_ > 0) | isS) & ~BALLm[ys, xs]
    lab = np.where(isS, LabS[ys, xs], LabG[ys, xs]).astype(np.float32)
    return (p + n * off[..., None]).astype(np.float32), n.astype(np.float32), wrap, sid, valid, isE, lab

s = a.stride; og = s // 2
gy, gx = np.mgrid[og:H:s, og:W:s]; gh, gw = gy.shape
Rp, Rn, Rw, Rid, Rvalid, RisE, Rlab = surf(gy, gx)
diff_ok = Rvalid & (~RisE | (a.em_albedo > 0))
mv = max(1, a.vstride // s)
isvis = np.zeros((gh, gw), bool); isvis[::mv, ::mv] = True
log('receiver grid %dx%d (stride %d), visibility grid stride %d' % (gw, gh, s, s * mv))

def jbu(val, valid, sp, sn, sid, so, ss, tx, ty, tp, tn, tid, rad=2, sig=6.0):
    """joint (depth/normal/surface-aware) upsampling of grid values (origin so, stride ss) to targets (tx, ty)"""
    gh_, gw_ = valid.shape
    fx = (tx - so) / ss; fy = (ty - so) / ss
    ix0 = np.floor(fx).astype(np.int32); iy0 = np.floor(fy).astype(np.int32)
    acc = np.zeros(tx.shape + (val.shape[-1],), np.float32); wsum = np.zeros(tx.shape, np.float32)
    for dy in range(-rad + 1, rad + 1):
        for dx in range(-rad + 1, rad + 1):
            jx = ix0 + dx; jy = iy0 + dy
            ok = (jx >= 0) & (jx < gw_) & (jy >= 0) & (jy < gh_)
            jx = np.clip(jx, 0, gw_ - 1); jy = np.clip(jy, 0, gh_ - 1)
            ws = np.clip(1 - np.abs(fx - jx) / rad, 0, 1) * np.clip(1 - np.abs(fy - jy) / rad, 0, 1)
            dpl = ((sp[jy, jx] - tp) * tn).sum(-1)
            cn = np.clip((sn[jy, jx] * tn).sum(-1), 0, 1)
            w = ws * np.exp(-(dpl / sig) ** 2) * cn ** 4 * (sid[jy, jx] == tid) * valid[jy, jx] * ok
            acc += w[..., None] * val[jy, jx]; wsum += w
    return acc / np.maximum(wsum, 1e-12)[..., None], wsum

# ----------------------------------------------------------------------------------------------------------- transport
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
Ed = np.zeros((gh, gw, 3), np.float32); Ed_ball = {}; S_ball = {}
ray_total = 0
ONLY = set(a.only.split(',')) if a.only else None
def active(o): return ONLY is None or o.name in ONLY
for bi, o in enumerate(balls):
    if a.no_diffuse or not active(o): continue
    tb = time.time()
    v = o.c[None, None] - Rp
    dist = np.linalg.norm(v, axis=-1) + 1e-6
    facing = ((Rn * v).sum(-1) + o.r) / dist + Rw > 0
    bound = o.Lbound * (o.r / np.maximum(dist, o.r)) ** 2 * np.exp(-np.maximum(dist - o.r, 0) / a.ext) * 0.32 * 2.5 * a.base * a.gain
    act = diff_ok & facing & (bound > a.thr)
    ai = np.nonzero(act.ravel())[0]
    if len(ai) == 0: continue
    p_all, n_all, w_all = Rp.reshape(-1, 3)[ai] - o.c, Rn.reshape(-1, 3)[ai], Rw.ravel()[ai]
    vflag = isvis.ravel()[ai]
    Lc = o.Lp - o.c; Lnr = o.Ln; Lr = o.Lr; NL = len(Lc)
    lc2 = (Lc * Lc).sum(1); lcn = (Lc * Lnr).sum(1)
    Etot = np.zeros((len(ai), 3), np.float32)
    vrows = np.nonzero(vflag)[0]; Ec = np.zeros((len(vrows), o.K, 3), np.float32); vpos = np.full(len(ai), -1, np.int64)
    vpos[vrows] = np.arange(len(vrows))
    ch = max(64, int(6e6 // NL))
    for c0 in range(0, len(ai), ch):
        pr, nr, wr = p_all[c0:c0 + ch], n_all[c0:c0 + ch], w_all[c0:c0 + ch, None]
        d2 = (pr * pr).sum(1)[:, None] + lc2[None] - 2 * (pr @ Lc.T)
        d2 = np.maximum(d2, 1e-6); dd = np.sqrt(d2); inv = 1 / dd
        cr = np.clip(((nr @ Lc.T - (pr * nr).sum(1)[:, None]) * inv + wr) / (1 + wr), 0, None)
        cl = np.clip((pr @ Lnr.T - lcn[None]) * inv, 0, 1)
        G = cr * cl * (0.35 + 0.65 * cl ** 0.6) * (o.A / (d2 + a.d0 ** 2)) * np.exp(-dd / a.ext)
        Etot[c0:c0 + ch] = G @ Lr
        rr = np.nonzero(vflag[c0:c0 + ch])[0]
        if len(rr):
            Gv = G[rr]
            for k in range(3):
                Ec[vpos[c0 + rr], :, k] = np.add.reduceat(Gv * Lr[None, :, k], o.cstart, axis=1)
    log('%s: transport %d receivers x %d emitters (%.1fs)' % (o.name, len(ai), NL, time.time() - tb))
    # ---- visibility on the coarse grid: one jittered sample per cluster and receiver
    tb = time.time()
    el = Ec @ LUM; et = el.sum(1)
    pi_, ci_ = np.nonzero(el > 2e-3 * et[:, None] + 1e-12)
    jj = o.cstart[ci_] + np.floor(rng.random(len(ci_)) * o.ccount[ci_]).astype(np.int64)
    Rv = p_all[vrows][pi_] + o.c; Qv = o.Lp[jj] + o.Ln[jj] * 1.0
    V = march(Rv.astype(np.float32), Qv.astype(np.float32), Rlab.ravel()[ai][vrows][pi_], skip=bi)
    ray_total += len(V)
    Es = Ec.copy(); Es[pi_, ci_] *= V[:, None]                       # clusters below 0.2% of the flux count as lit
    S = (Es.sum(1) + 1e-9) / (Ec.sum(1) + 1e-9)
    log('%s: visibility %d rays, %.1f%% lit (%.1fs)' % (o.name, len(V), 100 * V.mean() if len(V) else 0, time.time() - tb))
    # ---- shadow ratio -> transport grid (depth/normal aware); receivers without a usable neighbour trace their own
    vg = np.zeros((gh, gw, 3), np.float32); vvalid = np.zeros((gh, gw), bool)
    fl = np.zeros(gh * gw, bool); fl[ai[vrows]] = True; vvalid = fl.reshape(gh, gw)
    tmp = np.zeros((gh * gw, 3), np.float32); tmp[ai[vrows]] = S; vg = tmp.reshape(gh, gw, 3)
    sub = (slice(None, None, mv), slice(None, None, mv))
    ty, tx = gy.reshape(-1)[ai].astype(np.float32), gx.reshape(-1)[ai].astype(np.float32)
    Sup, wsum = jbu(vg[sub], vvalid[sub], Rp[sub], Rn[sub], Rid[sub], og, s * mv,
                    tx, ty, Rp.reshape(-1, 3)[ai], Rn.reshape(-1, 3)[ai], Rid.ravel()[ai])
    orph = np.nonzero((wsum < 1e-3) & ~vflag)[0]
    if len(orph):
        e2 = Etot[orph] @ LUM
        orph = orph[e2 > a.thr * 0.1]
    if len(orph):
        # orphans: shadow rays to every cluster's centre sample, weighted by the cluster flux (approximation)
        mid = o.cstart + o.ccount // 2
        Ro = np.repeat(p_all[orph] + o.c, len(mid), 0); Qo = np.tile(o.Lp[mid] + o.Ln[mid], (len(orph), 1))
        fac = ((Ro - o.c) * np.tile(o.Ln[mid], (len(orph), 1))).sum(1) > o.r * 0.8
        Vo = march(Ro.astype(np.float32), Qo.astype(np.float32), np.repeat(Rlab.ravel()[ai][orph], len(mid)), skip=bi) & fac
        ray_total += len(Vo)
        fl_ = np.tile(o.Lr[mid] @ LUM * o.ccount, len(orph)) * fac
        Vr = (Vo * fl_).reshape(len(orph), -1).sum(1) / np.maximum(fl_.reshape(len(orph), -1).sum(1), 1e-9)
        Sup[orph] = Vr[:, None]
    Sup[vflag] = S
    Ed.reshape(-1, 3)[ai] += Etot * np.clip(Sup, 0, 1.5)
    if a.dump:
        e_ = np.zeros((gh * gw, 3), np.float32); e_[ai] = Etot * np.clip(Sup, 0, 1.5); Ed_ball[o.name] = e_.reshape(gh, gw, 3)
        s_ = np.full(gh * gw, -1, np.float32); s_[ai] = Sup @ LUM; S_ball[o.name] = s_.reshape(gh, gw)
    log('%s: %d orphan receivers traced, done' % (o.name, len(orph)))

# ----------------------------------------------------------------------------------------------------------- to page
log('upsampling irradiance')
lit = (Ed.sum(-1) > 0) & diff_ok
ys_, xs_ = np.nonzero(lit)
E1 = np.zeros((H, W, 3), np.float32)
if len(ys_):
    by0, by1 = max(0, int(gy[ys_.min(), 0]) - 8), min(H, int(gy[ys_.max(), 0]) + 9)
    bx0, bx1 = max(0, int(gx[0, xs_.min()]) - 8), min(W, int(gx[0, xs_.max()]) + 9)
    yy, xx = np.mgrid[by0:by1, bx0:bx1]
    tp, tn, _, tid, tval, tisE, _ = surf(yy, xx)
    up1, ws1 = jbu(Ed, diff_ok, Rp, Rn, Rid, og, s, xx.astype(np.float32), yy.astype(np.float32), tp, tn, tid)
    # pixels whose surface has no grid sample nearby (thin features): plain normalized convolution of the grid
    num = cv2.GaussianBlur(Ed * diff_ok[..., None], (0, 0), 1.0); den = cv2.GaussianBlur(diff_ok.astype(np.float32), (0, 0), 1.0)
    fill = np.ascontiguousarray(num / np.maximum(den, 1e-6)[..., None])
    fb = cv2.remap(fill, ((xx - og) / s).astype(np.float32), ((yy - og) / s).astype(np.float32), cv2.INTER_LINEAR,
                   borderMode=cv2.BORDER_REPLICATE)
    k = np.clip(ws1 / 0.05, 0, 1)[..., None]
    E1[by0:by1, bx0:bx1] = (up1 * k + fb * (1 - k)) * (tval & (~tisE | (a.em_albedo > 0)))[..., None]

# ----------------------------------------------------------------------------------------------------------- glossy
log('glossy reflections')
R1 = np.zeros((H, W, 3), np.float32)
isS = SMm; c_ = cls
gl_mask = ((c_ > 0) | isS) & ~BALLm & (EMm | (isS & ~EMm) | (c_ == 3))
gyx = np.nonzero(gl_mask)
pg = np.where(isS[gyx][:, None], SPo[gyx], P[gyx]).astype(np.float32)
ng = np.where(isS[gyx][:, None], SN[gyx], N[gyx]).astype(np.float32)
lg = np.where(isS[gyx], LabS[gyx], LabG[gyx]).astype(np.float32)
kind = np.where(EMm[gyx], 0, np.where(isS[gyx], 1, 2))                       # 0 cover glass, 1 sign metal, 2 walkway
sig = np.array([a.rough_cover, 0.25, 0.20], np.float32)[kind]
cosv = np.clip(-ng[:, 2], 0, 1)
wgt = np.where(kind == 0, a.f0 + (1 - a.f0) * (1 - cosv) ** 5, np.where(kind == 1, 0.25, 0.10)).astype(np.float32)
rdir = unit(np.stack([-2 * ng[:, 2] * ng[:, 0], -2 * ng[:, 2] * ng[:, 1], 1 - 2 * ng[:, 2] ** 2], 1))
cand = np.zeros(len(pg), bool)
for o in balls:
    vv = o.c[None] - pg; dd = np.linalg.norm(vv, axis=1) + 1e-6
    ang = np.arccos(np.clip((vv * rdir).sum(1) / dd, -1, 1)); ab = np.arcsin(np.clip(o.r / dd, 0, 1))
    wide = np.where(kind == 0, 0.6, 3 * sig)                                  # cover glass: the haze lobe reaches further
    cand |= (ang < ab + wide) & (dd > o.r * 1.01)
ci = np.nonzero(cand)[0] if not a.no_glossy else np.zeros(0, np.int64)
log('glossy pixels %d, candidates %d' % (len(pg), len(ci)))

def lobe(nsamp, sigma, rot):
    """Gaussian lobe offsets (n, K, 2): Fibonacci-disc stratified, randomly rotated per pixel"""
    i = np.arange(nsamp) + 0.5
    u = i / nsamp; rr = np.sqrt(-2 * np.log(1 - u * 0.985)); ph = i * math.pi * (3 - math.sqrt(5))
    ang = ph[None] + rot[:, None]
    return np.stack([rr[None] * np.cos(ang), rr[None] * np.sin(ang)], -1) * sigma[:, None, None]

def trace_balls(p, dirs):
    """nearest ball hit of rays p + t dirs: (t, ball index or -1)"""
    best = np.full(dirs.shape[:-1], np.inf, np.float32); bid = np.full(dirs.shape[:-1], -1, np.int16)
    for bj, o in enumerate(balls):
        f = p[:, None] - o.c
        bb = (f * dirs).sum(-1); cc = (f * f).sum(-1) - o.r * o.r
        disc = bb * bb - cc
        t = -bb - np.sqrt(np.maximum(disc, 0))
        hit = (disc > 0) & (t > 0) & (t < best)
        best = np.where(hit, t, best); bid = np.where(hit, bj, bid)
    return best, bid

def ball_radiance(o, n_hit, dirs, t, spread):
    """LED radiance leaving the ball at camera-space normals n_hit toward -dirs"""
    pb = n_hit @ o.M.T.astype(np.float32)
    lon = np.arctan2(pb[:, 0], -pb[:, 2]) + o.rot; lat = np.arcsin(np.clip(pb[:, 1], -1, 1))
    u = (np.mod(lon / (2 * math.pi) + 0.5, 1.0) * o.W0).astype(np.float32); v = ((0.5 - lat / math.pi) * o.H0).astype(np.float32)
    lod = np.log2(np.maximum(1.0, (spread * t + 0.5) / (math.pi * o.r / o.H0)))
    col = sample_pyr(o.pyr, u, v, lod)
    mu = np.clip(-(n_hit * dirs).sum(1), 0, 1)
    col *= (0.35 + 0.65 * mu ** 0.6)[:, None]
    if o.np_ is not None: col *= (n_hit @ o.np_ > o.cut)[:, None]
    return col

NB = len(balls); GQ = 4                                     # occlusion rays per reflecting pixel and ball (lobe sectors)
nc = len(ci)
Lg = np.zeros((NB, nc, GQ, 3), np.float32); hitp = np.zeros((NB, nc, GQ, 3), np.float32); hitw = np.zeros((NB, nc, GQ), np.float32)
K_ = a.spp
for c0 in range(0, nc, 20000):
    ii = ci[c0:c0 + 20000]
    p, n, r, sg_ = pg[ii], ng[ii], rdir[ii], sig[ii]
    t1 = unit(np.cross(r, np.where(np.abs(r[:, :1]) < 0.9, ex[None], np.array([[0, 1.0, 0]], np.float32))))
    t2 = np.cross(r, t1)
    rot = rng.random(len(ii)) * 2 * math.pi
    lobes = [(np.ones(len(ii), np.float32), sg_)]
    if a.haze_cover > 0:
        lobes = [(np.where(kind[ii] == 0, 1 - a.haze_cover, 1.0), sg_), (np.where(kind[ii] == 0, a.haze_cover, 0.0), np.full_like(sg_, 0.45))]
    for lw, ls in lobes:
        off = lobe(K_, ls, rot)
        sec = (np.floor(np.mod(np.arctan2(off[..., 1], off[..., 0]), 2 * math.pi) / (2 * math.pi / GQ)).astype(np.int64)) % GQ
        dirs = unit(r[:, None] + off[..., :1] * t1[:, None] + off[..., 1:] * t2[:, None])
        above = (dirs * n[:, None]).sum(-1) > 0
        tt, bid = trace_balls(p, dirs)
        bid = np.where(above & (lw[:, None] > 0), bid, -1)
        for bj, o in enumerate(balls):
            q, kk = np.nonzero(bid == bj)
            if len(q) == 0 or not active(o): continue
            hp = p[q] + tt[q, kk][:, None] * dirs[q, kk]
            nh = unit(hp - o.c)
            col = ball_radiance(o, nh, dirs[q, kk], tt[q, kk], ls[q] * 2.5 / math.sqrt(K_))
            w_ = lw[q] / K_
            cq, sq = c0 + q, sec[q, kk]
            np.add.at(Lg[bj], (cq, sq), col * w_[:, None])
            lw_ = col @ LUM * w_ + 1e-9
            np.add.at(hitw[bj], (cq, sq), lw_); np.add.at(hitp[bj], (cq, sq), hp * lw_[:, None])
# occlusion: per reflecting pixel and ball one ray for each of GQ lobe sectors, toward the flux-weighted mean hit point
# of that sector on the ball; the answers are then smoothed over neighbouring reflecting pixels (~1.5 px) -> soft edges
Lsum = np.zeros((len(pg), 3), np.float32); nref = 0
for bj, o in enumerate(balls):
    cr_, gq_ = np.nonzero(hitw[bj] > 0)
    if len(cr_) == 0: continue
    hc = hitp[bj, cr_, gq_] / hitw[bj, cr_, gq_, None]                  # (inside the ball: a mean of surface points)
    hc = o.c + unit(hc - o.c) * (o.r + 1.0)
    pix = ci[cr_]
    Vq = march(pg[pix] + ng[pix] * 2.0, hc, lg[pix], skip=bj).astype(np.float32)
    rows = np.unique(cr_); nref += len(rows)
    Lun = Lg[bj, rows].sum(1)                                           # unoccluded reflection
    Lvis = np.zeros((nc, 3), np.float32); np.add.at(Lvis, cr_, Lg[bj, cr_, gq_] * Vq[:, None])
    Lvis = Lvis[rows]
    # smoothed visible fraction (luminance weighted), applied to the unoccluded colour
    wimg = np.zeros((H, W), np.float32); vimg = np.zeros((H, W), np.float32)
    yy_, xx_ = gyx[0][ci[rows]], gyx[1][ci[rows]]
    wimg[yy_, xx_] = Lun @ LUM + 1e-9; vimg[yy_, xx_] = Lvis @ LUM
    y0_, y1_, x0_, x1_ = max(yy_.min() - 8, 0), yy_.max() + 9, max(xx_.min() - 8, 0), xx_.max() + 9
    sw = cv2.GaussianBlur(wimg[y0_:y1_, x0_:x1_], (0, 0), 1.5); sv = cv2.GaussianBlur(vimg[y0_:y1_, x0_:x1_], (0, 0), 1.5)
    Vs = np.clip(sv[yy_ - y0_, xx_ - x0_] / np.maximum(sw[yy_ - y0_, xx_ - x0_], 1e-12), 0, 1)
    Lsum[ci[rows]] += Lun * Vs[:, None]
    log('%s: %d reflecting pixels, %d occlusion rays, %.1f%% unoccluded' % (o.name, len(rows), len(Vq), 100 * Vq.mean()))
    ray_total += len(Vq)
R1[gyx] = Lsum * wgt[:, None]
# lobe-sampling noise: smooth each reflecting surface patch on its own (normalized Gaussian, ~2 px; the lobes themselves
# blur the reflected ball over tens of px, so this removes only the Monte-Carlo grain, not detail)
labimg = np.full((H, W), -1, np.int64); labimg[gyx] = lg.astype(np.int64) * 3 + kind
R1s = np.zeros_like(R1)
hasR = (R1.sum(-1) > 0)
for lv in np.unique(labimg[hasR]):
    m = labimg == lv
    ys_m, xs_m = np.nonzero(m & hasR)
    y0_, y1_, x0_, x1_ = max(ys_m.min() - 8, 0), ys_m.max() + 9, max(xs_m.min() - 8, 0), xs_m.max() + 9
    mm = m[y0_:y1_, x0_:x1_].astype(np.float32)
    num = cv2.GaussianBlur(R1[y0_:y1_, x0_:x1_] * mm[..., None], (0, 0), a.gsmooth)
    den = cv2.GaussianBlur(mm, (0, 0), a.gsmooth)
    R1s[y0_:y1_, x0_:x1_] += num / np.maximum(den, 1e-6)[..., None] * mm[..., None]
R1 = cv2.GaussianBlur(R1s, (0, 0), 0.5)

# ----------------------------------------------------------------------------------------------------------- compose (2x)
# (row strips, so the 2x float images never all exist at once: the whole pass stays near 1 GB)
del DB, Lg, hitp, hitw, R1s, labimg, Ed, YY, XX
Bp8 = np.asarray(Image.open('scene/base.png').convert('RGB'))
Lb = S2L[Bp8] @ LUM
# (the photo's lit windows are capped before the local mean, else the wall around each window reads as dark albedo
#  and the added light shows black rings around them)
Lcap = np.minimum(Lb, 2.0 * cv2.GaussianBlur(Lb, (0, 0), 25) + 0.002)
tex = np.clip(Lb / (cv2.GaussianBlur(Lcap, (0, 0), 10) + 0.0015), 0.25, 2.5); del Lcap
SM2 = cv2.resize(SMm.astype(np.uint8), (W2, H2), interpolation=cv2.INTER_NEAREST) > 0
EM2 = cv2.resize(EMm.astype(np.float32), (W2, H2), interpolation=cv2.INTER_LINEAR)
cover = np.zeros((H2, W2), np.float32)
for o, b in zip(balls, meta['balls']):
    rr2 = b['r'] + (float(np.clip(0.045 * b['r'], 2.0, 4.0)) if o.mounted else 0.0)
    x0_, x1_ = max(0, int(b['cx'] - rr2) - 2), min(W2, int(b['cx'] + rr2) + 3)
    y0_, y1_ = max(0, int(b['cy'] - rr2) - 2), min(H2, int(b['cy'] + rr2) + 3)
    yb, xb = np.mgrid[y0_:y1_, x0_:x1_].astype(np.float32)
    c_ = np.clip(rr2 + 0.5 - np.hypot(xb - b['cx'], yb - b['cy']), 0, 1)
    cover[y0_:y1_, x0_:x1_] = 1 - (1 - cover[y0_:y1_, x0_:x1_]) * (1 - c_)
E2 = np.clip(cv2.resize(E1, (W2, H2), interpolation=cv2.INTER_LINEAR), 0, None) / np.pi
R2 = np.clip(cv2.resize(R1, (W2, H2), interpolation=cv2.INTER_LINEAR), 0, None)
def to8(x): return (np.clip(l2s(x), 0, 1) * 255 + .5).astype(np.uint8)
out8 = np.empty((H2, W2, 3), np.uint8); dbg8 = np.empty((H2, W2, 3), np.uint8) if a.debug else None
st = {'sum': 0.0, 'max': 0.0, 'add': [], 'dif': [], 'glo': []}
for y0 in range(0, H2, 256):
    sl = slice(y0, min(H2, y0 + 256))
    Bs = S2L[Bp8[sl]]; Ls = Lb[sl][..., None]
    alb = 0.32 * tex[sl][..., None] * (0.6 + 0.4 * np.clip((Bs + 0.002) / (Ls + 0.002), 0, 2))   # photo albedo
    alb = np.where(SM2[sl][..., None], np.float32(0.22), alb)                                    # sign returns
    em = EM2[sl][..., None]; alb = alb * (1 - em) + a.em_albedo * em                               # LED faces
    k = (a.gain * (1 - cover[sl]))[..., None]
    dif = alb * E2[sl] * (a.base * k); glo = R2[sl] * (a.spec * k); add = dif + glo
    out8[sl] = to8(S2L[F8[sl]] + add)
    if dbg8 is not None: dbg8[sl] = to8(add * 4)
    st['sum'] += float(add.sum()); st['max'] = max(st['max'], float(add.max()))
    st['add'].append(add[::4, ::4].copy()); st['dif'].append(dif[::4, ::4].copy()); st['glo'].append(glo[::4, ::4].copy())
Image.fromarray(out8).save(a.out)
if a.debug: Image.fromarray(dbg8).save(a.debug)
if a.dump:
    np.savez_compressed(a.dump, E1=E1, R1=R1, **{'E_' + k: v for k, v in Ed_ball.items()}, **{'S_' + k: v for k, v in S_ball.items()})
try:
    peak = [l for l in open('/proc/self/status') if l.startswith('VmHWM')][0].split()[1]; peak = ', peak RSS %d MB' % (int(peak) // 1024)
except Exception:
    peak = ''
log('balltrace: shadow rays %d, added mean %.5f p99 %.4f max %.3f (diffuse p99 %.4f, glossy p99.9 %.4f)%s -> %s' % (
    ray_total, st['sum'] / (H2 * W2 * 3), np.percentile(np.concatenate(st['add']), 99), st['max'],
    np.percentile(np.concatenate(st['dif']), 99), np.percentile(np.concatenate(st['glo']), 99.9), peak, a.out))
