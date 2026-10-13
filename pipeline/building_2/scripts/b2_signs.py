"""Composite building-2 signage onto the photo (page 2x canvas).

Each face: cleaned block mask -> 4 corners -> boundary curves from the mask contour -> Coons patch with mild
perspective foreshortening -> inverse map (u,v) per pixel -> texture lookup -> material (LED pixel grid,
lightbox diffuser + metal frame, dark metal returns, neon tubes, lamps).
Also writes out/signgeo.npz: emission mask, two-sided flag, per-pixel normal/position overrides (page 1x units)
for the light-transport stage.
"""
import json, sys, numpy as np, cv2
from PIL import Image
from scipy.interpolate import griddata
sys.path.insert(0, 'scripts')
from b2_faces import FACES, face_mask, clean, piece_alpha

def s2l(x): return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4).astype(np.float32)
def l2s(x):
    x = np.clip(x, 0, None); return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055).astype(np.float32)

W2, H2 = 2910, 4112
base = np.asarray(Image.open('scene/base.png').convert('RGB'), np.float32) / 255
canvas = s2l(base)                                     # linear working canvas
items = json.load(open('out/full.svg.json'))
F = json.load(open('scene/faces.json'))
G = np.load('out/geo.npz'); GP, GN = G['P'], G['N']; th = float(G['th'])
GPF, GPN, GNF, GNN = G['Pf'], G['Pn'], G['Nf'], G['Nn']
NEAR = {'band_top', 'band_front', 'band_end', 'rec_black', 'rec_dots', 'rec_floor', 'rec_wall', 'rec_wall2',
        'trbox_top', 'trbox_left', 'trbox_front', 'pink_top', 'pink_mid', 'pink_bot', 'pink_side', 'kiosk'} | {'tile_' + t for t in ('r26', 'r27', 'r28', 'r29', 'r30', 'r31')}
CUR = {'anchor': 'far'}
up = np.array([0, -np.cos(th), -np.sin(th)], np.float32); h2 = np.array([0, -np.sin(th), np.cos(th)], np.float32)
ex = np.array([1.0, 0, 0], np.float32); toward = -np.array([0, 0, 1.0], np.float32)
# sign geometry maps at 1x (page) resolution
EM = np.zeros((2056, 1455), np.float32); TWO = np.zeros((2056, 1455), np.float32)
SN = np.zeros((2056, 1455, 3), np.float32); SP = np.zeros((2056, 1455, 3), np.float32); SM = np.zeros((2056, 1455), np.float32)

MANUAL = {
    'trbox_front': [(2160, 340), (2531, 309), (2531, 577), (2165, 579)],
    'cap_front': [(706, 1513), (1031, 1566), (1031, 1641), (706, 1602)],
    'cap_top': [(772, 1471), (1096, 1547), (1031, 1566), (706, 1513)],
    'wedge_face': [(861, 1613), (1162, 1381), (1263, 1397), (862, 1615)],
    'band_top': [(1347, 2190), (2438, 1322), (2711, 1380), (1429, 2259)],
    'kiosk': [(1962, 1014), (2039, 1061), (2037, 1208), (1958, 1160)],
}
LED = {'trbox_left', 'trbox_front', 'mag', 'band_top', 'band_front', 'band_end', 'cap_front', 'cap_top', 'kiosk', 'rec_floor',
       'tile_r28', 'tile_r26', 'tile_r30', 'tile_r27', 'tile_r31', 'tile_r29', 'moon', 'mascot'}
BOX = {'pink_top', 'pink_bot', 'mint_v1', 'cream_h', 'mint_v2', 'pill', 'arc', 'wedge_face', 'blade1', 'blade2', 'blade3', 'cap_end', 'L_face', 'rec_wall', 'rec_wall2'}
TWO_SIDED = {'blade1', 'blade2', 'blade3'}
BBOXMAP = {'trbox_top', 'pink_side', 'pink_mid', 'L_face', 'L_side', 'L_bot', 'wedge_side', 'wedge_under', 'moon_frame'}

