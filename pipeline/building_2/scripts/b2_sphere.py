"""Spherical LED screen renderer (photoreal ball display seen by the tilted telephoto camera).

    render_sphere(canvas, cx, cy, r, tex, th, rot_deg=0.0, tilt_deg=0.0, exposure=1.0, env=None, collar=True,
                  shadow=None) -> dict

canvas   float32 HxWx3 LINEAR light, modified in place. Pixel (row j, col i) has its centre at (x, y) = (i, j).
cx,cy,r  ball centre / radius in canvas px.
tex      equirect RGBA (float32 in [0,1] or uint8), sRGB-encoded colours. Column u = (lon+180)/360*W, row
         v = (90-lat)/180*H (row 0 = north pole), lon = 0 is the centre column. Transparent texels = LEDs off.
         May also be the dict returned by prepare_texture(tex) (reuses the mip pyramid).
th       camera pitch (rad, looking down). Camera space: x right, y down, z forward.
rot_deg  spin about the ball's vertical axis: texture longitude rot_deg faces the viewer (lon = atan2(X,-Z) + rot).
tilt_deg tips the ball's polar axis about the world right axis (positive: north pole toward the viewer).
exposure scales the LED emission (emission = sRGB->linear(tex) * alpha * exposure).
env      optional linear RGB image (same size as canvas, normally the canvas before the ball is drawn) used for the
         glossy cover reflection; None -> dim blue night-sky/ground gradient.

Returns dict(xs, ys, normals (N,3 camera space, unit), emission (N,3 linear LED emission incl. exposure but without
the viewing-angle falloff / cover reflection, i.e. what the ball radiates into the scene), alpha (N,) silhouette
coverage, color (N,3) final shaded ball colour) for every pixel the ball touches.

Model: front hemisphere nz = -sqrt(1-nx^2-ny^2); world X=n.ex, Y=n.up, Z=n.h with up=(0,-cos th,-sin th),
h=(0,-sin th,cos th). Analytic screen->texture Jacobian -> anisotropic mip sampling (up to MAX_ANISO taps along the
footprint's major axis; pixels at the pole pinch, where that is not enough, are 8x8 screen-supersampled), LED cell grid
in lat/lon texture space, per-cell/module brightness variation, LED viewing-angle falloff + colour shift, Schlick
Fresnel cover reflecting env (screen-space folded around the limb), one soft specular glint, 4x4 supersampled
silhouette, dark metal collar + contact shadow.

LED_STYLE = 'halftone' (default): every LED cell is a round dot on a near-black substrate.  Cell colour = exact box
average C of the texture over the cell; the dot shines in that colour at (at most) HT_PEAK = 1.0 in the canvas (the
clip level of the 8-bit full_2x.png) and its AREA carries the brightness (area ~ max(C) / HT_PEAK, plus a faint
diffuser bleed glow HT_BLEED on the substrate), so the cell mean equals C before and after the clip: dark -> tiny
dot / off, bright -> big dot nearly filling its cell (bright dots may grow just past touching, clipped to their cell,
up to HT_COVER coverage).  Dots are circles on the sphere surface: their screen shape comes from the local
screen->cell Jacobian (ellipses toward the limb); coverage is the exact overlap of the dot (local screen radius) with
a unit-area disc pixel filter (analytic AA), or for sub-pixel dots an energy-exact box filter (no moire from dots
falling between pixel centres); the own cell and its 3 nearest neighbours contribute.  Where the dot pitch falls
below HT_FADE px the dots fade to the plain filtered texture (no moire); below HT_DETAIL[1] px each dot's size and
colour follow the per-pixel texture inside its cell (threshold halftone, legible text on the small balls).
'emission' stays the cell-average (undotted) radiance.  halftone_cells(r, th, tilt_deg) gives the recommended
LED_CELLS.  LED_STYLE = 'grid': the previous look (flat cells + shallow dark gap), unchanged.
"""
import math, sys
import numpy as np, cv2

# ---------------------------------------------------------------- tunables (module level, override if needed)
LED_STYLE = 'halftone'          # 'halftone': round LED dots on a black substrate, dot size = brightness
                                # 'grid': the old look (flat cells with a shallow dark gap)
LED_CELLS = (256, 128)          # LED pixels around (lon) x pole-to-pole (lat); see halftone_cells(r)
LED_GAP = 0.13                  # ('grid') dark-gap depth per axis (product <= ~0.25 contrast)
# ---- halftone LED surface ('halftone' style)
HT_PEAK = 1.0                   # max dot radiance in the canvas (linear, max channel; / exposure in texture units).
                                # 1.0 = the canvas clip level (b2_signs saves an 8-bit PNG): every dot shines at
                                # <= HT_PEAK and its AREA carries the brightness (area ~ cell mean / HT_PEAK), so the
                                # mean survives the clip.  >1 = smaller, hotter dots (punchier halftone), but the part
                                # above 1.0 is clipped away in the pipeline (HT_PEAK 4 loses ~30% of the big ball's red).
HT_COVER = 0.80                 # largest dot coverage of its cell (0.80 ~ circles just touching, clipped to their
                                # cell; dark corner holes stay).  Only cells brighter than ~0.84 x HT_PEAK then need
                                # dots > HT_PEAK (white text: ~1.19, clipped -> up to ~15% darker); 0.94 keeps even
                                # white within ~3% but turns bright dots into rounded squares
HT_FILL = 0.86                  # dot diameter / narrower cell side asked for by the display value V alone (V = 1);
                                # the dot is never smaller than that (only matters for HT_PEAK > ~1.7)
HT_GAMMA = 1.2                  # V-based diameter = HT_FILL * ((V - HT_V0) / (1 - HT_V0)) ** HT_GAMMA
HT_V0 = 0.03                    # V (display value of the cell colour) below which the V-based dot is off
HT_VMIX = 0.5                   # V = mix(luma, max channel) of the sRGB cell colour (0 = luma .. 1 = max channel)
HT_SAT = 1.0                    # saturation of the dot colour around its luminance (1 = cell colour as is)
HT_BLEED = 0.10                 # diffuser bleed glow on the substrate around a dot (fraction of the dot radiance,
                                # reached for dots >= the HT_FILL size)
HT_BLEED_W = 0.15               # bleed decay length (fraction of the narrower cell side)
HT_FADE = (1.7, 2.7)            # screen pitch (px) range over which dots fade in (below: plain averaged colour)
HT_DETAIL = (1.0, 4.2, 3.6)     # dot size + colour = mix(cell's, from the per-pixel texture, d): d = [0] at pitch
                                # <= [2] px, 0 at pitch >= [1] px (one colour per dot); legible small-ball text
HT_AA_R = 0.5642                # pixel filter: disc of unit area (analytic disc-disc overlap coverage)
HT_BOX = (0.55, 1.1)            # dots whose minor screen semi-axis is below [0] px use an energy-exact box pixel
                                # filter (equal-area rectangle footprint), blending to the disc filter by [1] px
