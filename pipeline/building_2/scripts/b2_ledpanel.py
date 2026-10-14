"""Halftone LED look for flat (or curved) ad panels - the same LED style as the NEWS 360 balls.

Every LED is a round dot on a near-black substrate. The dot colour is the average of the panel content over
the LED's cell, and the dot AREA carries the brightness (dark = tiny dot, bright = dot nearly filling the cell),
so each cell keeps its mean radiance (the light the panel throws into the scene is unchanged). Dots are round
on the PANEL, so they appear as ellipses wherever the panel is foreshortened, and they are anti-aliased
analytically from the local screen-space Jacobian of the LED grid. A faint diffuser bleed sits around bright
dots; per-LED and per-module brightness scatter breaks the regularity. Where the LED pitch on screen drops
below ~2.4 px the dots fade to the plain content (no moire).

API
    led_grid(uv, wpx_edge, hpx_edge, n)            -> (cu, cv) continuous LED-cell coordinates
    halftone(canvas, xs, ys, cu, cv, seed)         -> rewrites canvas[ys, xs] (linear light) in place
"""
import numpy as np, cv2
from scipy.ndimage import distance_transform_edt

PITCH = 4.4            # LED pitch in 2x-canvas px along an unforeshortened direction (balls: ~4.6 px)
A_MAX = 0.80           # largest dot area (fraction of the cell) used for mean-preserving tones
A_TOP = 0.86           # cells brighter than A_MAX grow up to this (whites stay round dots, just touching)
SHARP = 1.0            # unsharp amount on the content before it is averaged into LEDs
MIN_SCREEN = 3.6       # smallest on-screen LED pitch (10th percentile, along either axis); coarser LEDs if needed
BLEED = 0.08           # diffuser glow around dots, on the substrate
SUBSTRATE = np.array([0.0022, 0.0022, 0.0032], np.float32)
LED_VAR, MOD_VAR, MODULE = 0.05, 0.025, 16
FADE = (2.2, 2.8)      # on-screen pitch (px) range over which the dots fade in

_LUT = None
def _lut():
    """area of a circle of radius R (cell units) clipped to the unit cell centred on it"""
    global _LUT
    if _LUT is None:
        g = (np.arange(500) + 0.5) / 500 - 0.5
        X, Y = np.meshgrid(g, g); D = np.sort(np.hypot(X, Y).ravel())
        R = np.linspace(0, 0.7072, 2001)
        _LUT = (R, np.searchsorted(D, R) / D.size)
    return _LUT

def radius_for_area(A):
    R, Al = _lut()
    return np.interp(A, Al, R)

def physical_len(s, n):
    """length of a screen vector s (2x px) lying in a plane with camera-space normal n (orthographic camera)"""
    nz = n[2] if abs(n[2]) > 0.25 else np.copysign(0.25, n[2] if n[2] != 0 else -1.0)
    pz = -(n[0] * s[0] + n[1] * s[1]) / nz
    return float(np.sqrt(s[0] ** 2 + s[1] ** 2 + pz ** 2))

def _fill_grad(xs, ys, F):
    """d/dx, d/dy of a per-pixel field given only on the face pixels (outside filled by nearest value)"""
    x0, y0 = xs.min(), ys.min(); w, h = xs.max() - x0 + 1, ys.max() - y0 + 1
    I = np.full((h, w), np.nan, np.float32); I[ys - y0, xs - x0] = F
    m = np.isnan(I)
    if m.any():
        idx = distance_transform_edt(m, return_distances=False, return_indices=True); I = I[idx[0], idx[1]]
    gy, gx = np.gradient(I)
    return gx[ys - y0, xs - x0], gy[ys - y0, xs - x0]

def led_grid(uv, C, n, xs, ys, pitch=PITCH, min_screen=None):
    """LED cell coordinates from the face's (u,v) map, its 4 corners C (TL,TR,BR,BL) and plane normal n.
    The cell count along each axis follows the PHYSICAL edge length, so LEDs are square on the panel; on panels
    seen at a steep angle the (still square) LEDs are made coarser until they are >= MIN_SCREEN px on screen."""
    C = np.asarray(C, float)
    eu = 0.5 * ((C[1] - C[0]) + (C[2] - C[3])); ev = 0.5 * ((C[3] - C[0]) + (C[2] - C[1]))
    NU = physical_len(eu, n) / pitch; NV = physical_len(ev, n) / pitch
    ux, uy = _fill_grad(xs, ys, uv[:, 0]); vx, vy = _fill_grad(xs, ys, uv[:, 1])
    pu = np.percentile(1 / (np.hypot(ux, uy) * NU + 1e-9), 50); pv = np.percentile(1 / (np.hypot(vx, vy) * NV + 1e-9), 50)
    k = min(1.3, max(1.0, (MIN_SCREEN if min_screen is None else min_screen) / min(pu, pv)))   # steep rest fades (FADE)
    NU, NV = max(4, int(round(NU / k))), max(4, int(round(NV / k)))
    return uv[:, 0] * NU, uv[:, 1] * NV, (NU, NV)

def _hash(i, j, seed):
    return (np.sin(i * 12.9898 + j * 78.233 + seed * 37.719) * 43758.5453) % 1.0

