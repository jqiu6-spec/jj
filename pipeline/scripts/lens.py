#!/usr/bin/env python3
"""Camera-geometry + lens stage: Nikon F3 + Nikkor 20mm f/2.8 AI-S, wide open, at night.

usage: python3 -I scripts/lens.py IN.png OUT.png [--tilt DEG] [--width 2400] [--k1 VALUE]
                                  [--params out/lens_params.json] [options]

1. Geometry (true three-point perspective, pure camera rotation):
   H = Kin * R(t) * inv(Kin), R rotates about axis = dv x z (perpendicular to the optical
   axis and the world vertical dv), so the optical axis tilts further UP toward the vertical
   vanishing point.  Lines stay straight, all three VPs stay mutually consistent, verticals
   converge harder.  Only existing pixels are used: tilt + 2:3 window are searched so the
   window lies inside the rotated source quad, keeps the train/viaduct band and >= a share
   of the signage energy, maximising the angle between the left- and right-edge verticals.
2. 35mm portrait frame 2:3 (default 2400x3600), one Lanczos-4 resample (cv2.remap) that
   folds homography + distortion + lateral CA together.
3. Lens character: Brown barrel distortion (normalised so the corners stay filled), lateral
   CA (R/B magnification), radially increasing corner softness, cos^4 + mechanical
   vignetting and faint veiling glare (photometric parts in linear light).
4. Every parameter is written to --params JSON.
"""
import argparse
import json
import os
import sys
import time

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PAGE_W, PAGE_H = 1455.0, 2056.0          # CSS-px page that camera.json is expressed in

# train / viaduct band in 2x-source pixels (2910x4112): upper edge of the light strips and
# bottom of the deck girder, sampled left -> right.  Scaled to the actual input size.
BAND_TOP_2X = [(0, 1380), (1400, 2080), (2700, 2720)]
BAND_BOT_2X = [(0, 1700), (1400, 2600), (2700, 3050)]


# ----------------------------------------------------------------------------- helpers
def rot(axis, ang):
    a = np.asarray(axis, float)
    a = a / np.linalg.norm(a)
    c, s = np.cos(ang), np.sin(ang)
    A = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) * c + s * A + (1 - c) * np.outer(a, a)


def ph(H, P):
    P = np.atleast_2d(np.asarray(P, float))
    q = np.c_[P, np.ones(len(P))] @ H.T
    return q[:, :2] / q[:, 2:]


def srgb_to_lin(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4).astype(np.float32)


def lin_to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055).astype(np.float32)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def densify(P, n=48):
    P = np.asarray(P, float)
    out = [P[i] * (1 - u) + P[i + 1] * u for i in range(len(P) - 1)
           for u in np.linspace(0, 1, n, endpoint=False)]
    out.append(P[-1])
    return np.array(out)


def conv_stats(vp, cx, cy, w, h):
    """Vertical-VP stats for an axis-aligned frame (centre cx,cy, size w x h) in one plane."""
    d = float(np.hypot(vp[0] - cx, vp[1] - cy))
    L = np.array([cx - w / 2 - vp[0], cy - vp[1]])
    R = np.array([cx + w / 2 - vp[0], cy - vp[1]])
    ang = float(np.degrees(np.arccos(np.clip(L @ R / np.linalg.norm(L) / np.linalg.norm(R), -1, 1))))
    # lean of the edge verticals from the frame's own vertical axis (+ = leaning in)
    lean_l = float(np.degrees(np.arctan2(vp[0] - (cx - w / 2), cy - vp[1])))
    lean_r = float(np.degrees(np.arctan2((cx + w / 2) - vp[0], cy - vp[1])))
    BL = np.array([cx - w / 2 - vp[0], cy + h / 2 - vp[1]])
    BR = np.array([cx + w / 2 - vp[0], cy + h / 2 - vp[1]])
    ang_b = float(np.degrees(np.arccos(np.clip(BL @ BR / np.linalg.norm(BL) / np.linalg.norm(BR), -1, 1))))
    centre_vert = float(np.degrees(np.arctan2(vp[0] - cx, cy - vp[1])))
    return dict(vp=[float(vp[0]), float(vp[1])], vp_dist_px=d, vp_dist_over_height=d / h,
                edge_vertical_angle_deg=ang, bottom_corner_vertical_angle_deg=ang_b,
                lean_left_deg=lean_l, lean_right_deg=lean_r, centre_vertical_tilt_deg=centre_vert)


