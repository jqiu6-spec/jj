"""Rebuild every hand-drawn block as a true rectangle on a scene plane (camera from 3 VPs).

Plane types:  'A' = vertical facade parallel to the train (dirs d1, up)
              'B' = vertical facade perpendicular to the train (dirs d2, up)
              'H' = horizontal plane / underside (dirs d1, d2)
Outputs scene/signs.json: {key: {quad:[TL,TR,BR,BL], w, h (metric aspect), plane}}.
"""
import json, sys
import numpy as np

S = sys.argv[1]
cam = json.load(open(f'{S}/scene/camera.json'))
K = np.array(cam['K']); Ki = np.linalg.inv(K)
up = np.array(cam['dv']); d1 = np.array(cam['d1']); d2 = np.array(cam['d2'])
blocks = json.load(open(f'{S}/out/blocks.json'))
P = {int(k): np.array(v['pts']) for k, v in blocks.items()}

def proj(X):
    x = K @ X
    return x[:2] / x[2]

def ray(p):
    return Ki @ np.array([p[0], p[1], 1.0])

def axes(kind, p0):
    """unit in-plane axes (eu ~ image-right, ev ~ image-down) at image point p0"""
    if kind == 'A': eu, ev = d1, -up
    elif kind == 'B': eu, ev = d2, -up
    else: eu, ev = d1, d2
    X0 = ray(p0)
    for _ in range(2):
        if (proj(X0 + 1e-3 * eu) - proj(X0))[0] < 0: eu = -eu
        dv = proj(X0 + 1e-3 * ev) - proj(X0)
        if kind != 'H' and dv[1] < 0: ev = -ev
    if kind == 'H':
        # make ev the axis that goes more "down" in the image, eu more "right"
        a = proj(X0 + 1e-3 * eu) - proj(X0); b = proj(X0 + 1e-3 * ev) - proj(X0)
        if abs(a[1]) / np.linalg.norm(a) > abs(b[1]) / np.linalg.norm(b):
            eu, ev = ev, eu
        if (proj(X0 + 1e-3 * eu) - proj(X0))[0] < 0: eu = -eu
        if (proj(X0 + 1e-3 * ev) - proj(X0))[1] < 0: ev = -ev
    return eu, ev, X0

def Hmat(kind, p0):
    eu, ev, X0 = axes(kind, p0)
    return K @ np.c_[eu, ev, X0]

def to_plane(H, pts):
    Hi = np.linalg.inv(H)
    q = (Hi @ np.c_[pts, np.ones(len(pts))].T).T
    return q[:, :2] / q[:, 2:3]

def to_img(H, st):
    q = (H @ np.c_[st, np.ones(len(st))].T).T
    return q[:, :2] / q[:, 2:3]

def score(kind, poly):
    """how well the polygon's edges align to the plane axes (0..1)"""
    c = poly.mean(0)
    st = to_plane(Hmat(kind, c), poly)
    e = np.roll(st, -1, 0) - st
    L = np.linalg.norm(to_img(Hmat(kind, c), np.roll(st, -1, 0)) - poly, axis=1)
    ang = np.degrees(np.arctan2(np.abs(e[:, 1]), np.abs(e[:, 0])))
    ok = (ang < 12) | (ang > 78)
    return (L * ok).sum() / L.sum()

def fit(kind, poly, mode='auto', pad=(0, 0, 0, 0)):
    """axis-aligned rectangle in plane coords fitted to an image polygon"""
    c = poly.mean(0)
    H = Hmat(kind, c)
    st = to_plane(H, poly)
    if mode == 'bbox':
        l, t = st.min(0); r, b = st.max(0)
    else:
        # robust: average the two extreme vertices on each side
        s_sorted = np.sort(st[:, 0]); t_sorted = np.sort(st[:, 1])
        l, r = s_sorted[:2].mean(), s_sorted[-2:].mean()
        t, b = t_sorted[:2].mean(), t_sorted[-2:].mean()
    w, h = r - l, b - t
    l -= pad[0] * w; r += pad[1] * w; t -= pad[2] * h; b += pad[3] * h
    corners = np.array([[l, t], [r, t], [r, b], [l, b]])
    return H, corners

OUT = {}
def put(key, H, corners, kind, extra=None):
    q = to_img(H, corners)
    w = corners[1, 0] - corners[0, 0]; h = corners[3, 1] - corners[0, 1]
    OUT[key] = dict(quad=q.round(2).tolist(), aspect=float(w / h), plane=kind, **(extra or {}))
    return q

