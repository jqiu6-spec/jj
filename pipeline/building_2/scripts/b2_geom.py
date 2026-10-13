"""Geometry proxy for the ring photo (orthographic telephoto view, pitch from the fitted ellipses).

Far well wall: concave vertical cylinder (centre xc, radius R) seen on its far side.
Near structure (upper wall + front wall with the big opening): convex vertical cylinder (centre xt, radius rt), near side.
Top surfaces of the near walls and the far-right walkway: horizontal.
Camera space (orthographic): x right, y down (image), z forward. depth z = y*tan(th) + D/cos(th), D = forward horizontal offset.
Outputs at page 1x (1455x2056): out/geo.npz with P (3-D position, page-px units), N (normal), cls (0 sky 1 far 2 near 3 top).
"""
import json, numpy as np, cv2
SC = 1.37926365188936; W, H = 1455, 2056
o = json.load(open('out/b2_ortho.json'))
s = o['s']; th = np.arcsin(s); c = np.cos(th)
xc, R = o['well'][0] * SC, o['well'][1] * SC
xt, rt = o['tower'][0] * SC, o['tower'][1] * SC
up = np.array([0, -c, -s]); h2 = np.array([0, -s, c]); ex = np.array([1.0, 0, 0])
# near-structure outline (native px), traced on the photo
C3 = [(307,897),(350,878),(400,856),(450,832),(500,806),(550,780),(600,752),(650,725),(670,712),(730,650),(790,600),(830,550),(865,500),(890,450),(905,400),(918,350),(925,300),(930,260)]
F1 = [(330,915),(400,892),(450,872),(500,852),(600,805),(700,745),(800,672),(850,622),(890,560),(910,500),(925,420),(935,330),(940,260)]
FW = [(405,955),(500,925),(600,885),(700,835),(800,770),(900,690),(1000,590),(1055,530)]
C1 = [(0,128),(100,100),(200,78),(300,60),(400,47),(500,39),(600,35),(700,33),(1055,30)]
def pg(pts): return (np.array(pts, float) * SC).astype(np.int32)
near = np.zeros((H, W), np.uint8)
cv2.fillPoly(near, [pg(C3 + [(940, 0), (1055, 0), (1055, 1491), (390, 1491), (390, 1420), (300, 1420), (300, 1330), (307, 1320)])], 1)
top = np.zeros((H, W), np.uint8)
cv2.fillPoly(top, [pg(C3 + [(940, 260)] + F1[::-1])], 1)
cv2.fillPoly(top, [pg(FW + [(1055, 545)] + [(x, y + 14) for x, y in FW[::-1]])], 1)
cv2.fillPoly(top, [pg([(955, 0), (1055, 0), (1055, 470), (990, 610), (960, 560)])], 1)
sky = np.zeros((H, W), np.uint8)
cv2.fillPoly(sky, [pg([(0, 0)] + C1 + [(1055, 0)])], 1)
opening = np.zeros((H, W), np.uint8)
cv2.fillPoly(opening, [pg([(645, 1160), (960, 1000), (960, 1250), (650, 1390)])], 1)
cls = np.ones((H, W), np.uint8); cls[near > 0] = 2; cls[(top > 0)] = 3; cls[sky > 0] = 0
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
# far wall
cf = np.clip((xx - xc) / R, -0.995, 0.995); sf = np.sqrt(1 - cf * cf)
Nf = -(cf[..., None] * ex + sf[..., None] * h2)          # inward normal (faces the camera side)
Df = 0 + R * sf
# near convex wall
ct = np.clip((xx - xt) / rt, -0.995, 0.995); st = -np.sqrt(1 - ct * ct)
Nt = ct[..., None] * ex + st[..., None] * h2              # outward normal
Dt = 975 * SC + rt * st
D = np.where(cls >= 2, Dt, Df).astype(np.float32)
D += opening.astype(np.float32) * 260 * SC                                  # courtyard seen through the big opening is deeper
N = np.where((cls >= 2)[..., None], Nt, Nf)
N[cls == 3] = up
N[opening > 0] = -np.array([0, 0, 1.0]) * 0.8 + up * 0.2
N /= np.linalg.norm(N, axis=-1, keepdims=True)
z = yy * np.tan(th) + D / c
P = np.stack([xx, yy, z], -1).astype(np.float32)
Df0 = Df.astype(np.float32); Dt0 = Dt.astype(np.float32)
Pf = np.stack([xx, yy, yy * np.tan(th) + Df0 / c], -1).astype(np.float32)
Pn = np.stack([xx, yy, yy * np.tan(th) + Dt0 / c], -1).astype(np.float32)
np.savez_compressed('out/geo.npz', P=P, N=N.astype(np.float32), cls=cls, th=th, Pf=Pf, Pn=Pn, Nf=Nf.astype(np.float32), Nn=Nt.astype(np.float32))
vis = ((N * 0.5 + 0.5) * 255).astype(np.uint8)[..., ::-1].copy(); vis[cls == 0] = 0
cv2.imwrite('out/geo_normals.png', vis)
zz = (z - z[cls > 0].min()) / (np.ptp(z[cls > 0]) + 1e-6); cv2.imwrite('out/geo_depth.png', (np.clip(zz, 0, 1) * 255).astype(np.uint8))
print('pitch %.1f deg; far wall xc %.0f R %.0f; near xt %.0f r %.0f (page px); depth range %.0f..%.0f' % (np.degrees(th), xc, R, xt, rt, z[cls > 0].min(), z[cls > 0].max()))
