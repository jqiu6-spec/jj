#!/usr/bin/env python3
"""Extract a clean, perceptually balanced color palette from photographs.

Pipeline
--------
1. Decode the image (EXIF-rotated, alpha-aware) and downsample it.
2. Bin pixels to 15-bit color and convert the bins to OKLab, a perceptual
   color space in which Euclidean distance tracks how different two colors
   look.
3. Over-cluster with weighted k-means++ so small but meaningful accents
   survive, then rebuild each cluster's color from its core members with the
   chroma that plain averaging washes out (averaging is what makes naive
   photo palettes look muddy).
4. Merge near-duplicates and greedily pick a diverse set ranked by visual
   salience (coverage balanced against colorfulness).
5. Apply a finishing style (natural / clean / vivid / muted), map back into
   the sRGB gamut, name the colors and assign UI roles.

Usage
-----
    python3 palette.py photo.jpg
    python3 palette.py photo.jpg -n 6 --style vivid --format css
    python3 palette.py a.jpg b.jpg --preview board.png   # one palette for a moodboard

Requires Pillow and NumPy (`pip install pillow numpy`).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Sequence

try:
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps
except ImportError as exc:  # pragma: no cover - exercised only without deps
    # install.sh may have put the packages in a private environment; when this
    # file (or the MCP server) was started with another Python, hand over to it.
    _venv = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex") / "photo-palette-venv"
    for _py in (_venv / "bin" / "python", _venv / "Scripts" / "python.exe"):
        if (_py.exists() and sys.argv and os.path.isfile(sys.argv[0])
                and not os.environ.get("PHOTO_PALETTE_REEXEC")):
            os.environ["PHOTO_PALETTE_REEXEC"] = "1"
            os.execv(str(_py), [str(_py), *sys.argv])
    sys.stderr.write(
        f"photo-palette needs Pillow and NumPy ({exc}).\n"
        "Repair the install with:  bash ~/.codex/photo-palette-marketplace/install.sh\n"
        "or install them:  python3 -m pip install --user pillow numpy\n"
        "(Homebrew Python: add --break-system-packages, or run: brew install numpy pillow)\n"
    )
    raise SystemExit(2)

__version__ = "0.2.0"

# Pillow < 9.1 has the resampling filters on Image itself.
_RESAMPLE = getattr(Image, "Resampling", Image)

STYLES = ("clean", "natural", "vivid", "muted")
SORTS = ("weight", "lightness", "hue")
FORMATS = ("text", "json", "css", "scss", "tailwind", "gpl", "svg")

MAX_SIDE = 384          # analysis resolution; keeps small details, still fast
NEUTRAL_CHROMA = 0.035  # OKLCh chroma below which a color reads as gray
EDGE_THR, EDGE_FLOOR = 0.025, 0.1  # down-weighting of edge (blend) pixels
K_MIN, K_PER = 24, 3    # k-means clusters: max(K_MIN, K_PER * count)
SEED_POW = 0.25         # k-means++ seeding ~ weight**SEED_POW: distinct small colors get seeds too
MERGE_DIST = 0.035      # clusters closer than this (OKLab) are one color
MIN_WEIGHT = 0.002      # clusters lighter than this are mostly edge blends
# Two colors are compared with lightness counting half: shading, vignetting and
# light falloff change lightness, so a darker patch of the same wall is not a
# new color, while a change of hue or saturation is.
L_WEIGHT = 0.5
NEUTRAL_FLOOR = 0.05    # gray vs tinted is always at least this far apart
MIN_SEPARATION = 0.05   # picks closer than this are duplicates
DIVERSITY_SCALE = 0.16  # picks closer than this are discounted, not excluded
CONSOLIDATE = 0.06      # shading variants within this distance fold into a pick
AUTO_MIN, AUTO_MAX = 4, 12  # palette size range for count="auto"
AUTO_SHARE = 0.005      # a distinct color is notable from 0.5% of the photo...
AUTO_VIVID = 0.002      # ...or from 0.2% when vivid (chroma >= 0.1)
EXTRAS_MAX = 6          # notable colors reported beyond the palette
EDGE_RATIO = 0.2        # notable colors can't be mostly edge pixels (blends between objects)

# --------------------------------------------------------------------------
# Color math (sRGB <-> OKLab), vectorised over the last axis.
# --------------------------------------------------------------------------

_RGB_TO_LMS = np.array([
    [0.4122214708, 0.5363325363, 0.0514459929],
    [0.2119034982, 0.6806995451, 0.1073969566],
    [0.0883024619, 0.2817188376, 0.6299787005],
])
_LMS_TO_LAB = np.array([
    [0.2104542553, 0.7936177850, -0.0040720468],
    [1.9779984951, -2.4285922050, 0.4505937099],
    [0.0259040371, 0.7827717662, -0.8086757660],
])
_LAB_TO_LMS = np.linalg.inv(_LMS_TO_LAB)
_LMS_TO_RGB = np.linalg.inv(_RGB_TO_LMS)


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * c ** (1 / 2.4) - 0.055)


def srgb_to_oklab(rgb: np.ndarray) -> np.ndarray:
    """sRGB in [0, 1] -> OKLab."""
    lms = srgb_to_linear(rgb) @ _RGB_TO_LMS.T
    return np.cbrt(lms) @ _LMS_TO_LAB.T


def oklab_to_linear(lab: np.ndarray) -> np.ndarray:
    """OKLab -> linear sRGB (unclipped; may be out of gamut)."""
    return (lab @ _LAB_TO_LMS.T) ** 3 @ _LMS_TO_RGB.T


def oklab_to_oklch(lab: np.ndarray) -> np.ndarray:
    lab = np.asarray(lab, dtype=float)
    c = np.hypot(lab[..., 1], lab[..., 2])
    h = np.degrees(np.arctan2(lab[..., 2], lab[..., 1])) % 360
    return np.stack([lab[..., 0], c, h], axis=-1)


def oklch_to_oklab(lch: np.ndarray) -> np.ndarray:
    lch = np.asarray(lch, dtype=float)
    h = np.radians(lch[..., 2])
    return np.stack([lch[..., 0], lch[..., 1] * np.cos(h), lch[..., 1] * np.sin(h)], axis=-1)


def in_gamut(lab: np.ndarray, eps: float = 1e-4) -> bool:
    lin = oklab_to_linear(lab)
    return bool(np.all(lin >= -eps) and np.all(lin <= 1 + eps))


def gamut_map(lch: Sequence[float]) -> np.ndarray:
    """Bring an OKLCh color into sRGB by reducing chroma at constant L and hue."""
    l, c, h = float(np.clip(lch[0], 0.0, 1.0)), float(max(lch[1], 0.0)), float(lch[2])
    if in_gamut(oklch_to_oklab(np.array([l, c, h]))):
        return np.array([l, c, h])
    lo, hi = 0.0, c
    for _ in range(24):
        mid = (lo + hi) / 2
        if in_gamut(oklch_to_oklab(np.array([l, mid, h]))):
            lo = mid
        else:
            hi = mid
    return np.array([l, lo, h])


def oklch_to_rgb8(lch: Sequence[float]) -> tuple[int, int, int]:
    rgb = linear_to_srgb(oklab_to_linear(oklch_to_oklab(np.asarray(lch, dtype=float))))
    r, g, b = (int(round(float(v) * 255)) for v in np.clip(rgb, 0, 1))
    return r, g, b


def rgb8_to_hex(rgb: Sequence[int]) -> str:
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def hex_to_rgb8(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def relative_luminance(rgb8: Sequence[int]) -> float:
    lin = srgb_to_linear(np.asarray(rgb8, dtype=float) / 255)
    return float(lin @ np.array([0.2126, 0.7152, 0.0722]))


def contrast_ratio(a: Sequence[int], b: Sequence[int]) -> float:
    la, lb = relative_luminance(a), relative_luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def rgb8_to_hsl(rgb8: Sequence[int]) -> tuple[int, int, int]:
    r, g, b = (v / 255 for v in rgb8)
    mx, mn = max(r, g, b), min(r, g, b)
    l = (mx + mn) / 2
    if mx == mn:
        return 0, 0, round(l * 100)
    d = mx - mn
    s = d / (2 - mx - mn) if l > 0.5 else d / (mx + mn)
    if mx == r:
        h = (g - b) / d + (6 if g < b else 0)
    elif mx == g:
        h = (b - r) / d + 2
    else:
        h = (r - g) / d + 4
    return round(h * 60) % 360, round(s * 100), round(l * 100)


# --------------------------------------------------------------------------
# Color names: nearest reference color in OKLab.
# --------------------------------------------------------------------------

_NAMED = {
    "white": "#FFFFFF", "ivory": "#F6F1E4", "cream": "#EFE3C8", "sand": "#D8C29D",
    "beige": "#C8B79E", "tan": "#C29B70", "khaki": "#B5A77A", "taupe": "#8B7D70",
    "light gray": "#C9CACC", "silver": "#A8ABAF", "gray": "#7D7F82", "slate": "#5A6470",
    "charcoal": "#36393D", "black": "#121212", "brown": "#6B4A2F", "chocolate": "#4A2E1E", "espresso": "#2E1A12",
    "rust": "#A4471F", "terracotta": "#C8643F", "coral": "#F07F68", "peach": "#F6B89A",
    "salmon": "#E8907A", "red": "#C8202E", "crimson": "#9E1B32", "burgundy": "#6D1A2C",
    "pink": "#F2A7BC", "blush": "#E8C4C4", "rose": "#D46A86", "magenta": "#C2307F",
    "plum": "#6E3B63", "mauve": "#9E7290", "dusty rose": "#C08A8F", "eggplant": "#45324F",
    "lavender": "#B7A8D9", "midnight": "#1E2240", "sienna": "#A0522D", "purple": "#6A3FA0", "indigo": "#33307A",
    "navy": "#1F2C55", "denim": "#3D5A80", "blue": "#2F63C8", "steel blue": "#4F7A9E",
    "sky blue": "#8CC3EA", "powder blue": "#BFD7E6", "teal": "#1E7A78",
    "turquoise": "#3FBFB0", "mint": "#A8DDC0", "sage": "#9AAE8C", "olive": "#707A3A",
    "moss": "#5C6B35", "forest green": "#2E5A35", "green": "#3E9A4A", "lime": "#A5CF3A",
    "lemon": "#F5E77A", "yellow": "#F2D33A", "gold": "#D8AF3A", "mustard": "#CFA230",
    "ochre": "#B7832F", "amber": "#E59A1F", "orange": "#E8742A",
}
_NAME_KEYS = list(_NAMED)
_NAME_LAB = srgb_to_oklab(np.array([hex_to_rgb8(v) for v in _NAMED.values()], dtype=float) / 255)


def color_name(lab: np.ndarray) -> str:
    # Weight hue/chroma above lightness so a dark plum is not called "charcoal".
    d = (_NAME_LAB - lab) * np.array([1.0, 2.0, 2.0])
    return _NAME_KEYS[int(np.argmin(np.linalg.norm(d, axis=1)))]


# --------------------------------------------------------------------------
# Image loading and clustering.
# --------------------------------------------------------------------------


@dataclass
class Swatches:
    """Distinct colors of an image: OKLab coordinates with pixel weights."""

    lab: np.ndarray       # (n, 3)
    weight: np.ndarray    # (n,) clustering weight (edges and clipping discounted)
    coverage: np.ndarray  # (n,) plain fraction of pixels, for reporting shares


def load_swatches(path: str | Path, max_side: int | None = None) -> Swatches:
    """Decode an image into weighted 15-bit color bins in OKLab."""
    max_side = max_side or MAX_SIDE
    with Image.open(path) as img:
        img.draft("RGB", (max_side * 2, max_side * 2))  # fast JPEG downscale
        img = ImageOps.exif_transpose(img)
        if img.mode in ("I;16", "I;16B", "I;16L", "I", "F"):
            img = img.point(lambda v: v * (1 / 256)).convert("L")  # old Pillow: only * and +
        img = img.convert("RGBA")
        img.thumbnail((max_side, max_side), _RESAMPLE.BOX)
        arr = np.asarray(img, dtype=np.uint8)
        smooth = np.asarray(img.convert("RGB").filter(ImageFilter.GaussianBlur(1)), dtype=float)

    # Pixels on edges are blends of two surfaces (red petal + green leaf =
    # brown) rather than colors of the scene. Measure local contrast on a
    # lightly blurred copy, so sensor noise does not count as an edge.
    if min(smooth.shape[:2]) >= 3:
        lab_img = srgb_to_oklab(smooth / 255)
        gy, gx = np.gradient(lab_img, axis=(0, 1))
        grad = np.sqrt((gx ** 2 + gy ** 2).sum(axis=2))
        pixel_w = np.maximum(1 / (1 + (grad / EDGE_THR) ** 2), EDGE_FLOOR).reshape(-1)
    else:  # too small to have edges
        pixel_w = np.ones(smooth.shape[0] * smooth.shape[1])

    arr = arr.reshape(-1, 4)
    opaque = arr[:, 3] >= 128  # ignore transparent pixels
    if not opaque.any():
        raise ValueError(f"{path}: image has no opaque pixels")
    rgb = arr[opaque, :3].astype(np.int64)
    pixel_w = pixel_w[opaque]
    key = (rgb[:, 0] >> 3) << 10 | (rgb[:, 1] >> 3) << 5 | (rgb[:, 2] >> 3)
    uniq, inverse, counts = np.unique(key, return_inverse=True, return_counts=True)
    mean_rgb = np.stack(
        [np.bincount(inverse, weights=rgb[:, i], minlength=len(uniq)) for i in range(3)], axis=1
    ) / counts[:, None]
    lab = srgb_to_oklab(mean_rgb / 255)
    weight = np.bincount(inverse, weights=pixel_w, minlength=len(uniq))
    # Clipped highlights and crushed shadows are sensor artefacts more often
    # than they are colors of the scene: keep them, but let them count less.
    weight[(lab[:, 0] > 0.985) | (lab[:, 0] < 0.04)] *= 0.35
    return Swatches(lab=lab, weight=weight / weight.sum(), coverage=counts / counts.sum())


def kmeans(points: np.ndarray, weights: np.ndarray, k: int, seed: int = 7,
           iterations: int = 60) -> np.ndarray:
    """Weighted k-means with k-means++ seeding. Returns a label per point."""
    n = len(points)
    k = min(k, n)
    rng = np.random.default_rng(seed)
    centers = np.empty((k, points.shape[1]))
    centers[0] = points[int(np.argmax(weights))]
    d2 = np.sum((points - centers[0]) ** 2, axis=1)
    for i in range(1, k):
        p = weights ** SEED_POW * d2
        total = p.sum()
        idx = int(rng.choice(n, p=p / total)) if total > 0 else int(rng.integers(n))
        centers[i] = points[idx]
        d2 = np.minimum(d2, np.sum((points - centers[i]) ** 2, axis=1))

    labels = np.zeros(n, dtype=int)
    for it in range(iterations):
        dist = ((points[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        new_labels = dist.argmin(axis=1)
        if it and np.array_equal(new_labels, labels):
            break
        labels = new_labels
        for j in range(k):
            m = labels == j
            w = weights[m]
            if w.sum() > 0:
                centers[j] = (points[m] * w[:, None]).sum(axis=0) / w.sum()
    return labels


@dataclass
class Cluster:
    lab: np.ndarray
    weight: float          # clustering weight (edges and clipping discounted)
    coverage: float = 0.0  # plain fraction of the image's pixels

    @property
    def lch(self) -> np.ndarray:
        return oklab_to_oklch(self.lab)


def _weighted_quantile(values: np.ndarray, weights: np.ndarray, q: float) -> float:
    order = np.argsort(values)
    cum = np.cumsum(weights[order])
    return float(values[order][np.searchsorted(cum, q * cum[-1])])


def representative(lab: np.ndarray, w: np.ndarray, chroma_q: float) -> np.ndarray:
    """A cluster color that looks like its pixels rather than their average.

    Uses a trimmed mean of the members nearest the centroid, then restores the
    chroma that averaging different hues strips away (the source of "mud").
    """
    center = (lab * w[:, None]).sum(axis=0) / w.sum()
    if len(lab) > 3:
        dist = np.linalg.norm(lab - center, axis=1)
        core = dist <= _weighted_quantile(dist, w, 0.6)
        lab, w = lab[core], w[core]
        center = (lab * w[:, None]).sum(axis=0) / w.sum()
    l, c, h = oklab_to_oklch(center)
    member_c = np.hypot(lab[:, 1], lab[:, 2])
    target_c = _weighted_quantile(member_c, w, chroma_q)
    if c > 0.01:
        c = max(c, min(target_c, c * 1.6))
    return oklch_to_oklab(np.array([l, c, h]))


def find_clusters(sw: Swatches, k: int, chroma_q: float, seed: int) -> list[Cluster]:
    labels = kmeans(sw.lab, sw.weight, k, seed=seed)
    clusters = []
    for j in np.unique(labels):
        m = labels == j
        clusters.append(Cluster(representative(sw.lab[m], sw.weight[m], chroma_q),
                                float(sw.weight[m].sum()), float(sw.coverage[m].sum())))
    clusters.sort(key=lambda c: -c.weight)

    merged: list[Cluster] = []  # heaviest first; absorb close lighter ones
    for c in clusters:
        for m in merged:
            if np.linalg.norm(m.lab - c.lab) < MERGE_DIST:
                m.weight += c.weight
                m.coverage += c.coverage
                break
        else:
            merged.append(Cluster(c.lab.copy(), c.weight, c.coverage))
    return merged


def perceived_distance(a: np.ndarray, b: np.ndarray) -> float:
    """OKLab distance with lightness discounted (shading is not a new color)."""
    d = a - b
    dist = float(np.sqrt((L_WEIGHT * d[0]) ** 2 + d[1] ** 2 + d[2] ** 2))
    # Gray vs tinted (e.g. a warm gray wall vs skin) reads as a different
    # color even when the numbers are close, so never treat it as a duplicate.
    if (np.hypot(a[1], a[2]) < NEUTRAL_CHROMA) != (np.hypot(b[1], b[2]) < NEUTRAL_CHROMA):
        dist = max(dist, NEUTRAL_FLOOR)
    return dist


def salience(c: Cluster) -> float:
    """Coverage balanced with colorfulness: small vivid accents can compete."""
    chroma = float(c.lch[1])
    return math.sqrt(c.weight) * (0.45 + min(chroma / 0.12, 1.6))


def select(clusters: list[Cluster], count: int, neutrals: bool,
           min_sep: float | None = None, relax: bool = True) -> list[Cluster]:
    """Greedy pick: most salient first, then salience discounted by similarity.

    If the photo has too few distinct colors to fill the palette at `min_sep`,
    the separation is relaxed step by step rather than returning fewer colors.
    """
    min_sep = MIN_SEPARATION if min_sep is None else min_sep
    # Negligible clusters are mostly edge blends; keep them only if vivid.
    pool = [c for c in clusters if (neutrals or c.lch[1] >= NEUTRAL_CHROMA)
            and (c.weight >= MIN_WEIGHT or (c.weight >= MIN_WEIGHT / 4 and c.lch[1] >= 0.1))]
    if relax and len(pool) < count:  # an exact count was asked for: use what there is
        pool += [c for c in clusters if not any(c is q for q in pool)
                 and (neutrals or c.lch[1] >= NEUTRAL_CHROMA)]
    if not pool:  # e.g. a black-and-white photo with --no-neutrals
        pool = list(clusters)
    chosen = [max(pool, key=salience)]
    while len(chosen) < min(count, len(pool)):
        best, best_score = None, -1.0
        for c in pool:
            if any(c is s for s in chosen):
                continue
            sep = min(perceived_distance(c.lab, s.lab) for s in chosen)
            if sep < min_sep:
                continue
            score = salience(c) * min(1.0, sep / DIVERSITY_SCALE) ** 2
            if score > best_score:
                best, best_score = c, score
        if best is None:
            if not relax or min_sep <= 0.02:
                break
            min_sep *= 0.7
            continue
        chosen.append(best)
    return chosen


def notable(c: Cluster) -> bool:
    """Worth a palette slot (auto) or a mention (extras), judged by real coverage."""
    if c.coverage <= 0 or c.weight / c.coverage < EDGE_RATIO:
        return False
    return c.coverage >= AUTO_SHARE or (c.coverage >= AUTO_VIVID and c.lch[1] >= 0.1)


def consolidate(chosen: list[Cluster], clusters: list[Cluster]) -> list[Cluster]:
    """Re-center each pick on the shading variants around it.

    A lit surface shows up as several clusters that differ mostly in
    lightness; the pick should be that surface's typical shade, not whichever
    variant happened to win selection.
    """
    if CONSOLIDATE <= 0:
        return chosen
    groups = [[c] for c in chosen]
    for c in clusters:
        if any(c is p for p in chosen):
            continue
        d = [perceived_distance(c.lab, p.lab) for p in chosen]
        j = int(np.argmin(d))
        if d[j] < CONSOLIDATE:
            groups[j].append(c)
    out = []
    for g in groups:
        w = np.array([c.weight for c in g])
        lab = (np.array([c.lab for c in g]) * w[:, None]).sum(axis=0) / w.sum()
        out.append(Cluster(lab, float(w.sum()), float(sum(c.coverage for c in g))))
    return out


# --------------------------------------------------------------------------
# Finishing styles.
# --------------------------------------------------------------------------


def apply_style(lch: np.ndarray, style: str) -> np.ndarray:
    l, c, h = (float(v) for v in lch)
    if style == "clean":
        # Lift muddy mid-tones, purify near-grays, keep extremes printable.
        l = min(max(l, 0.2), 0.97)
        if c < NEUTRAL_CHROMA:
            c *= 0.5
        else:
            # Boost tapers off so already-saturated colors are not pushed to neon.
            c *= 1 + 0.25 * max(0.0, 1 - c / 0.16)
    elif style == "vivid":
        l = l + (0.68 - l) * 0.2
        c = c * (1 + 0.5 * max(0.0, 1 - c / 0.3)) if c >= NEUTRAL_CHROMA else c
    elif style == "muted":
        l = l + (0.62 - l) * 0.12
        c *= 0.6
    return gamut_map((l, c, h))


# --------------------------------------------------------------------------
# Palette assembly.
# --------------------------------------------------------------------------


@dataclass
class Color:
    hex: str
    rgb: tuple[int, int, int]
    hsl: tuple[int, int, int]
    oklch: tuple[float, float, float]
    name: str
    share: float  # fraction of the image this color represents
    roles: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        white, black = (255, 255, 255), (0, 0, 0)
        on_white, on_black = contrast_ratio(self.rgb, white), contrast_ratio(self.rgb, black)
        return {
            "hex": self.hex,
            "name": self.name,
            "rgb": list(self.rgb),
            "hsl": list(self.hsl),
            "oklch": [round(self.oklch[0], 4), round(self.oklch[1], 4), round(self.oklch[2], 1)],
            "share": round(self.share, 4),
            "roles": self.roles,
            "contrast": {"white": round(on_white, 2), "black": round(on_black, 2)},
            "text_on": "#FFFFFF" if on_white >= on_black else "#000000",
        }


def _make_color(lch: np.ndarray, share: float) -> Color:
    rgb = oklch_to_rgb8(lch)
    lab = srgb_to_oklab(np.asarray(rgb, dtype=float) / 255)
    return Color(hex=rgb8_to_hex(rgb), rgb=rgb, hsl=rgb8_to_hsl(rgb),
                 oklch=tuple(float(v) for v in oklab_to_oklch(lab)),
                 name=color_name(lab), share=share)


def _dedupe_names(colors: list[Color]) -> None:
    seen: dict[str, Color] = {}
    for c in sorted(colors, key=lambda c: -c.share):
        base = c.name
        if base in seen:
            first = seen[base]
            prefix = "deep" if c.oklch[0] < first.oklch[0] else "soft"
            c.name = f"{prefix} {base}"
            i = 2
            while any(o is not c and o.name == c.name for o in colors):
                c.name = f"{prefix} {base} {i}"
                i += 1
        else:
            seen[base] = c


def _tint(hue: float, l: float, c: float) -> str:
    return rgb8_to_hex(oklch_to_rgb8(gamut_map((l, c, hue))))


def assign_roles(colors: list[Color]) -> tuple[dict[str, str], list[str]]:
    """Map the palette onto UI roles: background, surface, text, primary, accent.

    Photos rarely contain a usable page background or body-text color, so when
    the palette has none, a quiet tint in the photo's dominant hue is derived
    instead. Derived roles are listed separately so callers can tell them apart.
    """
    roles: dict[str, str] = {}
    derived: list[str] = []
    used: list[Color] = []

    def take(role: str, color: Color | None, fallback: tuple[float, float]) -> None:
        if color is not None:
            roles[role] = color.hex
            color.roles.append(role)
            used.append(color)
        else:
            l, c = fallback
            roles[role] = _tint(hue, l, c if chromatic else 0.0)  # B&W photo: true grays
            derived.append(role)

    by_l = sorted(colors, key=lambda c: c.oklch[0])
    chromatic = [c for c in colors if c.oklch[1] >= NEUTRAL_CHROMA]
    hue = max(chromatic or colors, key=lambda c: c.share).oklch[2]

    light = by_l[-1]
    take("background", light if light.oklch[0] >= 0.9 and light.oklch[1] <= 0.05 else None,
         (0.975, 0.008))
    second = by_l[-2] if len(by_l) > 1 else None
    take("surface", second if second is not None and second.oklch[0] >= 0.82
         and second.oklch[1] <= 0.08 and "background" not in derived else None, (0.935, 0.015))
    bg = hex_to_rgb8(roles["background"])
    dark = by_l[0]
    take("text", dark if dark.oklch[0] <= 0.4 and contrast_ratio(dark.rgb, bg) >= 7 else None,
         (0.24, 0.025))

    free = [c for c in colors if not any(c is u for u in used)]
    candidates = [c for c in free if c.oklch[1] >= NEUTRAL_CHROMA] or free
    if not candidates:
        return roles, derived
    primary = max(candidates, key=lambda c: c.share * (0.5 + c.oklch[1] / 0.12)
                  * (1.0 if contrast_ratio(c.rgb, bg) >= 3 else 0.35))
    take("primary", primary, (0, 0))
    others = [c for c in candidates if c is not primary]
    if others:
        def hue_gap(c: Color) -> float:
            d = abs(c.oklch[2] - primary.oklch[2]) % 360
            return min(d, 360 - d)
        take("accent", max(others, key=lambda c: c.oklch[1] * (0.4 + hue_gap(c) / 180)), (0, 0))
    return roles, derived


def _sort(colors: list[Color], how: str) -> list[Color]:
    if how == "lightness":
        return sorted(colors, key=lambda c: -c.oklch[0])
    if how == "hue":
        # Neutrals first (dark to light), then chromatic colors around the wheel.
        return sorted(colors, key=lambda c: (c.oklch[1] >= NEUTRAL_CHROMA,
                                             c.oklch[2] if c.oklch[1] >= NEUTRAL_CHROMA else c.oklch[0]))
    return sorted(colors, key=lambda c: -c.share)


def extract_palette(images: Sequence[str | Path] | str | Path, count: int | str = "auto",
                    style: str = "clean", sort: str = "weight", neutrals: bool = True,
                    seed: int = 7) -> dict:
    """Build a palette from one image, or one combined palette from several.

    count is 1-16, or "auto" to size the palette to the photo (4-12 colors).
    Notable colors that did not make the palette are returned as "extras".
    """
    if isinstance(images, (str, Path)):
        images = [images]
    if not images:
        raise ValueError("no images given")
    if style not in STYLES:
        raise ValueError(f"style must be one of {', '.join(STYLES)}")
    if sort not in SORTS:
        raise ValueError(f"sort must be one of {', '.join(SORTS)}")
    auto = isinstance(count, str) and count.strip().lower() == "auto"
    if not auto:
        try:
            count = int(count)
        except (TypeError, ValueError):
            raise ValueError("count must be a number from 1 to 16, or 'auto'") from None
        if not 1 <= count <= 16:
            raise ValueError("count must be between 1 and 16")

    loaded = [load_swatches(p) for p in images]
    sw = Swatches(lab=np.concatenate([s.lab for s in loaded]),
                  weight=np.concatenate([s.weight for s in loaded]) / len(loaded),
                  coverage=np.concatenate([s.coverage for s in loaded]) / len(loaded))

    chroma_q = {"natural": 0.5, "muted": 0.5, "clean": 0.65, "vivid": 0.75}[style]
    k = max(K_MIN, (AUTO_MAX if auto else count) * K_PER)
    clusters = find_clusters(sw, k=k, chroma_q=chroma_q, seed=seed)
    # Greedy order of clearly distinct colors; the palette is a prefix of it,
    # and the notable colors right after the palette are reported as extras.
    ordered = select(clusters, 16, neutrals, relax=False)
    if auto:
        count = min(max(sum(1 for c in ordered if notable(c)), AUTO_MIN), AUTO_MAX)
    picks = ordered[:count] if len(ordered) >= count else select(clusters, count, neutrals)
    extra_picks = [c for c in ordered[len(picks):] if notable(c)][:EXTRAS_MAX]
    chosen = consolidate(picks, clusters)

    # Re-attribute every pixel to its nearest chosen color so shares add up.
    centers = np.array([c.lab for c in chosen])
    nearest = np.linalg.norm(sw.lab[:, None, :] - centers[None], axis=2).argmin(axis=1)
    shares = np.bincount(nearest, weights=sw.coverage, minlength=len(chosen))

    colors = [_make_color(apply_style(c.lch, style), float(s)) for c, s in zip(chosen, shares)]
    extras = []
    if extra_picks:
        allc = np.array([c.lab for c in chosen + extra_picks])
        near = np.linalg.norm(sw.lab[:, None, :] - allc[None], axis=2).argmin(axis=1)
        cover = np.bincount(near, weights=sw.coverage, minlength=len(allc))[len(chosen):]
        extras = [_make_color(apply_style(c.lch, style), float(s)) for c, s in zip(extra_picks, cover)]
        # an extra that styles to the same hex as a palette color adds nothing
        extras = [e for e in extras if e.hex not in {c.hex for c in colors}]
    _dedupe_names(colors + extras)
    roles, derived = assign_roles(colors)
    colors = _sort(colors, sort)
    return {
        "source": [str(p) for p in images],
        "style": style,
        "count": len(colors),
        "colors": [c.to_dict() for c in colors],
        "roles": roles,
        "derived_roles": derived,
        "extras": [{"hex": e.hex, "name": e.name, "share": round(e.share, 4)} for e in extras],
    }


# --------------------------------------------------------------------------
# Output formats.
# --------------------------------------------------------------------------


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _var_names(palette: dict) -> list[str]:
    return [slug(c["name"]) for c in palette["colors"]]


def format_text(palette: dict, color: bool = False) -> str:
    lines = [f"Palette ({palette['style']}, {palette['count']} colors) from "
             + ", ".join(palette["source"])]
    for c in palette["colors"]:
        r, g, b = c["rgb"]
        chip = f"\x1b[48;2;{r};{g};{b}m      \x1b[0m " if color else ""
        roles = f"  [{', '.join(c['roles'])}]" if c["roles"] else ""
        lines.append(f"  {chip}{c['hex']}  {c['name']:<18} {c['share'] * 100:5.1f}%"
                     f"  text {c['text_on']}{roles}")
    if palette.get("derived_roles"):
        lines.append("  derived: " + ", ".join(
            f"{r} {palette['roles'][r]}" for r in palette["derived_roles"]))
    if palette.get("extras"):
        lines.append("  also in this photo: " + ", ".join(
            f"{e['hex']} {e['name']} ({e['share'] * 100:.1f}%)" for e in palette["extras"]))
    return "\n".join(lines)


def format_css(palette: dict, prefix: str = "palette") -> str:
    out = [":root {"]
    for name, c in zip(_var_names(palette), palette["colors"]):
        out.append(f"  --{prefix}-{name}: {c['hex']};")
    out.append("")
    for role, value in palette["roles"].items():
        out.append(f"  --{prefix}-{role}: {value};")
    out.append("}")
    return "\n".join(out)


def format_scss(palette: dict, prefix: str = "palette") -> str:
    out = [f"${prefix}-{n}: {c['hex']};" for n, c in zip(_var_names(palette), palette["colors"])]
    out.append("")
    out += [f"${prefix}-{role}: {value};" for role, value in palette["roles"].items()]
    return "\n".join(out)


def format_tailwind(palette: dict, prefix: str = "palette") -> str:
    """Tailwind CSS v4 `@theme` block (utilities like bg-palette-primary)."""
    out = ["@theme {"]
    for name, c in zip(_var_names(palette), palette["colors"]):
        out.append(f"  --color-{prefix}-{name}: {c['hex']};")
    for role, value in palette["roles"].items():
        out.append(f"  --color-{prefix}-{role}: {value};")
    out.append("}")
    return "\n".join(out)


def format_gpl(palette: dict) -> str:
    """GIMP palette, also read by Inkscape, Krita, Aseprite and others."""
    out = ["GIMP Palette", "Name: photo-palette", "Columns: 0", "#"]
    for c in palette["colors"]:
        r, g, b = c["rgb"]
        out.append(f"{r:3d} {g:3d} {b:3d}\t{c['name']} {c['hex']}")
    return "\n".join(out)


def format_svg(palette: dict) -> str:
    w, h, label_h = 140, 160, 46
    n = len(palette["colors"])
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w * n}" height="{h}" '
           f'viewBox="0 0 {w * n} {h}" font-family="ui-sans-serif, system-ui, sans-serif">']
    for i, c in enumerate(palette["colors"]):
        x = i * w
        out.append(f'  <rect x="{x}" y="0" width="{w}" height="{h - label_h}" fill="{c["hex"]}"/>')
        out.append(f'  <rect x="{x}" y="{h - label_h}" width="{w}" height="{label_h}" fill="#FFFFFF"/>')
        out.append(f'  <text x="{x + 12}" y="{h - 26}" font-size="14" font-weight="600" '
                   f'fill="#1A1A1A">{c["hex"]}</text>')
        out.append(f'  <text x="{x + 12}" y="{h - 9}" font-size="12" fill="#666666">'
                   f'{c["name"]}</text>')
    out.append("</svg>")
    return "\n".join(out)


def render(palette: dict, fmt: str, prefix: str = "palette", color: bool = False) -> str:
    if fmt == "json":
        return json.dumps(palette, indent=2)
    if fmt == "css":
        return format_css(palette, prefix)
    if fmt == "scss":
        return format_scss(palette, prefix)
    if fmt == "tailwind":
        return format_tailwind(palette, prefix)
    if fmt == "gpl":
        return format_gpl(palette)
    if fmt == "svg":
        return format_svg(palette)
    if fmt == "text":
        return format_text(palette, color=color)
    raise ValueError(f"format must be one of {', '.join(FORMATS)}")


def _font(size: int) -> ImageFont.ImageFont:
    for name in ("DejaVuSans.ttf", "Arial.ttf", "Helvetica.ttc"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def save_preview(palette: dict, out_path: str | Path, width: int = 1200) -> Path:
    """Write the source image(s) above a labelled swatch strip."""
    sources = palette["source"]
    tiles = []
    for p in sources:
        with Image.open(p) as im:
            im = ImageOps.exif_transpose(im).convert("RGB")
            tile_w = width // len(sources)
            tiles.append(im.resize((tile_w, max(1, round(im.height * tile_w / im.width))),
                                   _RESAMPLE.LANCZOS))
    photo_h = min(max(t.height for t in tiles), round(width * 0.75))
    colors = palette["colors"]
    per_row = min(len(colors), 8)
    rows = -(-len(colors) // per_row)
    strip_h, label_h = (150, 64) if rows == 1 else (110, 60)
    canvas = Image.new("RGB", (width, photo_h + rows * (strip_h + label_h)), "#FFFFFF")
    x = 0
    for t in tiles:
        top = max(0, (t.height - photo_h) // 2)
        canvas.paste(t.crop((0, top, t.width, top + photo_h)), (x, 0))
        x += t.width

    draw = ImageDraw.Draw(canvas)
    big, small = _font(20), _font(15)
    for i, c in enumerate(colors):
        row, col = divmod(i, per_row)
        in_row = min(per_row, len(colors) - row * per_row)
        x0, x1 = round(col * width / in_row), round((col + 1) * width / in_row)
        y0 = photo_h + row * (strip_h + label_h)
        draw.rectangle([x0, y0, x1, y0 + strip_h], fill=c["hex"])
        draw.text((x0 + 14, y0 + strip_h + 10), c["hex"], fill="#1A1A1A", font=big)
        draw.text((x0 + 14, y0 + strip_h + 36), c["name"], fill="#6B6B6B", font=small)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)
    return out_path


# --------------------------------------------------------------------------
# CLI.
# --------------------------------------------------------------------------


def _count_arg(value: str):
    if value.strip().lower() == "auto":
        return "auto"
    try:
        n = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("use a number from 1 to 16, or 'auto'") from None
    if not 1 <= n <= 16:
        raise argparse.ArgumentTypeError("use a number from 1 to 16, or 'auto'")
    return n


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="palette.py",
        description="Generate a clean color palette from a photograph (or several, as a moodboard).",
    )
    p.add_argument("images", nargs="+", help="image file(s): JPEG, PNG, WebP, TIFF, GIF, BMP ...")
    p.add_argument("-n", "--count", type=_count_arg, default="auto",
                   help="number of colors, 1-16, or 'auto' to fit the photo (default: auto, 4-12)")
    p.add_argument("-s", "--style", choices=STYLES, default="clean",
                   help="finish: clean (default), natural (as captured), vivid, muted")
    p.add_argument("-f", "--format", choices=FORMATS, default="text", help="output format")
    p.add_argument("--sort", choices=SORTS, default="weight",
                   help="order by coverage (default), lightness or hue")
    p.add_argument("--no-neutrals", action="store_true",
                   help="leave out grays, near-blacks and near-whites")
    p.add_argument("--prefix", default="palette", help="variable prefix for css/scss/tailwind")
    p.add_argument("-o", "--output", help="write the formatted palette to this file")
    p.add_argument("--preview", help="also save a PNG of the photo with its swatches")
    p.add_argument("--seed", type=int, default=7, help="clustering seed (results are deterministic)")
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    return p


def main(argv: Iterable[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        palette = extract_palette(args.images, count=args.count, style=args.style,
                                  sort=args.sort, neutrals=not args.no_neutrals, seed=args.seed)
    except (OSError, ValueError) as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 1
    text = render(palette, args.format, prefix=args.prefix,
                  color=args.format == "text" and not args.output and sys.stdout.isatty())
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
        sys.stderr.write(f"wrote {args.output}\n")
    else:
        print(text)
    if args.preview:
        sys.stderr.write(f"wrote preview {save_preview(palette, args.preview)}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
