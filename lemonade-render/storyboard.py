"""Assemble renders/step1..6.png into one storyboard picture: renders/lemonade_storyboard.png"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REN = os.environ.get("RENDER_DIR", os.path.join(HERE, "renders"))
FONT_DIR = "/usr/share/fonts/opentype/inter"

STEPS = ["Cut", "Squeeze", "Pour", "Add water + sugar", "Pour into cup", "Final"]

PW, PH = 1200, 900          # panel size
GAP, MARGIN = 56, 96
TITLE_H, CAP_H = 230, 120
BG = (247, 244, 236)
INK = (52, 46, 38)
LEMON = (246, 200, 40)


def font(name, size):
    for cand in (os.path.join(FONT_DIR, name), "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if os.path.exists(cand):
            return ImageFont.truetype(cand, size)
    return ImageFont.load_default()


def rounded(im, r):
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.size[0] - 1, im.size[1] - 1), r, fill=255)
    out = Image.new("RGBA", im.size)
    out.paste(im, (0, 0), mask)
    return out


def main():
    W = MARGIN * 2 + PW * 3 + GAP * 2
    H = TITLE_H + 2 * (PH + CAP_H) + GAP + MARGIN
    sheet = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(sheet)
    title = font("InterDisplay-Bold.otf", 108)
    sub = font("Inter-Medium.otf", 40)
    cap = font("Inter-SemiBold.otf", 54)
    num = font("Inter-Bold.otf", 46)

    d.text((MARGIN, 70), "Making Lemonade", font=title, fill=INK)
    tw = d.textlength("Making Lemonade", font=title)
    d.text((MARGIN + tw + 40, 128), "six steps, from lemon to glass", font=sub, fill=(140, 128, 110))

    for i, label in enumerate(STEPS):
        path = os.path.join(REN, "step%d.png" % (i + 1))
        im = Image.open(path).convert("RGB")
        # centre-crop to the panel aspect, then resize
        sw, sh = im.size
        tgt = PW / PH
        if sw / sh > tgt:
            nw = int(sh * tgt)
            im = im.crop(((sw - nw) // 2, 0, (sw - nw) // 2 + nw, sh))
        else:
            nh = int(sw / tgt)
            im = im.crop((0, (sh - nh) // 2, sw, (sh - nh) // 2 + nh))
        im = im.resize((PW, PH), Image.LANCZOS)
        col, row = i % 3, i // 3
        x = MARGIN + col * (PW + GAP)
        y = TITLE_H + row * (PH + CAP_H + GAP)
        # soft drop shadow
        sh_img = Image.new("RGBA", (PW + 80, PH + 80), (0, 0, 0, 0))
        ImageDraw.Draw(sh_img).rounded_rectangle((40, 48, PW + 40, PH + 48), 28, fill=(60, 45, 20, 70))
        sh_img = sh_img.filter(ImageFilter.GaussianBlur(18))
        sheet.paste(sh_img, (x - 40, y - 40), sh_img)
        panel = rounded(im, 28)
        sheet.paste(panel, (x, y), panel)
        # caption: yellow numbered badge + step name
        cy = y + PH + 34
        r = 34
        d.ellipse((x, cy, x + 2 * r, cy + 2 * r), fill=LEMON)
        n = str(i + 1)
        nw = d.textlength(n, font=num)
        d.text((x + r - nw / 2, cy + r - 29), n, font=num, fill=INK)
        d.text((x + 2 * r + 22, cy + r - 36), label, font=cap, fill=INK)
        # arrow toward the next step (within a row)
        if col < 2:
            ax = x + PW + GAP // 2
            ay = y + PH // 2
            d.polygon([(ax - 12, ay - 18), (ax + 14, ay), (ax - 12, ay + 18)], fill=(200, 160, 30))

    out = os.path.join(REN, "lemonade_storyboard.png")
    sheet.save(out, optimize=True)
    small = sheet.resize((W // 2, H // 2), Image.LANCZOS)
    small.save(os.path.join(REN, "lemonade_storyboard_small.jpg"), quality=90)
    print("wrote", out, sheet.size)


if __name__ == "__main__":
    main()
