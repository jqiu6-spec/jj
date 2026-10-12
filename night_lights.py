"""Night pre-pass: makes rendered night lighting behave like real light on film.

  - every lit window gets its own light: tungsten, warm-white, fluorescent
    or cold LED, at its own brightness, some with blinds or curtains;
    lamps, headlights and other clipped emitters are left alone
  - neon and other strongly coloured lights are left their own colour
  - the CG navy sky becomes the murky, light-polluted brown-grey a city
    sky records as on daylight-balanced colour negative film

Also exports light_mask(), which the weathering pass uses to keep stains
off every light source, whatever its colour.
"""

import numpy as np

from film_emulation import gaussian_blur

LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

# Daylight-balanced film under each light type: (share, colour). The colour
# is normalized to unit luminance when applied, so it shifts hue only.
WINDOW_LIGHTS = (
    (0.40, np.array([1.06, 0.80, 0.52], np.float32)),  # tungsten
    (0.23, np.array([1.03, 0.92, 0.76], np.float32)),  # warm-white LED
    (0.22, np.array([0.86, 1.02, 0.86], np.float32)),  # fluorescent
    (0.15, np.array([0.90, 0.96, 1.04], np.float32)),  # cold LED
)
TUBE_PICK = 0.63  # tubes draw only from the fluorescent / cold LED share


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