# ----------------------------------------------------------------------------- search
class Scene:
    def __init__(self, cam, Win, Hin, energy, sx, margin, band_margin):
        K = np.array(cam['K'], float)
        self.K = K.copy()
        self.K[:2] *= sx
        self.Ki = np.linalg.inv(self.K)
        dv = np.array(cam['dv'], float)
        self.dv = dv / np.linalg.norm(dv)
        if self.dv[2] < 0:
            self.dv = -self.dv
        self.axis = np.cross(self.dv, [0, 0, 1.0])
        self.vv = np.array(cam['vv'], float) * sx
        self.W, self.H = Win, Hin
        self.margin = margin
        self.band_margin = band_margin * sx / 2
        self.band_top = densify(np.array(BAND_TOP_2X, float) * sx / 2)
        self.band_bot = densify(np.array(BAND_BOT_2X, float) * sx / 2)
        ys, xs, w, f = energy
        self.pts = np.c_[(xs + .5) * f, (ys + .5) * f]
        self.wts = w
        self.wsum = w.sum()

    def H_of(self, t_deg):
        R = rot(self.axis, np.radians(t_deg))
        return R, self.K @ R @ self.Ki

    def windows(self, t_deg, CX, CY):
        """For centres CX,CY (H-space): max half-width s, feasibility, objective terms."""
        R, Hm = self.H_of(t_deg)
        m = self.margin
        src = np.array([(m, m), (self.W - m, m), (self.W - m, self.H - m), (m, self.H - m)], float)
        Q = ph(Hm, src)
        area = 0.5 * np.sum(Q[:, 0] * np.roll(Q[:, 1], -1) - np.roll(Q[:, 0], -1) * Q[:, 1])
        smax = np.full(CX.shape, np.inf)
        for i in range(4):
            p, q = Q[i], Q[(i + 1) % 4]
            e = q - p
            n = np.array([-e[1], e[0]]) if area > 0 else np.array([e[1], -e[0]])
            n /= np.linalg.norm(n)
            smax = np.minimum(smax, (n[0] * CX + n[1] * CY - n @ p) / (abs(n[0]) + 1.5 * abs(n[1])))
        ok = smax > 0.2 * self.W / 2
        s = np.where(ok, smax, 1.0)
        # train / viaduct band must cross the frame with a margin above and below
        for P in (ph(Hm, self.band_top), ph(Hm, self.band_bot)):
            inx = np.abs(P[None, None, :, 0] - CX[..., None]) <= s[..., None]
            bad = inx & (np.abs(P[None, None, :, 1] - CY[..., None]) > 1.5 * s[..., None] - self.band_margin)
            ok &= ~bad.any(-1)
        # share of signage energy inside the window (integral image in H-space)
        q = ph(Hm, self.pts)
        bs = 8.0 * self.W / 2910
        x0, y0 = Q.min(0) - 50
        x1, y1 = Q.max(0) + 50
        nx, ny = int((x1 - x0) / bs) + 2, int((y1 - y0) / bs) + 2
        hist = np.zeros((ny + 1, nx + 1))
        ix = np.clip(((q[:, 0] - x0) / bs).astype(int), 0, nx - 1)
        iy = np.clip(((q[:, 1] - y0) / bs).astype(int), 0, ny - 1)
        np.add.at(hist, (iy + 1, ix + 1), self.wts)
        I = hist.cumsum(0).cumsum(1)
        b = lambda v, o, n: np.clip(np.round((v - o) / bs).astype(int), 0, n)
        xa, xb = b(CX - s, x0, nx), b(CX + s, x0, nx)
        ya, yb = b(CY - 1.5 * s, y0, ny), b(CY + 1.5 * s, y0, ny)
        frac = (I[yb, xb] - I[ya, xb] - I[yb, xa] + I[ya, xa]) / self.wsum
        vp = ph(Hm, [self.vv])[0]
        Lx, Rx, dy = CX - s - vp[0], CX + s - vp[0], CY - vp[1]
        ang = np.degrees(np.arccos(np.clip((Lx * Rx + dy * dy) /
                                           np.hypot(Lx, dy) / np.hypot(Rx, dy), -1, 1)))
        return dict(s=s, ok=ok, frac=frac, ang=ang, vp=vp, Q=Q, H=Hm, R=R)

    def best_for_tilt(self, t, min_sign):
        _, Hm = self.H_of(t)
        Q = ph(Hm, [(0, 0), (self.W, 0), (self.W, self.H), (0, self.H)])
        (x0, y0), (x1, y1) = Q.min(0), Q.max(0)
        CX, CY = np.meshgrid(np.linspace(x0, x1, 150), np.linspace(y0, y1, 220))
        best = None
        for it in range(3):
            r = self.windows(t, CX, CY)
            ok = r['ok'] & (r['frac'] >= min_sign)
            if not ok.any():
                return None
            # objective: edge-vertical convergence; tiny tie-break toward the bigger window
            obj = np.where(ok, r['ang'] + 1e-4 * r['s'], -1)
            i, j = np.unravel_index(np.argmax(obj), obj.shape)
            best = dict(t=float(t), cx=float(CX[i, j]), cy=float(CY[i, j]), s=float(r['s'][i, j]),
                        frac=float(r['frac'][i, j]), ang=float(r['ang'][i, j]), vp=r['vp'], H=r['H'], R=r['R'])
            dx = (CX[0, 1] - CX[0, 0]) * 2.5
            dy = (CY[1, 0] - CY[0, 0]) * 2.5
            CX, CY = np.meshgrid(np.linspace(best['cx'] - dx, best['cx'] + dx, 41),
                                 np.linspace(best['cy'] - dy, best['cy'] + dy, 41))
        return best


