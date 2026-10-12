"""Concrete weathering pass, applied before the film emulation.

Adds the surface character a render tends to miss:
  - pour-to-pour tone mottling and fine aggregate texture
  - low-relief bumps lit from the sky, plus small air-void pits
  - rain run-off grime streaks under windows, portholes and ledges
  - broad dirt washes and orange rust run-off from metal fittings
  - a few pale lime (efflorescence) streaks

Streaks run "down" in the world, i.e. away from the vertical vanishing
point, so they follow the converging verticals of a looking-up shot. They
stop at strong edges, so a streak on a tower does not carry over onto the
bridge in front of it.
"""

import numpy as np

from film_emulation import bilinear_sample, gaussian_blur

RNG = np.random.default_rng(1977)
LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def blur1d(arr, sigma, axis):
    """FFT gaussian blur along one axis, with reflect padding."""
    n = arr.shape[axis]
    pad = int(3 * sigma) + 1
    widths = [(0, 0)] * arr.ndim
    widths[axis] = (pad, pad)
    p = np.pad(arr, widths, mode="reflect")
    m = p.shape[axis]
    shape = [1] * arr.ndim
    shape[axis] = -1
    k = np.exp(-2 * (np.pi * sigma * np.fft.rfftfreq(m)) ** 2).reshape(shape)
    out = np.fft.irfft(np.fft.rfft(p, axis=axis) * k, n=m, axis=axis)
    keep = [slice(None)] * arr.ndim
    keep[axis] = slice(pad, pad + n)
    return out[tuple(keep)].astype(np.float32)


def smooth_noise(shape, sigma):
    n = gaussian_blur(RNG.standard_normal(shape).astype(np.float32), sigma)
    return n / n.std()


def estimate_vertical_vp(L):
    """Vanishing point of the near-vertical lines (robust least squares)."""
    h, w = L.shape
    gx = np.zeros_like(L)
    gy = np.zeros_like(L)
    gx[:, 1:-1] = (L[:, 2:] - L[:, :-2]) / 2
    gy[1:-1] = (L[2:] - L[:-2]) / 2
    jxx = gaussian_blur(gx * gx, 3)
    jyy = gaussian_blur(gy * gy, 3)
    jxy = gaussian_blur(gx * gy, 3)
    strength = np.sqrt((jxx - jyy) ** 2 + 4 * jxy ** 2)
    coherence = strength / (jxx + jyy + 1e-6)
    grad_angle = 0.5 * np.arctan2(2 * jxy, jxx - jyy)
    # Line normal is the gradient direction.
    nx, ny = np.cos(grad_angle), np.sin(grad_angle)
    sel = (
        (np.abs(nx) > np.cos(np.radians(30)))  # line within 30 deg of vertical
        & (coherence > 0.6)
        & (strength > np.percentile(strength, 85))
    )
    ys, xs = np.nonzero(sel)
    nx, ny, wt = nx[sel], ny[sel], strength[sel]
    A = np.stack([nx, ny], 1)
    b = nx * xs + ny * ys
    vp = np.array([w / 2, -h / 3])
    for _ in range(30):
        r = A @ vp - b
        c = 25.0 * max(h, w) / 1500
        rw = wt * (np.abs(r) < c) * (1 - (r / c) ** 2) ** 2  # Tukey weights
        vp = np.linalg.solve((A * rw[:, None]).T @ A, (A * rw[:, None]).T @ b)
    return vp