TH_SCENE = 0.72767              # camera pitch of the scene (rad), default for halftone_cells()
LED_VAR = 0.08                  # per-LED brightness scatter
LED_MODULE = 16                 # LEDs per module edge (module-to-module brightness scatter)
LED_MODULE_VAR = 0.035
QUANTIZE = True                 # large LED cells show one flat colour each (real LED look)
MAX_ANISO = 8
F0 = 0.04                       # protective cover (polycarbonate) reflectance at normal incidence
ENV_K = 0.55                    # screen-space reflection: background depth factor
ENV_MAXR = 4.0                  # farthest env lookup, in radii
ENV_SKY = np.array([0.010, 0.016, 0.038], np.float32)     # fallback env (linear) when env is None
ENV_GROUND = np.array([0.003, 0.0035, 0.006], np.float32)
GLINT_DIR = (-0.45, -0.78, -0.45)                         # camera space, surface -> light (upper left, toward camera)
GLINT_COLOR = np.array([1.0, 0.95, 0.88], np.float32)
GLINT_POWER = 7.0
COLLAR_COLOR = np.array([0.010, 0.010, 0.012], np.float32)
SHADOW = 0.45                   # contact shadow strength on the panel


def s2l(x):
    x = np.asarray(x, np.float32)
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4).astype(np.float32)


def l2s(x):
    x = np.clip(x, 0, None)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055).astype(np.float32)