def _label_components(mask, iterations=400):
    """4-connected component labels by min-label propagation (-1 = background).

    Each label is the flat index of a pixel in the same component, so after
    every step a label can jump to that pixel's label, which converges in
    far fewer steps than plain propagation.
    """
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
        flat = np.where(mask, nb, big).ravel()
        inside = flat < big
        flat[inside] = flat[flat[inside]]
        labels = flat.reshape(h, w)
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
    h, w = window.shape
    L = rgb @ LUMA
    # Label whole windows: close mullions and the dim centres of big panes,
    # so that each window gets one light rather than several.
    seed = gaussian_blur((window > 0.15).astype(np.float32), 2.5) > 0.2
    labels = _label_components(seed)
    inside = labels >= 0
    ids, inv = np.unique(labels[inside], return_inverse=True)
    n = len(ids)
    ys, xs = np.nonzero(inside)
    area = np.bincount(inv, minlength=n)
    y0 = np.full(n, h)
    y1 = np.zeros(n, dtype=np.int64)
    x0 = np.full(n, w)
    x1 = np.zeros(n, dtype=np.int64)
    peak = np.zeros(n, dtype=np.float32)
    np.minimum.at(y0, inv, ys)
    np.maximum.at(y1, inv, ys)
    np.minimum.at(x0, inv, xs)
    np.maximum.at(x1, inv, xs)
    np.maximum.at(peak, inv, rgb.min(axis=2)[inside])
    tall, wide = y1 - y0 + 1, x1 - x0 + 1

    def draw(salt):
        return _hash01(ids, salt)

    # Windows close together (a train carriage, an office floor) share one
    # lighting system: group them through a wider dilation.
    groups = _label_components(gaussian_blur(seed.astype(np.float32), 8) > 0.15)
    grp = np.zeros(n, dtype=np.int64)
    grp[inv] = groups[ys, xs]
    _, grp_inv, members = np.unique(grp, return_inverse=True, return_counts=True)
    members = members[grp_inv]
    grouped = members >= 8
    own = (draw(6) < 0.1) & (members < 30)  # the odd room on its own lamp

    # What is not a window keeps its own light: clipped point emitters
    # (lamps, headlights) and big clipped glows, tiny points, thin strips,
    # specular rims along edges, and soft pools of lamp light on walls.
    fill = area / (tall * wide)
    tube = (np.maximum(tall, wide) > 3 * np.minimum(tall, wide)) & (area < 600)
    rim = (fill < 0.35) & ~tube
    thin = (np.minimum(tall, wide) <= 4) & ~tube
    pool = (area > 1500) & (peak < 0.8)
    clipped_lamp = (peak > 0.9) & (~grouped | (area >= 1200))
    fixed = clipped_lamp | (area < 60) | rim | thin | pool
    # Rooms come in arrays: room details only on grouped, window-sized shapes.
    room = grouped & (area > 120) & (area < 1200) & ~tube & ~fixed

    # Light type, shared more widely than the grouping above: one train, or
    # one building's cluster of floors, has one lighting system.
    sys_map = _label_components(gaussian_blur(seed.astype(np.float32), 14) > 0.15)
    system = np.zeros(n, dtype=np.int64)
    system[inv] = sys_map[ys, xs]
    # Thin bars are tubes: fluorescent or cold LED only.
    pick = np.where(grouped & ~own, _hash01(system, 1), draw(1))
    pick = np.where(tube, TUBE_PICK + (1 - TUBE_PICK) * draw(1), pick)
    tint = np.ones((n, 3), dtype=np.float32)
    edge = 0.0
    for share, colour in WINDOW_LIGHTS:
        tint[(pick >= edge) & (pick < edge + share)] = colour / (colour @ LUMA)
        edge += share

    # Brightness: x0.74 to x1.35, or within +-0.3 stop inside a group.
    level = np.exp(np.where(grouped, 0.2, 0.3) * (draw(2) * 2 - 1))
    tail = draw(3)
    level = np.where(tail < 0.08, level * 1.6, level)  # a few blazing
    level = np.where((tail > 0.88) & (area > 150), level * 0.45, level)  # curtains
    level = np.where((tail > 0.80) & (tail <= 0.88) & (area > 150), level * 0.18, level)  # nearly off

    # The render repeats one interior in every window (a dark notch on the
    # sill). Light the notch in about half the rooms, as an open room would.
    rgb = rgb.copy()
    lit_sum = np.zeros((n, 3))
    np.add.at(lit_sum, inv, rgb[inside])
    lit_mean = lit_sum / area[:, None]
    mean_L = lit_mean @ LUMA
    for i in np.nonzero(room & (draw(13) < 0.5))[0]:
        ya, yb, xa, xb = y0[i] + 3, y1[i] - 2, x0[i] + 3, x1[i] - 2
        if yb <= ya or xb <= xa:
            continue
        block = rgb[ya:yb, xa:xb]
        lit = (block @ LUMA) >= 0.55 * mean_L[i]
        # The notch is enclosed by the window's light on the left, right and
        # top; the wall around the window and gaps between windows are not.
        enclosed = (
            np.maximum.accumulate(lit, axis=1)
            & np.maximum.accumulate(lit[:, ::-1], axis=1)[:, ::-1]
            & np.maximum.accumulate(lit, axis=0)
        )
        block[enclosed & ~lit] = lit_mean[i] * (0.6 + 0.3 * draw(14)[i])

    g = tint[inv] * level[inv][:, None]
    blind = room & (draw(4) < 0.3)
    blind_to = y0 + (0.2 + 0.4 * draw(5)) * tall  # blind pulled down to here
    g[blind[inv] & (ys < blind_to[inv])] *= 0.45
    # Something in the room blocks part of the light: furniture on the sill
    # (a block) or a person (head and shoulders), different in every window.
    occl = room & (draw(7) < 0.6)
    person = draw(15) < 0.5
    occl_w = np.where(person, 0.35 + 0.2 * draw(8), 0.3 + 0.3 * draw(8)) * wide
    occl_h = np.where(person, 0.4 + 0.2 * draw(9), 0.2 + 0.25 * draw(9)) * tall
    occl_x0 = x0 + draw(10) * (wide - occl_w)
    occl_top = y1 - occl_h
    dx = (xs - (occl_x0 + occl_w / 2)[inv]) / (occl_w[inv] / 2)
    dy = (ys - occl_top[inv]) / occl_h[inv]
    in_box = (np.abs(dx) < 1) & (dy > 0)
    shoulders = dy > 0.45
    head = ((dx / 0.45) ** 2 + ((dy - 0.25) / 0.22) ** 2) < 1
    shape = np.where(person[inv], (shoulders & in_box) | head, in_box)
    hit = occl[inv] & shape
    dim = np.where(person, 0.3 + 0.2 * draw(11), 0.4 + 0.3 * draw(11))
    g[hit] *= dim[inv][hit][:, None]
    # Light falls off across each room differently.
    slope = np.where(room, 0.35 * (draw(12) * 2 - 1), 0.0)
    g *= (1 + slope[inv] * (ys - (y0 + y1)[inv] / 2) / tall[inv])[:, None]
    g[fixed[inv]] = 1.0
    # Specular rims are the render's rim light: break them up and dim them,
    # as reflected interior light would be.
    breakup = gaussian_blur(np.random.default_rng(11).standard_normal((h, w)).astype(np.float32), 25)
    breakup = 0.675 + 0.325 * np.clip(breakup / breakup.std(), -1, 1)
    on_rim = rim[inv]
    g[on_rim] = (0.75 * breakup[ys[on_rim], xs[on_rim]])[:, None]

    # Spread each window's gain a few pixels past its label by normalized
    # convolution, so a dimmed window takes its own darkness right to the
    # edge of its glow instead of keeping a bright rim.
    m = inside.astype(np.float32)
    field = np.zeros_like(rgb)
    field[inside] = g
    num = gaussian_blur(field, 1.5)
    den = gaussian_blur(m, 1.5)[..., None]
    reach = gaussian_blur(m, 2.0) > 0.1
    gain = np.where(den > 0.02, num / np.maximum(den, 0.02), 1.0)
    gain[~reach] = 1.0
    L = rgb @ LUMA  # after the notch fill
    amount = gaussian_blur((reach & (L > 0.08)).astype(np.float32), 1.2)[..., None]
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
    rows = np.arange(h, dtype=np.float32)[:, None]
    floor = np.clip((L - 0.004) / 0.01, 0, 1)
    sky = (
        np.clip((blueness - 0.25) / 0.15, 0, 1)
        * np.clip((0.04 - detail) / 0.02, 0, 1)
        * floor
        * np.clip((0.45 * h - rows) / (0.08 * h), 0, 1)
    )
    # Keep only large connected regions: the open sky is a few big pieces
    # between the bridges; bluish specks on hazy towers are not sky.
    q = 4
    small = sky[: h // q * q, : w // q * q].reshape(h // q, q, w // q, q).mean(axis=(1, 3))
    labels = _label_components(small > 0.5, iterations=600)
    ids, counts = np.unique(labels[labels >= 0], return_counts=True)
    keep = np.isin(labels, ids[counts * q * q > 0.0006 * h * w])
    keep = np.repeat(np.repeat(keep, q, axis=0), q, axis=1).astype(np.float32)
    keep = np.pad(keep, ((0, h - keep.shape[0]), (0, w - keep.shape[1])), mode="edge")
    # Grow into the edges and fill holes, then test only the colour there, so
    # the regrade reaches the tower silhouettes without a navy fringe.
    region = gaussian_blur(keep, 6) > 0.2
    sky = np.clip((blueness - 0.15) / 0.15, 0, 1) * floor * region
    sky = gaussian_blur(sky.astype(np.float32), 4)[..., None]
    # Light-polluted glow: warm brown-grey, brighter than the towers, with
    # the cloud contrast kept (even raised a bit).
    # Cloud structure from a slightly smoothed luminance: the dark source sky
    # has few code values, and the gain below would turn them into steps.
    Ls = gaussian_blur(L, 2.0)
    m = float((Ls * sky[..., 0]).sum() / max(float(sky.sum()), 1.0))
    clouds = np.maximum(m + 1.3 * (Ls - m), 0)
    # Brightest at the top of the gap. Deeper into the canyon the sky shows
    # only as narrow slots between bridges, a little above the towers.
    glow = 2.2 - 1.0 * np.clip((rows - 0.1 * h) / (0.25 * h), 0, 1)
    hue = np.array([1.22, 1.0, 0.78], np.float32)
    murk = hue * (clouds * glow)[..., None]
    out = rgb * (1 - sky) + murk * sky
    # Skyglow scattered in the canyon air: a faint warm haze on the towers
    # nearest the open sky, fading with distance from it.
    haze = gaussian_blur(sky[..., 0], 120)
    haze = haze / max(float(haze.max()), 1e-6)
    out = out + (0.012 * haze * (1 - sky[..., 0]))[..., None] * hue
    return out, sky[..., 0]


def prepare_night(rgb):
    """Returns the prepared image and the sky mask."""
    rgb = vary_windows(rgb)
    rgb, sky = grade_sky(rgb)
    return np.clip(rgb, 0, 1), sky