def signage_energy(img_f, base_path, f):
    """Low-res map of where the signage is (render minus photo, linear light)."""
    h, w = img_f.shape[:2]
    small = cv2.resize(img_f, (w // f, h // f), interpolation=cv2.INTER_AREA)
    A = srgb_to_lin(small)
    E = None
    if base_path and os.path.exists(base_path):
        B = np.asarray(Image.open(base_path).convert('RGB'), np.float32) / 255
        B = cv2.resize(B, (w // f, h // f), interpolation=cv2.INTER_AREA)
        E = np.clip((A - srgb_to_lin(B)).sum(-1), 0, None)
    if E is None or E.sum() <= 0:
        E = np.clip(A.sum(-1) - 0.05, 0, None)        # fallback: bright stuff = signs
    ys, xs = np.nonzero(E > 0.002)
    return ys, xs, E[ys, xs].astype(np.float64), f


# ----------------------------------------------------------------------------- lens
def undistort_radius(rd, k1, k2, iters=8):
    """Solve ru*(1 + k1 ru^2 + k2 ru^4) = rd (Newton)."""
    ru = rd.copy()
    for _ in range(iters):
        r2 = ru * ru
        f = ru * (1 + k1 * r2 + k2 * r2 * r2) - rd
        fp = 1 + 3 * k1 * r2 + 5 * k2 * r2 * r2
        ru -= f / fp
    return ru


def gauss(img, sigma):
    if sigma <= 0.05:
        return img
    return cv2.GaussianBlur(img, (0, 0), sigmaX=sigma, sigmaY=sigma, borderType=cv2.BORDER_REFLECT)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('inp')
    ap.add_argument('out')
    ap.add_argument('--tilt', type=float, default=None, help='extra upward tilt in degrees (default: searched 0..25)')
    ap.add_argument('--width', type=int, default=2400, help='output width; height = 1.5x (35mm portrait 2:3)')
    ap.add_argument('--k1', type=float, default=-0.016, help='Brown k1 (corner-normalised radius); <0 = barrel')
    ap.add_argument('--k2', type=float, default=0.002, help='Brown k2 (corner-normalised radius)')
    ap.add_argument('--params', default=os.path.join(ROOT, 'out', 'lens_params.json'))
    ap.add_argument('--camera', default=os.path.join(ROOT, 'scene', 'camera.json'))
    ap.add_argument('--base', default=os.path.join(ROOT, 'scene', 'base.png'),
                    help='plain photo, used only to locate the signage for the window search')
    ap.add_argument('--min-signage', type=float, default=0.92, help='share of signage energy the frame must keep')
    ap.add_argument('--band-margin', type=float, default=120, help='px (2x-source scale) above/below the train band')
    ap.add_argument('--tilt-max', type=float, default=25.0)
    ap.add_argument('--vignette-natural', type=float, default=0.75, help='stops lost at the extreme corner by cos^4-like falloff')
    ap.add_argument('--vignette-mech', type=float, default=0.25, help='extra stops of mechanical/optical (cat-eye) vignetting at the corner')
    ap.add_argument('--ca', type=float, default=0.0006, help='lateral CA: R minus B magnification (0.0006 = 0.06%%)')
    ap.add_argument('--soft', type=float, default=0.9, help='corner blur sigma in px at 2400 px width')
    ap.add_argument('--glare', type=float, default=0.008, help='veiling glare: share of wide-scattered light')
    ap.add_argument('--flare-floor', type=float, default=0.006, help='veiling glare: uniform share of mean image light')
    ap.add_argument('--no-lens', action='store_true', help='geometry only (no distortion / CA / blur / vignette / glare)')
    a = ap.parse_args()
    t0 = time.time()

    cam = json.load(open(a.camera))
    img = np.asarray(Image.open(a.inp).convert('RGB'), np.float32) / 255
    Hin, Win = img.shape[:2]
    sx = Win / PAGE_W
    sc_lin = Win / 2910.0                          # 2x-source-relative scale for px constants

    # ---------------------------------------------------------------- 1. tilt + window search
    energy = signage_energy(img, a.base, max(2, int(round(8 * sc_lin))))
    sc = Scene(cam, Win, Hin, energy, sx, margin=max(6.0, 6 * sc_lin), band_margin=a.band_margin)
    tilts = [a.tilt] if a.tilt is not None else list(np.arange(0, a.tilt_max + 1e-6, 0.5))
    table, best = [], None
    for t in tilts:
        b = sc.best_for_tilt(t, a.min_signage)
        if b is None:
            table.append(dict(tilt=float(t), feasible=False))
            continue
        table.append(dict(tilt=float(t), feasible=True, angle=b['ang'], signage=b['frac'], win_w=2 * b['s']))
        if best is None or b['ang'] > best['ang'] + 1e-6:
            best = b
    if a.tilt is None and best is not None:              # refine tilt around the coarse optimum
        for t in np.arange(max(0, best['t'] - 0.45), min(a.tilt_max, best['t'] + 0.45) + 1e-6, 0.05):
            b = sc.best_for_tilt(t, a.min_signage)
            if b is not None and b['ang'] > best['ang'] + 1e-6:
                best = b
    if best is None:
        sys.exit('no valid window for the requested tilt / constraints')
    t_best, R, Hm = best['t'], best['R'], best['H']
    cx, cy, s = best['cx'], best['cy'], best['s']
    ww, wh = 2 * s, 3 * s

    Wo = int(a.width)
    Ho = int(round(Wo * 1.5))
    scale = Wo / ww                                       # output px per H-space px
    T = np.array([[scale, 0, -(cx - s) * scale], [0, scale, -(cy - 1.5 * s) * scale], [0, 0, 1]])
    G = T @ Hm                                            # input px -> output px (pinhole part)
    Gi = np.linalg.inv(G)

    # ---------------------------------------------------------------- 2./3. one resample
    xs = np.arange(Wo, dtype=np.float32) + 0.5 - Wo / 2
    ys = np.arange(Ho, dtype=np.float32) + 0.5 - Ho / 2
    X, Y = np.meshgrid(xs, ys)
    Rc = float(np.hypot(Wo / 2, Ho / 2))
    rho = np.hypot(X, Y) / Rc                             # 0 centre .. 1 extreme corner
    k1, k2 = (0.0, 0.0) if a.no_lens else (a.k1, a.k2)
    dR, dB = (0.0, 0.0) if a.no_lens else (a.ca / 2, -a.ca / 2)
    mags = [1 + dR, 1.0, 1 + dB]
    n_ca = min(mags)                                      # the widest-sampling channel hits the corner exactly
    norm_d = 1 + k1 + k2
    maps = []
    for m in mags:
        rd = rho * (n_ca / m)                             # this channel's radius in G-equivalent units
        ru = undistort_radius(rd * norm_d, k1, k2)
        f = np.where(rho > 1e-6, ru / np.maximum(rho, 1e-6), n_ca / m * norm_d).astype(np.float32)
        u = X * f + Wo / 2                                # undistorted output-plane coords (px)
        v = Y * f + Ho / 2
        den = Gi[2, 0] * u + Gi[2, 1] * v + Gi[2, 2]
        mx = (Gi[0, 0] * u + Gi[0, 1] * v + Gi[0, 2]) / den - 0.5
        my = (Gi[1, 0] * u + Gi[1, 1] * v + Gi[1, 2]) / den - 0.5
        maps.append((mx.astype(np.float32), my.astype(np.float32)))
    valid = dict(x_min=float(min(m[0].min() for m in maps)), x_max=float(max(m[0].max() for m in maps)),
                 y_min=float(min(m[1].min() for m in maps)), y_max=float(max(m[1].max() for m in maps)))
    valid['all_inside'] = bool(valid['x_min'] >= 0 and valid['y_min'] >= 0 and
                               valid['x_max'] <= Win - 1 and valid['y_max'] <= Hin - 1)
    if not valid['all_inside']:
        print('WARNING: some output pixels sample outside the source', valid, file=sys.stderr)

    # local scale (output px per input px) over the frame, pinhole part
    gx, gy = np.meshgrid(np.linspace(0, Wo, 13), np.linspace(0, Ho, 19))
    P = np.c_[gx.ravel(), gy.ravel()]
    p0, px_, py_ = ph(Gi, P), ph(Gi, P + [1, 0]), ph(Gi, P + [0, 1])
    sv = np.linalg.svd(np.stack([px_ - p0, py_ - p0], -1), compute_uv=False)   # input px per output px
    up_local_max = float(1 / sv[:, 1].min())
    up_local_min = float(1 / sv[:, 0].max())
    up_mean = float(np.mean(1 / np.sqrt(sv[:, 0] * sv[:, 1])))
    if up_mean < 0.85:                                     # strong minification: pre-filter against aliasing
        img = gauss(img, 0.5 * np.sqrt(1 / up_mean ** 2 - 1))

    out = np.empty((Ho, Wo, 3), np.float32)
    for c in range(3):
        out[..., c] = cv2.remap(np.ascontiguousarray(img[..., c]), maps[c][0], maps[c][1],
                                interpolation=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)
    del maps
    lin = srgb_to_lin(out)
    del out

    pscale = Wo / 2400.0
    if not a.no_lens:
        # corner softness: blur sigma grows with radius (field curvature / coma wide open)
        sig = a.soft * pscale * smoothstep(0.30, 1.0, rho) ** 1.6
        levels = [0.0, 0.25, 0.5, 0.75, 1.0]
        acc = np.zeros_like(lin)
        sn = sig / max(a.soft * pscale, 1e-6)
        for i, lv in enumerate(levels):
            w = np.clip(1 - np.abs(sn - lv) / 0.25, 0, 1)
            if not w.any():
                continue
            acc += gauss(lin, lv * a.soft * pscale) * w[..., None]
        lin = acc
        del acc
        # vignetting: cos^4-like natural fall-off + a little mechanical (cat-eye) at the corners
        tan_c = np.tan(np.arccos((2 ** -a.vignette_natural) ** 0.25))
        V_nat = np.cos(np.arctan(rho * tan_c)) ** 4
        mech_corner = 2 ** -a.vignette_mech
        V_mech = 1 - (1 - mech_corner) * smoothstep(0.72, 1.0, rho) ** 1.5
        V = (V_nat * V_mech).astype(np.float32)
        # veiling glare from the un-vignetted image light, itself lightly vignetted
        diag = np.hypot(Wo, Ho)
        small = cv2.resize(lin, (Wo // 8, Ho // 8), interpolation=cv2.INTER_AREA)
        veil = gauss(small, 0.07 * diag / 8) * 0.6 + gauss(small, 0.2 * diag / 8) * 0.4
        veil = cv2.resize(veil, (Wo, Ho), interpolation=cv2.INTER_LINEAR)
        floor = lin.reshape(-1, 3).mean(0)
        lin = lin * V[..., None] + (a.glare * veil + a.flare_floor * floor) * np.sqrt(V)[..., None]
    else:
        V = np.ones((Ho, Wo), np.float32)

    g = lin_to_srgb(lin)
    del lin
    rng = np.random.default_rng(3)
    g8 = np.clip(g * 255 + rng.uniform(-0.5, 0.5, g.shape).astype(np.float32) + 0.5, 0, 255).astype(np.uint8)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)) or '.', exist_ok=True)
    Image.fromarray(g8).save(a.out)

    # ---------------------------------------------------------------- 4. report
    before_full = conv_stats(sc.vv, Win / 2, Hin / 2, Win, Hin)
    b0 = sc.best_for_tilt(0.0, a.min_signage)
    before_crop = None
    if b0 is not None:
        sc0 = Wo / (2 * b0['s'])
        st = conv_stats(b0['vp'], b0['cx'], b0['cy'], 2 * b0['s'], 3 * b0['s'])
        st['vp_dist_px'] *= sc0
        st['vp'] = [float(v) for v in (np.array(st['vp']) - [b0['cx'] - b0['s'], b0['cy'] - 1.5 * b0['s']]) * sc0]
        before_crop = st
    vp_out = ph(G, [sc.vv])[0]
    after = conv_stats(vp_out, Wo / 2, Ho / 2, Wo, Ho)
    pp_out = ph(G, [sc.K[:2, 2]])[0]
    f_out = sc.K[0, 0] * scale
    win_src = ph(np.linalg.inv(Hm), [(cx - s, cy - 1.5 * s), (cx + s, cy - 1.5 * s),
                                      (cx + s, cy + 1.5 * s), (cx - s, cy + 1.5 * s)])
    rr = lambda r: float(-(1 - (1 + k1 * r * r + k2 * r ** 4) / (1 + k1 + k2) * 1.0) * 100) if False else \
        float(((1 + k1 * r * r + k2 * r ** 4) - 1) * 100)
    edge_rho_lr = (Wo / 2) / Rc
    edge_rho_tb = (Ho / 2) / Rc
    V_corner = float(V[0, 0]) if not a.no_lens else 1.0
    params = dict(
        input=dict(path=os.path.abspath(a.inp), size=[Win, Hin], K=sc.K.tolist(), vv=sc.vv.tolist(),
                   dv=sc.dv.tolist(), page_scale=sx),
        tilt=dict(deg=t_best, axis_cam=(sc.axis / np.linalg.norm(sc.axis)).tolist(), R=R.tolist(),
                  angle_optical_axis_to_vertical_before_deg=float(np.degrees(np.arccos(sc.dv[2]))),
                  angle_optical_axis_to_vertical_after_deg=float(np.degrees(np.arccos((R @ sc.dv)[2]))),
                  searched=(a.tilt is None), table=table),
        homography_in_to_rotated=Hm.tolist(),
        crop_window=dict(centre=[cx, cy], width=ww, height=wh, space='rotated image plane, input px scale',
                         source_footprint_TL_TR_BR_BL=win_src.tolist(), signage_share=best['frac']),
        output=dict(size=[Wo, Ho], format='35mm portrait 2:3', resample='cv2.remap INTER_LANCZOS4 (single pass)',
                    homography_in_to_out_pinhole=(G / G[2, 2]).tolist(),
                    principal_point_out=pp_out.tolist(), focal_px_out=float(f_out),
                    equiv_focal_mm_24x36=float(f_out * 24.0 / Wo),
                    upscale_factor=float(scale), upscale_local_min=up_local_min, upscale_local_max=up_local_max,
                    upscale_local_mean=up_mean, all_samples_valid=valid),
        distortion=dict(model='Brown radial, radius normalised to half-diagonal, corner-normalised so corners stay filled',
                        k1=k1, k2=k2, corner_pct=rr(1.0), edge_mid_lr_pct=rr(edge_rho_lr), edge_mid_tb_pct=rr(edge_rho_tb),
                        centre_scale_vs_pinhole=float(1 / norm_d)),
        chromatic_aberration=dict(lateral_R_mag=dR, lateral_B_mag=dB, R_minus_B_pct=(dR - dB) * 100,
                                  corner_shift_px_R_vs_B=float((dR - dB) * Rc)),
        corner_softness=dict(sigma_corner_px=a.soft * pscale if not a.no_lens else 0,
                             profile='sigma = s_c * smoothstep(0.30,1,rho)^1.6, linear light'),
        vignetting=dict(natural_corner_stops=a.vignette_natural if not a.no_lens else 0,
                        mech_corner_stops=a.vignette_mech if not a.no_lens else 0,
                        total_corner_stops=float(-np.log2(max(V_corner, 1e-6))),
                        edge_mid_lr_stops=float(-np.log2(V[Ho // 2, 0])), edge_mid_tb_stops=float(-np.log2(V[0, Wo // 2])),
                        model='cos^4(atan(rho*tan_c)) * (1-m*smoothstep(0.72,1,rho)^1.5), linear light'),
        veiling_glare=dict(scatter_share=a.glare if not a.no_lens else 0, floor_share=a.flare_floor if not a.no_lens else 0,
                           kernel='0.6*G(0.07 diag)+0.4*G(0.2 diag)'),
        convergence=dict(before_input_frame=before_full, before_tilt0_best_2x3_crop=before_crop, after=after,
                         note='angles between the images of the vertical lines through the left/right frame-edge '
                              'midpoints (and bottom corners); VP distance from frame centre in px of that frame'),
        seconds=time.time() - t0,
    )
    os.makedirs(os.path.dirname(os.path.abspath(a.params)) or '.', exist_ok=True)
    json.dump(params, open(a.params, 'w'), indent=1)
    bf, af = before_full, after
    print(f'tilt {t_best:.2f} deg (axis-to-vertical {params["tilt"]["angle_optical_axis_to_vertical_before_deg"]:.1f}'
          f' -> {params["tilt"]["angle_optical_axis_to_vertical_after_deg"]:.1f} deg); window {ww:.0f}x{wh:.0f} '
          f'signage {best["frac"]:.3f}; out {Wo}x{Ho} scale {scale:.3f} (local {up_local_min:.3f}..{up_local_max:.3f})')
    print(f'VP dist/height  input {bf["vp_dist_px"]:.0f}px {bf["vp_dist_over_height"]:.3f}'
          + (f' | t=0 2:3 crop {before_crop["vp_dist_over_height"]:.3f} ({before_crop["edge_vertical_angle_deg"]:.2f} deg)' if before_crop else '')
          + f' | after {af["vp_dist_px"]:.0f}px {af["vp_dist_over_height"]:.3f}')
    print(f'edge-vertical angle  input {bf["edge_vertical_angle_deg"]:.2f} -> after {af["edge_vertical_angle_deg"]:.2f} deg'
          f'  (lean L/R {af["lean_left_deg"]:.1f}/{af["lean_right_deg"]:.1f}, centre vertical {af["centre_vertical_tilt_deg"]:+.2f})')
    print(f'distortion corner {params["distortion"]["corner_pct"]:.2f}%  vignette corner {params["vignetting"]["total_corner_stops"]:.2f} st'
          f'  CA R-B {(dR - dB) * 100:.3f}%  valid={valid["all_inside"]}  {time.time() - t0:.1f}s  -> {a.out}')


if __name__ == '__main__':
    main()
