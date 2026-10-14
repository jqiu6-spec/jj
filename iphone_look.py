#!/usr/bin/env python3
"""
iphone_look.py — turn a clean CGI product render into something that reads as a
real photograph captured on an iPhone 17 (main 26mm-equivalent camera).

Everything a phone camera pipeline does to light on its way to a JPEG is
simulated, in order:

  1. framing      - 16:9 crop, slight handheld roll + keystone, 2.5% zoom
  2. lens         - residual barrel distortion, lateral chromatic aberration,
                    corner softness, vignetting
  3. tone/colour  - warm daylight white balance, Smart-HDR style shadow lift,
                    highlight knee, S-curve, saturation, cool shadow tint,
                    local tone mapping ("clarity")
  4. surface      - low-frequency plaster/light mottling so flat CGI walls
                    stop being mathematically uniform
  5. sensor       - luminance grain (shadow-weighted), chroma blotches, chroma
                    noise reduction
  6. ISP          - phone-style over-sharpening after NR
  7. container    - 4:2:0 JPEG at iPhone-ish quality, real iPhone 17 EXIF

Two variants are written:
  * overlay  - the typography is lifted off the render first and re-composited
               as a crisp graphic on top of the "photo" (how a real ad is built
               from a real photo).
  * printed  - the typography goes through the camera pipeline as well, as if
               the whole thing were a wall graphic photographed in place.

Usage: python3 iphone_look.py SRC_IMAGE OUT_DIR
Only numpy + Pillow are required.
"""
import os
import sys
import math
import numpy as np
from PIL import Image, ImageFilter
from PIL.TiffImagePlugin import IFDRational

OUT_W, OUT_H = 4032, 2268          # iPhone 12MP 16:9 frame
SEED = 1717
TEXT_RGB = np.array([21, 42, 30], np.float32) / 255.0   # sampled from the ad

rng = np.random.default_rng(SEED)


# ----------------------------------------------------------------------------
# small numpy image toolbox (no scipy / cv2 in this environment)
# ----------------------------------------------------------------------------
def box1d(a, r, axis):
    """Edge-replicated box filter of radius r along one axis."""
    if r <= 0:
        return a
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    p = np.pad(a, pad, mode="edge")
    cs = np.cumsum(p, axis=axis, dtype=np.float64)
    n = a.shape[axis]
    hi = [slice(None)] * a.ndim
    lo = [slice(None)] * a.ndim
    hi[axis] = slice(2 * r + 1, 2 * r + 1 + n)
    lo[axis] = slice(0, n)
    return ((cs[tuple(hi)] - cs[tuple(lo)]) / (2 * r + 1)).astype(np.float32)


def boxes_for_gauss(sigma, n=3):
    """Box widths whose n-fold convolution approximates a Gaussian (Kovesi)."""
    w_ideal = math.sqrt(12 * sigma * sigma / n + 1)
    wl = int(math.floor(w_ideal))
    if wl % 2 == 0:
        wl -= 1
    wu = wl + 2
    m_ideal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4)
    m = int(round(m_ideal))
    return [wl if i < m else wu for i in range(n)]


def gauss(a, sigma):
    """Separable Gaussian blur via three box passes. Works on HxW or HxWxC."""
    if sigma <= 0:
        return a
    out = a
    for w in boxes_for_gauss(sigma):
        r = (w - 1) // 2
        out = box1d(box1d(out, r, 0), r, 1)
    return out


def luma(rgb):
    return rgb @ np.array([0.299, 0.587, 0.114], np.float32)


def srgb_to_lin(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4).astype(np.float32)


def lin_to_srgb(x):
    x = np.clip(x, 0, None)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055).astype(np.float32)


def to_pil(arr):
    return Image.fromarray(np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8))


def resize_f(arr, size, resample=Image.LANCZOS):
    """Resize a float HxW or HxWxC array with Pillow's float path."""
    if arr.ndim == 2:
        return np.asarray(Image.fromarray(arr, mode="F").resize(size, resample), np.float32)
    return np.stack([resize_f(arr[..., c], size, resample) for c in range(arr.shape[2])], -1)


def remap_bilinear(img, sx, sy):
    """Sample img (HxWxC) at float source coords sx, sy (HxW) bilinearly."""
    H, W = img.shape[:2]
    sx = np.clip(sx, 0, W - 1.001)
    sy = np.clip(sy, 0, H - 1.001)
    x0 = np.floor(sx).astype(np.int32)
    y0 = np.floor(sy).astype(np.int32)
    wx = (sx - x0)[..., None]
    wy = (sy - y0)[..., None]
    x1 = x0 + 1
    y1 = y0 + 1
    return (img[y0, x0] * (1 - wx) * (1 - wy) + img[y0, x1] * wx * (1 - wy)
            + img[y1, x0] * (1 - wx) * wy + img[y1, x1] * wx * wy).astype(np.float32)


