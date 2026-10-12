"""Film-emulation pass: Nikon F3 + 20mm f/2.8 on Kodak Portra 400.

Re-photographs a rendered image as a 35mm colour-negative scan:
  - 2:3 35mm frame, extra keystone for stronger converging verticals
  - slight barrel distortion, lateral chromatic aberration, corner softness
  - wide-open light falloff (vignetting)
  - red-orange halation and bloom around light sources
  - Portra-style tone curve: lifted blacks, soft shoulder, muted saturation,
    cool shadows / warm highlights
  - luminance-dependent grain with fine dye-cloud colour noise

Usage: python3 film_emulation.py input.webp output.jpg
"""

import sys

import numpy as np
from PIL import Image

RNG = np.random.default_rng(400)  # fixed seed so the grain is reproducible
SCALE = 2  # scan resolution relative to the source


def srgb_to_linear(v):
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(v):
    v = np.clip(v, 0.0, None)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * v ** (1 / 2.4) - 0.055)


def gaussian_blur(arr, sigma):
    """FFT gaussian blur over the first two axes, with reflect padding."""
    pad = int(3 * sigma) + 1
    widths = [(pad, pad), (pad, pad)] + [(0, 0)] * (arr.ndim - 2)
    p = np.pad(arr, widths, mode="reflect")
    h, w = p.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.rfftfreq(w)[None, :]
    kernel = np.exp(-2 * (np.pi * sigma) ** 2 * (fx ** 2 + fy ** 2))
    if arr.ndim == 3:
        kernel = kernel[..., None]
    out = np.fft.irfft2(np.fft.rfft2(p, axes=(0, 1)) * kernel, s=(h, w), axes=(0, 1))
    return out[pad:-pad, pad:-pad].astype(np.float32)


