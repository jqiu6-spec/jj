#!/usr/bin/env python3
"""Post pass on the finished building-2 frames (2400x3600): body for the flat light panels + the SORA TAXI billboard.

The flat lightboxes and LED screens (くすり, 環状七号線, ホテル MIDORI, PURIN, HOTEL LUNA, the three izakaya blades, the
METRO kiosk, the 夜光 BAR boxes) are given a real body: dark metal returns on the sides that face the camera (the top,
and the side that faces away from the far point of the ring), a lit bezel line where the face meets the return, and a
contact shadow on the wall around the mounting footprint. A new wall billboard in the HOTEL LUNA family (SORA TAXI,
flying taxi) is added on the lower-left wall with the same LED material, metal frame, returns and contact shadow, its
light spilled and bloomed onto the wall, then the lens falloff and the film treatment of the frame it sits in
(halation, shoulder/toe, grade, scan sharpening, grain).

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
# bbox, hue range (deg) or None, min sat, min val, parts, thickness px, frame dilation px, outline tolerance px
PANELS = {
    'kusuri':    dict(bbox=(215, 480, 345, 800), hue=None, smin=0.0, vmin=0.45, n=1, t=10, grow=4, eps=5),
    'ringline7': dict(bbox=(1085, 500, 1380, 630), hue=None, smin=0.0, vmin=0.45, n=1, t=10, grow=4, eps=5),
    'midori':    dict(bbox=(915, 640, 1030, 1055), hue=None, smin=0.0, vmin=0.40, n=1, t=10, grow=4, eps=5),
    'purin':     dict(bbox=(370, 900, 955, 1425), hue=(265, 335), smin=0.35, vmin=0.22, n=1, t=18, grow=4, eps=2.5,
                      hull=False, smooth=7),
    'luna':      dict(bbox=(425, 1790, 835, 2190), hue=(210, 258), smin=0.40, vmin=0.18, n=1, t=16, grow=4, eps=2.5,
                      hull=False, smooth=5, hidden_corner=(432, 1815)),
    'kiosk':     dict(bbox=(1610, 980, 1780, 1200), hue=(210, 258), smin=0.35, vmin=0.18, n=1, t=9, grow=3, eps=5),
    'bars':      dict(bbox=(2175, 600, 2400, 1000), hue=(265, 330), smin=0.22, vmin=0.30, n=2, t=9, grow=3, eps=5),
}
# the izakaya blades light the wall around them too strongly to be segmented by colour: their quads (TL, TR, BR, BL)
# are given by hand, back to front. Thin two-sided sheets whose free edge faces the camera: top + right returns.
BLADES = {
    'blade3': dict(quad=[(598, 2268), (770, 2348), (780, 3022), (608, 2942)], t=10, nx=-0.35),
    'blade2': dict(quad=[(482, 2244), (640, 2325), (660, 3020), (502, 2939)], t=10, nx=-0.35),
    'blade1': dict(quad=[(344, 2210), (528, 2314), (548, 2990), (350, 2962)], t=10, nx=-0.35),
}
BALL = (432, 1653, 262)                          # the hovering NEWS 360 ball: in front of HOTEL LUNA

# the new billboard: a 3:2 board on the lower-left (convex, near) wall, whose rows slope ~13 deg down to the right
BOARD = dict(TL=(88, 3090), width=400, height=230, hdir=(0.975, 0.222), vdir=(0.09, 0.996), bow=5.0,
             t=16, nx=-0.35, frame=5.0, exposure=1.3)

def segment(por):
    hsv = cv2.cvtColor((por * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    Hd, S, V = hsv[..., 0] * 2, hsv[..., 1] / 255, hsv[..., 2] / 255
    yy, xx = np.mgrid[0:H, 0:W]
    ball = ((xx - BALL[0]) ** 2 + (yy - BALL[1]) ** 2 <= BALL[2] ** 2).astype(np.uint8)
    out = []
    for name, p in PANELS.items():
        x0, y0, x1, y1 = p['bbox']
        m = (V >= p['vmin']) & (S >= p['smin'])
        if p['hue']: m &= (Hd >= p['hue'][0]) & (Hd <= p['hue'][1])
        reg = np.zeros((H, W), bool); reg[y0:y1, x0:x1] = True
        m = (m & reg).astype(np.uint8)
        if name == 'luna': m[cv2.dilate(ball, disk(4)) > 0] = 0
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
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
            out.append(dict(name=f'{name}{j if p["n"] > 1 else ""}', mask=part, t=p['t'], d=shift_vec(nx, nz, p['t'])))
    for name, p in BLADES.items():
        nx, nz = wall_normal(0, p['nx'])
        out.append(dict(name=name, mask=poly_mask(p['quad']), t=p['t'], d=shift_vec(nx, nz, p['t'])))
    bright = (((V > 0.30) & (S > 0.30)) | (V > 0.72)).astype(np.uint8)
    bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    return out, ball, bright

# ----------------------------------------------------------------------------------------------- the body of a panel
def body(F, d):
    """returns (R: pixels of the returns, s: 0 at the face edge -> 1 at the wall, top: 1 where the return is the top face)
    for a face mask F standing off the wall by image displacement d"""
    dx, dy = d; n = max(2, int(np.ceil(np.hypot(dx, dy) * 1.5)))
    ys, xs = np.nonzero(F); pad = int(abs(dx) + abs(dy) + 4)
    x0, y0 = max(0, xs.min() - pad), max(0, ys.min() - pad); x1, y1 = min(W, xs.max() + pad + 1), min(H, ys.max() + pad + 1)
    f = F[y0:y1, x0:x1]; h, w = f.shape
    R = np.zeros((h, w), np.uint8); s = np.zeros((h, w), np.float32); top = np.zeros((h, w), np.uint8)
    U = f.copy()
    for i in range(1, n + 1):
        k = i / n
        sh = cv2.warpAffine(f, np.float32([[1, 0, -dx * k], [0, 1, -dy * k]]), (w, h), flags=cv2.INTER_NEAREST)
        new = (sh > 0) & (U == 0)
        if new.any():
            s[new] = k; R[new] = 1
            vert = cv2.warpAffine(f, np.float32([[1, 0, 0], [0, 1, -dy * k]]), (w, h), flags=cv2.INTER_NEAREST)
            horz = cv2.warpAffine(f, np.float32([[1, 0, -dx * k], [0, 1, 0]]), (w, h), flags=cv2.INTER_NEAREST)
            top[new & (vert > 0) & (horz == 0)] = 1
        U |= sh
    Rf = np.zeros((H, W), np.uint8); Rf[y0:y1, x0:x1] = R
    sf = np.zeros((H, W), np.float32); sf[y0:y1, x0:x1] = s
    tf = np.zeros((H, W), np.uint8); tf[y0:y1, x0:x1] = top
    return Rf, sf, tf

def add_body(img, F, d, t, look, protect, touched, tint=None):
    """draw the returns + bezel of face F into img (sRGB float), then the contact shadow around the body on the wall"""
    R, s, top = body(F, d)
    face_col = tint if tint is not None else np.percentile(img[F > 0], 60, axis=0)
    rr = R > 0
    wall = img[rr]
    kc = 1.25 if look == 'cinematic' else 1.0
    top_col = np.array([0.110, 0.115, 0.130], np.float32) * kc        # top face: dark metal lit by the sky and the signs above
    side_col = np.array([0.055, 0.058, 0.066], np.float32) * kc       # side faces: in their own shadow
    lift = np.array([0.022, 0.031, 0.028], np.float32) if look == 'cinematic' else 0.0
    sv = s[rr][:, None]; tp = top[rr][:, None].astype(np.float32)
    # painted metal: a little of the wall it stands in front of, darker toward the wall, a faint leak of the face
    base = top_col * tp + side_col * (1 - tp)
    col = wall * (0.30 * tp + 0.25 * (1 - tp)) + (base * (1 - 0.25 * sv) + lift) + face_col * (0.05 * (1 - sv))
    bez = np.clip(1 - (sv * np.hypot(*d) - 0.6) / 1.0, 0, 1) * 0.45                 # ~1 px metal edge on the face side
    bezel_col = np.array([0.24, 0.25, 0.28], np.float32) * 0.5 + face_col * 0.2 + lift
    col = col * (1 - bez) + bezel_col * bez
    img[rr] = col
    touched[rr] = np.maximum(touched[rr], 1.0)
    # contact shadow: ambient occlusion on the wall around the footprint, not on other lights
    Bd = (F | R)
    D = cv2.distanceTransform((1 - Bd).astype(np.uint8), cv2.DIST_L2, 5)
    ao = 0.25 * np.exp(-(D / (0.8 * t)) ** 1.3) * (D > 0) * (protect == 0)
    img *= (1 - ao)[..., None]
    return Bd

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
    ledu, ledv = max(20, wpx / 3.0), max(8, hpx / 3.0)
    fu, fv = (uv[:, 0] * ledu) % 1, (uv[:, 1] * ledv) % 1
    cell = np.clip(1 - (np.abs(fu - .5) * 2) ** 6 * 0.4, 0, 1) * np.clip(1 - (np.abs(fv - .5) * 2) ** 6 * 0.4, 0, 1)
    var = 0.93 + 0.14 * ((np.sin(np.floor(uv[:, 0] * ledu) * 12.9898 + np.floor(uv[:, 1] * ledv) * 78.233) * 43758.5453) % 1.0)
    col = col * (cell * var)[:, None] * 1.05
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

def add_board(img, look, tex_path, protect, touched):
    F, L, E, alpha, (xs, ys) = render_board(tex_path, look)
    nx, nz = wall_normal(0, BOARD['nx']); d = shift_vec(nx, nz, BOARD['t'])
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
    add_body(img, F, d, BOARD['t'], look, protect, touched, tint=tint)
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

def process(img, look, panels, ball, bright, tex_path, seed):
    img = img.copy(); orig = img.copy()
    protect = bright.copy()
    touched = np.zeros((H, W), np.float32)
    ball_m = cv2.dilate(ball, disk(2)) > 0
    for p in panels:
        add_body(img, p['mask'], p['d'], p['t'], look, protect, touched)
    img[ball_m] = orig[ball_m]; touched[ball_m] = 0            # the ball hovers in front of HOTEL LUNA
    Fb, sharpen = add_board(img, look, tex_path, protect, touched)
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
    print('panels:', ', '.join('%s t=%d d=(%.1f,%.1f)' % (p['name'], p['t'], *p['d']) for p in panels))
    por_new, touched, Fb = process(por, 'portra', panels, ball, bright, a.tex, a.seed)
    cin_new, _, _ = process(cin, 'cinematic', panels, ball, bright, a.tex, a.seed)
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