def max_filter(mask01, size):
    m = Image.fromarray((np.clip(mask01, 0, 1) * 255).astype(np.uint8))
    return np.asarray(m.filter(ImageFilter.MaxFilter(size)), np.float32) / 255.0


# ----------------------------------------------------------------------------
# 0. load + frame the source as a 16:9 photo
# ----------------------------------------------------------------------------
src_path, out_dir = sys.argv[1], sys.argv[2]
os.makedirs(out_dir, exist_ok=True)

src = np.asarray(Image.open(src_path).convert("RGB"), np.float32) / 255.0
H0, W0 = src.shape[:2]
# 16:9 crop; the top of the ad is empty wall so take most of the trim there
crop_h = int(round(W0 * 9 / 16))
top = int(round((H0 - crop_h) * 0.75))
src = src[top: top + crop_h]
H1, W1 = src.shape[:2]

# ----------------------------------------------------------------------------
# 1. lift the typography off the render (luma key against a locally
#    estimated wall colour) and inpaint the wall underneath it
# ----------------------------------------------------------------------------
yy, xx = np.mgrid[0:H1, 0:W1]
# text lives in the left strip; below the headline the navy block intrudes,
# so the strip narrows there
region = ((yy < 354) & (xx < 565)) | ((yy >= 354) & (xx < 490))
lum = luma(src)
rough = ((lum < 0.62) & region).astype(np.float32)
rough_d = max_filter(rough, 7)                       # protect anti-aliased edges

