"""Procedural lemon cross-section textures.

Writes into ./textures:
  lemon_cut_color.png   sRGB albedo of a lemon cut across its equator
  lemon_cut_height.png  16-bit height (segment bulge + juice vesicles)
  lemon_cut_mask.png    R = pulp, G = pith/membrane, B = rind

The disc of the lemon fills the image: pixel (0, 0)..(N, N) maps to x, y in [-1, 1].
"""
import os

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree

N = 2048
SEED = 7
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "textures")

R_RIND = 0.935   # flavedo (yellow skin) starts here
R_PITH = 0.835   # albedo (white pith) between R_PITH and R_RIND
R_CORE = 0.075   # central pith core
N_SEG = 10


def value_noise(shape, scale, rng):
    """Smooth band-limited noise in [0, 1]."""
    g = rng.random((int(shape[0] / scale) + 3, int(shape[1] / scale) + 3))
    img = np.array(Image.fromarray((g * 65535).astype(np.uint16)).resize(
        (shape[1] + int(3 * scale), shape[0] + int(3 * scale)), Image.BICUBIC), dtype=np.float32) / 65535
    return img[: shape[0], : shape[1]]


def fbm(shape, scale, rng, octaves=4):
    out = np.zeros(shape, np.float32)
    amp, tot = 1.0, 0.0
    for _ in range(octaves):
        out += amp * value_noise(shape, max(scale, 1.5), rng)
        tot += amp
        amp *= 0.5
        scale /= 2
    return out / tot


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def main():
    rng = np.random.default_rng(SEED)
    os.makedirs(OUT, exist_ok=True)
    ax = (np.arange(N) + 0.5) / N * 2 - 1
    x, y = np.meshgrid(ax, -ax)
    r = np.hypot(x, y)
    th = np.arctan2(y, x)

    # Irregular, slightly wobbly outlines.
    wob = (fbm((N, N), 160, rng) - 0.5)
    r_w = r * (1 + 0.025 * wob)

    # ---- segment geometry -------------------------------------------------
    widths = rng.uniform(0.8, 1.2, N_SEG)
    widths = widths / widths.sum() * 2 * np.pi
    bounds = np.concatenate([[0], np.cumsum(widths)]) - np.pi  # boundary at +-pi hides the seam
    # gently curve the membranes (they are never perfectly straight)
    th_c = th + 0.05 * np.sin(r * 5.0 + 1.3) + 0.04 * (fbm((N, N), 300, rng) - 0.5)
    th_c = (th_c + np.pi) % (2 * np.pi) - np.pi
    k = np.clip(np.searchsorted(bounds, th_c, side="right") - 1, 0, N_SEG - 1)
    lo, hi = bounds[k], bounds[k + 1]
    dth = np.minimum(th_c - lo, hi - th_c)

    memb = 0.006 + 0.010 * (1 - r)                   # membrane thickness, thicker near the core
    d_side = dth * r - memb / 2
    seg_outer = R_PITH - 0.012
    d_out = seg_outer * (1 + 0.02 * wob) - r
    d_in = r - (R_CORE + 0.01 * (1 - np.cos(N_SEG * th)))
    kr = 0.045                                      # corner rounding radius
    ds = np.minimum(np.minimum(d_side, d_out), d_in)
    both = (d_side < kr) & (d_out < kr)
    ds = np.where(both, kr - np.hypot(kr - np.minimum(d_side, kr), kr - np.minimum(d_out, kr)), ds)
    both_in = (d_side < kr * 0.5) & (d_in < kr * 0.5)
    ds = np.where(both_in, np.minimum(ds, kr * 0.5 - np.hypot(kr * 0.5 - np.minimum(d_side, kr * 0.5),
                                                             kr * 0.5 - np.minimum(d_in, kr * 0.5))), ds)
    pulp = smoothstep(-0.002, 0.004, ds)

    # ---- juice vesicles: Voronoi in a radially stretched space -------------
    n_pts = 7000
    pr = np.sqrt(rng.random(n_pts)) * 0.85
    pt = rng.uniform(-np.pi, np.pi, n_pts)
    su, sv = 9.0, 46.0
    pts = np.stack([pr * su, pt * np.maximum(pr, 0.06) * sv], 1)
    q = np.stack([r.ravel() * su, (th * np.maximum(r, 0.06)).ravel() * sv], 1)
    tree = cKDTree(pts)
    dd, ii = tree.query(q, k=2, workers=-1)
    edge = (dd[:, 1] - dd[:, 0]).reshape(N, N)
    cell_rand = rng.random(n_pts)[ii[:, 0]].reshape(N, N)
    ves_edge = 1 - smoothstep(0.0, 0.12, edge)       # 1 on vesicle walls
    ves_dome = smoothstep(0.0, 0.35, edge)           # domed cell interiors

    # ---- colours (linear-ish floats in sRGB space, 0..1) -------------------
    def c(*v):
        return np.array(v, np.float32) / 255.0

    fine = fbm((N, N), 12, rng, 3)[..., None]
    pulp_deep = c(232, 178, 28)
    pulp_mid = c(244, 204, 66)
    pulp_light = c(250, 228, 132)
    membrane_c = c(249, 244, 214)
    pith_c = c(247, 242, 214)
    pith_out = c(250, 232, 150)
    rind_in = c(244, 196, 40)
    rind_out = c(222, 160, 12)

    t = np.clip(cell_rand[..., None] * 0.7 + 0.3 * fine, 0, 1)
    col_pulp = pulp_deep * (1 - t) + pulp_mid * t
    radial_light = smoothstep(0.15, 0.75, r)[..., None]   # vesicles near the core are paler
    col_pulp = col_pulp * (1 - 0.35 * (1 - radial_light)) + pulp_light * 0.35 * (1 - radial_light)
    col_pulp = col_pulp * (1 - 0.35 * ves_edge[..., None]) + pulp_light * 0.35 * ves_edge[..., None]

    pith_t = smoothstep(R_PITH, R_RIND, r_w)[..., None]
    col_pith = pith_c * (1 - pith_t ** 3) + pith_out * pith_t ** 3
    col_pith = col_pith * (0.97 + 0.06 * fine)

    rind_t = smoothstep(R_RIND, 1.0, r_w)[..., None]
    col_rind = rind_in * (1 - rind_t) + rind_out * rind_t
    # oil glands in the flavedo
    glands = value_noise((N, N), 6, rng)
    col_rind = col_rind * (1 - 0.18 * smoothstep(0.62, 0.8, glands)[..., None])

    is_rind = smoothstep(R_RIND - 0.004, R_RIND + 0.004, r_w)
    in_disc = smoothstep(R_PITH - 0.03, R_PITH, r_w)  # pith / rind zone

    col = membrane_c * np.ones((N, N, 1), np.float32)
    col = col * (1 - pulp[..., None]) + col_pulp * pulp[..., None]
    outer = np.clip(in_disc - pulp, 0, 1)[..., None]
    col = col * (1 - outer) + col_pith * outer
    col = col * (1 - is_rind[..., None]) + col_rind * is_rind[..., None]

    # ---- seeds -----------------------------------------------------------
    seed_mask = np.zeros((N, N), np.float32)
    for kk in rng.choice(N_SEG, 4, replace=False):
        sm = 0.5 * (bounds[kk] + bounds[kk + 1]) + rng.uniform(-0.1, 0.1)
        sr = rng.uniform(0.17, 0.25)
        cx, cy = sr * np.cos(sm), sr * np.sin(sm)
        # teardrop aligned radially
        ux, uy = np.cos(sm), np.sin(sm)
        dx, dy = x - cx, y - cy
        a = dx * ux + dy * uy
        b = -dx * uy + dy * ux
        L, W = 0.075, 0.032
        w = W * np.clip(1 - ((a / L) ** 2), 0, 1) ** 0.5 * (1 - 0.35 * (a / L))
        s = smoothstep(0.002, -0.002, np.abs(b) - w) * (np.abs(a) < L)
        seed_mask = np.maximum(seed_mask, s)
    seed_col = c(250, 246, 222) * (0.92 + 0.08 * fine)
    col = col * (1 - seed_mask[..., None]) + seed_col * seed_mask[..., None]

    col = np.clip(col, 0, 1)
    Image.fromarray((col * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "lemon_cut_color.png"))

    # ---- height -----------------------------------------------------------
    bulge = smoothstep(0.0, 0.05, ds) * 0.6          # each segment swells above the membranes
    h = bulge + pulp * (0.25 * ves_dome + 0.1 * cell_rand) - 0.05 * ves_edge * pulp
    h = h * (1 - in_disc * (1 - pulp)) + (in_disc * (1 - pulp)) * (0.55 + 0.05 * fine[..., 0])
    h = h + seed_mask * 0.25
    h = gaussian_filter(h, 1.2)
    h = (h - h.min()) / (h.max() - h.min())
    Image.fromarray((h * 65535).astype(np.uint16)).save(os.path.join(OUT, "lemon_cut_height.png"))

    mask = np.stack([np.clip(pulp - seed_mask, 0, 1),
                     np.clip(1 - pulp - is_rind, 0, 1) + seed_mask,
                     is_rind], -1)
    Image.fromarray((np.clip(mask, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, "lemon_cut_mask.png"))
    print("textures written to", OUT)


if __name__ == "__main__":
    main()