def frame3d(kind, p0, corners):
    """3-D frame of a planar sign: point(s,t,d) = X0 + s*eu + t*ev + d*nin  (nin points into the building)"""
    eu, ev, X0 = axes(kind, p0)
    n = np.cross(eu, ev); n /= np.linalg.norm(n)
    if np.dot(n, X0) < 0: n = -n
    l, t = corners[0]; r, b = corners[2]
    return dict(eu=eu.tolist(), ev=ev.tolist(), X0=X0.tolist(), nin=n.tolist(), rect=[float(l), float(t), float(r), float(b)])

def sign(key, ids, kind, mode='auto', pad=(0, 0, 0, 0)):
    poly = np.vstack([P[i] for i in ids])
    src = poly if len(ids) > 1 else P[ids[0]]
    H, c = fit(kind, src, 'bbox' if len(ids) > 1 else mode, pad)
    q = put(key, H, c, kind)
    OUT[key]['f3d'] = frame3d(kind, src.mean(0), c)
    return q

# --- report best plane per block (sanity check) ---
if '--report' in sys.argv:
    for i in sorted(P):
        if len(P[i]) < 3: continue
        sc = {k: round(score(k, P[i]), 2) for k in 'ABH'}
        print(i, blocks[str(i)]['fill'], sc, '->', max(sc, key=sc.get))
    sys.exit()

# ---------------- single-plane signs ----------------
sign('band', [166], 'A')
sign('led', [185], 'A')
sign('ledlight', [111], 'A')
sign('neonA', [153], 'A')
sign('neonB', [154], 'A')
sign('pink', [183], 'A')
sign('lime', [184], 'A')
sign('brown', [159], 'A')
sign('deckside', [162], 'A')
sign('deckunder', [161], 'A')
sign('trainstrip', [112], 'A')
sign('leftled', [167], 'A', 'bbox')
sign('magenta', [108], 'A')
sign('posterframe', [151], 'A')
sign('poster', [152], 'A')
sign('pachinko', [105], 'B')
sign('coffee', [147], 'B')
sign('fan', [148], 'B', 'bbox')
sign('lavender', [150], 'B')
sign('hotel', [114], 'B')
sign('bracket', [109], 'B', 'bbox')
sign('karaoke', [164], 'A')
sign('mintsign', [136], 'B', 'bbox')
sign('exit', [163], 'A', 'bbox')
sign('mech', [118, 116, 117, 115], 'A')
sign('car', [119, 120], 'A')
sign('carside', [180], 'B', 'bbox', pad=(-.75, 0, -.08, 0))
sign('brut', [155], 'A')
sign('surv', [168], 'A')
sign('mallfront', [126], 'A')
sign('mallupper', [125], 'B')
sign('mallside', [124], 'B')
sign('mallmint', [122], 'B')
sign('mallband', [158], 'B')

# signs that sit on real objects in the photo: use the measured corners
def quad_sign(key, q, aspect):
    OUT[key] = dict(quad=[list(map(float, p)) for p in q], aspect=aspect, plane='photo')
s2 = np.array([[970.7, 544], [1022.7, 562.7], [1046, 771.7], [990, 757]])
quad_sign('s2', s2, 52 / 215)
def lerp_quad(q, v0, v1):
    """sub-quad of a quad between fractional heights v0..v1 (projective along edges approx)"""
    TL, TR, BR, BL = q
    L = lambda a, b, t: a + (b - a) * t
    return np.array([L(TL, BL, v0), L(TR, BR, v0), L(TR, BR, v1), L(TL, BL, v1)])
quad_sign('s2cap', lerp_quad(s2, -0.30, -0.03), 52 / 58)
quad_sign('nose', [[80, 606], [178, 597], [152, 694], [53, 706]], 1.15)
quad_sign('nose2', [[150, 738], [186, 752], [170, 830], [134, 814]], 0.45)

# ---------------- 3D boxes ----------------
def orient(d, p, want):
    X = ray(p)
    st = proj(X + 1e-3 * d) - proj(X)
    return d if np.dot(st, want) > 0 else -d

def solve_len(X0, e, target, axis):
    lo, hi = 0.0, 0.5
    f = lambda L: proj(X0 + L * e)[axis] - target
    flo = f(lo)
    for _ in range(80):
        mid = (lo + hi) / 2
        if np.sign(f(mid)) == np.sign(flo): lo = mid
        else: hi = mid
    return (lo + hi) / 2

def box(key, B0, dirs, targets, faces):
    X0 = ray(B0)
    dims = [solve_len(X0, e, t, ax) for e, (t, ax) in zip(dirs, targets)]
    a, b, c = [np.array(d) * L for d, L in zip(dirs, dims)]
    V = {k: X0 + k[0] * a + k[1] * b + k[2] * c for k in
         [(i, j, l) for i in (0, 1) for j in (0, 1) for l in (0, 1)]}
    for name, (cs, i_w, i_h) in faces.items():
        OUT[f'{key}_{name}_3d'] = [V[k].tolist() for k in cs]
        OUT[f'{key}_{name}'] = dict(quad=[proj(V[k]).round(2).tolist() for k in cs],
                                    aspect=float(dims[i_w] / dims[i_h]), plane='box')
    return dims