def halftone(canvas, xs, ys, cu, cv, seed=0):
    xs = np.asarray(xs); ys = np.asarray(ys)
    if len(xs) == 0: return
    Cpx = canvas[ys, xs].astype(np.float32)
    ci = np.floor(cu).astype(np.int64); cj = np.floor(cv).astype(np.int64)
    # contrast-preserved copy for the cell means: strokes thinner than one LED keep ~2x their contrast (zero-mean)
    x0_, y0_ = xs.min(), ys.min(); w_, h_ = xs.max() - x0_ + 1, ys.max() - y0_ + 1
    I_ = np.zeros((h_, w_, 3), np.float32); I_[ys - y0_, xs - x0_] = Cpx
    m_ = np.zeros((h_, w_), np.float32); m_[ys - y0_, xs - x0_] = 1
    sg_ = max(0.8, 0.5 * PITCH)
    bl_ = cv2.GaussianBlur(I_, (0, 0), sg_) / np.maximum(cv2.GaussianBlur(m_, (0, 0), sg_), 1e-3)[..., None]
    Cs = np.maximum(0, Cpx + SHARP * (Cpx - bl_[ys - y0_, xs - x0_]))
    span = int(ci.max() - ci.min() + 1)
    key = (cj - cj.min()) * span + (ci - ci.min())
    uk, inv = np.unique(key, return_inverse=True)
    cnt = np.bincount(inv).astype(np.float32)
    mean = np.stack([np.bincount(inv, Cs[:, k]) / cnt for k in range(3)], -1).astype(np.float32)
    # ---- per LED: dot area A and drive D so that D*A = cell mean (bleed compensated)
    cmax = mean.max(1)
    A = np.where(cmax <= A_MAX, np.sqrt(A_MAX * np.maximum(cmax, 0)), np.clip(cmax, A_MAX, A_TOP)).astype(np.float32)
    A = np.maximum(A, 1e-4)
    ki = uk % span; kj = uk // span
    var = 1 + LED_VAR * (2 * _hash(ki, kj, seed) - 1) + MOD_VAR * (2 * _hash(ki // MODULE, kj // MODULE, seed + 11) - 1)
    D = mean / A[:, None] / (1 + BLEED * (1 - A))[:, None] * var[:, None].astype(np.float32)
    R = radius_for_area(A).astype(np.float32)
    # ---- per pixel: distance to its LED centre in cell units, and the Jacobian of the grid on screen
    x0, y0 = xs.min(), ys.min(); w, h = xs.max() - x0 + 1, ys.max() - y0 + 1
    U = np.full((h, w), np.nan, np.float32); V = np.full((h, w), np.nan, np.float32)
    U[ys - y0, xs - x0] = cu; V[ys - y0, xs - x0] = cv
    nanm = np.isnan(U)
    if nanm.any():
        idx = distance_transform_edt(nanm, return_distances=False, return_indices=True)
        U = U[idx[0], idx[1]]; V = V[idx[0], idx[1]]
    Uy, Ux = np.gradient(U); Vy, Vx = np.gradient(V)
    pp = (ys - y0, xs - x0)
    ux, uy, vx, vy = Ux[pp], Uy[pp], Vx[pp], Vy[pp]
    fu = cu - ci - 0.5; fv = cv - cj - 0.5
    d = np.hypot(fu, fv) + 1e-6
    gx = (fu * ux + fv * vx) / d; gy = (fu * uy + fv * vy) / d
    det = np.abs(ux * vy - uy * vx) + 1e-9
    gd = np.maximum(np.hypot(gx, gy), 0.35 * np.sqrt(det))           # cell units per px along the radius
    Rp = R[inv]
    cov = np.clip(0.5 + (Rp - d) / gd, 0, 1).astype(np.float32)
    # exact per-LED energy: the dot drawn over this cell's visible pixels must carry A x (its pixel count); this
    # also covers LEDs clipped by the bezel or by an overlapping panel and sub-pixel dots in dark areas
    actual = np.bincount(inv, cov).astype(np.float32)
    corr = np.clip(A * cnt / np.maximum(actual, 1e-3), 0.5, 2.5)
    D = D * corr[:, None]
    dots = D[inv] * cov[:, None]
    # ---- diffuser bleed around bright dots
    pitch_px = 1 / np.sqrt(det)
    img = np.zeros((h, w, 3), np.float32); img[pp] = dots
    sig = float(np.clip(0.45 * np.median(pitch_px), 0.8, 4))
    bleed = cv2.GaussianBlur(img, (0, 0), sig)[pp]
    out = SUBSTRATE[None] * (1 - cov)[:, None] + dots + BLEED * bleed * (1 - cov)[:, None]
    # ---- fade to the plain content where the LEDs get too small on screen
    pm = np.minimum(1 / (np.hypot(ux, uy) + 1e-9), 1 / (np.hypot(vx, vy) + 1e-9))
    t = np.clip((pm - FADE[0]) / (FADE[1] - FADE[0]), 0, 1); fh = (t * t * (3 - 2 * t)).astype(np.float32)[:, None]
    canvas[ys, xs] = Cpx * (1 - fh) + out * fh
    return dict(cells=len(uk), pitch_med=float(np.median(pitch_px)), mean_in=Cpx.mean(0), mean_out=canvas[ys, xs].mean(0))