def weather(rgb, lights=None, min_surface=0.0, texture_gain=1.0):
    """rgb: sRGB float32 array (H, W, 3) in [0, 1]. Returns a weathered copy.

    lights: optional soft mask of light sources to keep clear of stains and
    texture. By default only warm lamps and lit windows are detected.
    min_surface: texture floor on flat but visible surfaces (the detail
    measure misses featureless slabs, which at night is most of them).
    texture_gain: scales the surface texture (not the stains).
    """
    h, w = rgb.shape[:2]
    L = rgb @ LUMA
    vx, vy = estimate_vertical_vp(L)

    # ---- Where to apply: textured, near surfaces; not fog, sky or lamps ----
    hp = L - gaussian_blur(L, 2.0)
    energy = np.sqrt(np.maximum(gaussian_blur(hp ** 2, 10), 0))
    surface = np.clip(energy / np.percentile(energy, 70), 0, 1)
    surface = gaussian_blur(surface, 6) ** 1.2
    if min_surface:
        surface = np.maximum(surface, min_surface * np.clip((L - 0.02) / 0.05, 0, 1))
    warm = rgb[..., 0] - rgb[..., 2]
    lamps = np.clip((L - 0.5) / 0.2, 0, 1) * np.clip(warm / 0.12, 0, 1)
    if lights is not None:
        lamps = np.maximum(lamps, lights)
    lamps = np.clip(gaussian_blur(lamps, 3) * 3, 0, 1)
    mask = (surface * (1 - lamps))[..., None]
    tight = np.clip(np.sqrt(np.maximum(gaussian_blur(hp ** 2, 3), 0)) / np.percentile(energy, 70), 0, 1)
    tight = np.minimum(gaussian_blur(tight, 2), surface)
    stain_mask = (tight * (1 - lamps))[..., None]

    # ---- Rectified grid: columns run straight "down" from the VP ----
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    theta = np.arctan2(xs - vx, ys - vy)
    rho = np.hypot(xs - vx, ys - vy)
    t0, r0 = theta.min(), rho.min()
    rho_ref = float(np.median(rho))
    nu = int((theta.max() - t0) * rho_ref) + 2
    nv = int(rho.max() - r0) + 2
    gth = t0 + np.arange(nu, dtype=np.float32)[None, :] / rho_ref
    grh = r0 + np.arange(nv, dtype=np.float32)[:, None]
    gx = vx + grh * np.sin(gth)
    gy = vy + grh * np.cos(gth)
    Lg = bilinear_sample(L, gx, gy)
    maskg = bilinear_sample(stain_mask[..., 0], gx, gy)
    rustg = bilinear_sample(np.clip((warm - 0.03) / 0.08, 0, 1) * (L < 0.5), gx, gy)
    del gx, gy

    # Change in brightness going down: positive at the bottom edge of dark
    # openings and ledges, where run-off starts.
    Lgs = blur1d(blur1d(Lg, 1.2, 0), 0.8, 1)
    dLv = np.zeros_like(Lgs)
    dLv[1:-1] = (Lgs[2:] - Lgs[:-2]) / 2
    stop = 1 - np.clip((np.abs(dLv) - 0.035) / 0.05, 0, 1)

    col_var = np.clip(blur1d(RNG.standard_normal(nu).astype(np.float32), 3, 0) * 4 - 0.2, 0, None)
    sparse = RNG.random((nv, nu), dtype=np.float32)
    below = np.zeros_like(maskg)
    below[:-10] = np.minimum(maskg[5:-5], maskg[10:])
    drip_src = np.clip(dLv - 0.012, 0, None) * 12 * col_var[None, :] * below
    rain_src = (sparse < 0.0007) * RNG.exponential(0.25, (nv, nu)).astype(np.float32) * below
    rust_src = (
        rustg * (sparse > 0.997) * 0.7
        + (sparse < 0.00025) * 0.6
    ) * below
    lime_src = ((sparse > 0.5) & (sparse < 0.5003)) * 0.5 * below

    # Run-off: each row inherits the decayed stain from the row above.
    def run_off(src, mean_len, spread):
        length = mean_len * np.exp(spread * RNG.standard_normal(nu)).astype(np.float32)
        decay = np.exp(-1.0 / length)[None, :] * stop
        out = np.empty_like(src)
        acc = np.zeros(nu, dtype=np.float32)
        for v in range(nv):
            acc = acc * decay[v] + src[v]
            out[v] = acc
        return out

    breakup = np.clip(1 + 0.6 * blur1d(blur1d(RNG.standard_normal((nv, nu)).astype(np.float32), 14, 0), 1, 1) * 6, 0, None)
    streak_acc = run_off(drip_src + rain_src, 70, 0.7)
    streak_acc = 0.6 * blur1d(streak_acc, 0.8, 1) + 0.4 * blur1d(streak_acc, 2.2, 1)
    streak = 1 - np.exp(-streak_acc * breakup * 1.6)
    del streak_acc
    wash = 1 - np.exp(-blur1d(run_off(drip_src * 0.5, 300, 0.5), 10, 1) * 0.6)
    rust = 1 - np.exp(-blur1d(run_off(rust_src, 45, 0.6), 1.0, 1) * breakup * 1.4)
    lime = 1 - np.exp(-blur1d(run_off(lime_src, 90, 0.4), 1.5, 1) * 1.5)
    del breakup, dLv, stop, sparse, Lg, Lgs

    # Back to image space, with a slight meander.
    wobble = gaussian_blur(RNG.standard_normal((h, w)).astype(np.float32), 30)
    wobble *= 1.5 / wobble.std()
    u = (theta - t0) * rho_ref + wobble
    v = rho - r0
    stains = {
        name: bilinear_sample(layer, u, v)[..., None]
        for name, layer in (("streak", streak), ("wash", wash), ("rust", rust), ("lime", lime))
    }
    del streak, wash, rust, lime

    # ---- Concrete surface texture (image space) ----
    depth = (ys / h)[..., None]  # nearer surfaces toward the bottom
    mottle = 0.5 * smooth_noise((h, w), 70) + 0.35 * smooth_noise((h, w), 22) + 0.15 * smooth_noise((h, w), 7)
    tone = smooth_noise((h, w), 90)
    fine = smooth_noise((h, w), 0.7) * (1 - depth[..., 0] * 0.4) + smooth_noise((h, w), 1.4) * depth[..., 0] * 0.4
    height = 0.6 * smooth_noise((h, w), 1.5) + 0.4 * smooth_noise((h, w), 5)
    hy, hx = np.gradient(height)
    relief = (hx * (vx - xs) + hy * (vy - ys)) / rho  # slope toward the sky
    relief /= relief.std()
    voids = gaussian_blur((RNG.random((h, w)) < 0.0009).astype(np.float32), 0.9) * 2 * np.pi * 0.81
    voids += gaussian_blur((RNG.random((h, w)) < 0.0003).astype(np.float32), 1.7) * 2 * np.pi * 2.89
    voids = np.clip(voids, 0, 1)

    out = rgb.copy()
    lum_mod = (0.07 * mottle + 0.04 * fine + 0.045 * relief) * texture_gain
    out *= 1 + mask * lum_mod[..., None]
    out *= 1 + mask * tone[..., None] * np.array([0.018, 0.004, -0.02], np.float32)
    out *= 1 - mask * voids[..., None] * 0.45

    # ---- Stains ----
    out *= 1 - stain_mask * stains["wash"] * 0.3 * np.array([0.92, 1.0, 1.12], np.float32)
    out *= 1 - stain_mask * stains["streak"] * 0.34 * np.array([0.9, 1.0, 1.15], np.float32)
    rust_tint = np.array([1.22, 0.74, 0.46], np.float32)
    r = stain_mask * stains["rust"] * 0.45
    out = out * (1 - r) + out * rust_tint * r
    out += stain_mask * stains["lime"] * 0.07 * np.array([1.0, 1.0, 0.96], np.float32)

    return np.clip(out, 0, 1)
