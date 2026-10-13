#!/usr/bin/env python3
"""Physically based light transport from every sign/screen onto the photographed environment.

usage: python3 -I scripts/relight.py RENDER_2x.png OUT_2x.png [--gain 1.0] [--spec 1.0] [--stride 6]

Lights: each sign is an area light lying on its solved 3-D plane (scene/signs.json). Its emitting surface
is sampled on a grid; every sample carries the colour actually rendered there (linear radiance) and an
area element. Wall-mounted screens emit one-sided (toward the camera side); neon/holograms two-sided.
Receivers: every photo pixel back-projected onto the z=1 working depth (the same convention the sign
planes use), with the surface normal from out/normals.npy.
Transport: E(x) = sum_i L_i * max(0, n.w) * max(0, n_i.(-w)) * A_i / max(d^2, d0^2)   (Lambertian, inverse
square, cosine at both ends) + a glossy Blinn-Phong lobe on the train body/glass/rail.
The reflected light multiplies an albedo map taken from the photo's own local texture, so the added light
reveals the real surface detail instead of blurring it.
"""
import argparse, json, os, re
import numpy as np, cv2
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def s2l(x): return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4).astype(np.float32)
def l2s(x):
    x = np.clip(x, 0, None)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055).astype(np.float32)


def homog(q):
    """unit square -> quad (TL,TR,BR,BL) projective map, returns f(u,v)->(x,y)"""
    src = np.float32([[0, 0], [1, 0], [1, 1], [0, 1]]); dst = np.float32(q)
    Hm = cv2.getPerspectiveTransform(src, dst)
    def f(u, v):
        p = np.stack([u, v, np.ones_like(u)], -1) @ Hm.T
        return p[..., :2] / p[..., 2:3]
    return f


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('inp'); ap.add_argument('out')
    ap.add_argument('--gain', type=float, default=1.0); ap.add_argument('--spec', type=float, default=1.0)
    ap.add_argument('--stride', type=int, default=14)
    ap.add_argument('--debug', default=None, help='write the added light alone here')
    a = ap.parse_args()

    F = np.asarray(Image.open(a.inp).convert('RGB'), np.float32) / 255
    B = np.asarray(Image.open(os.path.join(ROOT, 'scene', 'base.png')).convert('RGB'), np.float32) / 255
    H, W = F.shape[:2]; sc = W / 1455.0
    Fl, Bl = s2l(F), s2l(B)
    M = np.clip(np.abs(F - B).sum(-1) * 6, 0, 1)                       # 1 on sign pixels
    M = cv2.GaussianBlur(M, (0, 0), 1.5)
    cam = json.load(open(os.path.join(ROOT, 'scene', 'camera.json')))
    K = np.array(cam['K']); K2 = K.copy(); K2[:2] *= sc; Ki2 = np.linalg.inv(K2)
    G = json.load(open(os.path.join(ROOT, 'scene', 'signs.json')))

    # ---------------- lights ----------------
    Lpos, Lnrm, Lrad, Larea, Ltwo = [], [], [], [], []
    emis = Fl * M[..., None]
    emis_s = cv2.GaussianBlur(emis, (0, 0), 3 * sc / 2)
    holo_like = re.compile(r'gpu|poster|coffee|surv|neon|karaoke|hotel|s2|mintsign|exit|fan|bars')
    for key, g in G.items():
        if not isinstance(g, dict) or 'quad' not in g: continue
        q = np.array(g['quad'], np.float64) * sc
        f = homog(q)
        area_px = abs(cv2.contourArea(q.astype(np.float32)))
        if area_px < 30: continue
        n = int(np.clip(np.sqrt(area_px) / 30, 3, 9))
        u, v = np.meshgrid((np.arange(n) + .5) / n, (np.arange(n) + .5) / n)
        xy = f(u.ravel(), v.ravel())
        # 3-D sample positions on the sign's own plane
        if f'{key}_3d' in G:                                           # box face: exact 3-D corners
            C = np.array(G[f'{key}_3d']); uu, vv = u.ravel()[:, None], v.ravel()[:, None]
            X = (1 - uu) * (1 - vv) * C[0] + uu * (1 - vv) * C[1] + uu * vv * C[2] + (1 - uu) * vv * C[3]
            nl = np.cross(C[1] - C[0], C[3] - C[0])
        else:
            rays = np.c_[xy, np.ones(len(xy))] @ Ki2.T
            if 'f3d' in g:
                f3 = g['f3d']; X0 = np.array(f3['X0']); nl = np.cross(f3['eu'], f3['ev'])
                X = rays * (nl @ X0) / (rays @ nl)[:, None]
            else:                                                      # photo-fitted board: facing camera
                X = rays.copy(); nl = -rays.mean(0)
        nl = nl / np.linalg.norm(nl)
        if nl @ (-X.mean(0)) < 0: nl = -nl                             # emitting side faces the camera
        # layered depth: facade signs at 1.0, things hanging in front of the train/facade closer to the camera
        if key.startswith(('sov_', 'rbox_')): X = X * 0.92
        elif key.startswith('cube_'): X = X * 0.95
        elif key in ('bars', 'trainstrip', 'nose', 'nose2'): X = X * 0.955
        xi = np.clip(xy[:, 0].astype(int), 0, W - 1); yi = np.clip(xy[:, 1].astype(int), 0, H - 1)
        rad = emis_s[yi, xi]
        # 3-D area of the face: sum of the two triangles of its 3-D corners
        cr = (np.c_[f(np.array([0., 1, 1, 0]), np.array([0., 0, 1, 1])), np.ones(4)] @ Ki2.T)
        if f'{key}_3d' in G: Cq = np.array(G[f'{key}_3d'])
        else:
            if 'f3d' in g: Cq = cr * (nl @ X0) / (cr @ nl)[:, None]
            else: Cq = cr
        A3 = .5 * np.linalg.norm(np.cross(Cq[1] - Cq[0], Cq[3] - Cq[0])) + .5 * np.linalg.norm(np.cross(Cq[1] - Cq[2], Cq[3] - Cq[2]))
        Lpos.append(X); Lnrm.append(np.repeat(nl[None], len(X), 0)); Lrad.append(rad)
        Larea.append(np.full(len(X), A3 / len(X))); Ltwo.append(np.full(len(X), bool(holo_like.search(key))))
    Lpos, Lnrm, Lrad, Larea, Ltwo = (np.concatenate(x) for x in (Lpos, Lnrm, Lrad, Larea, Ltwo))
    keep = Lrad.sum(1) > 1e-4
    Lpos, Lnrm, Lrad, Larea, Ltwo = Lpos[keep], Lnrm[keep], Lrad[keep], Larea[keep], Ltwo[keep]
    Lpos, Lnrm, Lrad, Larea = (x.astype(np.float32) for x in (Lpos, Lnrm, Lrad, Larea))
    print('light samples', len(Lpos))

    # ---------------- receivers ----------------
    s = a.stride
    ys, xs = np.mgrid[s // 2:H:s, s // 2:W:s]
    h2, w2 = ys.shape
    rays = np.stack([xs, ys, np.ones_like(xs)], -1).reshape(-1, 3).astype(np.float64) @ Ki2.T
    P = rays.astype(np.float32)                                        # z = 1 working depth (facade)
    fgm = np.zeros((H, W), np.float32)
    fgsrc = open(os.path.join(ROOT, 'scene', 'foreground.js')).read()
    fgp = json.loads(fgsrc[fgsrc.index('const FG_PATHS = ') + 17: fgsrc.index(';\n', fgsrc.index('const FG_PATHS = '))])
    for d in fgp:
        pts = np.array([tuple(map(float, t.split())) for t in d.strip('MZ ').split(' L')]) * sc
        cv2.fillPoly(fgm, [pts.astype(np.int32)], 1.0)
    via = np.zeros((H, W), np.float32)                                 # viaduct front face below the deck edge
    cv2.fillPoly(via, [(np.array([[0, 830], [1455, 1540], [1455, 1700], [0, 990]]) * sc).astype(np.int32)], 1.0)
    depth = 1.0 - 0.045 * np.maximum(fgm, via)
    P = P * depth[ys, xs].reshape(-1, 1)
    N = np.load(os.path.join(ROOT, 'out', 'normals.npy'))
    N = cv2.resize(N, (W, H), interpolation=cv2.INTER_LINEAR)[ys, xs].reshape(-1, 3).astype(np.float32)
    V = -P / np.linalg.norm(P, axis=1, keepdims=True)
    Ed = np.zeros((len(P), 3)); Es = np.zeros((len(P), 3))
    d0 = 0.012                                                         # near-field clamp (~ a few metres)
    for i in range(0, len(P), 2500):
        p, n, vv = P[i:i + 2500, None, :], N[i:i + 2500, None, :], V[i:i + 2500, None, :]
        w = Lpos[None] - p
        d2 = (w ** 2).sum(-1); d = np.sqrt(d2) + 1e-9; wn = w / d[..., None]
        cr = np.clip((wn * n).sum(-1), 0, None)
        cl = -(wn * Lnrm[None]).sum(-1)
        cl = np.where(Ltwo[None], np.abs(cl), np.clip(cl, 0, None))
        geo = cr * cl * Larea[None] / np.maximum(d2, d0 * d0)
        Ed[i:i + 2500] = geo @ Lrad
        hv = wn + vv; hv /= np.linalg.norm(hv, axis=-1, keepdims=True)
        lobe = np.clip((hv * n).sum(-1), 0, None) ** 48
        Es[i:i + 2500] = (lobe * cl * Larea[None] / np.maximum(d2, d0 * d0) * (cr > 0)) @ Lrad
    Ed = Ed.reshape(h2, w2, 3).astype(np.float32); Es = Es.reshape(h2, w2, 3).astype(np.float32)
    Ed = cv2.resize(Ed, (W, H), interpolation=cv2.INTER_CUBIC); Es = cv2.resize(Es, (W, H), interpolation=cv2.INTER_CUBIC)
    Ed = np.clip(Ed, 0, None) / np.pi; Es = np.clip(Es, 0, None)

    # ---------------- albedo / gloss from the photograph ----------------
    Lb = 0.2126 * Bl[..., 0] + 0.7152 * Bl[..., 1] + 0.0722 * Bl[..., 2]
    local = cv2.GaussianBlur(Lb, (0, 0), 10 * sc / 2) + 0.0015
    tex = np.clip(Lb / local, 0.25, 2.5)                               # the photo's surface texture
    chroma = (Bl + 0.002) / (Lb[..., None] + 0.002); chroma = 0.6 + 0.4 * np.clip(chroma, 0, 2)
    albedo = 0.32 * tex[..., None] * chroma
    gloss = np.full((H, W), 0.06, np.float32)                          # damp concrete: slight sheen
    fg = open(os.path.join(ROOT, 'scene', 'foreground.js')).read()
    paths = json.loads(fg[fg.index('const FG_PATHS = ') + 17: fg.index(';\n', fg.index('const FG_PATHS = '))])
    for k_, d in enumerate(paths):
        pts = np.array([tuple(map(float, t.split())) for t in d.strip('MZ ').split(' L')]) * sc
        cv2.fillPoly(gloss, [pts.astype(np.int32)], 0.55 if k_ == 0 else 0.8)   # train body / rail metal
    gloss = cv2.GaussianBlur(gloss, (0, 0), 1.5)
    recv = (1 - M)[..., None]
    add = (albedo * Ed * a.gain + gloss[..., None] * Es * 0.004 * a.spec) * recv
    out = Fl + add
    Image.fromarray((np.clip(l2s(out), 0, 1) * 255 + .5).astype(np.uint8)).save(a.out)
    if a.debug:
        Image.fromarray((np.clip(l2s(add * 4), 0, 1) * 255 + .5).astype(np.uint8)).save(a.debug)
    print('relight: added light mean %.5f  p99 %.4f' % (add.mean(), np.percentile(add, 99)))


if __name__ == '__main__':
    main()
