#!/usr/bin/env python3
"""Per-pixel surface orientation of the photo from vanishing-direction edge energy.

A facade parallel to the train contains edges toward vv (vertical) and v1; a perpendicular facade toward
vv and v2; a horizontal soffit/deck toward v1 and v2. Edge energy per family -> soft plane weights ->
blended camera-space normal (oriented toward the camera). Output: out/normals.npy (page res, HxWx3).
"""
import json, os, sys
import numpy as np, cv2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cam = json.load(open(os.path.join(ROOT, 'scene', 'camera.json')))
K = np.array(cam['K']); Ki = np.linalg.inv(K)
vps = {k: np.array(cam[k]) for k in ('vv', 'v1', 'v2')}
up, d1, d2 = (np.array(cam[k]) for k in ('dv', 'd1', 'd2'))
base = cv2.imread(os.path.join(ROOT, 'scene', 'base.png'))
g = cv2.cvtColor(cv2.resize(base, (1455, 2056), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY).astype(np.float32)
g = np.log1p(g)                                         # dark photo: equalise edge strength
g = cv2.GaussianBlur(g, (0, 0), 1.0)
gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3); gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
H, W = g.shape
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
E = {}
for k, v in vps.items():
    dx, dy = v[0] - xx, v[1] - yy
    n = np.hypot(dx, dy) + 1e-6
    nx, ny = -dy / n, dx / n                            # unit normal to the line toward the VP
    e = (gx * nx + gy * ny) ** 2
    # energy of edges ALONG the VP direction = gradient perpendicular to it, minus generic texture
    E[k] = cv2.GaussianBlur(e, (0, 0), 10)
tot = sum(E.values()) + 1e-6
for k in E: E[k] = E[k] / tot
SA = np.sqrt(E['vv'] * E['v1']); SB = np.sqrt(E['vv'] * E['v2']); SH = np.sqrt(E['v1'] * E['v2']) * 0.9
S = np.stack([SA, SB, SH], -1)
S = cv2.GaussianBlur(S, (0, 0), 18)
S = S / (S.sum(-1, keepdims=True) + 1e-9)
# priors: default mix, the solved plane of every sign spread over its surroundings, train + viaduct
prior = np.zeros((H, W, 3), np.float32); prior[..., 0] = .45; prior[..., 1] = .35; prior[..., 2] = .20
G = json.load(open(os.path.join(ROOT, 'scene', 'signs.json')))
kind_idx = {'A': 0, 'B': 1, 'H': 2}
for key, gsg in G.items():
    if not isinstance(gsg, dict) or 'quad' not in gsg: continue
    kind = gsg.get('plane')
    if kind == 'box':
        kind = 'H' if key.endswith('bottom') else ('A' if key.endswith(('front', 'right')) else 'B')
    if kind not in kind_idx: continue
    m = np.zeros((H, W), np.float32)
    cv2.fillPoly(m, [np.array(gsg['quad'], np.int32)], 1.0)
    m = cv2.GaussianBlur(m, (0, 0), 45) * 2.5
    prior[..., kind_idx[kind]] += m
# train side and viaduct front face are parallel to the train; deck underside below it is horizontal
fg = open(os.path.join(ROOT, 'scene', 'foreground.js')).read()
paths = json.loads(fg[fg.index('const FG_PATHS = ') + 17: fg.index(';\n', fg.index('const FG_PATHS = '))])
def path_poly(d):
    pts = [tuple(map(float, t.split())) for t in d.strip('MZ ').replace('M', '').split(' L')]
    return np.array(pts, np.int32)
tm = np.zeros((H, W), np.float32)
cv2.fillPoly(tm, [path_poly(paths[0])], 1.0)
prior[..., 0] += cv2.GaussianBlur(tm, (0, 0), 6) * 4.0
vi = np.zeros((H, W), np.float32)                 # viaduct front face: band below the deck edge
vi_poly = np.array([[0, 830], [1455, 1540], [1455, 1700], [0, 990]], np.int32)
cv2.fillPoly(vi, [vi_poly], 1.0)
prior[..., 0] += cv2.GaussianBlur(vi, (0, 0), 10) * 1.5
Wt = (S + 0.08) * prior
Wt = Wt ** 1.5
Wt = Wt / (Wt.sum(-1, keepdims=True) + 1e-9)
P = np.stack([xx, yy, np.ones_like(xx)], -1) @ Ki.T          # rays (z = 1)
toward = -P / np.linalg.norm(P, axis=-1, keepdims=True)
def orient(nvec):
    n = np.broadcast_to(nvec, P.shape).copy()
    flip = (n * toward).sum(-1) < 0
    n[flip] *= -1
    return n
N = Wt[..., 0:1] * orient(d2) + Wt[..., 1:2] * orient(d1) + Wt[..., 2:3] * orient(up)
N /= np.linalg.norm(N, axis=-1, keepdims=True) + 1e-9
np.save(os.path.join(ROOT, 'out', 'normals.npy'), N.astype(np.float32))
np.save(os.path.join(ROOT, 'out', 'plane_weights.npy'), Wt.astype(np.float32))
vis = (Wt[..., [2, 1, 0]] * 255).astype(np.uint8)       # B=A-facade, G=B-facade, R=horizontal
over = cv2.addWeighted(cv2.resize(base, (W, H)), 0.5, vis, 0.6, 0)
cv2.imwrite(os.path.join(ROOT, 'out', 'normals_vis.jpg'), cv2.resize(over, (728, 1028)))
print('normals', N.shape, 'mean weights A/B/H', Wt.reshape(-1, 3).mean(0).round(3))