def doc_index(p):
    for i, it in enumerate(items):
        if p[0] == 'r' and it['kind'] == 'raster' and it['i'] == int(p[1:]): return i
        if p[0] == 'v' and i == int(p[1:]): return i
    return 999

def resample(pts, n):
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    if d[-1] < 1e-6: return np.repeat(pts[:1], n, 0)
    t = np.linspace(0, d[-1], n)
    return np.stack([np.interp(t, d, pts[:, 0]), np.interp(t, d, pts[:, 1])], -1)

def boundary(b, C):
    """split the outer contour of mask b at the 4 corners C (TL,TR,BR,BL) into top/right/bottom/left polylines"""
    cnts, _ = cv2.findContours(b, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cnts, key=cv2.contourArea)[:, 0, :].astype(np.float64)
    x, y = c[:, 0], c[:, 1]
    if 0.5 * np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y) < 0: c = c[::-1]   # clockwise in image coords
    idx = [int(np.argmin(((c - np.array(p)) ** 2).sum(1))) for p in C]
    n = len(c)
    def arc(i, j):
        k = (j - i) % n
        return c[(i + np.arange(k + 1)) % n]
    top, right, bot, left = arc(idx[0], idx[1]), arc(idx[1], idx[2]), arc(idx[2], idx[3])[::-1], arc(idx[3], idx[0])[::-1]
    for k_, a in enumerate((top, right, bot, left)):         # guard against a corner order the contour cannot honour
        if len(a) > 0.8 * n: return None
    return top, right, bot, left

def coons(b, C, nu, nv, persp=True):
    bd = boundary(b, C)
    C = np.array(C, float)
    if bd is None:
        T, Bm = np.linspace(C[0], C[1], 50), np.linspace(C[3], C[2], 50)
        L, R = np.linspace(C[0], C[3], 50), np.linspace(C[1], C[2], 50)
    else:
        T, R, Bm, L = bd
    TL, TR, BR, BL = C[0], C[1], C[2], C[3]
    hL, hR = np.linalg.norm(TL - BL), np.linalg.norm(TR - BR)
    wT, wB = np.linalg.norm(TL - TR), np.linalg.norm(BL - BR)
    rh = np.clip(hR / max(hL, 1), 0.85, 1.18) if persp else 1.0
    rw = np.clip(wB / max(wT, 1), 0.85, 1.18) if persp else 1.0
    u = np.linspace(0, 1, nu); v = np.linspace(0, 1, nv)
    su = u * rh / ((1 - u) + u * rh); sv = v * rw / ((1 - v) + v * rw)
    def along(P, s):
        P = resample(np.asarray(P, float), 400); return np.stack([np.interp(s, np.linspace(0, 1, 400), P[:, k]) for k in (0, 1)], -1)
    Tu, Bu = along(T, su), along(Bm, su)
    Lv, Rv = along(L, sv), along(R, sv)
    U, V = np.meshgrid(u, v)
    P = ((1 - V)[..., None] * Tu[None] + V[..., None] * Bu[None] + (1 - U)[..., None] * Lv[:, None] + U[..., None] * Rv[:, None]
         - ((1 - U) * (1 - V))[..., None] * TL - (U * (1 - V))[..., None] * TR - ((1 - U) * V)[..., None] * BL - (U * V)[..., None] * BR)
    return P, U, V

def inverse_uv(P, U, V, bbox, mask):
    x0, y0, x1, y1 = bbox
    ys, xs = np.nonzero(mask[y0:y1 + 1, x0:x1 + 1] > 0)
    xs = xs + x0; ys = ys + y0
    pts = P.reshape(-1, 2); vals = np.stack([U.ravel(), V.ravel()], -1)
    uv = griddata(pts, vals, (xs + .5, ys + .5), method='linear')
    bad = np.isnan(uv[:, 0])
    if bad.any(): uv[bad] = griddata(pts, vals, (xs[bad] + .5, ys[bad] + .5), method='nearest')
    return xs, ys, np.clip(uv, 0, 1)

