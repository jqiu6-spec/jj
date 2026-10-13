#!/usr/bin/env python3
"""Atmosphere + fine-detail stage (runs between composite.py and lens.py).

usage: python3 -I scripts/atmos.py IN_2x.png OUT_2x.png [--fog 1.0] [--seed 7]

Adds the cinematic megacity texture of the style references:
  1. fine surface texture: local-contrast recovery on the photo's concrete
  2. deep distant city: far facade planes (projected through the solved camera, so they obey the
     same three-point perspective) carrying thousands of tiny lit windows, visible only through
     the voids/sky in the megastructure, fading with distance into haze
  3. flying vehicles in traffic lanes parallel to the train, sized by depth, with running lights
  4. two volumetric searchlight beams
  5. layered, textured haze that thickens with height and is lit by nearby light (signs glow in it)
"""
import argparse, json, os
import numpy as np, cv2
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def s2l(x): return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4).astype(np.float32)
def l2s(x):
    x = np.clip(x, 0, None)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055).astype(np.float32)
def blur(a, s): return cv2.GaussianBlur(a, (0, 0), s, borderType=cv2.BORDER_REFLECT) if s > 0 else a
def lum(x): return 0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]


def fbm(h, w, rng, scales=(512, 256, 128, 64), amps=(1, .55, .3, .16)):
    n = np.zeros((h, w), np.float32)
    for sc, a in zip(scales, amps):
        g = rng.standard_normal((h // sc + 3, w // sc + 3)).astype(np.float32)
        n += a * cv2.resize(g, (w + 3 * sc, h + 3 * sc), interpolation=cv2.INTER_CUBIC)[:h, :w]
    return (n - n.mean()) / (n.std() + 1e-6)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('inp'); ap.add_argument('out')
    ap.add_argument('--fog', type=float, default=1.0); ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--base', default=os.path.join(ROOT, 'scene', 'base.png'))
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    img = np.asarray(Image.open(a.inp).convert('RGB'), np.float32) / 255
    base = np.asarray(Image.open(a.base).convert('RGB'), np.float32) / 255
    H, W = img.shape[:2]
    sc = W / 1455.0                                     # page -> image scale
    cam = json.load(open(os.path.join(ROOT, 'scene', 'camera.json')))
    K = np.array(cam['K']); K[:2] *= sc
    up, d1, d2 = (np.array(cam[k]) for k in ('dv', 'd1', 'd2'))
    Ki = np.linalg.inv(K)
    lin = s2l(img)

    # ---- 1. fine texture: recover local contrast in the (upscaled, soft) photograph -------------------
    L = lum(lin)
    detail = l2s(L) - l2s(blur(L, 5 * sc / 2))
    changed = np.clip(np.abs(img - base).sum(-1) * 6, 0, 1)           # 1 where signage was drawn
    lin = s2l(np.clip(img + (0.95 * detail * (1 - changed))[..., None], 0, 1))

    # ---- 2. voids: where the photo shows deep blue-dark space through the megastructure ------------------
    b8 = (base * 255).astype(np.int16)
    gb = cv2.cvtColor((base * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
    tex = np.abs(cv2.Laplacian(cv2.GaussianBlur(gb, (0, 0), 2), cv2.CV_32F))
    void = ((b8[..., 2] - b8[..., 0]) > 5) & (gb < 75) & (tex < 1.6)
    yy, xx = np.mgrid[0:H, 0:W]
    void &= (xx > 600 * sc) & (xx < 800 * sc) & (yy < 880 * sc)
    void = cv2.morphologyEx(void.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    void = cv2.morphologyEx(void, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)).astype(np.float32)
    void = blur(void, 2.0) * (1 - changed)
    void_soft = blur(void, 25)

    # distant city: towers on far facade planes (A: along the train direction) at several depths.
    # Each tower is a dark silhouette against the hazy sky glow; its floors carry runs of lit window strips.
    def proj(P):
        q = P @ K.T
        return q[:, :2] / q[:, 2:3]
    centre_ray = Ki @ np.array([700 * sc, 320 * sc, 1.0]); centre_ray /= np.linalg.norm(centre_ray)
    sky_glow = np.stack([np.full((H, W), .012), np.full((H, W), .020), np.full((H, W), .026)], -1).astype(np.float32)
    sky_glow *= (1.7 - 1.2 * yy / H)[..., None]
    city = sky_glow.copy()
    for depth, haze in ((9.0, .70), (5.5, .50), (3.2, .28)):          # far -> near (painter's order)
        X0 = centre_ray * depth
        sil = np.zeros((H, W), np.float32); win = np.zeros((H, W, 3), np.float32)
        s_pos = -1.0 * depth / 3
        while s_pos < 1.0 * depth / 3:
            tw = (0.05 + rng.random() * 0.12) * depth / 3          # tower width
            gap = (0.01 + rng.random() * 0.05) * depth / 3
            top = -(1.5 + rng.random() * 2.0) * depth / 3          # tower top (t grows downward)
            corners = proj(np.array([X0 + s_pos * d1 + top * up, X0 + (s_pos + tw) * d1 + top * up,
                                      X0 + (s_pos + tw) * d1 + 2.0 * up * -1, X0 + s_pos * d1 + 2.0 * up * -1]))
            cv2.fillPoly(sil, [corners.astype(np.int32)], 1.0, lineType=cv2.LINE_AA)
            fh = 0.0042 * depth / 3                                 # floor height
            ww = 0.0026 * depth / 3                                 # window pitch
            t = top + fh
            while t < 1.0:
                if rng.random() < 0.32:                             # this floor has lit runs
                    x = s_pos + ww
                    while x < s_pos + tw - ww:
                        run = int(rng.integers(2, 10)) if rng.random() < .33 else 0
                        col = (1.0, .74, .42) if rng.random() < .7 else (.72, .86, 1.0)
                        inten = 0.6 + 0.5 * rng.random()
                        for _ in range(run):
                            if x > s_pos + tw - ww: break
                            p = proj(np.array([X0 + x * d1 - t * up, X0 + (x + ww * .62) * d1 - t * up]))
                            cv2.line(win, tuple(np.round(p[0]).astype(int)), tuple(np.round(p[1]).astype(int)),
                                     tuple(c * inten for c in col), 1, cv2.LINE_AA)
                            x += ww
                        x += ww * int(rng.integers(1, 8))
                t += fh
            s_pos += tw + gap
        k = 1 - haze
        city = city * (1 - sil[..., None] * (0.55 + 0.35 * k)) + win * (0.8 * k) * 1.0 + blur(win, 2.0) * 0.5 * k
    void_m = np.clip(blur(void, 6) * 1.25, 0, 1) ** 1.3
    lin = lin * (1 - 0.8 * void_m[..., None]) + (city + lin * 0.25) * void_m[..., None]

    # ---- 3. flying vehicles in lanes parallel to the train ---------------------------------------------
    veh = np.zeros((H, W, 4), np.float32)
    seeds = rng.random((18, 3))
    drawn = 0
    for u, v, r in seeds:
        px, py = (80 + u * 1300) * sc, (20 + v * 980) * sc
        X = Ki @ np.array([px, py, 1.0]); X /= np.linalg.norm(X); X *= 1.2 + 2.5 * (1 - v)
        dirv = d1 if r < .6 else -d1
        size = 0.007
        P = np.array([X - dirv * size, X + dirv * size, X - dirv * size + up * size * .3, X + dirv * size + up * size * .25])
        q = proj(P)
        tail, head, tailtop, headtop = q
        Lpx = np.linalg.norm(head - tail)
        if Lpx < 8 * sc / 2 or Lpx > 50 * sc / 2: continue
        if lum(lin[int(py) % H, int(px) % W]) > 0.02: continue            # keep them over dark sky/facade
        hull = np.array([tail, (tail + tailtop) / 2, headtop, head]).astype(np.int32)
        cv2.fillPoly(veh, [hull], (0.012, 0.013, 0.015, 1.0), lineType=cv2.LINE_AA)
        hx, hy = head.astype(int); tx, ty = tail.astype(int)
        cv2.circle(veh, (hx, hy), max(1, int(sc * .8)), (1.0, .95, .85, 1.0), -1, cv2.LINE_AA)
        cv2.circle(veh, (tx, ty), max(1, int(sc * .6)), (1.0, .12, .08, 1.0), -1, cv2.LINE_AA)
        trail_end = tail - (head - tail) * 2.5
        cv2.line(veh, (tx, ty), tuple(trail_end.astype(int)), (.35, .04, .03, .18), max(1, int(sc * .4)), cv2.LINE_AA)
        drawn += 1
    va = veh[..., 3:4]
    lights = np.clip(veh[..., :3] - 0.02, 0, None) * va
    lin = lin * (1 - va) + veh[..., :3] * va + blur(lights, 3 * sc / 2) * 1.5

    # ---- 4. searchlight beams (volumetric, additive) ----------------------------------------------------
    beams = np.zeros((H, W), np.float32)
    for (x0, y0, x1, y1, w0, w1) in ((690, 860, 560, -200, 4, 60), (760, 820, 980, -200, 4, 50)):
        p0, p1 = np.array([x0, y0]) * sc, np.array([x1, y1]) * sc
        dvec = p1 - p0; Lb = np.linalg.norm(dvec); dn = dvec / Lb; nn = np.array([-dn[1], dn[0]])
        rel = np.stack([xx - p0[0], yy - p0[1]], -1).astype(np.float32)
        along = rel @ dn; across = rel @ nn
        t = np.clip(along / Lb, 0, 1)
        width = (w0 + (w1 - w0) * t) * sc
        prof = np.exp(-(across / (width + 1e-3)) ** 2 * 2.0) * (along > 0) * (along < Lb)
        beams += prof * (0.6 + 0.4 * (1 - t))
    beam_tex = 0.75 + 0.25 * fbm(H, W, rng, scales=(256, 64), amps=(1, .5))
    lin = lin + (beams * beam_tex * (0.35 + 0.65 * void_soft / (void_soft.max() + 1e-6)) * 0.06)[..., None] * np.array([.75, .9, 1.0], np.float32)

    # ---- 5. layered textured haze, thicker with height, lit by its surroundings --------------------------
    far = (1 - yy / H).astype(np.float32) ** 1.25
    noise = fbm(H, W, rng)
    dens = (0.008 + 0.13 * far ** 1.7) * (0.75 + 0.35 * noise) * a.fog
    dens = np.clip(dens, 0, 0.5)[..., None]
    fog_col = np.array([0.012, 0.017, 0.017], np.float32)            # green-grey night haze
    lit_fog = fog_col + blur(lin, 40 * sc / 2) * 0.4 + blur(lin, 120 * sc / 2) * 0.06
    lin = lin * (1 - dens) + lit_fog * dens

    out = l2s(lin)
    # crisp pass: small-radius unsharp mask on luminance (recovers edges softened by upscaling)
    lo = lum(out); out = out + (0.6 * (lo - blur(lo, 1.4 * sc / 2)))[..., None]
    Image.fromarray((np.clip(out, 0, 1) * 255 + .5).astype(np.uint8)).save(a.out)
    print(f'atmos: {a.inp} -> {a.out}  void px {int(void.sum())}  vehicles {drawn}')


if __name__ == '__main__':
    main()
