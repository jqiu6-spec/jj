"""Composite the giant-train render into the night source image.

  - the train is kept only above the bridge deck's front edge, which hides
    its belly and bogies, as the deck hid the old train's
  - a soft spill of the train's own light falls on its surroundings
  - writes the composited source and the train's coverage mask, which the
    film pass uses to leave the train out of the window relighting, sky
    regrade and concrete weathering

Usage: python3 composite_train.py SOURCE TRAIN_RGBA OUT_IMAGE OUT_MASK
"""

import sys

import numpy as np
from PIL import Image

from film_emulation import gaussian_blur, linear_to_srgb, srgb_to_linear

# The deck's front edge: through the old train's base point and the track
# vanishing point (source pixels), from the camera match in giant_train.py.
DECK_POINT = (400.0, 725.0)
TRACK_VP = (2280.7, 1431.0)
SPILL = 0.3  # strength of the train's light on its surroundings


def downscale_rgba(img, size):
    """Resize with premultiplied alpha, so edges don't pick up dark fringes."""
    a = np.asarray(img, np.float32) / 255
    rgb, alpha = a[..., :3], a[..., 3:]
    pre = Image.fromarray(np.uint8(np.clip(rgb * alpha, 0, 1) * 255 + 0.5))
    al = Image.fromarray(np.uint8(alpha[..., 0] * 255 + 0.5))
    pre = np.asarray(pre.resize(size, Image.LANCZOS), np.float32) / 255
    al = np.asarray(al.resize(size, Image.LANCZOS), np.float32)[..., None] / 255
    return np.clip(pre, 0, 1), np.clip(al, 0, 1)


def main(src_path, train_path, out_path, mask_path):
    src = Image.open(src_path).convert("RGB")
    w, h = src.size
    bg = srgb_to_linear(np.asarray(src, np.float32) / 255)
    pre, alpha = downscale_rgba(Image.open(train_path).convert("RGBA"), (w, h))
    pre_lin = srgb_to_linear(np.where(alpha > 0, pre / np.maximum(alpha, 1e-4), 0)) * alpha

    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    deck_y = DECK_POINT[1] + (TRACK_VP[1] - DECK_POINT[1]) * (xs - DECK_POINT[0]) / (TRACK_VP[0] - DECK_POINT[0])
    above = np.clip((deck_y + 3 - ys) / 2.5, 0, 1)[..., None]
    alpha = alpha * above
    pre_lin = pre_lin * above

    # The train's light on the deck and the towers around it.
    spill = gaussian_blur(pre_lin, 18) * 0.6 + gaussian_blur(pre_lin, 60) * 0.4
    bg = bg + SPILL * spill * (1 - alpha)

    out = pre_lin + bg * (1 - alpha)
    out = linear_to_srgb(out)
    Image.fromarray(np.uint8(np.clip(out, 0, 1) * 255 + 0.5)).save(out_path)
    Image.fromarray(np.uint8(np.clip(alpha[..., 0], 0, 1) * 255 + 0.5)).save(mask_path)
    print(f"wrote {out_path} and {mask_path}")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    main(*sys.argv[1:])