def load_tex(name, w_out, h_out):
    im = Image.open(f'tex/{name}.png').convert('RGBA')
    tw, th_ = im.size
    sc = min(1.0, 1.6 * max(w_out / tw, h_out / th_))     # pre-filter: keep ~1.6 texels per output pixel
    if sc < 1: im = im.resize((max(8, int(tw * sc)), max(8, int(th_ * sc))), Image.LANCZOS)
    a = np.asarray(im, np.float32) / 255
    return a

def sample(tex, u, v):
    h, w = tex.shape[:2]
    n = len(u); cols = 4096; rows = (n + cols - 1) // cols
    mx = np.zeros(rows * cols, np.float32); my = np.zeros(rows * cols, np.float32)
    mx[:n] = u * (w - 1); my[:n] = v * (h - 1)
    out = cv2.remap(tex, mx.reshape(rows, cols), my.reshape(rows, cols), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return out.reshape(rows * cols, -1)[:n]

def hash2(i, j):
    return (np.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1.0

def put_geo(xs, ys, nrm, off, emissive, two=False):
    """record sign geometry at 1x: normal and position (geo surface point pushed `off` px toward the viewer)"""
    x1, y1 = np.clip(xs // 2, 0, 1454), np.clip(ys // 2, 0, 2055)
    n = nrm if nrm.ndim == 2 else np.repeat(nrm[None], len(xs), 0)
    SN[y1, x1] = n; SM[y1, x1] = 1
    base_p = GPN if CUR['anchor'] == 'near' else GPF
    SP[y1, x1] = base_p[y1, x1] + toward[None] * off
    if emissive: EM[y1, x1] = 1
    if two: TWO[y1, x1] = 1

def face_normal(name, xs, ys):
    x1, y1 = np.clip(xs // 2, 0, 1454), np.clip(ys // 2, 0, 2055)
    gn = (GNN if CUR['anchor'] == 'near' else GNF)[y1, x1]
    def tangent_left(n):
        t = np.cross(np.repeat(up[None], len(n), 0), n); t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-9
        t[(t @ toward) < 0] *= -1
        return t
    if name in ('band_top', 'trbox_top', 'cap_top', 'rec_floor', 'L_bot'): return up, 18
    if name in ('band_end', 'rec_wall', 'rec_wall2'): return tangent_left(gn), 20
    if name.startswith('blade'): return tangent_left(gn), 60
    if name == 'trbox_front': return -h2, 140
    if name == 'trbox_left': n = -0.8 * ex - 0.6 * h2; return n / np.linalg.norm(n), 140
    if name in ('wedge_face',): n = up - h2; return n / np.linalg.norm(n), 60
    if name in ('wedge_side', 'cap_end', 'pink_side'): n = 0.8 * ex - 0.6 * h2; return n / np.linalg.norm(n), 50
    if name in ('wedge_under', 'L_side'): n = -up * 0.6 - h2 * 0.8; return n / np.linalg.norm(n), 40
    if name.startswith(('rec_black', 'rec_dots')): return gn, -90
    if name in ('rec_floor',): return up, -40
    if name in ('rec_wall', 'rec_wall2'): return gn * 0 + (-ex), -60
    return gn, 10

def material(name, kind, rgba, xs, ys, uv, b, wpx, hpx):
    col = s2l(rgba[:, :3]); al = rgba[:, 3]
    if kind in ('screen', 'disc'):
        if name in LED:
            nu, nv = max(20, wpx / 3.6), max(8, hpx / 3.6)
            fu, fv = (uv[:, 0] * nu) % 1, (uv[:, 1] * nv) % 1
            cell = np.clip(1 - (np.abs(fu - .5) * 2) ** 6 * 0.4, 0, 1) * np.clip(1 - (np.abs(fv - .5) * 2) ** 6 * 0.4, 0, 1)
            var = 0.93 + 0.14 * hash2(np.floor(uv[:, 0] * nu), np.floor(uv[:, 1] * nv))
            col = col * (cell * var)[:, None] * 1.05
        else:                                           # lightbox: fluorescent tubes behind an acrylic diffuser
            tubes = 0.92 + 0.08 * np.cos(2 * np.pi * (uv[:, 0] if wpx > hpx * 1.3 else uv[:, 1]) * 4)
            col = col * tubes[:, None]
        # metal frame / bezel from the distance to the face edge
        dist = cv2.distanceTransform(b, cv2.DIST_L2, 3)[ys, xs]
        fw = np.clip(min(wpx, hpx) * 0.025, 1.5, 7)
        frame = np.clip(1 - (dist - fw) / 1.2, 0, 1)
        inner = np.clip(dist / (fw * 4), 0, 1)
        col = col * (0.82 + 0.18 * inner)[:, None]
        col = col * (1 - frame)[:, None] + np.array([0.012, 0.012, 0.014], np.float32) * frame[:, None]
        return col, al, (1 - frame) * al
    if kind == 'metal':
        tint = s2l(rgba[:, :3])
        shade = 0.035 + 0.02 * uv[:, 1]
        return tint * shade[:, None] * 0.6 + 0.006, al, np.zeros_like(al)
    if kind in ('void', 'top'):
        return col, al, (np.zeros_like(al) if kind == 'void' else (col.max(1) > 0.2).astype(np.float32) * al)
    return col, al, al

def draw_face(name, tex_name=None, mode='coons'):
    CUR['anchor'] = 'near' if name in NEAR else 'far'
    pieces, rot, kind = FACES[name]
    m = face_mask(name); b = clean(m)
    if name == 'kiosk':                                 # separate the thin mounting arm
        arm = b - cv2.morphologyEx(b, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8)); b = b - arm
        ys, xs = np.nonzero(arm)
        canvas[ys, xs] = canvas[ys, xs] * 0.2 + 0.01
    if name == 'moon':                                  # fill the moon hole; the disc is drawn separately
        cnts, _ = cv2.findContours(b, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE); full = np.zeros_like(b)
        cv2.drawContours(full, cnts, -1, 1, -1); hole = full - b; b = full
    C = MANUAL.get(name, F[name]['corners'])
    ys0, xs0 = np.nonzero(b)
    bbox = (xs0.min(), ys0.min(), xs0.max(), ys0.max())
    Cn = np.array(C, float)
    wpx = 0.5 * (np.linalg.norm(Cn[1] - Cn[0]) + np.linalg.norm(Cn[2] - Cn[3]))
    hpx = 0.5 * (np.linalg.norm(Cn[3] - Cn[0]) + np.linalg.norm(Cn[2] - Cn[1]))
    if name.startswith('tile_'):                       # parallelogram tiles (partly covered by neighbours): homography
        cols = np.nonzero(b.any(0))[0]; xl, xr = cols.min() + 2, cols.max() - 2
        yl = np.nonzero(b[:, xl])[0]; yr = np.nonzero(b[:, xr])[0]
        TL, BL, TR = np.array([xl, yl.min()], float), np.array([xl, yl.max()], float), np.array([xr, yr.min()], float)
        C = [TL, TR, TR + (BL - TL), BL]
        Hh = cv2.getPerspectiveTransform(np.float32(C), np.float32([[0, 0], [1, 0], [1, 1], [0, 1]]))
        xs, ys = xs0, ys0
        q = np.c_[xs + .5, ys + .5, np.ones(len(xs))] @ Hh.T; uv = np.clip(q[:, :2] / q[:, 2:3], 0, 1)
        wpx, hpx = np.linalg.norm(TR - TL), np.linalg.norm(BL - TL)
    elif mode == 'bbox' or name in BBOXMAP:
        xs, ys = xs0, ys0
        uv = np.stack([(xs - bbox[0]) / max(1, bbox[2] - bbox[0]), (ys - bbox[1]) / max(1, bbox[3] - bbox[1])], -1)
        wpx, hpx = bbox[2] - bbox[0], bbox[3] - bbox[1]
    else:
        nu = int(np.clip(wpx / 6, 24, 220)); nv = int(np.clip(hpx / 6, 12, 160))
        P, U, V = coons(b, C, nu, nv)
        xs, ys, uv = inverse_uv(P, U, V, bbox, b)
    alpha_aa = cv2.GaussianBlur(b.astype(np.float32), (0, 0), 0.7)[ys, xs]
    if name.startswith('tile_'):
        tile_texture(name, b, xs, ys, uv)
    if tex_name:
        tex = load_tex(tex_name, wpx, hpx); rgba = sample(tex, uv[:, 0], uv[:, 1])
    else:                                               # materials: use the drawn colour
        it_col = np.asarray(Image.open(f'scene/masks/{pieces[0]}.png'))
        if it_col.ndim == 3: rgba = np.c_[it_col[ys, xs, :3] / 255., np.ones(len(xs))].astype(np.float32)
        else:
            hexc = [it for i, it in enumerate(items) if i == int(pieces[0][1:])][0]['fill'].lstrip('#')
            rgba = np.tile(np.array([int(hexc[k:k + 2], 16) / 255 for k in (0, 2, 4)] + [1.0], np.float32), (len(xs), 1))
    col, al, emis = material(name, kind, rgba, xs, ys, uv, b, wpx, hpx)
    a = (al * alpha_aa)[:, None]
    canvas[ys, xs] = canvas[ys, xs] * (1 - a) + col * a
    nrm, off = face_normal(name, xs, ys)
    put_geo(xs, ys, nrm, off, emissive=kind in ('screen', 'disc', 'top') and emis.mean() > 0.05, two=name in TWO_SIDED)
    if name == 'moon': draw_disc_mask(hole, 'moon_disc')
    return len(xs)

TILE_ORDER = ['tile_r28', 'tile_r26', 'tile_r30', 'tile_r27', 'tile_r31', 'tile_r29']    # drawing (stacking) order
TILE_TXT = {'tile_r28': ('#fdfbb0', '#141414', '夜市', 'DelaGothicOne-400.ttf'), 'tile_r26': ('#1414ff', '#ffffff', 'NIGHT', 'Bungee-400.ttf'),
            'tile_r30': ('#fdfbb0', '#141414', '屋台', 'DelaGothicOne-400.ttf'), 'tile_r27': ('#1414ff', '#ffffff', 'MARKET', 'Bungee-400.ttf'),
            'tile_r31': ('#fdfbb0', '#c8141e', '毎晩', 'DelaGothicOne-400.ttf'), 'tile_r29': ('#1414ff', '#fff36a', '22-05', 'Orbitron-900.ttf')}
def tile_texture(name, b, xs, ys, uv):
    from PIL import ImageDraw, ImageFont
    later = TILE_ORDER[TILE_ORDER.index(name) + 1:]
    cover = np.zeros_like(b)
    for t in later: cover |= clean(face_mask(t))
    vis = cover[ys, xs] == 0
    bg, fg, txt, font = TILE_TXT[name]
    W_, H_ = 800, 500
    im = Image.new('RGBA', (W_, H_), bg); d = ImageDraw.Draw(im)
    if vis.sum() > 50:
        gw, gh = 160, 100                                   # visible part of the tile in texture space
        grid = np.zeros((gh, gw), np.uint8)
        gi = np.clip((uv[vis, 1] * (gh - 1)).astype(int), 0, gh - 1); gj = np.clip((uv[vis, 0] * (gw - 1)).astype(int), 0, gw - 1)
        grid[gi, gj] = 1
        grid = cv2.morphologyEx(grid, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        best = (0, 0, 0, 0)
        for r0 in range(0, gh, 2):                          # largest inscribed axis-aligned box (texture space)
            for r1 in range(r0 + 6, gh + 1, 2):
                rows = grid[r0:r1].min(0)
                run = 0; bestrun = (0, 0)
                for j, v_ in enumerate(rows):
                    run = run + 1 if v_ else 0
                    if run > bestrun[0]: bestrun = (run, j)
                area = bestrun[0] * W_ / gw * min((r1 - r0) * H_ / gh, bestrun[0] * W_ / gw * 0.6)
                if area > best[0]: best = (area, (bestrun[1] - bestrun[0] + 1) / gw, r0 / gh, bestrun[0] / gw, (r1 - r0) / gh)
        _, bu, bv, bw_, bh_ = best
        boxw, boxh = bw_ * W_ * 0.86, bh_ * H_ * 0.8
        size = 400
        while size > 20:
            f = ImageFont.truetype('fonts/' + font, size); bb = d.textbbox((0, 0), txt, font=f)
            if bb[2] - bb[0] <= boxw and bb[3] - bb[1] <= boxh: break
            size -= 6
        bb = d.textbbox((0, 0), txt, font=f)
        d.text(((bu + bw_ / 2) * W_ - (bb[0] + bb[2]) / 2, (bv + bh_ / 2) * H_ - (bb[1] + bb[3]) / 2), txt, font=f, fill=fg)
    im.save(f'tex/{name}.png')

def draw_disc_mask(bm, tex_name, rim=True):
    cnts, _ = cv2.findContours(bm.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cnts, key=cv2.contourArea)
    (cx, cy), (ax1, ax2), ang = cv2.fitEllipse(c)
    tex = load_tex(tex_name, ax1, ax2); th_, tw = tex.shape[:2]
    a = np.radians(ang); R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    S = np.diag([ax1 / tw, ax2 / th_])
    A = R @ S; t = np.array([cx, cy]) - A @ np.array([tw / 2, th_ / 2])
    M = np.c_[A, t].astype(np.float32)
    x0, y0 = int(cx - max(ax1, ax2) / 2 - 6), int(cy - max(ax1, ax2) / 2 - 6); x1, y1 = int(cx + max(ax1, ax2) / 2 + 6), int(cy + max(ax1, ax2) / 2 + 6)
    M2 = M.copy(); M2[:, 2] -= [x0, y0]
    warped = cv2.warpAffine(tex, M2, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR)
    reg = canvas[y0:y1, x0:x1]
    al = warped[..., 3:4]
    col = s2l(warped[..., :3])
    if rim:                                             # disc edge seen slightly from the side: dark metal rim
        inside = (warped[..., 3] > .5).astype(np.uint8)
        rimm = (cv2.dilate(inside, np.ones((5, 5), np.uint8)) - inside).astype(np.float32)
        reg[:] = reg * (1 - rimm[..., None] * .9) + 0.01 * rimm[..., None]
    reg[:] = reg * (1 - al) + col * al
    ys, xs = np.nonzero(al[..., 0] > 0.5); xs = xs + x0; ys = ys + y0
    nrm, off = face_normal('disc', xs, ys)
    put_geo(xs, ys, nrm, 12, emissive=True)

def draw_neon(piece, core_col=None):
    CUR['anchor'] = 'far'
    im = np.asarray(Image.open(f'scene/masks/{piece}.png')).astype(np.float32) / 255
    al = im[..., 3]; ys, xs = np.nonzero(al > 0.02)
    x0, y0, x1, y1 = xs.min() - 30, ys.min() - 30, xs.max() + 30, ys.max() + 30
    a = al[y0:y1, x0:x1]
    colr = s2l(np.array(im[al > 0.8][:, :3].mean(0), np.float32))
    tube = cv2.GaussianBlur((a > 0.4).astype(np.float32), (0, 0), 0.9)
    core = cv2.GaussianBlur(cv2.erode((a > 0.4).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32), (0, 0), 0.8)
    glass = tube[..., None] * (colr * 1.6)
    hot = core[..., None] * (colr * 0.6 + 0.55)
    halo = cv2.GaussianBlur(tube, (0, 0), 5)[..., None] * colr * 0.35
    reg = canvas[y0:y1, x0:x1]
    reg[:] = reg * (1 - tube[..., None] * 0.9) + glass * 0.9 + hot + halo
    yy, xx = np.nonzero(tube > 0.3); put_geo(xx + x0, yy + y0, face_normal('neon', xx + x0, yy + y0)[0], 8, True, True)

def draw_lamp(piece):
    CUR['anchor'] = 'far'
    m = piece_alpha(piece).astype(np.float32) / 255
    hexc = items[int(piece[1:])]['fill'].lstrip('#')
    colr = s2l(np.array([int(hexc[k:k + 2], 16) / 255 for k in (0, 2, 4)], np.float32))
    ys, xs = np.nonzero(m > 0.02); x0, y0, x1, y1 = xs.min() - 20, ys.min() - 20, xs.max() + 20, ys.max() + 20
    a = m[y0:y1, x0:x1]
    core = cv2.GaussianBlur(cv2.erode((a > .5).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32), (0, 0), 1.5)
    reg = canvas[y0:y1, x0:x1]
    reg[:] = reg * (1 - a[..., None] * .95) + a[..., None] * colr * 1.4 + core[..., None] * (colr * .5 + .5) + cv2.GaussianBlur(a, (0, 0), 4)[..., None] * colr * .3
    yy, xx = np.nonzero(a > .5); put_geo(xx + x0, yy + y0, face_normal('lamp', xx + x0, yy + y0)[0], 6, True)

def procedural_band_front():
    """purple bioluminescent cell screen (the designer's cellular raster, rebuilt sharp): Worley-noise cells"""
    w, h = 2600, 460; rng = np.random.default_rng(11)
    pts = np.c_[rng.uniform(0, w, 900), rng.uniform(0, h, 900)]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d1 = np.full((h, w), 1e9, np.float32); d2 = np.full((h, w), 1e9, np.float32)
    for px, py in pts:
        d = (xx - px) ** 2 + (yy - py) ** 2
        d2 = np.minimum(d2, np.maximum(d1, d)); d1 = np.minimum(d1, d)
    d1, d2 = np.sqrt(d1), np.sqrt(d2)
    edge = np.exp(-((d2 - d1) / 3.5) ** 2)              # glowing cell membranes
    nuc = np.exp(-(d1 / 9) ** 2)                         # bright nuclei
    blob = np.clip(1 - d1 / 34, 0, 1) ** 2
    r = 0.08 * blob + 0.55 * edge + 0.9 * nuc; g = 0.02 * blob + 0.12 * edge + 0.55 * nuc; bl = 0.18 * blob + 0.95 * edge + 1.0 * nuc
    img = np.stack([r * 0.75, g * 0.55, bl * 0.95], -1) * 0.95 + np.array([0.035, 0.0, 0.06])
    Image.fromarray((np.clip(img, 0, 1) ** (1 / 1.5) * 255).astype(np.uint8)).convert('RGBA').save('tex/band_front.png')
    # recess interior: dark hall with hanging purple orb lamps receding
    w, h = 2600, 420; yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    img = np.zeros((h, w, 3), np.float32) + np.array([0.012, 0.004, 0.02])
    for i in range(110):
        px, py, s = rng.uniform(0, w), rng.uniform(40, h - 20), rng.uniform(5, 16)
        dd = np.sqrt((xx - px) ** 2 + (yy - py) ** 2)
        img += (np.exp(-(dd / s) ** 2) * 1.2 + np.exp(-(dd / (s * 3.5)) ** 2) * 0.12)[..., None] * np.array([0.75, 0.3, 1.0])
    Image.fromarray((np.clip(img, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)).convert('RGBA').save('tex/rec_dots.png')
    w, h = 1200, 400; yy, xx = np.mgrid[0:h, 0:w].astype(np.float32) / np.array([h, w], np.float32)[:, None, None]
    img = np.zeros((h, w, 3), np.float32) + np.array([0.004, 0.0015, 0.007])
    img += (np.exp(-(1 - xx) * 5) * 0.05)[..., None] * np.array([0.9, 0.1, 0.9])          # spill from the magenta side wall
    img += (np.exp(-(1 - yy) * 4) * 0.035)[..., None] * np.array([0.9, 0.35, 0.9])         # glow from the pink floor
    for k in range(14):                                                                     # deep columns and floor slabs
        x = (k + 0.5) / 14; img[:, int(x * w):int(x * w) + 6] *= 0.35
    for k in range(5):
        y = 0.15 + k * 0.17; img[int(y * h):int(y * h) + 3] += np.array([0.010, 0.004, 0.014])
    for i in range(60):                                                                     # a few lit windows far inside
        px, py = int(rng.uniform(0, w - 8)), int(rng.uniform(20, h - 30))
        img[py:py + 5, px:px + 4] += np.array([0.12, 0.07, 0.03]) * rng.uniform(0.3, 1)
    Image.fromarray((np.clip(img, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)).convert('RGBA').save('tex/rec_black.png')

procedural_band_front()
ORDER = [
    ('rec_black', 'rec_black'), ('rec_dots', 'rec_dots'), ('rec_floor', 'rec_floor'), ('rec_wall2', 'rec_wall2'), ('rec_wall', 'rec_wall'),
    ('band_front', 'band_front'), ('tile_r28', 'tile_r28'), ('tile_r26', 'tile_r26'), ('tile_r30', 'tile_r30'), ('tile_r27', 'tile_r27'),
    ('tile_r31', 'tile_r31'), ('tile_r29', 'tile_r29'), ('band_end', 'band_end'), ('band_top', 'band_top'),
    ('moon_frame', None), ('moon', 'moon'), ('mag', 'mag'), ('mascot', 'mascot'),
    ('mint_v1', 'mint_v1'), ('cream_h', 'cream_h'), ('mint_v2', 'mint_v2'), ('pill', 'pill'), ('kiosk', 'kiosk'), ('arc', 'arc'),
    ('cap_top', 'cap_top'), ('cap_front', 'cap_front'), ('cap_end', 'cap_end'), ('wedge_under', None), ('wedge_side', None), ('wedge_face', 'wedge_face'),
    ('trbox_top', 'trbox_top'), ('trbox_left', 'trbox_left'), ('trbox_front', 'trbox_front'),
    ('pink_side', None), ('pink_bot', 'pink_bot'), ('pink_mid', 'pink_mid'), ('pink_top', 'pink_top'),
    ('blade3', 'blade3'), ('blade2', 'blade2'), ('blade1', 'blade1'),
    ('L_bot', None), ('L_side', None), ('L_face', 'L_face'),
]
for name, tx in ORDER:
    n = draw_face(name, tx); print(name, n, flush=True)
for p in ('r34', 'r35', 'r36', 'r37'): draw_neon(p)
for p in ('v43', 'v44', 'v45', 'v46', 'v47', 'v48'): draw_lamp(p)
CUR['anchor'] = 'far'
for e in ('r8', 'r9', 'r10', 'r11', 'r12'):
    draw_disc_mask(clean(face_mask('disc_' + e)), 'disc_' + e)
out = l2s(canvas)
Image.fromarray((np.clip(out, 0, 1) * 255 + .5).astype(np.uint8)).save('out/full_2x.png')
np.savez_compressed('out/signgeo.npz', EM=EM, TWO=TWO, SN=SN, SP=SP, SM=SM)
Image.fromarray((np.clip(out, 0, 1) * 255 + .5).astype(np.uint8)).resize((1455, 2056), Image.LANCZOS).save('out/full_1x.png')
print('signs done')