# background estimate: normalised-average downsample that ignores text pixels,
# then harmonic (diffusion) fill of the holes, then bicubic back up
S = 4
known = 1.0 - rough_d
num = resize_f(src * known[..., None], (W1 // S, H1 // S), Image.BOX)
den = resize_f(known, (W1 // S, H1 // S), Image.BOX)
small = num / np.maximum(den, 1e-3)[..., None]
hole = den < 0.5
small[hole] = small[~hole].mean(0)
for _ in range(400):
    blurred = box1d(box1d(small, 1, 0), 1, 1)
    small[hole] = blurred[hole]
bg = resize_f(small, (W1, H1), Image.BICUBIC)
bg_lum = luma(bg)

alpha_raw = np.clip((bg_lum - lum) / np.maximum(bg_lum - 0.13, 1e-3), 0, 1)
alpha = np.clip((alpha_raw - 0.15) / 0.70, 0, 1) * region
# flat fill colour per text band (sampled from the ad; the body copy is a
# slightly darker neutral than the green logo/headline)
a3 = alpha[..., None]
text_rgb = np.broadcast_to(TEXT_RGB, src.shape).copy()
body_rows = (yy >= 630 - top) & (yy < 705 - top)
text_rgb[body_rows] = np.array([18, 28, 20], np.float32) / 255.0

scene_clean = src * (1 - np.minimum(rough_d, 1)[..., None]) + bg * np.minimum(rough_d, 1)[..., None]
scene_clean = np.where((alpha_raw > 0.02)[..., None] | (rough_d > 0)[..., None], scene_clean, src)

# ----------------------------------------------------------------------------
# 2. geometry: upscale to the phone frame, then one combined remap for
#    handheld roll, keystone, zoom, barrel distortion and lateral CA
# ----------------------------------------------------------------------------
def photo_pipeline(scene_small, label, overlay=None):
    print(f"[{label}] upscaling to {OUT_W}x{OUT_H}")
    scene = np.clip(resize_f(scene_small, (OUT_W, OUT_H), Image.LANCZOS), 0, 1)

    H, W = OUT_H, OUT_W
    cx, cy, f = (W - 1) / 2, (H - 1) / 2, W / 2
    v, u = np.mgrid[0:H, 0:W].astype(np.float32)
    nx = (u - cx) / f
    ny = (v - cy) / f

    zoom = 1.025
    roll = math.radians(0.45)
    keystone = 0.012       # camera tilted slightly downward -> verticals converge
    k1 = 0.010             # residual barrel after in-camera correction
    ca = {0: +0.00025, 1: 0.0, 2: -0.00030}   # R out, B in (lateral CA)

    x = nx / zoom
    y = ny / zoom
    c, s = math.cos(roll), math.sin(roll)
    x, y = c * x - s * y, s * x + c * y
    persp = 1.0 + keystone * y
    x, y = x / persp, y / persp
    r2 = x * x + y * y
    x, y = x * (1 + k1 * r2), y * (1 + k1 * r2)
    rr = np.sqrt(r2)

    print(f"[{label}] lens remap")
    chans = []
    for ch in range(3):
        sc = 1.0 + ca[ch] * rr * rr * 4      # CA grows with radius
        chans.append(remap_bilinear(scene[..., ch:ch + 1], cx + x * sc * f, cy + y * sc * f)[..., 0])
    img = np.stack(chans, -1)
    del scene, chans

    # ------------------------------------------------------------------
    # 3. tone + colour (linear light)
    # ------------------------------------------------------------------
    print(f"[{label}] tone & colour")
    lin = srgb_to_lin(img)
    lin *= np.array([1.022, 1.0, 0.972], np.float32)            # warm daylight WB
    Y = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    lin[..., 2] += 0.010 * (1 - Y) ** 3                           # cool shadow tint
    lin = lin + 0.018 * (1 - lin) ** 5                           # Smart-HDR shadow lift
    knee = 0.80                                                  # highlight knee
    hi = lin > knee
    lin = np.where(hi, knee + (1 - knee) * (1 - np.exp(-(lin - knee) / (1 - knee))), lin)
    img = lin_to_srgb(lin)
    del lin

    # S-curve contrast + saturation in display space
    img = np.clip(0.5 + (img - 0.5) * 1.07, 0, 1)
    img = np.clip(img ** 0.985, 0, 1)
    Yd = luma(img)[..., None]
    img = np.clip(Yd + (img - Yd) * 1.10, 0, 1)

    # veiling glare: bright wall bleeds a little light into neighbouring edges
    glow = gauss(np.clip(img - 0.78, 0, None), 40)
    img = np.clip(img + 0.18 * glow, 0, 1)
    del glow

    # local tone mapping / clarity: phones crunch mid-scale contrast
    Yd = luma(img)
    Ylow = gauss(Yd, 45)
    img = np.clip(img + 0.14 * (Yd - Ylow)[..., None], 0, 1)

    # ------------------------------------------------------------------
    # 4. surface mottling + vignette + corner softness
    # ------------------------------------------------------------------
    print(f"[{label}] mottling, vignette, corner softness")
    def mottle(div, sigma, amp):
        n = rng.standard_normal((H // div + 2, W // div + 2)).astype(np.float32)
        n = gauss(n, sigma)
        n = (n - n.mean()) / (n.std() + 1e-6)
        return 1.0 + amp * resize_f(n, (W, H), Image.BICUBIC)
    img = img * (mottle(32, 2.0, 0.022) * mottle(8, 2.5, 0.009))[..., None]

    vign = 1.0 - 0.13 * np.clip(rr / rr.max(), 0, 1) ** 2.4
    img = img * vign[..., None]

    soft = gauss(img, 1.6)
    wsoft = (0.75 * np.clip(rr / rr.max(), 0, 1) ** 2.2)[..., None]
    img = img * (1 - wsoft) + soft * wsoft
    del soft
    img = np.clip(img, 0, 1)

    # ------------------------------------------------------------------
    # 5. sensor noise + chroma NR,  6. ISP sharpening
    # ------------------------------------------------------------------
    print(f"[{label}] sensor noise + sharpening")
    Y = luma(img)
    shadow_w = (1 - Y) ** 2
    ln = rng.standard_normal((H, W)).astype(np.float32) * (0.013 + 0.020 * shadow_w)
    cn = rng.standard_normal((H, W, 2)).astype(np.float32)
    cn = gauss(cn, 2.5) * (0.055 * shadow_w)[..., None]

    # YCbCr
    Cb = (img[..., 2] - Y) * 0.564
    Cr = (img[..., 0] - Y) * 0.713
    Cb = gauss(Cb + cn[..., 0], 1.2)      # chroma NR smears colour slightly
    Cr = gauss(Cr + cn[..., 1], 1.2)
    Y = Y + ln
    R = Y + 1.403 * Cr
    B = Y + 1.773 * Cb
    G = (Y - 0.299 * R - 0.114 * B) / 0.587
    img = np.clip(np.stack([R, G, B], -1), 0, 1)
    del Cb, Cr, R, G, B, ln, cn

    # unsharp mask after NR = the familiar phone "crunch" + edge halos
    blur = gauss(img, 1.7)
    img = np.clip(img + 0.75 * (img - blur), 0, 1)
    del blur

    # ------------------------------------------------------------------
    # overlay the typography as a clean graphic (ad built on a real photo)
    # ------------------------------------------------------------------
    if overlay is not None:
        print(f"[{label}] compositing clean typography")
        o_alpha, o_rgb = overlay
        oa = resize_f(o_alpha, (W, H), Image.BICUBIC)
        oa = np.clip((oa - 0.5) * 2.0 + 0.5, 0, 1)[..., None]   # re-tighten edges
        orgb = resize_f(o_rgb, (W, H), Image.BILINEAR).clip(0, 1)
        img = img * (1 - oa) + orgb * oa

    return np.clip(img, 0, 1)


# ----------------------------------------------------------------------------
# 7. iPhone 17 EXIF
# ----------------------------------------------------------------------------
def iphone17_exif(w, h):
    ex = Image.Exif()
    ex[0x010F] = "Apple"
    ex[0x0110] = "iPhone 17"
    ex[0x0112] = 1
    ex[0x011A] = IFDRational(72, 1)
    ex[0x011B] = IFDRational(72, 1)
    ex[0x0128] = 2
    ex[0x0131] = "26.0.1"
    ex[0x0132] = "2026:10:14 11:32:17"
    ex[0x013C] = "iPhone 17"
    ex[0x0213] = 1
    e = ex.get_ifd(0x8769)
    e[0x829A] = IFDRational(1, 2000)             # ExposureTime
    e[0x829D] = IFDRational(8, 5)                # FNumber 1.6
    e[0x8822] = 2                                # ExposureProgram: normal
    e[0x8827] = 50                               # ISO
    e[0x9000] = b"0232"
    e[0x9003] = "2026:10:14 11:32:17"
    e[0x9004] = "2026:10:14 11:32:17"
    e[0x9010] = "-04:00"
    e[0x9011] = "-04:00"
    e[0x9012] = "-04:00"
    e[0x9201] = IFDRational(10966, 1000)         # ShutterSpeedValue (APEX)
    e[0x9202] = IFDRational(1356, 1000)          # ApertureValue (APEX)
    e[0x9203] = IFDRational(9412, 1000)          # BrightnessValue
    e[0x9204] = IFDRational(0, 1)                # ExposureBias
    e[0x9207] = 5                                # MeteringMode: pattern
    e[0x9209] = 16                               # Flash: off, did not fire
    e[0x920A] = IFDRational(596, 100)            # FocalLength 5.96 mm
    e[0x9291] = "412"
    e[0x9292] = "412"
    e[0xA001] = 1                                # sRGB
    e[0xA002] = w
    e[0xA003] = h
    e[0xA217] = 2                                # one-chip colour sensor
    e[0xA301] = b"\x01"
    e[0xA402] = 0
    e[0xA403] = 0
    e[0xA405] = 26                               # 26 mm equivalent
    e[0xA432] = (IFDRational(155, 100), IFDRational(596, 100),
                 IFDRational(11, 5), IFDRational(8, 5))
    e[0xA433] = "Apple"
    e[0xA434] = "iPhone 17 back dual wide camera 5.96mm f/1.6"
    return ex.tobytes()


def save_jpeg(arr, path):
    im = to_pil(arr)
    im.save(path, "JPEG", quality=91, subsampling=2, optimize=True,
            exif=iphone17_exif(im.width, im.height))
    print("wrote", path, f"{os.path.getsize(path)/1e6:.2f} MB")


if __name__ == "__main__":
    overlay_img = photo_pipeline(scene_clean, "overlay", overlay=(alpha, text_rgb))
    save_jpeg(overlay_img, os.path.join(out_dir, "always-pan-iphone17.jpg"))

    rng = np.random.default_rng(SEED)          # same grain for the alt variant
    printed_img = photo_pipeline(src, "printed")
    save_jpeg(printed_img, os.path.join(out_dir, "always-pan-iphone17-printed-type.jpg"))

    # quick-look previews (not photos: no EXIF)
    prev = to_pil(overlay_img).resize((1792, 1008), Image.LANCZOS)
    prev.save(os.path.join(out_dir, "preview-overlay.jpg"), quality=88)
    before = to_pil(src).resize((1792, 1008), Image.LANCZOS)
    cmp = Image.new("RGB", (1792, 2016 + 8), (255, 255, 255))
    cmp.paste(before, (0, 0)); cmp.paste(prev, (0, 1016))
    cmp.save(os.path.join(out_dir, "before-after.jpg"), quality=88)
    # 100% detail crop around the pan, to judge grain / sharpening
    to_pil(overlay_img).crop((1900, 1050, 3100, 1800)).save(os.path.join(out_dir, "detail-100pct.jpg"), quality=92)
    print("done")