def bilinear_sample(img, xs, ys):
    h, w = img.shape[:2]
    xs = np.clip(xs, 0, w - 1.001)
    ys = np.clip(ys, 0, h - 1.001)
    x0 = xs.astype(np.int32)
    y0 = ys.astype(np.int32)
    fx = (xs - x0)[..., None] if img.ndim == 3 else xs - x0
    fy = (ys - y0)[..., None] if img.ndim == 3 else ys - y0
    a = img[y0, x0]
    b = img[y0, x0 + 1]
    c = img[y0 + 1, x0]
    d = img[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def homography(src_pts, dst_pts):
    """3x3 matrix mapping src_pts -> dst_pts (4 point pairs)."""
    rows = []
    for (x, y), (u, v) in zip(src_pts, dst_pts):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    _, _, vt = np.linalg.svd(np.array(rows, dtype=np.float64))
    return (vt[-1] / vt[-1, -1]).reshape(3, 3)


def main(src_path, out_path):
    src = Image.open(src_path).convert("RGB")
    sw, sh = src.size
    src = src.resize((sw * SCALE, sh * SCALE), Image.LANCZOS)
    lin = srgb_to_linear(np.asarray(src, dtype=np.float32) / 255.0)
    sh, sw = lin.shape[:2]

    # 35mm frame is 2:3; keep the full source height.
    oh = sh
    ow = int(round(oh * 2 / 3))

    # Output pixel grid in normalized coords centred on the frame.
    yy, xx = np.mgrid[0:oh, 0:ow].astype(np.float32)
    half_diag = np.hypot(ow / 2, oh / 2)
    nx = (xx - ow / 2) / half_diag
    ny = (yy - oh / 2) / half_diag
    r2 = nx ** 2 + ny ** 2  # 1.0 at the corners

    # Barrel distortion (20mm Nikkor): r_undistorted = r * (1 + k r^2),
    # zoomed so the corners still land inside the frame.
    k1 = 0.045
    zoom = 1.0 / (1.0 + k1)

    # Keystone: bottom of the frame samples a narrower slice of the source,
    # pushing the verticals to converge harder toward the top.
    top_half, bottom_half = 0.94, 0.90  # fraction of source half-width
    cx = sw / 2
    H = homography(
        [(-1, -1), (1, -1), (1, 1), (-1, 1)],
        [
            (cx - top_half * cx, 0),
            (cx + top_half * cx, 0),
            (cx + bottom_half * cx, sh - 1),
            (cx - bottom_half * cx, sh - 1),
        ],
    )

    def source_coords(ca_scale):
        f = zoom * (1.0 + k1 * r2) * ca_scale
        ux = nx * f * half_diag / (ow / 2)  # back to [-1, 1] frame units
        uy = ny * f * half_diag / (oh / 2)
        den = H[2, 0] * ux + H[2, 1] * uy + H[2, 2]
        return (
            (H[0, 0] * ux + H[0, 1] * uy + H[0, 2]) / den,
            (H[1, 0] * ux + H[1, 1] * uy + H[1, 2]) / den,
        )

    # Lateral chromatic aberration: red slightly larger, blue slightly smaller.
    img = np.empty((oh, ow, 3), dtype=np.float32)
    for ch, ca in enumerate((1.0009, 1.0, 0.9991)):
        xs, ys = source_coords(ca)
        img[..., ch] = bilinear_sample(lin[..., ch], xs, ys)

    # Corner softness: wide-open 20mm is soft toward the edges.
    soft = gaussian_blur(img, 1.6 * SCALE / 2)
    edge = np.clip(r2 - 0.25, 0, None)[..., None] / 0.75
    img = img * (1 - 0.7 * edge) + soft * 0.7 * edge

    # Overall film/scan softness.
    img = img * 0.55 + gaussian_blur(img, 0.9) * 0.45

    # Halation (light scattering off the film base, red-orange) and bloom.
    lum = img @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    hot = np.clip((lum - 0.35) / 0.65, 0, None)[..., None] * img
    halo_tight = gaussian_blur(hot, 4 * SCALE)
    halo_wide = gaussian_blur(hot, 18 * SCALE)
    img += (halo_tight * 0.9 + halo_wide * 0.6) * np.array([1.0, 0.38, 0.12], np.float32)
    img += gaussian_blur(hot, 40 * SCALE) * np.array([0.35, 0.28, 0.2], np.float32)

    # Light falloff wide open (~0.7 stop in the corners).
    img *= (1.0 - 0.38 * r2 ** 1.1)[..., None]

    # Slight overexposure, as you'd rate Portra 400 at box speed in dull light.
    img *= 1.12

    # ---- Portra 400 rendering (display space) ----
    v = linear_to_srgb(img)

    # Highlight shoulder: roll off instead of clipping.
    v = np.where(v > 0.75, 0.75 + 0.25 * np.tanh((v - 0.75) / 0.25), v)

    # Gentle midtone S, then lifted blacks / pulled whites (scan levels).
    v = v - 0.08 * np.sin(2 * np.pi * v) / (2 * np.pi)
    v = 0.045 + v * (0.965 - 0.045)

    # Muted saturation, but keep warm hues a little richer.
    L = (v @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))[..., None]
    warmth = np.clip((v[..., :1] - v[..., 2:3]) * 4, 0, 1)
    sat = 0.82 + 0.12 * warmth
    v = L + (v - L) * sat

    # Split tone: cool-green shadows, warm highlights.
    ws = (1 - L) ** 2
    wh = L ** 2
    v += ws * np.array([-0.018, 0.004, 0.014], np.float32)
    v += wh * np.array([0.03, 0.01, -0.025], np.float32)

    # ---- Grain ----
    L = np.clip(v @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32), 0, 1)
    fine = gaussian_blur(RNG.standard_normal((oh, ow)).astype(np.float32), 0.7)
    coarse = gaussian_blur(RNG.standard_normal((oh, ow)).astype(np.float32), 1.8)
    fine /= fine.std()
    coarse /= coarse.std()
    lum_grain = 0.75 * fine + 0.25 * coarse
    amp = 0.019 * (0.55 + 1.1 * np.exp(-(((L - 0.35) / 0.32) ** 2)))
    v += (lum_grain * amp)[..., None]

    chroma = gaussian_blur(RNG.standard_normal((oh, ow, 3)).astype(np.float32), 1.4)
    chroma /= chroma.std()
    v += chroma * 0.005

    out = (np.clip(v, 0, 1) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(out).save(out_path, quality=94, subsampling=0)
    print(f"wrote {out_path} ({ow}x{oh})")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
