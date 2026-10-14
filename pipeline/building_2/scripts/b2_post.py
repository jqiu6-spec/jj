#!/usr/bin/env python3
"""Post pass on the finished building-2 frames (2400x3600): support structure for the flat light panels + the SORA
TAXI billboard.

The flat lightboxes and LED screens (くすり, 環状七号線, ホテル MIDORI, PURIN, HOTEL LUNA, the three izakaya blades, the
METRO kiosk, the 夜光 BAR boxes) were drawn as decals and read as floating. Each wall screen becomes a thin LED cabinet
on a steel sub-frame, held off the wall on outrigger brackets with wall plates that bolt to wall rails; side posts get
diagonal ties and big screens a lattice between the brackets. The blades are thin sheets hung on cantilever arms with
a tie rod. Members are sized in metres and projected with the mounting normal of that point of the ring (so the depth
direction turns around the ring) at the local px-per-metre scale; the wall behind the panel's edge falls into its
shadow, with a soft contact shadow beyond. A new wall billboard in the HOTEL LUNA family (SORA TAXI, flying taxi) is
added on the lower-left wall with the same LED material, metal frame and structure, its light spilled and bloomed
onto the wall, then the lens falloff and the film treatment of the frame it sits in (halation, shoulder/toe, grade,
scan sharpening, grain). The big screens (PURIN, HOTEL LUNA, AQUA, the RING SEVEN band) get the LED look of the NEWS
360 balls: cell gaps, gain variation and partly flat cells, laid out in each screen's own (u, v) through a Coons
patch so the grid follows the curved screens.

It works on the finished frames because the `.ai` assets of the pipeline are not in the repository: the panel outlines
are segmented from the Portra frame (all variants share the same geometry), the cinematic and Portra frames are edited
with their own looks, and the dither variant is re-quantised from the edited Portra frame inside the edited area.

usage: python3 -I scripts/b2_post.py --cinematic IN.jpg --portra IN.jpg --dither IN.png --tex tex/sora_taxi.png --out DIR
       [--debug DIR] [--preview-width 1200]
"""
import argparse, os, sys
import numpy as np, cv2
from PIL import Image
from scipy.interpolate import griddata

W, H = 2400, 3600
TH = np.radians(41.7 + 5.0)                      # ring fit pitch + lens re-tilt: foreshortening of depth into image y
SY = np.sin(TH)
RING_X, RING_R = 1200.0, 2200.0                  # far point of the concave wall and its radius in image x

def s2l(x): return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4).astype(np.float32)
def l2s(x):
    x = np.clip(x, 0, None); return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055).astype(np.float32)
def luma(x): return 0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]
def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def blur(a, s):
    return a if s <= 0 else cv2.GaussianBlur(a, (0, 0), s, borderType=cv2.BORDER_REFLECT)
def fill_holes(m):
    ff = np.pad(m, 1).copy(); cv2.floodFill(ff, None, (0, 0), 2); return (ff[1:-1, 1:-1] != 2).astype(np.uint8)
def largest(m, n=1):
    k, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    order = sorted(range(1, k), key=lambda i: -st[i, cv2.CC_STAT_AREA])[:n]
    return [(lab == i).astype(np.uint8) for i in order]
def disk(r): return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
def clean_outline(m, eps, hull=True, smooth=0):
    """the segmented outline is noisy where the glow meets the wall. Straight-edged signs are refit as their convex hull;
    the curved screens (whose top edge sags with the wall, so a hull would bridge it) are smoothed instead. Then the
    outline is simplified to a polygon with `eps` px tolerance."""
    if smooth:
        m = (cv2.GaussianBlur(m.astype(np.float32), (0, 0), smooth) > 0.5).astype(np.uint8)
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cnts, key=cv2.contourArea)
    if hull: c = cv2.convexHull(c)
    poly = cv2.approxPolyDP(c, eps, True)
    out = np.zeros_like(m); cv2.fillPoly(out, [poly], 1); return out
def poly_mask(pts):
    out = np.zeros((H, W), np.uint8); cv2.fillPoly(out, [np.array(pts, np.int32)], 1); return out
def wall_normal(px, nx=None):
    """horizontal normal (nx, nz) of the concave far wall at image x (nz > 0 = toward the camera)"""
    if nx is None: nx = float(np.clip((RING_X - px) / RING_R, -0.7, 0.7))
    return nx, float(np.sqrt(1 - nx * nx))
def shift_vec(nx, nz, t):
    """image displacement from the mounting footprint to a face standing `t` px off the wall"""
    return t * nx, t * nz * SY

# ----------------------------------------------------------------------------------------------- panel geometry
# bbox, hue range (deg) or None, min sat, min val, parts, scale (px per metre), frame dilation px, outline tolerance px
PANELS = {
    'kusuri':    dict(bbox=(215, 480, 345, 800), hue=None, smin=0.0, vmin=0.45, n=1, scale=46, grow=4, eps=5),
    'ringline7': dict(bbox=(1085, 500, 1380, 630), hue=None, smin=0.0, vmin=0.45, n=1, scale=46, grow=4, eps=5),
    'midori':    dict(bbox=(915, 640, 1030, 1055), hue=None, smin=0.0, vmin=0.40, n=1, scale=46, grow=4, eps=5),
    'purin':     dict(bbox=(370, 900, 955, 1405), hue=(265, 335), smin=0.35, vmin=0.22, n=1, scale=44, grow=4, eps=2.5,
                      hull=False, smooth=7, bright=0.55, close=15),       # the cream lettering on its bottom edge joins the mask
    'luna':      dict(bbox=(425, 1790, 835, 2190), hue=(210, 258), smin=0.40, vmin=0.18, n=1, scale=48, grow=4, eps=2.5,
                      hull=False, smooth=5, hidden_corner=(432, 1815)),
    'kiosk':     dict(bbox=(1610, 980, 1780, 1200), hue=(210, 258), smin=0.35, vmin=0.18, n=1, scale=42, grow=3, eps=5),
    'bars':      dict(bbox=(2175, 600, 2400, 1000), hue=(265, 330), smin=0.22, vmin=0.30, n=2, scale=42, grow=3, eps=5),
}
# the izakaya blades light the wall around them too strongly to be segmented by colour: their quads (TL, TR, BR, BL)
# are given by hand, back to front. Thin two-sided sheets hung on a cantilever arm along the top edge with a tie rod.
BLADES = {
    'blade3': dict(quad=[(598, 2268), (770, 2348), (780, 3022), (608, 2942)], scale=46, nx=-0.35),
    'blade2': dict(quad=[(482, 2244), (640, 2325), (660, 3020), (502, 2939)], scale=46, nx=-0.35),
    'blade1': dict(quad=[(344, 2210), (528, 2314), (548, 2990), (350, 2962)], scale=46, nx=-0.35),
}
BALL = (432, 1653, 262)                          # the hovering NEWS 360 ball: in front of HOTEL LUNA