def _smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def _hash(i, j):
    i = np.asarray(i, np.float64); j = np.asarray(j, np.float64)
    return ((np.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1.0).astype(np.float32)


# ---------------------------------------------------------------- halftone LED cell grid
def halftone_pitch(r):
    """recommended LED dot pitch (screen px at the front of the ball) for a ball of radius r (2x canvas px):
    ~3.0 px for r~51, ~3.1 px for r~68, ~4.75 px for r~292 (visible halftone, text still legible)."""
    return float(np.clip(3.1 + (r - 68.0) * 0.0074, 3.0, 6.0))


def halftone_cells(r, th=None, tilt_deg=0.0, pitch=None):
    """recommended LED_CELLS (around, pole-to-pole) for the halftone style: halftone_pitch(r) screen px between dots
    around the equator; the rows are made slightly denser (cells square half way between the equator, where the
    tickers run, and the latitude facing the camera, lat = th + tilt; th defaults to the scene camera TH_SCENE)."""
    p = halftone_pitch(r) if pitch is None else float(pitch)
    th = TH_SCENE if th is None else float(th)
    latf = math.radians(float(np.clip(math.degrees(th) + tilt_deg, -70.0, 70.0)))
    nu = max(16, int(round(2 * math.pi * r / p / 4)) * 4)
    nv = max(8, int(round(nu / 2 / math.cos(latf / 2) / 2)) * 2)
    return (nu, nv)


_HT_LUT = {}
_LUT_LK = np.linspace(math.log(0.02), math.log(4.0), 45)      # log cell aspect kx (lon / lat cell size)
_LUT_T = np.linspace(0.0, 1.0, 129)                           # dot radius / cell corner distance


def _ht_lut():
    """mean radiance of one LED cell (per unit dot radiance) and dot coverage, tabulated over the cell aspect kx and
    the dot radius T (fraction of the corner distance): the dot is a circle clipped to its own cell (exact area),
    the bleed glow (amplitude HT_BLEED * min(R / R_fill, 1), decay HT_BLEED_W * side) from the cell and its 8
    neighbours (same R) shows only on the uncovered substrate (numeric, 48x48 samples)."""
    key = (HT_FILL, HT_BLEED, HT_BLEED_W)
    if key in _HT_LUT: return _HT_LUT[key]
    n = 48
    gq = (np.arange(n) + 0.5) / n - 0.5
    A = np.zeros((len(_LUT_LK), len(_LUT_T))); COV = np.zeros_like(A)
    for i, lk in enumerate(_LUT_LK):
        kx = math.exp(lk); side = min(kx, 1.0); hx, hy = kx / 2, 0.5
        Rc = _LUT_T * math.hypot(hx, hy)
        def seg(h):
            q = np.clip(h / np.maximum(Rc, 1e-12), -1, 1)
            return np.where(Rc > h, Rc * Rc * np.arccos(q) - h * np.sqrt(np.maximum(Rc * Rc - h * h, 0)), 0.0)
        cov = np.clip((np.pi * Rc * Rc - 2 * seg(hx) - 2 * seg(hy)) / kx, 0, 1)     # circle ∩ cell (exact)
        X, Y = np.meshgrid(gq * kx, gq)
        rho0 = np.hypot(X, Y).ravel().astype(np.float32)
        rho = np.stack([np.hypot(X - dx * kx, Y - dy).ravel() for dx in (-1, 0, 1) for dy in (-1, 0, 1)])
        rho = rho.astype(np.float32) / np.float32(HT_BLEED_W * side)
        rw = (Rc / (HT_BLEED_W * side)).astype(np.float32)[:, None]
        B = HT_BLEED * np.clip(Rc / (0.5 * HT_FILL * side), 0, 1)
        sub = (rho0[None] >= Rc.astype(np.float32)[:, None])                         # uncovered substrate
        glow = np.zeros((len(Rc), n * n), np.float32)
        for k in range(9):
            glow += np.exp(np.minimum(rw - rho[k][None], 0))
        A[i] = cov + (sub * glow).mean(1) * B
        COV[i] = cov
    A = np.maximum.accumulate(A, axis=1)
    _HT_LUT[key] = (A, COV)
    return A, COV


def _cell_grid(pt, NCU, NCV, peak=None):
    """per-LED data for the halftone style, cached in the texture dict: cell-average colour C (exact box average of
    the texture over the cell), dot radius R (lat-cell units), mean per unit radiance A (dot + bleed, from the LUT)
    and dot radiance D = C / A, so the cell's mean radiance equals C.  The dot shines at HT_PEAK (max channel) and its area carries
    the brightness, unless the V-based HT_FILL size is bigger; dots grow up to HT_COVER of the cell.
    peak: max dot radiance in texture units (default HT_PEAK; render_sphere passes HT_PEAK / exposure)."""
    peak = HT_PEAK if peak is None else float(peak)
    key = ('ht', NCU, NCV, HT_FILL, HT_GAMMA, HT_V0, HT_VMIX, peak, HT_COVER, HT_SAT, HT_BLEED, HT_BLEED_W)
    cache = pt.setdefault('_ht', {})
    if key in cache: return cache[key]
    lin = pt['levels'][0][0][:, 2:-2]
    C = cv2.resize(lin, (NCU, NCV), interpolation=cv2.INTER_AREA).astype(np.float32).reshape(NCV, NCU, 3)
    S = l2s(np.clip(C, 0, 1))
    V = HT_VMIX * S.max(-1) + (1 - HT_VMIX) * (S @ np.array([0.2126, 0.7152, 0.0722], np.float32))
    lat = (0.5 - (np.arange(NCV) + 0.5) / NCV) * np.pi
    kx = np.maximum(2 * np.cos(lat) * NCV / NCU, 1e-4).astype(np.float32)   # lon / lat physical cell size per row
    side = np.minimum(kx, 1.0)                                               # narrower side (lat-cell units)
    w = (HT_BLEED_W * side).astype(np.float32)
    corner = np.hypot(kx / 2, 0.5)
    LA, LC = _ht_lut()
    li = np.clip((np.log(np.clip(kx, 0.02, 4.0)) - _LUT_LK[0]) / (_LUT_LK[1] - _LUT_LK[0]), 0, len(_LUT_LK) - 1 - 1e-9)
    l0 = np.floor(li).astype(int); lf = (li - l0)[:, None]
    Arow = LA[l0] * (1 - lf) + LA[l0 + 1] * lf                               # (NCV, nT) mean / unit radiance
    Crow = LC[l0] * (1 - lf) + LC[l0 + 1] * lf                               # (NCV, nT) dot coverage
    Cm = C.max(-1)
    agrid = np.linspace(0.0, 1.0, 257)
    R = np.zeros((NCV, NCU)); a = np.zeros((NCV, NCU)); thi = np.zeros(NCV); Tinv = np.zeros((NCV, len(agrid)))
    for j in range(NCV):
        thi[j] = np.interp(HT_COVER, Crow[j], _LUT_T)                        # largest dot
        Tinv[j] = np.interp(agrid, Arow[j], _LUT_T)                          # dot size for a mean (unit radiance)
        tv = _tv(V[j], side[j], corner[j])
        tp = np.interp(Cm[j] / peak, Arow[j], _LUT_T)                        # dot area that keeps D <= peak
        t = np.minimum(np.maximum(tv, tp), thi[j])
        R[j] = t * corner[j]
        a[j] = np.interp(t, _LUT_T, Arow[j])
    D = C / np.maximum(a, 1e-6)[..., None]
    if HT_SAT != 1.0:
        Y = (D @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
        D = np.maximum(Y + (D - Y) * HT_SAT, 0)
    g = dict(C=C, R=R.astype(np.float32), D=D.astype(np.float32), A=a.astype(np.float32), kx=kx, w=w,
             side=side.astype(np.float32), corner=corner.astype(np.float32), thi=thi.astype(np.float32),
             Arow=Arow.astype(np.float32), Tinv=Tinv.astype(np.float32), peak=peak)
    cache[key] = g
    return g


def _tv(V, side, corner):
    """V-based dot radius (fraction of the corner distance)"""
    return 0.5 * HT_FILL * np.clip((V - HT_V0) / (1 - HT_V0), 0, 1) ** HT_GAMMA * side / corner


def _rowlerp(tab, rows, x):
    """tab[rows, x] with linear interpolation along the (uniformly sampled) second axis, x in samples"""
    x = np.clip(np.asarray(x, np.float64), 0, tab.shape[1] - 1)
    i = np.minimum(np.floor(x).astype(np.int64), tab.shape[1] - 2); f = (x - i).astype(np.float32)
    return tab[rows, i] * (1 - f) + tab[rows, i + 1] * f


def _disc_cov(R, d, h=None):
    """fraction of a unit-area disc pixel filter (radius h) at distance d from the centre of a disc of radius R that
    the disc covers (exact disc-disc overlap; all in screen px)."""
    h = HT_AA_R if h is None else h
    R = np.maximum(R, 0.0); d = np.maximum(d, 0.0)
    out = np.where(d <= np.abs(R - h), np.minimum(R, h) ** 2 / (h * h), 0.0)
    part = np.nonzero((d > np.abs(R - h)) & (d < R + h))[0]
    if len(part):
        Rk, dk = R[part], np.maximum(d[part], 1e-9)
        a1 = Rk * Rk * np.arccos(np.clip((dk * dk + Rk * Rk - h * h) / (2 * dk * np.maximum(Rk, 1e-9)), -1, 1))
        a2 = h * h * np.arccos(np.clip((dk * dk + h * h - Rk * Rk) / (2 * dk * h), -1, 1))
        k = 0.5 * np.sqrt(np.clip((-dk + Rk + h) * (dk + Rk - h) * (dk - Rk + h) * (dk + Rk + h), 0, None))
        out[part] = (a1 + a2 - k) / (np.pi * h * h)
    return out


def _halftone(cu, cv, Ja, Jb, Jc, Jd, g, NCU, NCV, cont=None, detail=None):
    """halftone LED radiance (texture units) at screen samples with continuous cell coords (cu, cv) and screen
    Jacobian d(cu,cv)/d(x,y) = [[Ja, Jb], [Jc, Jd]] (cells per px).  Each dot is a circle on the sphere surface
    (cell-local physical coords s = (du*kx, dv) in lat-cell units); its screen shape follows from the local Jacobian
    (ellipses toward the limb).  The own cell and its 3 nearest neighbours contribute (dots near cell borders).
    Bright dots that grow past touching are clipped to their own cell (coverage = min(disc, cell rectangle), both
    anti-aliased in screen px); the bleed glow only shows on the uncovered substrate."""
    iu0, iv0 = np.floor(cu), np.floor(cv)
    fu, fv = cu - iu0 - 0.5, cv - iv0 - 0.5
    su, sv = np.where(fu >= 0, 1.0, -1.0), np.where(fv >= 0, 1.0, -1.0)
    gu = np.sqrt(Ja * Ja + Jb * Jb) + 1e-9; gv = np.sqrt(Jc * Jc + Jd * Jd) + 1e-9   # cells per px (u, v)
    dot = np.zeros((len(cu), 3), np.float32); glo = np.zeros((len(cu), 3), np.float32)
    U = np.zeros(len(cu), np.float32); cell = None
    if detail is not None:                      # threshold halftone of the per-pixel texture (sub-cell detail)
        a_px = np.clip(cont.max(1) / g['peak'], 0, 1) * (g['Tinv'].shape[1] - 1)
        sc = l2s(np.clip(cont, 0, 1))
        V_px = HT_VMIX * sc.max(1) + (1 - HT_VMIX) * (sc @ np.array([0.2126, 0.7152, 0.0722], np.float32))
        nT = g['Arow'].shape[1] - 1
    for k, l in ((0, 0), (1, 0), (0, 1), (1, 1)):
        iu, iv = iu0 + k * su, iv0 + l * sv
        ok = (iv >= 0) & (iv < NCV)
        ivc = np.clip(iv, 0, NCV - 1).astype(np.int64); iuc = np.mod(iu, NCU).astype(np.int64)
        kx = g['kx'][ivc]
        du, dv = fu - k * su, fv - l * sv                                   # offset from this cell's centre (cells)
        s0, s1 = du * kx, dv
        rho2 = s0 * s0 + s1 * s1
        tx, ty = kx * Ja * s0 + Jc * s1, kx * Jb * s0 + Jd * s1            # J_s^T s
        F2 = (kx * Ja) ** 2 + (kx * Jb) ** 2 + Jc * Jc + Jd * Jd
        gs = np.sqrt((tx * tx + ty * ty + 1e-6 * F2 / 2) / (rho2 + 1e-6))    # surface units per px along s
        R = g['R'][ivc, iuc]; rho = np.sqrt(rho2)
        Dk = g['D'][ivc, iuc]
        if detail is not None:                  # dot size + colour from the pixel's own texture value, sized on
            # this cell's row exactly like a cell of that brightness (mean kept, dot <= HT_PEAK): the dot edges
            # follow the glyph edges inside the cell (legible small text)
            cn = g['corner'][ivc]
            Tp = np.minimum(np.maximum(_rowlerp(g['Tinv'], ivc, a_px), _tv(V_px, g['side'][ivc], cn)), g['thi'][ivc])
            Ap = _rowlerp(g['Arow'], ivc, Tp * nT)
            R = R * (1 - detail) + Tp * cn * detail
            Dk = Dk * (1 - detail)[:, None] + cont / np.maximum(Ap, 1e-6)[:, None] * detail[:, None]
        cd = _disc_cov(R / gs, rho / gs)
        # small dots (minor screen semi-axis < ~1 px): the disc pixel filter does not tile the plane, so a sub-pixel
        # dot between pixel centres would lose energy (low-frequency moire on dark, small-dot areas).  Use an
        # energy-exact 1x1 box pixel filter there, with the dot's screen ellipse replaced by the equal-area
        # axis-aligned rectangle of its bounding-box proportions.
        det = kx * (Ja * Jd - Jb * Jc)
        det = np.where(np.abs(det) < 1e-12, 1e-12, det)
        i00, i01, i10, i11 = Jd / det, -kx * Jb / det, -Jc / det, kx * Ja / det          # J_s^-1 (px per unit)
        smax = np.sqrt(0.5 * (F2 + np.sqrt(np.maximum(F2 * F2 - 4 * det * det, 0))))     # largest sv of J_s
        beta = _smooth(HT_BOX[0], HT_BOX[1], R / smax)                                    # minor semi-axis, px
        mb = np.nonzero(beta < 1)[0]
        if len(mb):
            ex, ey = np.hypot(i00[mb], i01[mb]), np.hypot(i10[mb], i11[mb])
            kk = np.sqrt(np.pi / (4 * np.abs(det[mb]) * np.maximum(ex * ey, 1e-12))) * R[mb]
            wx, wy = ex * kk, ey * kk                                                    # rectangle half-sizes
            X = i00[mb] * s0[mb] + i01[mb] * s1[mb]; Y = i10[mb] * s0[mb] + i11[mb] * s1[mb]   # pixel - dot, px
            ox = np.clip(np.minimum(0.5, X + wx) - np.maximum(-0.5, X - wx), 0, 1)
            oy = np.clip(np.minimum(0.5, Y + wy) - np.maximum(-0.5, Y - wy), 0, 1)
            cd[mb] = cd[mb] * beta[mb] + ox * oy * (1 - beta[mb])
        cr = np.clip(0.5 + (0.5 - np.abs(du)) / gu, 0, 1) * np.clip(0.5 + (0.5 - np.abs(dv)) / gv, 0, 1)
        cov = (np.minimum(cd, cr) * ok).astype(np.float32)
        B = HT_BLEED * np.clip(R / (0.5 * HT_FILL * g['side'][ivc]), 0, 1)  # bleed scales with the dot size
        glow = B * np.exp(-np.maximum(rho - R, 0) / g['w'][ivc]) * ok
        var = 1 + LED_VAR * (_hash(iuc, ivc) - 0.5)
        var *= 1 + LED_MODULE_VAR * (_hash(iuc // LED_MODULE + 37, ivc // LED_MODULE + 11) - 0.5) * 2
        Dk = Dk * var[:, None]
        dot += Dk * cov[:, None]
        glo += Dk * glow[:, None].astype(np.float32)
        U += cov
        if cell is None: cell = g['C'][ivc, iuc]
    return dot + glo * np.clip(1 - U, 0, 1)[:, None], cell


# ---------------------------------------------------------------- texture pyramid + sampling
def prepare_texture(tex):
    """premultiplied linear-light mip pyramid of an equirect RGBA texture (wrap-padded in u)."""
    if isinstance(tex, dict) and tex.get('kind') == 'sphere_tex':
        return tex
    t = np.asarray(tex)
    t = t.astype(np.float32) / 255 if t.dtype == np.uint8 else t.astype(np.float32)
    if t.ndim == 2: t = np.repeat(t[..., None], 3, 2)
    if t.shape[2] == 3: t = np.concatenate([t, np.ones_like(t[..., :1])], 2)
    lin = np.ascontiguousarray(s2l(np.clip(t[..., :3], 0, 1)) * np.clip(t[..., 3:4], 0, 1))
    H0, W0 = lin.shape[:2]
    levels, cur = [], lin
    while True:
        h, w = cur.shape[:2]
        levels.append((np.ascontiguousarray(np.concatenate([cur[:, -2:], cur, cur[:, :2]], 1)), w, h))
        if min(w, h) <= 2: break
        cur = cv2.resize(cur, (max(1, w // 2), max(1, h // 2)), interpolation=cv2.INTER_AREA)
    return dict(kind='sphere_tex', levels=levels, W=W0, H=H0)


def _remap(img, X, Y):
    n = X.size
    if n == 0: return np.zeros((0, img.shape[2]), np.float32)
    cols = 4096; rows = (n + cols - 1) // cols
    mx = np.zeros(rows * cols, np.float32); my = np.zeros(rows * cols, np.float32)
    mx[:n] = X; my[:n] = Y
    out = cv2.remap(img, mx.reshape(rows, cols), my.reshape(rows, cols), cv2.INTER_LINEAR,
                    borderMode=cv2.BORDER_REPLICATE)
    return out.reshape(rows * cols, -1)[:n]


def _sample(pt, u, v, lod, au=None, av=None, ntap=None):
    """trilinear (+ anisotropic taps along (au,av), the footprint's major axis in level-0 texels) lookup.
    u, v: level-0 texel coords (texel i spans [i, i+1)); u wraps, v clamps."""
    n = len(u); out = np.zeros((n, 3), np.float32)
    if n == 0: return out
    lv = pt['levels']; nl = len(lv); W0, H0 = pt['W'], pt['H']
    lod = np.clip(lod, 0, nl - 1 - 1e-4)
    l0 = np.floor(lod).astype(np.int32); fr = (lod - l0).astype(np.float32)
    if ntap is None: ntap = np.ones(n, np.int32); au = np.zeros(n, np.float32); av = au
    for t in range(int(ntap.max())):
        sel = np.nonzero(ntap > t)[0]
        nt = ntap[sel].astype(np.float32)
        off = (t + 0.5) / nt - 0.5
        us = u[sel] + au[sel] * off; vs = v[sel] + av[sel] * off
        L0, FR = l0[sel], fr[sel]
        for k in range(int(L0.min()), int(L0.max()) + 2):
            wk = np.where(L0 == k, 1 - FR, 0) + np.where(L0 + 1 == k, FR, 0)
            m = np.nonzero(wk > 1e-6)[0]
            if len(m) == 0: continue
            pad, w, h = lv[min(k, nl - 1)]
            X = np.mod(us[m] * (w / W0), w) - 0.5 + 2
            Y = vs[m] * (h / H0) - 0.5
            out[sel[m]] += _remap(pad, X, Y) * (wk[m] / nt[m])[:, None]
    return out


# ---------------------------------------------------------------- geometry helpers
def _frame(th, rot_deg, tilt_deg):
    """M maps camera-space vectors to ball frame (x east-ish, y = pole, z); returns M, up_c."""
    up_c = np.array([0, -math.cos(th), -math.sin(th)])
    h = np.array([0, -math.sin(th), math.cos(th)])
    ex = np.array([1.0, 0, 0])
    B = np.stack([ex, up_c, h])                         # world = B @ cam
    t = math.radians(tilt_deg); c, s = math.cos(t), math.sin(t)
    R = np.array([[1, 0, 0], [0, c, s], [0, -s, c]])     # ball -> world (pole (0,1,0) -> (0,c,-s))
    return (R.T @ B).astype(np.float64), up_c, math.radians(rot_deg)


def _uv(M, rot, n, W0, H0):
    p = n @ M.T
    lon = np.arctan2(p[:, 0], -p[:, 2]) + rot
    lat = np.arcsin(np.clip(p[:, 1], -1, 1))
    u = np.mod(lon / (2 * np.pi) + 0.5, 1.0) * W0
    v = (0.5 - lat / np.pi) * H0
    return u, v, p


# ---------------------------------------------------------------- shading
def _footprint(nx, ny, r, M, rot, W0, H0):
    """texture coords + analytic screen->texel Jacobian / anisotropic footprint for a pixel footprint of 1/r (in n units)."""
    nz = -np.sqrt(np.clip(1 - nx * nx - ny * ny, 0, 1))
    n = np.stack([nx, ny, nz], 1).astype(np.float64)
    u, v, p = _uv(M, rot, n, W0, H0)
    nzc = np.minimum(nz, -2e-3)
    dndx = np.stack([np.ones_like(nx), np.zeros_like(nx), -nx / nzc], 1) / r
    dndy = np.stack([np.zeros_like(nx), np.ones_like(nx), -ny / nzc], 1) / r
    dpx, dpy = dndx @ M.T, dndy @ M.T
    q = np.maximum(p[:, 0] ** 2 + p[:, 2] ** 2, 1e-8); cl = np.sqrt(q)
    dlon_x = (-p[:, 2] * dpx[:, 0] + p[:, 0] * dpx[:, 2]) / q
    dlon_y = (-p[:, 2] * dpy[:, 0] + p[:, 0] * dpy[:, 2]) / q
    dlat_x, dlat_y = dpx[:, 1] / cl, dpy[:, 1] / cl
    a, b = dlon_x * W0 / (2 * np.pi), dlon_y * W0 / (2 * np.pi)       # du/dx, du/dy
    c, d = -dlat_x * H0 / np.pi, -dlat_y * H0 / np.pi                 # dv/dx, dv/dy
    P, Q, S = a * a + b * b, a * c + b * d, c * c + d * d
    T2 = (P + S) / 2; disc = np.sqrt(np.maximum(T2 * T2 - (P * S - Q * Q), 0))
    s1 = np.sqrt(T2 + disc); s2 = np.sqrt(np.maximum(T2 - disc, 0))
    e = np.where((P >= S)[:, None], np.stack([T2 + disc - S, Q], 1), np.stack([Q, T2 + disc - P], 1))
    en = np.linalg.norm(e, axis=1, keepdims=True)
    e = np.where(en > 1e-12, e / np.maximum(en, 1e-12), np.array([[1.0, 0.0]]))
    ntap = np.where(s1 > 1, np.clip(np.ceil(s1 / np.maximum(s2, 1)), 1, MAX_ANISO), 1).astype(np.int32)
    lod = np.log2(np.maximum(np.maximum(s1 / ntap, s2), 1.0))
    au, av = (e[:, 0] * s1).astype(np.float32), (e[:, 1] * s1).astype(np.float32)
    return n, nz, u, v, p, a, b, c, d, s1, s2, ntap, lod, au, av


def _pole_supersample(pt, nx, ny, r, M, rot, K=8):
    """Near a pole the u-footprint wraps (part of) the whole circle, far beyond MAX_ANISO taps, and the isotropic mip
    LOD would then smear far-away latitudes into the pixel (dark/odd dot at the pole). Integrate such pixels by KxK
    screen-space subsamples instead, each looked up with its own (1/K px) footprint and the LOD capped by its
    v-footprint (u aliasing per subsample averages out over the KxK ring of samples)."""
    W0, H0 = pt['W'], pt['H']
    o = ((np.arange(K) + 0.5) / K - 0.5) / r
    OX, OY = np.meshgrid(o, o)
    sx = (nx[:, None] + OX.ravel()[None]).ravel(); sy = (ny[:, None] + OY.ravel()[None]).ravel()
    rr = np.hypot(sx, sy); sc = np.minimum(1.0, 0.99999 / np.maximum(rr, 1e-12)); sx, sy = sx * sc, sy * sc
    _, _, u, v, _, _, _, _, _, s1, s2, ntap, lod, au, av = _footprint(sx, sy, r * K, M, rot, W0, H0)
    lod = np.minimum(lod, np.log2(np.maximum(s2, 1.0)) + 1.0)
    col = _sample(pt, u.astype(np.float32), v.astype(np.float32), lod, au, av, ntap)
    return col.reshape(len(nx), K * K, 3).mean(1)


def _shade(nx, ny, r, cx, cy, pt, M, rot, up_c, exposure, envf):
    W0, H0 = pt['W'], pt['H']
    n, nz, u, v, p, a, b, c, d, s1, s2, ntap, lod, au, av = _footprint(nx, ny, r, M, rot, W0, H0)
    # ---- LED cell coordinates and their on-screen size
    NCU, NCV = LED_CELLS
    cu, cv = u * NCU / W0, v * NCV / H0
    gu = np.sqrt(a * a + b * b) * NCU / W0 + 1e-9      # cells per px (u)
    gv = np.sqrt(c * c + d * d) * NCV / H0 + 1e-9
    pu, pv = 1 / gu, 1 / gv                            # cell size in px
    mu = np.clip(-nz, 0, 1)
    fall = 0.35 + 0.65 * mu ** 0.6                     # LED viewing-angle falloff + slight colour shift
    tint = 1 + ((1 - mu) ** 2)[:, None] * np.array([-0.06, -0.015, 0.08], np.float32)
    if LED_STYLE == 'halftone':
        led, emis = _shade_halftone(pt, nx, ny, r, M, rot, u, v, p, a, b, c, d, s1, s2, ntap, lod, au, av, cu, cv,
                                    pu, pv, exposure)
    else:
        led, emis = _shade_grid(pt, nx, ny, r, M, rot, u, v, p, s1, s2, ntap, lod, au, av, cu, cv, pu, pv, exposure)
    led = led * fall[:, None].astype(np.float32) * tint
    return _cover(led, emis, n, nx, ny, nz, mu, r, cx, cy, up_c, envf)


def _shade_halftone(pt, nx, ny, r, M, rot, u, v, p, a, b, c, d, s1, s2, ntap, lod, au, av, cu, cv, pu, pv, exposure):
    """halftone LED dots where the dot pitch is >= HT_FADE[1] px, fading to the plain filtered texture below
    HT_FADE[0] px (no moire).  Returns (LED radiance, cell-average emission)."""
    W0, H0 = pt['W'], pt['H']
    NCU, NCV = LED_CELLS
    N = len(nx)
    pm = np.minimum(pu, pv)
    fh = _smooth(HT_FADE[0], HT_FADE[1], pm).astype(np.float32)
    dk = (HT_DETAIL[0] * (1 - _smooth(HT_DETAIL[2], HT_DETAIL[1], pm))).astype(np.float32)
    cont = np.zeros((N, 3), np.float32)
    mc = np.nonzero((fh < 1) | (dk > 0))[0]
    if len(mc):
        cont[mc] = _sample(pt, u[mc].astype(np.float32), v[mc].astype(np.float32), lod[mc], au[mc], av[mc], ntap[mc])
    mp = np.nonzero(((fh < 1) | (dk > 0)) & (s1 > MAX_ANISO * np.maximum(s2, 1.0)) & (np.abs(p[:, 1]) > 0.9))[0]
    if len(mp):                                                    # pole pinch
        cont[mp] = _pole_supersample(pt, nx[mp], ny[mp], r, M, rot)
    dots = np.zeros((N, 3), np.float32); cell = np.zeros((N, 3), np.float32)
    md = np.nonzero(fh > 0)[0]
    if len(md):
        g = _cell_grid(pt, NCU, NCV, HT_PEAK / max(float(exposure), 1e-6))   # dots <= HT_PEAK in the canvas
        ku, kv = NCU / W0, NCV / H0
        dt = (cont[md], dk[md]) if HT_DETAIL[0] > 0 else (None, None)
        dots[md], cell[md] = _halftone(cu[md], cv[md], a[md] * ku, b[md] * ku, c[md] * kv, d[md] * kv, g, NCU, NCV, *dt)
    f = fh[:, None]
    return (cont * (1 - f) + dots * f) * exposure, (cont * (1 - f) + cell * f) * exposure


def _shade_grid(pt, nx, ny, r, M, rot, u, v, p, s1, s2, ntap, lod, au, av, cu, cv, pu, pv, exposure):
    """the old look: flat LED cells (quantized colour where cells are big) with a shallow dark gap."""
    W0, H0 = pt['W'], pt['H']
    NCU, NCV = LED_CELLS
    fade_u = np.clip((pu - 1.5) / 1.5, 0, 1); fade_v = np.clip((pv - 1.5) / 1.5, 0, 1)
    fq = np.clip((np.minimum(pu, pv) - 2.5) / 2.5, 0, 1) if QUANTIZE else np.zeros_like(pu)
    # ---- texture lookup (continuous, anisotropic) and per-LED flat colour where cells are big
    col = np.zeros((len(nx), 3), np.float32)
    mc = np.nonzero(fq < 1)[0]
    if len(mc):
        col[mc] = _sample(pt, u[mc].astype(np.float32), v[mc].astype(np.float32), lod[mc], au[mc], av[mc], ntap[mc]) \
            * (1 - fq[mc])[:, None]
    mp = np.nonzero((fq < 1) & (s1 > MAX_ANISO * np.maximum(s2, 1.0)) & (np.abs(p[:, 1]) > 0.9))[0]   # pole pinch
    if len(mp):
        col[mp] = _pole_supersample(pt, nx[mp], ny[mp], r, M, rot) * (1 - fq[mp])[:, None]
    mq = np.nonzero(fq > 0)[0]
    if len(mq):
        iu, iv = np.floor(cu[mq]), np.clip(np.floor(cv[mq]), 0, NCV - 1)
        uc, vc = ((iu + 0.5) * W0 / NCU).astype(np.float32), ((iv + 0.5) * H0 / NCV).astype(np.float32)
        lodc = np.full(len(mq), math.log2(max(W0 / NCU, H0 / NCV, 1)), np.float32)
        col[mq] += _sample(pt, uc, vc, lodc) * fq[mq][:, None]
    emis = col * exposure
    # ---- LED micro-structure (mean-preserving, faded by cell size)
    fu, fv = cu % 1.0, cv % 1.0
    eu, ev = np.abs(2 * fu - 1) ** 4, np.abs(2 * fv - 1) ** 4
    gap = (1 - LED_GAP * (eu * fade_u + (1 - fade_u) * 0.2)) * (1 - LED_GAP * (ev * fade_v + (1 - fade_v) * 0.2))
    gap /= (1 - LED_GAP * 0.2) ** 2
    iu = np.mod(np.floor(cu), NCU); iv = np.floor(cv)
    fc = np.minimum(fade_u, fade_v)
    var = 1 + LED_VAR * (_hash(iu, iv) - 0.5) * fc
    fm = np.clip((np.minimum(pu, pv) * LED_MODULE - 4) / 4, 0, 1)
    var *= 1 + LED_MODULE_VAR * (_hash(iu // LED_MODULE + 37, iv // LED_MODULE + 11) - 0.5) * 2 * fm
    return emis * (gap * var)[:, None].astype(np.float32), emis


def _cover(led, emis, n, nx, ny, nz, mu, r, cx, cy, up_c, envf):
    """glossy protective cover on top of the LEDs: Fresnel env reflection + one soft glint."""
    # ---- glossy cover: Fresnel reflection of the environment
    F = F0 + (1 - F0) * (1 - mu) ** 5
    rz = 1 - 2 * nz * nz                                # mirror dir z (view dir (0,0,1))
    if envf is not None:
        eimg, eimg2, ex0, ey0, amb = envf
        rho = np.sqrt(nx * nx + ny * ny) + 1e-9
        tand = np.sqrt(np.clip(1 - rz * rz, 0, 1)) / np.maximum(rz, 0.05)
        sr = 1.04 + ENV_K * tand                        # lookup radius (in radii) along the outward radial line
        X = (cx + nx / rho * r * np.minimum(sr, ENV_MAXR) - ex0).astype(np.float32)
        Y = (cy + ny / rho * r * np.minimum(sr, ENV_MAXR) - ey0).astype(np.float32)
        mb = _smooth(1.2, 3.0, sr)[:, None]             # far lookups: wider glossy lobe -> blurrier env
        ref = _remap(eimg, X, Y) * (1 - mb) + _remap(eimg2, X, Y) * mb
        wf = (_smooth(-0.15, 0.3, rz) * (1 - _smooth(0.55 * ENV_MAXR, ENV_MAXR, sr)))[:, None]
        ref = ref * wf + amb[None] * (1 - wf)
    else:
        rw = np.stack([-2 * nz * nx, -2 * nz * ny, rz], 1) @ up_c        # world-up component of the mirror dir
        ref = ENV_GROUND[None] + (ENV_SKY - ENV_GROUND)[None] * _smooth(-0.2, 0.7, rw)[:, None]
        amb = (ENV_SKY + ENV_GROUND) / 2
    # ---- soft specular glint (one light)
    L = np.array(GLINT_DIR, np.float64); L /= np.linalg.norm(L)
    Hh = L + np.array([0, 0, -1.0]); Hh /= np.linalg.norm(Hh)
    ndh = np.clip(n @ Hh, 0, 1); vdh = float(-Hh[2])
    Fs = F0 + (1 - F0) * (1 - vdh) ** 5
    spec = (Fs * GLINT_POWER * (ndh ** 320 + 0.025 * ndh ** 24))[:, None] * GLINT_COLOR[None]
    out = led * (1 - F)[:, None] + ref * F[:, None] + spec + 0.025 * amb[None] * (1 - F)[:, None]
    return out.astype(np.float32), emis.astype(np.float32), n.astype(np.float32)


def _limb_light(pt, M, rot, phi, exposure):
    """blurred LED emission near the limb in screen direction phi (lights the inner face of the collar)."""
    acc = np.zeros((len(phi), 3), np.float32)
    for nzv in (0.0, -0.35):
        s = math.sqrt(1 - nzv * nzv)
        n = np.stack([np.cos(phi) * s, np.sin(phi) * s, np.full_like(phi, nzv)], 1)
        u, v, _ = _uv(M, rot, n, pt['W'], pt['H'])
        acc += _sample(pt, u.astype(np.float32), v.astype(np.float32), np.full(len(phi), 5.0, np.float32)) * 0.5
    return acc * exposure


# ---------------------------------------------------------------- main entry
def render_sphere(canvas, cx, cy, r, tex, th, rot_deg=0.0, tilt_deg=0.0, exposure=1.0, env=None, collar=True, shadow=None):
    """collar/shadow: the mounting lip and contact-shadow ring of a ball set into a camera-facing panel; switch them
    off for a free-hovering ball or one resting on a horizontal surface (shadow=None -> module SHADOW)."""
    pt = prepare_texture(tex)
    Hc, Wc = canvas.shape[:2]
    M, up_c, rot = _frame(th, rot_deg, tilt_deg)
    shadow_k = SHADOW if shadow is None else float(shadow)
    cw = float(np.clip(0.045 * r, 2.0, 4.0)) if collar else 0.0   # collar width
    ws = float(np.clip(0.06 * r, 1.5, 10.0))           # contact shadow width
    Ro = r + cw + 5 * ws
    x0, x1 = max(0, int(math.floor(cx - Ro))), min(Wc, int(math.ceil(cx + Ro)) + 1)
    y0, y1 = max(0, int(math.floor(cy - Ro))), min(Hc, int(math.ceil(cy + Ro)) + 1)
    empty = dict(xs=np.zeros(0, int), ys=np.zeros(0, int), normals=np.zeros((0, 3), np.float32),
                 emission=np.zeros((0, 3), np.float32), alpha=np.zeros(0, np.float32), color=np.zeros((0, 3), np.float32))
    if x0 >= x1 or y0 >= y1: return empty
    # ---- environment for the cover reflection (ball disc masked out, glossy blur)
    envf = None
    if env is not None:
        Re = r * (ENV_MAXR + 0.3)
        ex0, ex1 = max(0, int(cx - Re)), min(Wc, int(cx + Re) + 1)
        ey0, ey1 = max(0, int(cy - Re)), min(Hc, int(cy + Re) + 1)
        E = np.asarray(env[ey0:ey1, ex0:ex1], np.float32)
        gy, gx = np.mgrid[ey0:ey1, ex0:ex1]
        m = (np.hypot(gx - cx, gy - cy) > r + cw + 0.5).astype(np.float32)
        def nblur(sig):                                  # normalized convolution (ignores the masked ball disc)
            return np.ascontiguousarray((cv2.GaussianBlur(E * m[..., None], (0, 0), sig) /
                    np.maximum(cv2.GaussianBlur(m, (0, 0), sig), 1e-4)[..., None]).astype(np.float32))
        amb = (E * m[..., None]).reshape(-1, 3).sum(0) / max(m.sum(), 1) * 0.6
        envf = (nblur(max(1.0, 0.03 * r)), nblur(max(2.0, 0.15 * r)), ex0, ey0, amb.astype(np.float32))
    reg = canvas[y0:y1, x0:x1]
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float64)
    dx, dy = xx - cx, yy - cy
    dist = np.hypot(dx, dy)
    # ---- 1) contact shadow on the panel
    dd = dist - (r + cw)
    if shadow_k > 0:
        shadow = np.where(dist > r, shadow_k * np.exp(-np.maximum(dd, 0) / ws), 0)
        reg *= (1 - shadow)[..., None].astype(np.float32)
    # ---- 2) dark metal mounting collar (rounded lip), lit faintly by the ball and the glint light
    cm = (dist > r - 2.5) & (dist < r + cw + 1.0)
    cyx = np.nonzero(cm)
    if collar and len(cyx[0]):
        dc = dist[cyx]; phi = np.arctan2(dy[cyx], dx[cyx])
        t = np.clip((dc - r) / cw, 0, 1)
        beta = np.radians(-70 + 140 * t)                   # lip normal: faces the ball (t=0) .. faces outward (t=1)
        nc = np.stack([np.cos(phi) * np.sin(beta), np.sin(phi) * np.sin(beta), -np.cos(beta)], 1)
        L = np.array(GLINT_DIR); L /= np.linalg.norm(L); Hh = L + [0, 0, -1.0]; Hh /= np.linalg.norm(Hh)
        sp = np.clip(nc @ Hh, 0, 1) ** 30 * 0.05 + np.clip(nc @ L, 0, 1) * 0.006
        ll = _limb_light(pt, M, rot, phi, exposure)
        bounce = (np.clip(-np.sin(beta), 0, 1) * 0.35 + 0.04)[:, None] * ll
        ccol = COLLAR_COLOR[None] * (0.6 + 0.4 * t)[:, None] + sp[:, None] * np.array([0.9, 0.92, 1.0]) + bounce
        cov = np.clip(r + cw + 0.5 - dc, 0, 1)[:, None]
        reg[cyx] = reg[cyx] * (1 - cov) + ccol.astype(np.float32) * cov
    # ---- 3) ball: one sample per interior pixel, 4x4 supersamples on the silhouette band
    inner = dist <= r - 2.5
    band = (dist > r - 2.5) & (dist < r + 0.75)
    iy, ix = np.nonzero(inner | band)
    pidx = np.full(dist.shape, -1, np.int64); pidx[iy, ix] = np.arange(len(iy))
    sy0, sx0 = np.nonzero(inner)
    SX, SY, SP, SW = [dx[sy0, sx0]], [dy[sy0, sx0]], [pidx[sy0, sx0]], [np.ones(len(sy0))]
    by, bx = np.nonzero(band)
    o = (np.arange(4) + 0.5) / 4 - 0.5
    for oy in o:
        for ox in o:
            px, py = dx[by, bx] + ox, dy[by, bx] + oy
            k = px * px + py * py < r * r
            SX.append(px[k]); SY.append(py[k]); SP.append(pidx[by[k], bx[k]]); SW.append(np.full(k.sum(), 1 / 16))
    SX, SY, SP, SW = (np.concatenate(z) for z in (SX, SY, SP, SW))
    if len(SX) == 0: return empty
    col, emis, nrm = _shade(SX / r, SY / r, r, cx, cy, pt, M, rot, up_c, exposure, envf)
    npix = len(iy)
    acc = lambda z: np.stack([np.bincount(SP, z[:, k] * SW, minlength=npix) for k in range(z.shape[1])], 1)
    cov = np.bincount(SP, SW, minlength=npix)
    C, E, N = acc(col), acc(emis), acc(nrm)
    keep = cov > 0
    iy, ix, cov, C, E, N = iy[keep], ix[keep], cov[keep], C[keep], E[keep], N[keep]
    reg[iy, ix] = reg[iy, ix] * (1 - cov)[:, None].astype(np.float32) + C.astype(np.float32)
    N = N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    return dict(xs=ix + x0, ys=iy + y0, normals=N.astype(np.float32), emission=(E / cov[:, None]).astype(np.float32),
                alpha=cov.astype(np.float32), color=(C / cov[:, None]).astype(np.float32))


# ---------------------------------------------------------------- self test
def _test_texture(W=2048, H=1024):
    from PIL import Image, ImageDraw, ImageFont
    import os
    fdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fonts')
    def font(sz, name='RussoOne-400.ttf'):
        try: return ImageFont.truetype(os.path.join(fdir, name), sz)
        except Exception: return ImageFont.load_default()
    lon = (np.arange(W) + 0.5) / W * 360 - 180
    lat = 90 - (np.arange(H) + 0.5) / H * 180
    LON, LAT = np.meshgrid(lon, lat)
    bg = np.stack([0.10 + 0.08 * np.cos(np.radians(LON)), 0.10 + 0.05 * np.sin(np.radians(LAT)) + 0.04,
                   0.32 + 0.10 * np.sin(np.radians(LON))], -1)          # hue drifts with lon (orientation cue)
    img = Image.fromarray((np.clip(bg, 0, 1) * 255).astype(np.uint8)).convert('RGBA')
    dr = ImageDraw.Draw(img)
    U = lambda lo: (lo + 180) / 360 * W
    V = lambda la: (90 - la) / 180 * H
    for la in range(-75, 90, 15):
        dr.line([(0, V(la)), (W, V(la))], fill=(170, 190, 220, 255), width=3)
    for lo in range(-180, 181, 15):
        dr.line([(U(lo), 0), (U(lo), H)], fill=(170, 190, 220, 255) if lo % 90 else (120, 255, 140, 255), width=3)
    dr.rectangle([0, V(3), W, V(-3)], fill=(235, 30, 30, 255))      # red equator band
    def text(s, lo, la, sz, fill, f='RussoOne-400.ttf'):
        fn = font(sz, f)
        for off in (-W, 0, W):                                       # wrap across the seam
            dr.text((U(lo) + off, V(la)), s, font=fn, fill=fill, anchor='mm')
    text('N', 0, 30, 200, (255, 255, 255, 255))
    text('E', 90, 30, 170, (255, 230, 60, 255))
    text('W', -90, 30, 170, (60, 220, 255, 255))
    text('S', 180, 30, 170, (255, 120, 220, 255))
    for lo in range(-150, 181, 30):
        if lo in (0, 90, -90, 180): continue
        text(f'{lo:+d}', lo, 52.5, 44, (255, 255, 255, 255), 'Rajdhani-700.ttf')
    text('NEWS 360  LIVE  NEWS 360  LIVE  NEWS 360', 0, -12, 60, (255, 255, 255, 255), 'Rajdhani-700.ttf')
    a = np.asarray(img, np.float32) / 255
    a[:int(V(82)), :, :3] = np.array([1.0, 0.85, 0.2])                       # yellow polar cap (north)
    return a


def _selftest():
    import os
    from PIL import Image
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.join(here, '..')
    th = math.asin(0.665)
    W = H = 1200
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    # dark panel with a few neon strips (something for the cover to reflect)
    can = np.zeros((H, W, 3), np.float32) + np.array([0.006, 0.007, 0.012], np.float32)
    can += (0.004 * (1 + np.sin(xx / 7)))[..., None] * np.array([1, 1, 1.3], np.float32)
    for y, colr in ((40, (1.6, 0.1, 0.9)), (1150, (0.1, 0.9, 1.6))):
        can += (np.exp(-((yy - y) / 6) ** 2))[..., None] * np.array(colr, np.float32)
    can += (np.exp(-((xx - 1150) / 8) ** 2) * (yy > 400))[..., None] * np.array([1.4, 0.7, 0.1], np.float32)
    env = can.copy()
    tex = _test_texture()
    pt = prepare_texture(tex)
    import time
    t0 = time.time()
    global LED_CELLS
    cells0 = LED_CELLS
    def ball(cx, cy, r, **kw):
        global LED_CELLS
        if LED_STYLE == 'halftone': LED_CELLS = halftone_cells(r, th)
        return render_sphere(can, cx, cy, r, pt, th, **kw)
    res = ball(540, 610, 500, env=env)
    ball(1060, 170, 120, env=env)
    ball(1095, 1010, 68, rot_deg=180, env=None)     # back side: seam test at scene scale
    ball(1110, 1150, 30, rot_deg=90, env=None)
    LED_CELLS = cells0
    print('render %.2fs, ball pixels %d' % (time.time() - t0, len(res['xs'])))
    os.makedirs(os.path.join(root, 'out'), exist_ok=True)
    out = os.path.join(root, 'out', 'sphere_test.png')
    Image.fromarray((np.clip(l2s(can), 0, 1) * 255 + 0.5).astype(np.uint8)).save(out)
    Image.fromarray((np.clip(tex, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(root, 'out', 'sphere_test_tex.png'))
    # projections of reference points (camera space) for the report
    up_c = np.array([0, -math.cos(th), -math.sin(th)]); h = np.array([0, -math.sin(th), math.cos(th)]); ex = np.array([1.0, 0, 0])
    for nm, lo, la in (('north pole', 0, 90), ('N (lon0,lat30)', 0, 30), ('E (lon90,lat30)', 90, 30), ('equator front', 0, 0)):
        lo, la = math.radians(lo), math.radians(la)
        w = np.array([math.cos(la) * math.sin(lo), math.sin(la), -math.cos(la) * math.cos(lo)])
        n = w[0] * ex + w[1] * up_c + w[2] * h
        print(f'{nm:18s} screen offset/r = ({n[0]:+.3f}, {n[1]:+.3f}) visible={n[2] < 0}')
    print('saved', os.path.abspath(out))


if __name__ == '__main__':
    if '--test' in sys.argv:
        _selftest()
    else:
        print(__doc__)
