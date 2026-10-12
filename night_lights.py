"""Night pre-pass: makes rendered night lighting behave like real light on film.

  - every lit window gets its own light: tungsten, warm-white, fluorescent
    or cold LED, at its own brightness, with a few nearly dark
  - neon and other strongly coloured lights are left their own colour
  - the CG navy sky becomes the murky, light-polluted brown-grey a city
    sky records as on daylight-balanced colour negative film

Also exports light_mask(), which the weathering pass uses to keep stains
off every light source, whatever its colour.
"""

import numpy as np

from film_emulation import gaussian_blur

LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

# Daylight-balanced film under each light type (multipliers on the source).
WINDOW_LIGHTS = (
    (0.45, np.array([1.06, 0.80, 0.52], np.float32)),  # tungsten
    (0.25, np.array([1.03, 0.92, 0.76], np.float32)),  # warm-white LED
    (0.18, np.array([0.86, 1.02, 0.86], np.float32)),  # fluorescent
    (0.12, np.array([0.90, 0.96, 1.04], np.float32)),  # cold LED
)


def light_mask(rgb):
    """Soft mask of emissive pixels: anything clearly brighter than its
    surroundings, very bright, or a bright saturated colour (neon)."""
    L = rgb @ LUMA
    local = L - gaussian_blur(L, 6)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    m = np.maximum.reduce([
        np.clip((local - 0.08) / 0.12, 0, 1) * np.clip((L - 0.2) / 0.2, 0, 1),
        np.clip((L - 0.75) / 0.15, 0, 1),
        np.clip((chroma - 0.25) / 0.2, 0, 1) * np.clip((L - 0.12) / 0.15, 0, 1),
    ])
    return m.astype(np.float32)


def _label_components(mask, iterations=80):
    """4-connected component labels by min-label propagation (-1 = background)."""
    h, w = mask.shape
    big = np.int32(h * w)
    labels = np.where(mask, np.arange(h * w, dtype=np.int32).reshape(h, w), big)
    for _ in range(iterations):
        prev = labels
        nb = labels.copy()
        nb[1:] = np.minimum(nb[1:], labels[:-1])
        nb[:-1] = np.minimum(nb[:-1], labels[1:])
        nb[:, 1:] = np.minimum(nb[:, 1:], labels[:, :-1])
        nb[:, :-1] = np.minimum(nb[:, :-1], labels[:, 1:])
        labels = np.where(mask, nb, big)
        if np.array_equal(labels, prev):
            break
    return np.where(mask, labels, -1)


def _hash01(labels, salt):
    """Deterministic pseudo-random value in [0, 1) per label."""
    x = np.sin(labels.astype(np.float64) * 12.9898 + salt * 78.233) * 43758.5453
    return (x - np.floor(x)).astype(np.float32)


def split_lights(rgb):
    """(window, neon) soft masks. Windows are neutral or warm (r >= g >= b,
    yellow-orange hue); neon is any other saturated light, e.g. the red
    signs (g < b) and the cyan one (r < b)."""
    lights = light_mask(rgb)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(axis=2)
    sat = (mx - rgb.min(axis=2)) / np.maximum(mx, 1e-3)
    neutral = np.clip((0.2 - sat) / 0.1, 0, 1)
    warm = ((r >= g) & (g >= b - 0.01) & ((g - b) >= 0.3 * (r - b))).astype(np.float32)
    window_hue = np.maximum(neutral, warm)
    neon = lights * (1 - window_hue) * np.clip((sat - 0.25) / 0.15, 0, 1)
    # Keep clear of neon so its white-hot cores are not taken for windows.
    near_neon = np.clip(gaussian_blur(neon, 4) * 4, 0, 1)
    window = lights * window_hue * (1 - near_neon)
    return window, neon


def vary_windows(rgb):
    window, _ = split_lights(rgb)
    labels = _label_components(window > 0.35)

    pick = _hash01(labels, 1)
    tint = np.ones_like(rgb)
    edge = 0.0
    for share, colour in WINDOW_LIGHTS:
        sel = (pick >= edge) & (pick < edge + share)
        tint[sel] = colour
        edge += share
    level = np.exp(0.35 * (_hash01(labels, 2) * 2 - 1) * 1.7)
    level = np.where(_hash01(labels, 3) < 0.06, 0.3, level)  # a few lights off
    gain = tint * level[..., None]
    gain[labels < 0] = 1.0

    # Feather the change so it follows the glow rather than hard pixel edges.
    amount = gaussian_blur(window, 1.2)[..., None]
    gain = gaussian_blur(gain, 1.5)
    return rgb * (1 - amount) + rgb * gain * amount


def grade_sky(rgb):
    """Light-polluted city sky: low-detail, bluish, open to the top edge."""
    h, w = rgb.shape[:2]
    L = rgb @ LUMA
    hp = L - gaussian_blur(L, 2.0)
    detail = np.sqrt(np.maximum(gaussian_blur(hp ** 2, 6), 0))
    # Sky is distinctly blue for its brightness ((b - r) / L around 0.5-0.7);
    # the dark concrete is close to neutral (under 0.2).
    blueness = (rgb[..., 2] - rgb[..., 0]) / np.maximum(L, 0.02)
    sky = (
        np.clip((blueness - 0.25) / 0.15, 0, 1)
        * np.clip((0.04 - detail) / 0.02, 0, 1)
        * np.clip((L - 0.015) / 0.03, 0, 1)
        * np.clip(1.3 - np.arange(h, dtype=np.float32)[:, None] / (0.5 * h), 0, 1)
    )
    # Keep only large connected regions: the open sky is a few big pieces
    # between the bridges; bluish specks on hazy towers are not sky.
    q = 4
    small = sky[: h // q * q, : w // q * q].reshape(h // q, q, w // q, q).mean(axis=(1, 3))
    labels = _label_components(small > 0.5, iterations=600)
    ids, counts = np.unique(labels[labels >= 0], return_counts=True)
    keep = np.isin(labels, ids[counts * q * q > 0.004 * h * w])
    keep = np.repeat(np.repeat(keep, q, axis=0), q, axis=1).astype(np.float32)
    keep = np.pad(keep, ((0, h - keep.shape[0]), (0, w - keep.shape[1])), mode="edge")
    sky = sky * gaussian_blur(keep, 6)
    sky = gaussian_blur(sky, 4)[..., None]
    # Keep the cloud structure, swap the colour, lift it a touch (sky glow).
    murk = np.array([1.12, 1.0, 0.86], np.float32) * L[..., None] * 1.35
    return rgb * (1 - sky) + murk * sky, sky[..., 0]


def prepare_night(rgb):
    rgb = vary_windows(rgb)
    rgb, _ = grade_sky(rgb)
    return np.clip(rgb, 0, 1)
