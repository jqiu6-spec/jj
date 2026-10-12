"""Film-emulation pass: Nikon F3 + 20mm f/2.8 on Kodak Portra 400.

Re-photographs a rendered image as a 35mm colour-negative scan:
  - 2:3 35mm frame, keystone for a little extra convergence of the verticals
  - slight barrel distortion, lateral chromatic aberration, corner softness
  - wide-open light falloff (vignetting)
  - red-orange halation and bloom around light sources
  - Portra-style tone curve: lifted blacks, soft shoulder, muted saturation,
    cool shadows / warm highlights
  - luminance-dependent grain with fine dye-cloud colour noise

Concrete weathering (concrete_weathering.py) runs first unless --no-weather.
--night uses the night profile, after the night pre-pass (night_lights.py).

Usage: python3 film_emulation.py [--night] [--no-weather] input.webp output.jpg
"""

import argparse

import numpy as np
from PIL import Image

RNG = np.random.default_rng(400)  # fixed seed so the grain is reproducible
SCALE = 2  # scan resolution relative to the source

# Exposure, light and scan settings per lighting condition.
PROFILES = {
    # Overcast dusk, Portra 400 at box speed.
    "dusk": dict(
        exposure=1.12,
        halo_threshold=0.35, halo_tight=0.9, halo_wide=0.6,
        bloom=(0.35, 0.28, 0.2), air_glow=0.0,
        vignette=0.38,
        shadow_gamma=1.0, black=0.045, white=0.965,
        sat=0.82, warm_sat=0.12,
        shadow_tone=(-0.018, 0.004, 0.014), highlight_tone=(0.03, 0.01, -0.025),
        grain=0.019, grain_centre=0.35, chroma_grain=0.005,
    ),
    # Handheld at night, wide open: exposed for the lights, so unlit concrete
    # sits low on the film's toe and scans as grainy near-black; lights
    # bloom in their own colour and halate red.
    "night": dict(
        exposure=1.4,
        hot_channel="max", halo_source="red",
        halo_threshold=0.3, halo_tight=0.5, halo_wide=0.35,
        bloom=(0.22, 0.18, 0.14), air_glow=0.03,
        lens_glow=(0.35, 0.18), neon_boost=2.0, neon_sat=0.35,
        vignette=0.6, vignette_power=1.0,
        ca_scales=(1.0005, 1.0, 0.9995),
        # Frame shifted left so the train nose and the ショクドウ sign stay in,
        # with the extra keystone taken on the right.
        frame=((0.0, 0.0), (1.0, 0.0), (0.9242, 1.0), (0.01706, 1.0)),
        shadow_gamma=1.06, black=0.036, white=0.97,
        sat=0.86, warm_sat=0.14,
        shadow_tone=(-0.008, 0.006, 0.004), highlight_tone=(0.03, 0.008, -0.025),
        grain=0.022, grain_centre=0.2, chroma_grain=0.009,
        grain_sigma=(0.9, 2.2), grain_floor_taper=True, chroma_shadow=True,
    ),
}


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