# the new billboard: a 3:2 board on the lower-left (convex, near) wall, whose rows slope ~13 deg down to the right
BOARD = dict(TL=(88, 3090), width=400, height=230, hdir=(0.975, 0.222), vdir=(0.09, 0.996), bow=5.0,
             scale=50, nx=-0.35, frame=5.0, exposure=1.3)

def segment(por):
    hsv = cv2.cvtColor((por * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    Hd, S, V = hsv[..., 0] * 2, hsv[..., 1] / 255, hsv[..., 2] / 255
    yy, xx = np.mgrid[0:H, 0:W]
    ball = ((xx - BALL[0]) ** 2 + (yy - BALL[1]) ** 2 <= BALL[2] ** 2).astype(np.uint8)
    out = []; by_name = {}
    for name, p in PANELS.items():
        x0, y0, x1, y1 = p['bbox']
        m = (V >= p['vmin']) & (S >= p['smin'])
        if p['hue']: m &= (Hd >= p['hue'][0]) & (Hd <= p['hue'][1])
        if p.get('bright'): m |= V >= p['bright']
        reg = np.zeros((H, W), bool); reg[y0:y1, x0:x1] = True
        m = (m & reg).astype(np.uint8)
        if name == 'luna': m[cv2.dilate(ball, disk(4)) > 0] = 0
        if name == 'purin': m[cv2.dilate(by_name['midori'], disk(2)) > 0] = 0    # MIDORI's foot overlaps PURIN's corner
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        kc = p.get('close', 5); m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((kc, kc), np.uint8))
        for j, part in enumerate(largest(m, p['n'])):
            part = fill_holes(part)
            if p.get('hidden_corner'):                       # complete the outline behind the ball
                pts = np.array(np.nonzero(part)[::-1]).T
                hull = cv2.convexHull(np.r_[pts, [p['hidden_corner']]].astype(np.int32))
                full = np.zeros((H, W), np.uint8); cv2.fillConvexPoly(full, hull, 1)
                part = part | (full & cv2.dilate(ball, disk(6)))
            part = cv2.dilate(clean_outline(part, p['eps'], p.get('hull', True), p.get('smooth', 0)), disk(p['grow']))
            ys, xs = np.nonzero(part); cx = xs.mean()
            nx, nz = wall_normal(cx, p.get('nx'))
            out.append(dict(name=f'{name}{j if p["n"] > 1 else ""}', mask=part, scale=p['scale'], d=shift_vec(nx, nz, 1.0), kind='wall'))
            by_name[name] = part
    wn = shift_vec(*wall_normal(0, 0.5), 1.0)                       # the wall the blades hang from
    blades = []
    for name, p in BLADES.items():
        nx, nz = wall_normal(0, p['nx'])
        blades.append(dict(name=name, mask=poly_mask(p['quad']), scale=p['scale'], d=shift_vec(nx, nz, 1.0), kind='blade',
                           poly=np.array(p['quad'], np.float64), wall_n=wn))
    for i, b in enumerate(blades):                                   # drawn back to front: the ones in front hide the structure
        front = [c['mask'] for c in blades[i + 1:]]
        if front: b['occluded_by'] = np.maximum.reduce(front)
    out += blades
    bright = (((V > 0.30) & (S > 0.30)) | (V > 0.72)).astype(np.uint8)
    bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    return out, ball, bright

# ----------------------------------------------------------------------------------------------- the body of a panel
# A wall screen is a thin LED cabinet on a steel sub-frame, held off the wall on outrigger brackets that bolt to wall
# rails; the side posts get diagonal ties. A blade is a thin sheet hung on cantilever arms with a tie rod. Dimensions in
# metres, projected with the mounting normal of that point of the ring (image direction nimg, length 1 for 1 m of depth
# before the camera foreshortening already in nimg) and the local scale s (px per metre).
CAB, PLATE = 0.12, 0.24                       # cabinet depth, wall plate; the rest scales with the panel size (add_body)

def sweep(F, d):
    """pixels swept by face F moved to the wall by image displacement d: the wall the panel's edge stands in front of"""
    dx, dy = d; n = max(2, int(np.ceil(np.hypot(dx, dy) * 1.5)))
    ys, xs = np.nonzero(F); pad = int(abs(dx) + abs(dy) + 4)
    x0, y0 = max(0, xs.min() - pad), max(0, ys.min() - pad); x1, y1 = min(W, xs.max() + pad + 1), min(H, ys.max() + pad + 1)
    f = F[y0:y1, x0:x1]; h, w = f.shape; U = f.copy()
    for i in range(1, n + 1):
        k = i / n
        U |= cv2.warpAffine(f, np.float32([[1, 0, -dx * k], [0, 1, -dy * k]]), (w, h), flags=cv2.INTER_NEAREST)
    out = np.zeros((H, W), np.uint8); out[y0:y1, x0:x1] = U & (1 - f); return out

def face_polygon(F, eps=4.0):
    cnts, _ = cv2.findContours(F, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = cv2.approxPolyDP(max(cnts, key=cv2.contourArea), eps, True)[:, 0, :].astype(np.float64)
    if 0.5 * np.sum(c[:, 0] * np.roll(c[:, 1], -1) - np.roll(c[:, 0], -1) * c[:, 1]) < 0: c = c[::-1]   # clockwise in image coords
    return c

class Layer:
    """steel members drawn back to front into a crop of the frame: dark steel lit by the local glow of the scene
    (a blurred copy of the frame around the panel), with a lit upper edge"""
    def __init__(self, img, touched, box, amb, lift, keep=None):
        self.img, self.touched, self.box, self.amb, self.lift, self.keep = img, touched, box, amb, lift, keep
    def _blend(self, m, col):
        x0, y0, x1, y1 = self.box
        a = m.astype(np.float32)[..., None] / 255
        if self.keep is not None: a = a * (1 - self.keep[..., None])             # things in front stay in front
        reg = self.img[y0:y1, x0:x1]; reg[:] = reg * (1 - a) + col * a
        t = self.touched[y0:y1, x0:x1]; t[:] = np.maximum(t, a[..., 0])
    def _q(self, p): return (int(round(p[0] - self.box[0])), int(round(p[1] - self.box[1])))
    def member(self, p0, p1, width, k, base, hi=True, tint=None, edge=True):
        h, w = self.amb.shape[:2]
        if edge:                                                          # a dark edge separates the member from the wall
            m = np.zeros((h, w), np.uint8); cv2.line(m, self._q(p0), self._q(p1), 255, max(2, int(round(width)) + 2), cv2.LINE_AA)
            self._blend(m, self.amb * k * 0.3 + base * 0.5 + self.lift)
        m = np.zeros((h, w), np.uint8); cv2.line(m, self._q(p0), self._q(p1), 255, max(1, int(round(width))), cv2.LINE_AA)
        self._blend(m, self.amb * k + base + self.lift + (0 if tint is None else tint))
        if hi and width >= 2.5:
            d = np.asarray(p1, float) - np.asarray(p0, float); ln = np.hypot(*d) + 1e-6
            perp = np.array([-d[1], d[0]]) / ln
            if perp[1] > 0: perp = -perp                              # the edge that faces up catches the light
            off = perp * (width / 2 - 0.7)
            m = np.zeros((h, w), np.uint8); cv2.line(m, self._q(np.asarray(p0) + off), self._q(np.asarray(p1) + off), 255, 1, cv2.LINE_AA)
            self._blend(m, self.amb * (k * 1.9) + base * 2.5 + self.lift)
    def strip(self, pts, k, base, tint):
        h, w = self.amb.shape[:2]
        m = np.zeros((h, w), np.uint8)
        cv2.fillPoly(m, [np.array([self._q(p) for p in pts], np.int32)], 255, cv2.LINE_AA)
        self._blend(m, self.amb * k + base + self.lift + tint * 0.04)

def add_body(img, orig, F, nimg, s, kind, look, protect, touched, tint=None, poly=None, wall_n=None, occluder=None):
    """draw the support structure of face F into img (sRGB float). nimg: image direction of the mounting normal
    (toward the viewer) per metre of depth; s: px per metre; kind 'wall' (cabinet on brackets) or 'blade' (sheet on arms)"""
    lift = np.array([0.022, 0.031, 0.028], np.float32) if look == 'cinematic' else 0.0
    face_col = tint if tint is not None else np.percentile(img[F > 0], 60, axis=0)
    poly = face_polygon(F) if poly is None else np.asarray(poly, np.float64)
    nimg = np.asarray(nimg, np.float64)
    cab = CAB if kind == 'wall' else 0.08
    # the structure scales with the panel: a 2 m lightbox sits on a light frame, a 14 m screen on a truss
    size_m = float(max(poly.max(0) - poly.min(0))) / s
    standoff = float(np.clip(0.07 * size_m, 0.45, 1.3))
    mem = float(np.clip(0.05 + 0.012 * size_m, 0.08, 0.20))
    RAIL = POST = mem; BRACKET = 0.8 * mem; TIE = 0.6 * mem; SPACING = float(np.clip(0.12 * size_m, 1.2, 2.5))
    Dc = nimg * cab * s                                                        # face -> back of the cabinet
    wn = nimg if wall_n is None else np.asarray(wall_n, np.float64)
    Dw = wn * (cab + standoff) * s                                             # face -> wall
    # the wall behind the panel's edge is in its shadow; a soft contact shadow beyond the footprint
    G = sweep(F, Dw if kind == 'wall' else Dc)
    front = (protect > 0) if occluder is None else occluder
    shade = (G > 0) & ~front
    img[shade] *= 0.4
    D = cv2.distanceTransform((1 - (F | G)).astype(np.uint8), cv2.DIST_L2, 5)
    ao = 0.22 * np.exp(-(D / (0.45 * s)) ** 1.2) * (D > 0) * (protect == 0)
    img *= (1 - ao)[..., None]
    # the local glow of the scene lights the dark steel
    ys, xs = np.nonzero(F | G); pad = int(1.0 * s) + 8
    box = (max(0, xs.min() - pad), max(0, ys.min() - pad), min(W, xs.max() + pad + 1), min(H, ys.max() + pad + 1))
    x0, y0, x1, y1 = box
    amb = np.clip(cv2.GaussianBlur(orig[y0:y1, x0:x1], (0, 0), 10), 0, 0.35)
    L = Layer(img, touched, box, amb, lift, keep=None if occluder is None else occluder[y0:y1, x0:x1].astype(np.float32))
    # exposed edges face the wall footprint: past them we look onto the structure behind the panel
    n = len(poly); edges = []; centre = poly.mean(0)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]; e = q - p; ln = np.hypot(*e)
        if ln < 1: continue
        out = np.array([e[1], -e[0]]) / ln
        # ... and lie on the wall side of the panel (a notch in the outline must not grow a truss across the face)
        ex = float(out @ (-nimg)) > 0.12 and float(((p + q) / 2 - centre) @ (-nimg)) > 0
        edges.append((p, q, ex))
    if kind == 'wall':
        for p, q, ex in edges:                                                 # wall rails (back)
            if ex: L.member(p - Dw, q - Dw, RAIL * s, 0.42, 0.02)
        chains, cur = [], []                                                   # outrigger brackets along the exposed chains
        for p, q, ex in edges:
            if ex: cur.append((p, q))
            elif cur: chains.append(cur); cur = []
        if cur:
            if chains and edges[0][2]: chains[0] = cur + chains[0]
            else: chains.append(cur)
        for ch in chains:
            pts = np.array([ch[0][0]] + [q for _, q in ch])
            seg = np.linalg.norm(np.diff(pts, axis=0), axis=1); cum = np.r_[0, np.cumsum(seg)]; total = cum[-1]
            k = max(1, int(round(total / (SPACING * s))))
            anchors = []
            for j in range(k + 1):
                t = total * j / k; i = min(int(np.searchsorted(cum, t, side='right') - 1), len(seg) - 1)
                a = pts[i] + (pts[i + 1] - pts[i]) * ((t - cum[i]) / max(seg[i], 1e-6))
                steep = abs(pts[i + 1][1] - pts[i][1]) > abs(pts[i + 1][0] - pts[i][0])
                perp = np.array([-wn[1], wn[0]]); perp /= np.linalg.norm(perp) + 1e-6
                L.member(a - Dw - perp * PLATE * s / 2, a - Dw + perp * PLATE * s / 2, BRACKET * s * 0.8, 0.40, 0.02, hi=False)
                L.member(a - Dc, a - Dw, BRACKET * s, 0.40, 0.02, hi=not steep)
                anchors.append((a, steep))
            if size_m > 5:                                                     # big screens: a lattice between the brackets
                for (a, sa), (b, sb) in zip(anchors[:-1], anchors[1:]):
                    if not (sa or sb): L.member(a - Dw, b - Dc, TIE * s, 0.36, 0.015, hi=False)
        for p, q, ex in edges:                                                 # side posts get diagonal ties to the wall
            if not ex: continue
            e = q - p; ln = np.hypot(*e)
            if abs(e[1]) > 0.7 * ln and ln > 1.2 * s:
                top, bot = (p, q) if p[1] < q[1] else (q, p)
                L.member(top - Dw, top * 0.5 + bot * 0.5 - Dc, TIE * s, 0.36, 0.015, hi=False)
                L.member(bot - Dw, top * 0.5 + bot * 0.5 - Dc, TIE * s, 0.36, 0.015, hi=False)
        for p, q, ex in edges:                                                 # the sub-frame at the back of the cabinet
            if ex: L.member(p - Dc, q - Dc, POST * s, 0.45, 0.025, hi=abs(q[1] - p[1]) < 0.7 * np.hypot(*(q - p)))
    else:
        TL, TR, BR, BL = poly[:4]
        arm = (cab + standoff) * s
        wu = wn / (np.linalg.norm(wn) + 1e-6)
        L.member(TL - Dc, TL - Dc - wu * arm, BRACKET * s, 0.40, 0.02)        # cantilever arm into the wall at the top
        L.member(TL - Dc - wu * arm, TL + (TR - TL) * 0.45 - Dc, TIE * s, 0.36, 0.015, hi=False)   # tie rod
        L.member(TL - Dc, TR - Dc, POST * s * 0.8, 0.45, 0.025)              # the sheet's top rail
    for p, q, ex in edges:                                                     # the cabinet return and its lit edge
        if not ex: continue
        L.strip([p, q, q - Dc, p - Dc], 0.33, 0.02, face_col)
        L.member(p, q, 1.2, 0.8, 0.05, hi=False, tint=face_col * 0.12, edge=False)
    return F | G

# ----------------------------------------------------------------------------------------------- LED texture on the big screens
# The big screens came out of the sign stage with a faint 3 px grid that the lens and film stages all but erased. Here
# they get the LED look of the NEWS 360 balls: one flat colour per LED cell, dark gaps between the cells, per-cell and
# per-module gain variation. Cells are laid out in the screen's own (u, v) through a Coons patch built from the
# screen's outline (so the grid follows the curved screens around the ring), at the same pitch for every screen.
LED_PITCH = 3.4                  # px per LED cell at 2400 px frame width (~7 cm, the pitch of the NEWS 360 balls)
LED_GAP = 0.18                   # dark-gap depth per axis
LED_VAR, LED_MODULE, LED_MODULE_VAR = 0.12, 8, 0.05
LED_FLAT = float(np.clip((LED_PITCH - 2.5) / 2.5, 0, 1))   # how much of each cell is one flat colour (b2_sphere's rule)
SMALL_BALLS = [(470, 1935, 60), (2176, 1405, 42)]           # the small NEWS 360 balls in front of HOTEL LUNA and on the band

# quad TL, TR, BR, BL in frame px; 'mask' names a PANELS entry (cleaned, ball-aware) or a colour rule for the others
SCREENS = {
    'purin':      dict(quad=[(380, 1012), (924, 972), (932, 1345), (410, 1345)], mask='purin'),
    'luna':       dict(quad=[(440, 1800), (810, 1800), (802, 2150), (452, 2082)], mask='luna'),
    'aqua_left':  dict(quad=[(1642, 198), (1838, 236), (1838, 556), (1642, 538)], mask='quad', hue=(205, 262), smin=0.30, vmin=0.12),
    'aqua_front': dict(quad=[(1838, 236), (2222, 262), (2222, 590), (1838, 556)], mask='quad', hue=(205, 262), smin=0.30, vmin=0.12),
    'band_top':   dict(quad=[(1107, 2087), (2229, 1300), (2301, 1394), (1168, 2330)], mask='colour', hue=(300, 358), smin=0.30, vmin=0.40),
    'band_front': dict(quad=[(1168, 2330), (2300, 1394), (2350, 1470), (1240, 2466)], mask='colour', hue=(262, 300), smin=0.25, vmin=0.22,
                       tiles=True),
}

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
    for a in (top, right, bot, left):
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

def inverse_uv(P, U, V, xs, ys):
    pts = P.reshape(-1, 2); vals = np.stack([U.ravel(), V.ravel()], -1)
    uv = griddata(pts, vals, (xs + .5, ys + .5), method='linear')
    bad = np.isnan(uv[:, 0])
    if bad.any(): uv[bad] = griddata(pts, vals, (xs[bad] + .5, ys[bad] + .5), method='nearest')
    return np.clip(uv, 0, 1)

def hash2(i, j):
    return (np.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1.0

def led_cells(uv, nu, nv):
    """(cell index u, v, gap*variation gain) for texture coordinates uv on a screen of nu x nv LED cells; mean-preserving"""
    cu, cv_ = uv[:, 0] * nu, uv[:, 1] * nv
    fu, fv = cu % 1.0, cv_ % 1.0
    eu, ev = np.abs(2 * fu - 1) ** 4, np.abs(2 * fv - 1) ** 4
    gap = (1 - LED_GAP * eu) * (1 - LED_GAP * ev) / (1 - LED_GAP / 5) ** 2
    iu, iv = np.floor(cu), np.floor(cv_)
    var = 1 + LED_VAR * (hash2(iu, iv) - 0.5)
    var *= 1 + LED_MODULE_VAR * (hash2(iu // LED_MODULE + 37, iv // LED_MODULE + 11) - 0.5) * 2
    return iu, iv, (gap * var).astype(np.float32)

def screen_masks(por, panels):
    """face masks of the big screens: PANELS entries where they exist, else the colour rule cut by the (dilated) quad"""
    hsv = cv2.cvtColor((por * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    Hd, S, V = hsv[..., 0] * 2, hsv[..., 1] / 255, hsv[..., 2] / 255
    by_name = {p['name']: p['mask'] for p in panels}
    out = {}
    for name, sc in SCREENS.items():
        Q = poly_mask(sc['quad'])
        if sc['mask'] in by_name:
            m = by_name[sc['mask']]
        else:
            m = (Hd >= sc['hue'][0]) & (Hd <= sc['hue'][1]) & (S >= sc['smin']) & (V >= sc['vmin'])
            if sc.get('tiles'):                                             # the night-market tiles sit on the cell screen
                m |= ((Hd >= 40) & (Hd <= 70) & (V > 0.6)) | ((Hd >= 215) & (Hd <= 250) & (S > 0.5) & (V > 0.4))
            m = (m & (cv2.dilate(Q, disk(6)) > 0)).astype(np.uint8)
            m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
            m = fill_holes(largest(m)[0])
            if sc['mask'] == 'quad': m = Q & cv2.dilate(m, disk(3))         # straight-edged box faces: the quad itself
        out[name] = m.astype(np.uint8)
    return out

def add_led(img, masks, exclude, touched):
    """re-light the big screens as LED walls (display-space frame in, same out)"""
    lin = s2l(img)
    soft = cv2.GaussianBlur(lin, (0, 0), 0.5 * LED_PITCH)            # per-cell colour: the grain and the old grid averaged out
    cont = cv2.GaussianBlur(lin, (0, 0), 1.0)                        # continuous part: the old 3 px grid filtered out (no moire)
    for name, sc in SCREENS.items():
        F = masks[name]
        if F.sum() < 100: continue
        C = np.array(sc['quad'], float)
        wpx = 0.5 * (np.linalg.norm(C[1] - C[0]) + np.linalg.norm(C[2] - C[3]))
        hpx = 0.5 * (np.linalg.norm(C[3] - C[0]) + np.linalg.norm(C[2] - C[1]))
        nu_, nv_ = int(np.clip(wpx / 6, 24, 240)), int(np.clip(hpx / 6, 12, 160))
        P, U, V = coons(F, sc['quad'], nu_, nv_)
        ys, xs = np.nonzero(F & (exclude == 0))
        uv = inverse_uv(P, U, V, xs, ys)
        nu, nv = max(8, int(round(wpx / LED_PITCH))), max(8, int(round(hpx / LED_PITCH)))
        iu, iv = led_cells(uv, nu, nv)[:2]
        # cell centres back in the frame: average the patch points of each cell
        gain = led_cells(uv, nu, nv)[2]
        key = (iu * (nv + 1) + iv).astype(np.int64)
        uniq, inv = np.unique(key, return_inverse=True)
        cnt = np.bincount(inv).astype(np.float32)
        cx = np.bincount(inv, xs) / cnt; cy = np.bincount(inv, ys) / cnt
        cc = soft[np.clip(cy.astype(int), 0, H - 1), np.clip(cx.astype(int), 0, W - 1)]
        col = (cc[inv] * LED_FLAT + cont[ys, xs] * (1 - LED_FLAT)) * gain[:, None]
        a = cv2.GaussianBlur(F.astype(np.float32), (0, 0), 0.7)[ys, xs][:, None]
        lin[ys, xs] = lin[ys, xs] * (1 - a) + col * a
        touched[ys, xs] = np.maximum(touched[ys, xs], a[:, 0])
        print('led: %s %d px, %dx%d cells' % (name, len(xs), nu, nv))
    img[:] = l2s(lin)

# ----------------------------------------------------------------------------------------------- the new billboard
def film_pixels(lin, look):
    """per-pixel part of film.py (characteristic curve, colour, grade, scan contrast) -> display sRGB"""
    shoulder = np.array([1.55, 1.40, 1.25], np.float32)
    y = lin / (1.0 + lin / shoulder) * 1.06
    toe = np.array([0.0022, 0.0034, 0.0038], np.float32)
    y = y * (1 - toe) + toe * (1 - np.exp(-y / 0.02)); y = np.clip(y, 0, None)
    Ly = luma(y)[..., None]; C = y - Ly
    sat = np.linalg.norm(C, axis=-1, keepdims=True) / (Ly + 0.02)
    y = Ly + C * (0.93 - 0.14 * smoothstep(0.6, 2.2, sat))
    h = smoothstep(0.08, 0.7, Ly)
    y = y * (1 + h * np.array([0.045, 0.012, -0.05], np.float32)) * (1 + (1 - h) * np.array([-0.02, 0.005, 0.03], np.float32))
    if look == 'cinematic':
        Ly = luma(y)[..., None]; h = smoothstep(0.02, 0.6, Ly)
        satk = 0.62 + 0.22 * smoothstep(0.25, 1.0, Ly)
        y = Ly + (y - Ly) * satk
        y = y * (1 + (1 - h) * np.array([-0.16, 0.05, -0.02], np.float32)) * (1 + h * np.array([0.07, 0.015, -0.10], np.float32))
    g = np.clip(l2s(y), 0, 1)
    if look == 'cinematic':
        lift = np.array([0.022, 0.031, 0.028], np.float32)
        g = lift + g * (1 - lift) * 0.97
        g = g + 0.10 * (g - 0.5) * (1 - np.abs(2 * g - 1))
    else:
        g = g + 0.06 * (g - 0.5) * (1 - np.abs(2 * g - 1))
    return np.clip(g, 0, 1)

def board_quad():
    b = BOARD; TL = np.array(b['TL'], float); hd = np.array(b['hdir'], float); vd = np.array(b['vdir'], float)
    hd /= np.linalg.norm(hd); vd /= np.linalg.norm(vd)
    TR = TL + hd * b['width']; BL = TL + vd * b['height']; BR = TR + vd * b['height']
    return TL, TR, BR, BL

def render_board(tex_path, look):
    """the SORA TAXI billboard as (face mask, sRGB colour where the mask is set, linear emission, alpha)"""
    b = BOARD
    TL, TR, BR, BL = board_quad()
    nu, nv = 160, 100
    u = np.linspace(0, 1, nu); v = np.linspace(0, 1, nv); U, V = np.meshgrid(u, v)
    P = ((1 - U) * (1 - V))[..., None] * TL + (U * (1 - V))[..., None] * TR + (U * V)[..., None] * BR + ((1 - U) * V)[..., None] * BL
    P[..., 1] += b['bow'] * 4 * U * (1 - U)                                     # the wall's rows bow slightly
    poly = np.r_[P[0], P[:, -1], P[-1][::-1], P[:, 0][::-1]].astype(np.int32)
    F = np.zeros((H, W), np.uint8); cv2.fillPoly(F, [poly], 1)
    ys, xs = np.nonzero(F)
    uv = griddata(P.reshape(-1, 2), np.stack([U.ravel(), V.ravel()], -1), (xs + .5, ys + .5), method='linear')
    bad = np.isnan(uv[:, 0])
    if bad.any(): uv[bad] = griddata(P.reshape(-1, 2), np.stack([U.ravel(), V.ravel()], -1), (xs[bad] + .5, ys[bad] + .5), method='nearest')
    uv = np.clip(uv, 0, 1)
    tex = Image.open(tex_path).convert('RGBA')
    wpx, hpx = b['width'], b['height']
    sc = min(1.0, 1.6 * max(wpx / tex.width, hpx / tex.height))
    if sc < 1: tex = tex.resize((max(8, int(tex.width * sc)), max(8, int(tex.height * sc))), Image.LANCZOS)
    T = np.asarray(tex, np.float32) / 255
    mx = (uv[:, 0] * (T.shape[1] - 1)).astype(np.float32); my = (uv[:, 1] * (T.shape[0] - 1)).astype(np.float32)
    n = len(xs); cols = 4096; rows = (n + cols - 1) // cols
    gx = np.zeros(rows * cols, np.float32); gy = np.zeros(rows * cols, np.float32); gx[:n] = mx; gy[:n] = my
    rgba = cv2.remap(T, gx.reshape(rows, cols), gy.reshape(rows, cols), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE).reshape(-1, 4)[:n]
    col = s2l(rgba[:, :3])
    # LED material of b2_signs.py: pixel grid at the pitch of the flat screens, per-cell gain variation
    nu, nv = max(8, int(round(wpx / LED_PITCH))), max(8, int(round(hpx / LED_PITCH)))
    iu, iv, gain = led_cells(uv, nu, nv)
    key = (iu * (nv + 1) + iv).astype(np.int64); uniq, inv = np.unique(key, return_inverse=True)      # one colour per LED
    cnt = np.bincount(inv).astype(np.float32)
    col = (np.stack([np.bincount(inv, col[:, k]) for k in range(3)], -1) / cnt[:, None])[inv] * gain[:, None]
    dist = cv2.distanceTransform(F, cv2.DIST_L2, 3)[ys, xs]
    fw = b['frame']
    frame = np.clip(1 - (dist - fw) / 1.2, 0, 1)
    inner = np.clip(dist / (fw * 4), 0, 1)
    col = col * (0.82 + 0.18 * inner)[:, None]
    col = col * (1 - frame)[:, None] + np.array([0.012, 0.012, 0.014], np.float32) * frame[:, None]
    emis = (1 - frame) * rgba[:, 3]
    # lens stage: natural + mechanical vignetting at this position in the frame
    cxo, cyo = (W - 1) / 2, (H - 1) / 2; rc = np.hypot(cxo, cyo)
    rho = np.hypot((xs - cxo) / rc, (ys - cyo) / rc)
    vig = 2.0 ** (-(0.75 * rho ** 2 + 0.25 * np.clip((rho - 0.7) / 0.3, 0, 1) ** 2))
    lin = col * (b['exposure'] * vig)[:, None]
    E = np.zeros((H, W, 3), np.float32); E[ys, xs] = lin * emis[:, None]
    L = np.zeros((H, W, 3), np.float32); L[ys, xs] = lin
    return F, L, E, rgba[:, 3], (xs, ys)

def add_board(img, orig, look, tex_path, protect, touched, occluder=None):
    F, L, E, alpha, (xs, ys) = render_board(tex_path, look)
    nx, nz = wall_normal(0, BOARD['nx']); d = shift_vec(nx, nz, 1.0)
    # light transport approximation (composite.py scaled to this frame): spill, bloom, diffuse glow on the wall
    k = W / 2910.0
    bg = s2l(img)
    surface = 0.02 + 2.6 * np.sqrt(np.clip(luma(bg), 0, 1))[..., None]
    M = cv2.GaussianBlur(F.astype(np.float32), (0, 0), 1.5)[..., None]
    S = blur(E, 45 * k) * 0.55 + blur(E, 14 * k) * 0.6 + blur(E, 5 * k) * 0.5
    spill = 0.22 * S * surface * (1 - 0.9 * M) * 2.2
    glow = (blur(E, 12 * k) * 0.32 + blur(E, 40 * k) * 0.22 + blur(E, 120 * k) * 0.05) * (1 - 0.6 * M)
    bright = np.maximum(E - 0.3, 0)
    bloom = blur(bright, 3 * k) * 0.22 + blur(bright, 10 * k) * 0.18 + blur(bright, 32 * k) * 0.12
    # film halation of the hot cream type (linear, added around the face)
    kf = 1.0
    Ll = luma(E)
    hot = np.clip(E - 0.35, 0, None) * smoothstep(0.35, 1.2, Ll)[..., None]
    hal = blur(hot, 5 * kf) * 0.35 + blur(hot, 16 * kf) * np.array([1.0, 0.36, 0.12], np.float32) * 0.55
    light = (spill + glow + bloom + hal) * (protect == 0)[..., None]
    outside = (F == 0)
    bg = bg + light * outside[..., None]
    img[:] = l2s(bg)
    # the face itself goes through the film chain with its own halation
    face_lin = L + hal + blur(L, 9) * 0.012
    face = film_pixels(face_lin[ys, xs], look)
    a = (alpha * cv2.GaussianBlur(F.astype(np.float32), (0, 0), 0.7)[ys, xs])[:, None]
    img[ys, xs] = img[ys, xs] * (1 - a) + face * a
    touched[ys, xs] = np.maximum(touched[ys, xs], a[:, 0])
    sharpen = np.zeros((H, W), np.float32); sharpen[ys, xs] = a[:, 0]
    tint = np.percentile(face, 60, axis=0)
    add_body(img, orig, F, d, BOARD['scale'], 'wall', look, protect, touched, tint=tint, occluder=occluder)
    return F, sharpen

# ----------------------------------------------------------------------------------------------- finishing
def grain_field(seed, look):
    rng = np.random.default_rng(seed); k = W / 2400.0
    def octave(sig):
        n = rng.standard_normal((H, W)).astype(np.float32); n = blur(n, sig); return n / (n.std() + 1e-6)
    gl = 0.7 * octave(0.6 * k) + 0.3 * octave(1.2 * k) + 0.08 * octave(2.6 * k); gl /= gl.std()
    chroma = np.stack([octave(1.6 * k) for _ in range(3)], -1); chroma -= chroma.mean(-1, keepdims=True)
    return gl, chroma

def finish(img, touched, sharpen, look, seed):
    """scan sharpening (on the new screen only: on a dark return it would draw a bright rim) and film grain on the
    pixels that were drawn fresh; everything else already carries them"""
    k = 1.0
    lum_s = luma(img); usm = lum_s - blur(lum_s, 1.1 * k)
    img += (0.75 * usm * sharpen)[..., None]
    gl, chroma = grain_field(seed, look)
    ls = np.clip(luma(np.clip(img, 0, 1)), 0, 1)
    amp = (0.006 + 0.019 * np.exp(-((ls - 0.22) / 0.26) ** 2) + 0.006 * (1 - ls)) * (0.85 if look == 'cinematic' else 0.8)
    img += ((gl * amp)[..., None] + chroma * (amp * 0.2)[..., None]) * touched[..., None]
    return np.clip(img, 0, 1)

def process(img, look, panels, ball, bright, tex_path, seed, por_ref):
    img = img.copy(); orig = img.copy()
    protect = bright.copy()
    touched = np.zeros((H, W), np.float32)
    ball_m = cv2.dilate(ball, disk(2)) > 0
    # every sign face and every strongly lit element stays in front of the structure drawn behind other panels
    faces = np.maximum.reduce([p['mask'] for p in panels])
    in_front = ((bright > 0) & (img.max(-1) > 0.55)) | (faces > 0) | ball_m
    yy, xx = np.mgrid[0:H, 0:W]
    led_excl = ball_m.copy()
    for cx, cy, r in SMALL_BALLS: led_excl |= (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
    add_led(img, screen_masks(por_ref, panels), led_excl.astype(np.uint8), touched)   # LED walls first, structure over them
    for p in panels:
        occ = p.get('occluded_by')
        if occ is not None: keep_img, keep_t = img.copy(), touched.copy()
        add_body(img, orig, p['mask'], p['d'], p['scale'], p['kind'], look, protect, touched, poly=p.get('poly'), wall_n=p.get('wall_n'),
                 occluder=in_front & (p['mask'] == 0))
        if occ is not None:                                        # a blade in front hides the structure of the one behind
            m = occ > 0; img[m] = keep_img[m]; touched[m] = keep_t[m]
    img[ball_m] = orig[ball_m]; touched[ball_m] = 0            # the ball hovers in front of HOTEL LUNA
    Fb, sharpen = add_board(img, orig, look, tex_path, protect, touched, occluder=in_front)
    img = finish(img, touched, sharpen, look, seed)
    return img, touched, Fb

def dither_variant(por_new, dit_old, touched):
    """dither.py's palettes and 8x8 Bayer threshold, re-quantised from the edited Portra frame inside the edited area"""
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts'))
    import dither as dz
    cell = 3
    clean = cv2.GaussianBlur(por_new, (0, 0), 0.9)                                   # take the grain back out
    w, h = W // cell, H // cell
    small = np.asarray(Image.fromarray((clean * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS), np.float32) / 255
    L = luma(small)
    t = np.clip((np.maximum(L - 0.025, 0) / 0.62) ** 0.85, 0, 1)
    sm = cv2.GaussianBlur(small, (0, 0), 6)
    bl = sm[..., 2] - np.maximum(sm[..., 0], sm[..., 1])
    blue = (bl > 0.012) & (sm.mean(-1) < 0.09) & (L < 0.12)
    thr = np.tile(dz.bayer(8), (h // 8 + 1, w // 8 + 1))[:h, :w]
    out = np.where(blue[..., None], dz.ramp_dither(np.clip(t * 0.9, 0, 1), dz.BLUE, thr), dz.ramp_dither(t, dz.GOLD, thr))
    out = np.asarray(Image.fromarray(out.astype(np.uint8)).resize((w * cell, h * cell), Image.NEAREST), np.float32) / 255
    m = cv2.dilate((touched > 0.02).astype(np.uint8), disk(9)).astype(np.float32)
    m = cv2.resize(cv2.resize(m, (w, h), interpolation=cv2.INTER_AREA), (w * cell, h * cell), interpolation=cv2.INTER_NEAREST) > 0.2
    res = dit_old.copy(); res[m] = out[m]
    return res

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--cinematic', required=True); ap.add_argument('--portra', required=True); ap.add_argument('--dither', required=True)
    ap.add_argument('--tex', required=True); ap.add_argument('--out', required=True); ap.add_argument('--debug', default=None)
    ap.add_argument('--preview-width', type=int, default=1200); ap.add_argument('--seed', type=int, default=400)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    load = lambda p: np.asarray(Image.open(p).convert('RGB'), np.float32) / 255
    cin, por, dit = load(a.cinematic), load(a.portra), load(a.dither)
    assert cin.shape[:2] == (H, W) and por.shape[:2] == (H, W) and dit.shape[:2] == (H, W)
    panels, ball, bright = segment(por)
    print('panels:', ', '.join('%s s=%d n=(%.2f,%.2f)' % (p['name'], p['scale'], *p['d']) for p in panels))
    por_new, touched, Fb = process(por, 'portra', panels, ball, bright, a.tex, a.seed, por)
    cin_new, _, _ = process(cin, 'cinematic', panels, ball, bright, a.tex, a.seed, por)
    dit_new = dither_variant(por_new, dit, touched)
    save = lambda arr, p, **kw: Image.fromarray((np.clip(arr, 0, 1) * 255 + .5).astype(np.uint8)).save(p, **kw)
    save(cin_new, os.path.join(a.out, 'building_2_render.jpg'), quality=95, subsampling=0)
    save(por_new, os.path.join(a.out, 'building_2_render_portra.jpg'), quality=95, subsampling=0)
    save(dit_new, os.path.join(a.out, 'building_2_render_dither.png'))
    pw = a.preview_width
    Image.fromarray((np.clip(cin_new, 0, 1) * 255 + .5).astype(np.uint8)).resize((pw, pw * 3 // 2), Image.LANCZOS).save(
        os.path.join(a.out, 'building_2_render_preview.jpg'), quality=92)
    if a.debug:
        os.makedirs(a.debug, exist_ok=True)
        ov = (por * 255).astype(np.uint8).copy()
        for i, p in enumerate(panels):
            cnts, _ = cv2.findContours(p['mask'], cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(ov, cnts, -1, (255, 0, 0), 3)
        cnts, _ = cv2.findContours(Fb, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE); cv2.drawContours(ov, cnts, -1, (0, 255, 255), 3)
        cv2.circle(ov, (BALL[0], BALL[1]), BALL[2], (255, 255, 255), 2)
        Image.fromarray(ov).resize((1200, 1800), Image.LANCZOS).save(os.path.join(a.debug, 'outlines.png'))
        Image.fromarray((touched * 255).astype(np.uint8)).resize((1200, 1800)).save(os.path.join(a.debug, 'touched.png'))
        for name, box in {'board': (0, 2950, 760, 3520), 'luna': (380, 1700, 900, 2220), 'purin': (330, 880, 1000, 1460),
                          'blades': (280, 2100, 860, 3080), 'right': (1580, 560, 2400, 1240), 'kusuri': (150, 420, 1100, 1120)}.items():
            x0, y0, x1, y1 = box
            pair = np.concatenate([cin[y0:y1, x0:x1], cin_new[y0:y1, x0:x1]], 1)
            save(pair, os.path.join(a.debug, f'{name}_before_after.png'))
            save(por_new[y0:y1, x0:x1], os.path.join(a.debug, f'{name}_portra.png'))
            save(dit_new[y0:y1, x0:x1], os.path.join(a.debug, f'{name}_dither.png'))
    print('post: wrote', a.out)

if __name__ == '__main__':
    main()
