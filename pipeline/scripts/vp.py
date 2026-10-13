"""Estimate vanishing points (vertical + two horizontal facade directions) and focal length."""
import sys, json
import numpy as np
S = sys.argv[1]
segs = np.array(json.load(open(f'{S}/out/segs.json')))
ang = np.degrees(np.arctan2(segs[:, 3] - segs[:, 1], segs[:, 2] - segs[:, 0])) % 180
L = np.hypot(segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1])
rng = np.random.default_rng(0)

def lines_of(s):
    p1 = np.c_[s[:, :2], np.ones(len(s))]; p2 = np.c_[s[:, 2:], np.ones(len(s))]
    l = np.cross(p1, p2)
    return l / np.linalg.norm(l[:, :2], axis=1, keepdims=True)

def fit(l, w):
    A = l * w[:, None]
    v = np.linalg.svd(A)[2][-1]
    return v

def dist(l, v, s):
    # angular error between the segment and the line from its midpoint to v
    mid = (s[:, :2] + s[:, 2:]) / 2
    if abs(v[2]) < 1e-12:
        d = v[:2]
    else:
        d = v[:2] / v[2] - mid
    seg = s[:, 2:] - s[:, :2]
    c = np.abs((d * seg).sum(1)) / (np.linalg.norm(d, axis=-1) * np.linalg.norm(seg, axis=1) + 1e-9)
    return np.degrees(np.arccos(np.clip(c, -1, 1)))

def ransac(mask, name, thr=1.2, it=4000):
    s, w = segs[mask], L[mask]
    l = lines_of(s)
    best, bi = -1, None
    for _ in range(it):
        i, j = rng.choice(len(s), 2, replace=False)
        v = np.cross(l[i], l[j])
        if np.linalg.norm(v) < 1e-12: continue
        inl = dist(l, v, s) < thr
        sc = w[inl].sum()
        if sc > best: best, bi = sc, inl
    v = fit(l[bi], w[bi])
    inl = dist(l, v, s) < thr
    v = fit(l[inl], w[inl])
    pt = v[:2] / v[2] if abs(v[2]) > 1e-9 else v[:2] * 1e9
    print(f'{name}: VP=({pt[0]:.1f}, {pt[1]:.1f})  inliers {inl.sum()}/{len(s)}')
    return pt, s[inl]

vv, sv = ransac((ang > 65) & (ang < 115), 'vertical')
v1, s1 = ransac((ang > 12) & (ang < 45), 'train dir (D1)')
v2, s2 = ransac((ang > 125) & (ang < 172), 'orthogonal (D2)')
c = np.array([1455 / 2, 2056 / 2])
for a, b, n in [(vv, v1, 'v-1'), (vv, v2, 'v-2'), (v1, v2, '1-2')]:
    f2 = -np.dot(a - c, b - c)
    print(n, 'f^2 =', round(f2), 'f =', round(np.sqrt(f2)) if f2 > 0 else 'NaN')
json.dump(dict(vv=vv.tolist(), v1=v1.tolist(), v2=v2.tolist(), sv=sv.tolist(), s1=s1.tolist(), s2=s2.tolist()), open(f'{S}/out/vps.json', 'w'))