def main(src_path, out_path, weather=True, profile="dusk"):
    P = PROFILES[profile]
    src = Image.open(src_path).convert("RGB")
    sw, sh = src.size
    src = src.resize((sw * SCALE, sh * SCALE), Image.LANCZOS)
    rgb = np.asarray(src, dtype=np.float32) / 255.0
    lights = neon = None
    weather_opts = {}
    if profile == "night":
        from night_lights import light_mask, prepare_night, split_lights

        lights = light_mask(rgb)
        _, neon = split_lights(rgb)
        rgb = prepare_night(rgb)
        # Unlit concrete still has some texture worth keeping at night.
        weather_opts = dict(min_surface=0.45, texture_gain=1.5)
    if weather:
        from concrete_weathering import weather as apply_weathering

        rgb = apply_weathering(rgb, lights=lights, **weather_opts)
    lin = srgb_to_linear(rgb)
    if neon is not None and P.get("neon_boost"):
        # Neon tubes are far brighter than the render's display white; give
        # them that headroom so they bloom in their own colour. Each channel
        # is boosted by its share of the strongest one, so a red tube grows
        # redder rather than drifting to salmon, and cyan stays cyan.
        share = lin / np.maximum(lin.max(axis=2, keepdims=True), 1e-4)
        lin = lin * (1 + P["neon_boost"] * neon[..., None] * share)
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
    if "frame" in P:
        # Source quad for the frame corners (TL, TR, BR, BL) as fractions.
        dst = [(fx * sw, fy * (sh - 1)) for fx, fy in P["frame"]]
    else:
        top_half, bottom_half = 0.94, 0.90  # fraction of source half-width
        cx = sw / 2
        dst = [
            (cx - top_half * cx, 0),
            (cx + top_half * cx, 0),
            (cx + bottom_half * cx, sh - 1),
            (cx - bottom_half * cx, sh - 1),
        ]
    H = homography([(-1, -1), (1, -1), (1, 1), (-1, 1)], dst)

    def source_coords(ca_scale):
        f = zoom * (1.0 + k1 * r2) * ca_scale
        ux = nx * f * half_diag / (ow / 2)  # back to [-1, 1] frame units
        uy = ny * f * half_diag / (oh / 2)
        den = H[2, 0] * ux + H[2, 1] * uy + H[2, 2]
        return (
            (H[0, 0] * ux + H[0, 1] * uy + H[0, 2]) / den,
            (H[1, 0] * ux + H[1, 1] * uy + H[1, 2]) / den,
        )

    # Lateral chromatic aberration: red is sampled from slightly further out,
    # so the red image is slightly smaller; blue the reverse.
    img = np.empty((oh, ow, 3), dtype=np.float32)
    for ch, ca in enumerate(P.get("ca_scales", (1.0009, 1.0, 0.9991))):
        xs, ys = source_coords(ca)
        img[..., ch] = bilinear_sample(lin[..., ch], xs, ys)
    neon_w = None
    if neon is not None:
        neon_w = np.clip(bilinear_sample(neon, *source_coords(1.0)), 0, 1)[..., None]

    # Corner softness: wide-open 20mm is soft toward the edges.
    soft = gaussian_blur(img, 1.6 * SCALE / 2)
    edge = np.clip(r2 - 0.25, 0, None)[..., None] / 0.75
    img = img * (1 - 0.7 * edge) + soft * 0.7 * edge

    # Overall film/scan softness.
    img = img * 0.55 + gaussian_blur(img, 0.9) * 0.45

    # Halation (light scattering off the film base, red-orange) and bloom.
    if P.get("hot_channel") == "max":
        # Any strongly exposed dye layer counts, so saturated neon blooms too.
        lum = img.max(axis=2)
    else:
        lum = img @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    t = P["halo_threshold"]
    hot = np.clip((lum - t) / (1 - t), 0, None)[..., None] * img
    # Halation re-exposes the red-sensitive layer from light bounced off the
    # film base, so physically it is driven by the red light alone.
    halo_src = hot[..., :1] if P.get("halo_source") == "red" else hot
    halo_tight = gaussian_blur(halo_src, 4 * SCALE)
    halo_wide = gaussian_blur(halo_src, 18 * SCALE)
    img += (halo_tight * P["halo_tight"] + halo_wide * P["halo_wide"]) * np.array([1.0, 0.38, 0.12], np.float32)
    img += gaussian_blur(hot, 40 * SCALE) * np.array(P["bloom"], np.float32)
    if P.get("lens_glow"):
        # Wide-open spherical aberration: a soft glow in each light's own colour.
        near, far = P["lens_glow"]
        img += gaussian_blur(hot, 3 * SCALE) * near + gaussian_blur(hot, 8 * SCALE) * far
    if P["air_glow"]:
        # Light scattered by haze in the night air: a wide, faint glow
        # around the brightest parts of the frame.
        img += gaussian_blur(hot, 130 * SCALE) * P["air_glow"] * 4

    # Light falloff wide open (~0.7 stop in the corners).
    img *= (1.0 - P["vignette"] * r2 ** P.get("vignette_power", 1.1))[..., None]

    # Exposure relative to the render.
    img *= P["exposure"]

    # ---- Portra 400 rendering (display space) ----
    v = linear_to_srgb(img)
    if P["shadow_gamma"] != 1.0:
        # Above 1 this is the film's toe: deep shadows compress toward the
        # scan's black floor instead of opening up.
        v = v ** P["shadow_gamma"]

    # Highlight shoulder: roll off instead of clipping.
    v = np.where(v > 0.75, 0.75 + 0.25 * np.tanh((v - 0.75) / 0.25), v)

    # Gentle midtone S, then lifted blacks / pulled whites (scan levels).
    v = v - 0.08 * np.sin(2 * np.pi * v) / (2 * np.pi)
    v = P["black"] + v * (P["white"] - P["black"])

    # Muted saturation, but keep warm hues a little richer.
    L = (v @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))[..., None]
    warmth = np.clip((v[..., :1] - v[..., 2:3]) * 4, 0, 1)
    sat = P["sat"] + P["warm_sat"] * warmth
    if neon_w is not None:
        sat = sat + P["neon_sat"] * neon_w
    v = L + (v - L) * sat

    # Split tone: cool-green shadows, warm highlights.
    ws = (1 - L) ** 2
    wh = L ** 2
    if neon_w is not None:
        wh = wh * (1 - neon_w)  # neon keeps its own hue
    v += ws * np.array(P["shadow_tone"], np.float32)
    v += wh * np.array(P["highlight_tone"], np.float32)

    # ---- Grain ----
    L = np.clip(v @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32), 0, 1)
    fine_sigma, coarse_sigma = P.get("grain_sigma", (0.7, 1.8))
    fine = gaussian_blur(RNG.standard_normal((oh, ow)).astype(np.float32), fine_sigma)
    coarse = gaussian_blur(RNG.standard_normal((oh, ow)).astype(np.float32), coarse_sigma)
    fine /= fine.std()
    coarse /= coarse.std()
    lum_grain = 0.75 * fine + 0.25 * coarse
    amp = P["grain"] * (0.55 + 1.1 * np.exp(-(((L - P["grain_centre"]) / 0.32) ** 2)))
    taper = 1.0
    if P.get("grain_floor_taper"):
        # Thin the grain near the scan's black floor instead of clipping it.
        taper = np.clip((L - 0.5 * P["black"]) / (2 * P["black"]), 0.4, 1.0)
        amp = amp * taper
    v += (lum_grain * amp)[..., None]

    chroma = gaussian_blur(RNG.standard_normal((oh, ow, 3)).astype(np.float32), 1.4)
    chroma /= chroma.std()
    if P.get("chroma_shadow"):
        # Dye-cloud colour mottling shows most in the thin, shadow areas.
        v += chroma * P["chroma_grain"] * ((1.4 - L) * taper)[..., None]
    else:
        v += chroma * P["chroma_grain"]

    out = (np.clip(v, 0, 1) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(out).save(out_path, quality=94, subsampling=0)
    print(f"wrote {out_path} ({ow}x{oh})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--no-weather", action="store_true", help="skip the concrete weathering pass")
    parser.add_argument("--night", action="store_true", help="night profile and night pre-pass")
    args = parser.parse_args()
    main(args.input, args.output, weather=not args.no_weather, profile="night" if args.night else "dusk")
