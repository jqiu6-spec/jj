"""Fit a camera: principal point (orthocentre of the 3 VPs) + focal; refine; draw a verification grid."""
import sys, json
import numpy as np, cv2
S = sys.argv[1]
V = json.load(open(f'{S}/out/vps.json'))
vv, v1, v2 = map(np.array, (V['vv'], V['v1'], V['v2']))

def ortho(a, b, c):
    # orthocentre of triangle abc
    A = np.array([b - c, a - c]); rhs = np.array([np.dot(a, b - c), np.dot(b, a - c)])
    return np.linalg.solve(A, rhs)
pp = ortho(vv, v1, v2)
f = np.sqrt(-np.dot(vv - pp, v1 - pp))
print('orthocentre', pp.round(1), 'f', round(f))

# Option B: principal point at centre, f from v & v1 (best supported), v2 derived
c = np.array([727.5, 1028.0])
fB = np.sqrt(-np.dot(vv - c, v1 - c))
K = np.array([[fB, 0, c[0]], [0, fB, c[1]], [0, 0, 1]])
Ki = np.linalg.inv(K)
dv = Ki @ np.r_[vv, 1]; dv /= np.linalg.norm(dv)
d1 = Ki @ np.r_[v1, 1]; d1 /= np.linalg.norm(d1)
print('angle v-d1 (deg)', np.degrees(np.arccos(abs(dv @ d1))).round(2))
d1 = d1 - (d1 @ dv) * dv; d1 /= np.linalg.norm(d1)
d2 = np.cross(dv, d1)
p2 = K @ d2; p2 = p2[:2] / p2[2]
print('derived v2', p2.round(1), 'detected v2', v2.round(1))
# check detected D2 segments against derived v2
s2 = np.array(V['s2'])
def err(s, v):
    mid = (s[:, :2] + s[:, 2:]) / 2; d = v - mid; seg = s[:, 2:] - s[:, :2]
    cc = np.abs((d * seg).sum(1)) / (np.linalg.norm(d, axis=1) * np.linalg.norm(seg, axis=1))
    return np.degrees(np.arccos(np.clip(cc, -1, 1)))
print('D2 seg err vs derived v2: median', np.median(err(s2, p2)).round(2), ' vs detected', np.median(err(s2, v2)).round(2))
json.dump(dict(K=K.tolist(), dv=dv.tolist(), d1=d1.tolist(), d2=d2.tolist(), vv=vv.tolist(), v1=v1.tolist(), v2=p2.tolist()), open(f'{S}/scene/camera.json', 'w'))

img = cv2.imread(f'{S}/scene/photo_native.png')
img = cv2.resize(img, (1455, 2056)) // 2 + 20
def ray(v, p, col):
    d = p - v; d /= np.linalg.norm(d)
    a, b = p - d * 3000, p + d * 3000
    cv2.line(img, tuple(a.astype(int)), tuple(b.astype(int)), col, 1, cv2.LINE_AA)
for x in range(-200, 1700, 90): ray(vv, np.array([x, 2056.]), (0, 255, 255))
for y in range(-600, 2600, 110): ray(v1, np.array([0., y]), (255, 160, 0))
for y in range(-600, 2600, 160): ray(p2, np.array([1455., y]), (60, 60, 255))
cv2.imwrite(f'{S}/out/grid.png', img)