# hanging cube: right face along the train direction, left face perpendicular, underside visible
B0 = np.array([330., 228.])
e1 = orient(d1, B0, [1, .6]); e2 = orient(d2, B0, [-1, .8]); eu = orient(up, B0, [0, -1])
box('cube', B0, (e1, e2, eu), ((412, 0), (232, 0), (-90, 1)), {
    'right': ([(0, 0, 1), (1, 0, 1), (1, 0, 0), (0, 0, 0)], 0, 2),
    'left': ([(0, 1, 1), (0, 0, 1), (0, 0, 0), (0, 1, 0)], 1, 2),
    'bottom': ([(0, 1, 0), (0, 0, 0), (1, 0, 0), (1, 1, 0)], 1, 0),
})
# Soviet box: long front along the train, short end face, underside
SB = np.array([746., 989.])
e1 = orient(d1, SB, [1, .5]); e2 = orient(d2, SB, [-1, .9]); eu = orient(up, SB, [0, -1])
box('sov', SB, (e1, e2, eu), ((994, 0), (700, 0), (868, 1)), {
    'front': ([(0, 0, 1), (1, 0, 1), (1, 0, 0), (0, 0, 0)], 0, 2),
    'end': ([(0, 1, 1), (0, 0, 1), (0, 0, 0), (0, 1, 0)], 1, 2),
    'bottom': ([(0, 1, 0), (1, 1, 0), (1, 0, 0), (0, 0, 0)], 0, 1),
})

# right hanging box: big front screen along the train, narrow left side face, underside
RB = np.array([1057., 1205.])
e1 = orient(d1, RB, [1, .5]); e2 = orient(d2, RB, [-1, .9]); eu = orient(up, RB, [0, -1])
box('rbox', RB, (e1, e2, eu), ((1300, 0), (1030, 0), (840, 1)), {
    'front': ([(0, 0, 1), (1, 0, 1), (1, 0, 0), (0, 0, 0)], 0, 2),
    'side': ([(0, 1, 1), (0, 0, 1), (0, 0, 0), (0, 1, 0)], 1, 2),
    'bottom': ([(0, 1, 0), (1, 1, 0), (1, 0, 0), (0, 0, 0)], 0, 1),
})

# multi-layer GPU hologram: each layer = parallel plane (top band + stem), fitted to its sketch
for k in range(5):
    top, stem = P[137 + 2 * k], P[138 + 2 * k]
    poly = np.vstack([top, stem])
    H = Hmat('A', poly.mean(0))
    stt, sts = to_plane(H, top), to_plane(H, stem)
    sx = lambda st: (np.sort(st[:, 0])[:2].mean(), np.sort(st[:, 0])[-2:].mean())
    sy = lambda st: (np.sort(st[:, 1])[:2].mean(), np.sort(st[:, 1])[-2:].mean())
    (tl, tr), (tt, tb) = sx(stt), sy(stt)
    (sl, sr), (s_t, sb) = sx(sts), sy(sts)
    l, r, t, b = min(tl, sl), max(tr, sr), tt, sb
    c = np.array([[l, t], [r, t], [r, b], [l, b]])
    put(f'gpu{k}', H, c, 'A', dict(top_b=float((tb - t) / (b - t)), stem_l=float((sl - l) / (r - l))))
    OUT[f'gpu{k}']['clip'] = [to_img(H, np.array([[l, t], [r, t], [r, tb], [l, tb]])).round(2).tolist(),
                              to_img(H, np.array([[sl, t], [r, t], [r, b], [sl, b]])).round(2).tolist()]

# light bars along the train: re-aim each long run at the train vanishing point
v1 = np.array(cam['v1'])
bars = []
for id_, start in ((131, (161, 720)), (132, (156, 739)), (133, (156, 759))):
    nose = P[id_][0]
    corner = np.array(start, float)
    d = v1 - corner; d /= np.linalg.norm(d)
    end = corner + d * (1360 - corner[0]) / d[0]
    bars.append([nose.tolist(), corner.tolist(), end.tolist()])
OUT['bars'] = dict(lines=bars)

json.dump(OUT, open(f'{S}/scene/signs.json', 'w'), indent=0)
with open(f'{S}/scene/signs.js', 'w') as f:
    f.write('const SG=' + json.dumps(OUT) + ';\n')
    f.write('const CAM=' + json.dumps(dict(K=K.tolist(), up=up.tolist(), d1=d1.tolist(), d2=d2.tolist())) + ';\n')
print('wrote', len(OUT), 'signs')
