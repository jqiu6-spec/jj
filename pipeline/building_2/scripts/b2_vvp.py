"""Vertical vanishing point of the ring photo (native px) from LSD segments."""
import numpy as np, cv2, json
img = cv2.imread('scene/photo_native.png'); g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
g = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(g)
g2 = cv2.resize(g, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
segs = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD).detect(g2)[0].reshape(-1, 4) / 2
L = np.hypot(segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1])
ang = np.degrees(np.arctan2(segs[:, 3] - segs[:, 1], segs[:, 2] - segs[:, 0])) % 180
m = (L > 30) & (np.abs(ang - 90) < 12)
s = segs[m]; w = L[m]
p1 = np.c_[s[:, :2], np.ones(len(s))]; p2 = np.c_[s[:, 2:], np.ones(len(s))]
l = np.cross(p1, p2); l /= np.linalg.norm(l[:, :2], axis=1, keepdims=True)
def err(v):
    mid = (s[:, :2] + s[:, 2:]) / 2; d = v[:2] / v[2] - mid if abs(v[2]) > 1e-9 else np.tile(v[:2], (len(s), 1))
    sg = s[:, 2:] - s[:, :2]
    c = np.abs((d * sg).sum(1)) / (np.linalg.norm(d, axis=1) * np.linalg.norm(sg, axis=1) + 1e-9)
    return np.degrees(np.arccos(np.clip(c, -1, 1)))
rng = np.random.default_rng(0); best = (-1, None)
for _ in range(5000):
    i, j = rng.choice(len(s), 2, replace=False); v = np.cross(l[i], l[j])
    if np.linalg.norm(v) < 1e-12: continue
    sc = w[err(v) < 0.6].sum()
    if sc > best[0]: best = (sc, v)
inl = err(best[1]) < 0.6
A = l[inl] * w[inl, None]; v = np.linalg.svd(A)[2][-1]; v = v / v[2]
print('segments', len(s), 'inliers', inl.sum(), 'VP', v[:2])
json.dump({'vv': v[:2].tolist(), 'segs': s[inl].tolist()}, open('out/vvp.json', 'w'))
vis = (cv2.cvtColor(g, cv2.COLOR_GRAY2BGR) * 0.5).astype(np.uint8)
for x1, y1, x2, y2 in s[inl]: cv2.line(vis, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 255), 2)
cv2.imwrite('out/vvp.png', vis)
