"""Giant futuristic train for the night megastructure shot.

Builds a ~100 m tall version of the Alstom Metropolis (Sydney Metro) train
from its USDZ model and renders it with a camera matched to
images/source_night.webp, on a transparent background, for compositing:

  - scaled so the car body is about 100 m tall, nose to the left
  - the silver side panels and all glass become a multi-floor facade: a
    grid of lit windows, each with its own on/off state, brightness and
    warm or cool light
  - the livery's teal stripes and nose swoosh become cyan light bars, with
    a white under-glow bar along the side
  - translucent holographic panels with Japanese signage float off the side
    facing the camera, and a destination board hangs above the nose

Camera: matched from the source's vanishing points (focal length 909 px on
the 1055 px source, i.e. 20.7 mm on a 24 mm-wide frame; pitched up 37
degrees; the track runs 57 degrees right of the view direction).

Usage (Blender as a Python module, `pip install bpy`):
  python3 giant_train.py --usdz MODEL.usdz --out train.png [--scale 2]
      [--samples 64] [--workdir DIR]
"""

import argparse
import math
import os

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
from PIL import Image, ImageDraw, ImageFont

# Source image and the camera recovered from it.
SRC_W, SRC_H = 1055, 1491
F_PX = 909.2
PITCH = 37.0  # camera tilted up, degrees
YAW = 57.0  # track direction, degrees right of the view direction

BODY_HEIGHT = 100.0  # metres, car body
FLOOR = 4.0  # metres per window row
BAY = 3.2  # metres per window column

# Placement in source pixels: a point on the body's near bottom edge (on the
# bridge deck), where the roof should land above it, and the nose position.
BASE_PX = (400.0, 725.0)
ROOF_Y = 385.0
NOSE_X = 20.0

FONT = "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf"


def parse_args():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--usdz", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--scale", type=float, default=2.0, help="render size relative to the source")
    p.add_argument("--samples", type=int, default=64)
    p.add_argument("--workdir", default=".")
    return p.parse_args()


# ---------------------------------------------------------------- textures

def hologram_textures(workdir):
    """RGBA hologram artwork (white on transparent; tinted in the shader)."""
    os.makedirs(workdir, exist_ok=True)
    paths = []

    def canvas(w, h):
        return Image.new("RGBA", (w, h), (0, 0, 0, 0))

    def font(size):
        return ImageFont.truetype(FONT, size)

    # 1: line name with a route bar and arrow.
    im = canvas(1600, 640)
    d = ImageDraw.Draw(im)
    d.text((60, 40), "メトロ未来線", font=font(250), fill=(255, 255, 255, 255))
    d.rectangle((60, 340, 1540, 352), fill=(255, 255, 255, 200))
    for i, x in enumerate(range(100, 1500, 230)):
        r = 30 if i == 2 else 18
        d.ellipse((x - r, 346 - r, x + r, 346 + r), outline=(255, 255, 255, 255), width=8)
    d.text((60, 400), "NEXT ▶ 新都心  SHIN-TOSHIN", font=font(110), fill=(255, 255, 255, 230))
    d.text((60, 540), "各駅停車  LOCAL  12両  →", font=font(70), fill=(255, 255, 255, 170))
    paths.append(("line", im))

    # 2: ring logo with a big M.
    im = canvas(900, 900)
    d = ImageDraw.Draw(im)
    for r, wdt, a in ((420, 18, 255), (360, 6, 180), (300, 3, 120)):
        d.ellipse((450 - r, 450 - r, 450 + r, 450 + r), outline=(255, 255, 255, a), width=wdt)
    d.text((250, 160), "M", font=font(560), fill=(255, 255, 255, 255))
    d.text((300, 760), "METRO", font=font(90), fill=(255, 255, 255, 200))
    paths.append(("logo", im))

    # 3: advertisement panel.
    im = canvas(1400, 700)
    d = ImageDraw.Draw(im)
    d.rectangle((10, 10, 1390, 690), outline=(255, 255, 255, 220), width=10)
    d.text((70, 60), "夜空へ、", font=font(200), fill=(255, 255, 255, 255))
    d.text((70, 300), "最速で。", font=font(200), fill=(255, 255, 255, 255))
    d.text((70, 560), "SKYLINE EXPRESS  ─  全席指定", font=font(70), fill=(255, 255, 255, 180))
    for i in range(6):
        d.rectangle((1000 + i * 55, 520 - i * 70, 1030 + i * 55, 620), fill=(255, 255, 255, 150))
    paths.append(("ad", im))

    # 4: destination board above the nose.
    im = canvas(1400, 360)
    d = ImageDraw.Draw(im)
    d.text((40, 20), "快速 新都心", font=font(230), fill=(255, 255, 255, 255))
    d.text((40, 270), "RAPID  for  SHIN-TOSHIN", font=font(70), fill=(255, 255, 255, 200))
    paths.append(("dest", im))

    out = {}
    for name, im in paths:
        path = os.path.join(workdir, f"holo_{name}.png")
        im.save(path)
        out[name] = path
    return out


# ---------------------------------------------------------------- shaders

def node(nt, kind, loc=(0, 0), **inputs):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


def math_node(nt, op, a=None, b=None, clamp=False, loc=(0, 0)):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    n.location = loc
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def window_grid(nt, density=1.0):
    """Emission colour of a lit-window grid in world space (x along the
    track, z up), on surfaces facing sideways. Returns a colour socket."""
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    u = math_node(nt, "DIVIDE", sep.outputs["X"], BAY / density)
    v = math_node(nt, "DIVIDE", sep.outputs["Z"], FLOOR / density)
    col = math_node(nt, "FLOOR", u)
    row = math_node(nt, "FLOOR", v)
    fu = math_node(nt, "SUBTRACT", u, col)
    fv = math_node(nt, "SUBTRACT", v, row)

    def band(x, lo, hi):
        return math_node(nt, "MULTIPLY",
                         math_node(nt, "GREATER_THAN", x, lo),
                         math_node(nt, "LESS_THAN", x, hi))

    pane = math_node(nt, "MULTIPLY", band(fu, 0.12, 0.88), band(fv, 0.22, 0.86))
    # Every sixth row carries a light bar instead of windows.
    bar_row = math_node(nt, "LESS_THAN", math_node(nt, "FRACT", math_node(nt, "DIVIDE", row, 6.0)), 0.1)
    pane = math_node(nt, "MULTIPLY", pane, math_node(nt, "SUBTRACT", 1.0, bar_row))

    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(col, comb.inputs[0])
    nt.links.new(row, comb.inputs[1])
    noise = nt.nodes.new("ShaderNodeTexWhiteNoise")
    noise.noise_dimensions = "3D"
    nt.links.new(comb.outputs[0], noise.inputs["Vector"])
    rsep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(noise.outputs["Color"], rsep.inputs[0])
    lit = math_node(nt, "GREATER_THAN", noise.outputs["Value"], 0.45)
    level = math_node(nt, "ADD", math_node(nt, "MULTIPLY", rsep.outputs[0], 1.1), 0.35)
    # Blinds: the upper part of some rooms dimmed.
    blind = math_node(nt, "MULTIPLY",
                      math_node(nt, "GREATER_THAN", rsep.outputs[2], 0.72),
                      math_node(nt, "GREATER_THAN", fv, 0.62))
    level = math_node(nt, "MULTIPLY", level, math_node(nt, "SUBTRACT", 1.0,
                                                       math_node(nt, "MULTIPLY", blind, 0.65)))

    warm = node(nt, "ShaderNodeRGB")
    warm.outputs[0].default_value = (1.0, 0.62, 0.32, 1)
    white = node(nt, "ShaderNodeRGB")
    white.outputs[0].default_value = (1.0, 0.86, 0.66, 1)
    cool = node(nt, "ShaderNodeRGB")
    cool.outputs[0].default_value = (0.72, 0.9, 1.0, 1)
    mix1 = nt.nodes.new("ShaderNodeMix")
    mix1.data_type = "RGBA"
    nt.links.new(math_node(nt, "GREATER_THAN", rsep.outputs[1], 0.55), mix1.inputs["Factor"])
    nt.links.new(warm.outputs[0], mix1.inputs[6])
    nt.links.new(white.outputs[0], mix1.inputs[7])
    mix2 = nt.nodes.new("ShaderNodeMix")
    mix2.data_type = "RGBA"
    nt.links.new(math_node(nt, "GREATER_THAN", rsep.outputs[1], 0.85), mix2.inputs["Factor"])
    nt.links.new(mix1.outputs[2], mix2.inputs[6])
    nt.links.new(cool.outputs[0], mix2.inputs[7])

    # Only on surfaces facing sideways (the long sides of the body).
    nsep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Normal"], nsep.inputs[0])
    side = math_node(nt, "GREATER_THAN", math_node(nt, "ABSOLUTE", nsep.outputs["Y"]), 0.7)

    amount = math_node(nt, "MULTIPLY", math_node(nt, "MULTIPLY", pane, lit),
                       math_node(nt, "MULTIPLY", level, side))
    scale = nt.nodes.new("ShaderNodeVectorMath")
    scale.operation = "SCALE"
    nt.links.new(mix2.outputs[2], scale.inputs[0])
    nt.links.new(amount, scale.inputs["Scale"])
    return scale.outputs[0]


def upgrade_body_material(mat, body_z0, window_strength, bar_strength):
    """Livery stays; teal becomes light bars, silver panels become windows."""
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    base_link = bsdf.inputs["Base Color"].links
    base = base_link[0].from_socket if base_link else None
    if base is None:
        rgb = node(nt, "ShaderNodeRGB")
        rgb.outputs[0].default_value = tuple(bsdf.inputs["Base Color"].default_value)
        base = rgb.outputs[0]
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(base, sep.inputs[0])
    r, g, b = sep.outputs[0], sep.outputs[1], sep.outputs[2]
    # Teal: blue well above red.
    teal = math_node(nt, "MULTIPLY",
                     math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", math_node(nt, "SUBTRACT", b, r), 0.3), 5.0, clamp=True),
                     1.0)
    # Silver: bright and nearly neutral.
    lum = math_node(nt, "ADD", math_node(nt, "MULTIPLY", g, 0.7), math_node(nt, "MULTIPLY", r, 0.3))
    chroma = math_node(nt, "ABSOLUTE", math_node(nt, "SUBTRACT", b, r))
    silver = math_node(nt, "MULTIPLY",
                       math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", lum, 0.5), 6.0, clamp=True),
                       math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", 0.15, chroma), 8.0, clamp=True))

    cyan = node(nt, "ShaderNodeRGB")
    cyan.outputs[0].default_value = (0.25, 0.85, 1.0, 1)
    bar = nt.nodes.new("ShaderNodeVectorMath")
    bar.operation = "SCALE"
    nt.links.new(cyan.outputs[0], bar.inputs[0])
    # The livery teal (stripes and the big nose swoosh) glows saturated cyan;
    # brighter would clip the swoosh to a white blob.
    nt.links.new(math_node(nt, "MULTIPLY", teal, 1.3), bar.inputs["Scale"])

    # Windows across every side-facing surface except the light bars; the
    # silver panels, which catch more light, glow a little brighter.
    not_bar = math_node(nt, "SUBTRACT", 1.0, teal)
    win = nt.nodes.new("ShaderNodeVectorMath")
    win.operation = "SCALE"
    nt.links.new(window_grid(nt), win.inputs[0])
    nt.links.new(math_node(nt, "MULTIPLY", math_node(nt, "MULTIPLY", not_bar,
                                                     math_node(nt, "ADD", math_node(nt, "MULTIPLY", silver, 0.3), 0.85)),
                           window_strength), win.inputs["Scale"])

    # Under-glow light bar along the lower side.
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    psep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], psep.inputs[0])
    zrel = math_node(nt, "SUBTRACT", psep.outputs["Z"], body_z0)
    nsep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Normal"], nsep.inputs[0])
    side = math_node(nt, "GREATER_THAN", math_node(nt, "ABSOLUTE", nsep.outputs["Y"]), 0.7)
    under = math_node(nt, "MULTIPLY",
                      math_node(nt, "GREATER_THAN", zrel, 0.11 * BODY_HEIGHT),
                      math_node(nt, "LESS_THAN", zrel, 0.125 * BODY_HEIGHT))
    # A light bar in every sixth window row (the rows left dark above), and
    # one along the top of the side.
    period = 6 * FLOOR
    frac = math_node(nt, "FRACT", math_node(nt, "DIVIDE", psep.outputs["Z"], period))
    floors = math_node(nt, "MULTIPLY",
                       math_node(nt, "MULTIPLY", math_node(nt, "GREATER_THAN", frac, 0.3 * FLOOR / period),
                                 math_node(nt, "LESS_THAN", frac, 0.7 * FLOOR / period)),
                       math_node(nt, "GREATER_THAN", zrel, 0.2 * BODY_HEIGHT))
    top = math_node(nt, "MULTIPLY",
                    math_node(nt, "GREATER_THAN", zrel, 0.86 * BODY_HEIGHT),
                    math_node(nt, "LESS_THAN", zrel, 0.875 * BODY_HEIGHT))
    under = math_node(nt, "MAXIMUM", under, math_node(nt, "MULTIPLY", side, top))
    white = node(nt, "ShaderNodeRGB")
    white.outputs[0].default_value = (0.85, 0.95, 1.0, 1)
    ug_w = nt.nodes.new("ShaderNodeVectorMath")
    ug_w.operation = "SCALE"
    nt.links.new(white.outputs[0], ug_w.inputs[0])
    nt.links.new(math_node(nt, "MULTIPLY", under, bar_strength * 0.8), ug_w.inputs["Scale"])
    cyan_bar = nt.nodes.new("ShaderNodeVectorMath")
    cyan_bar.operation = "SCALE"
    nt.links.new(cyan.outputs[0], cyan_bar.inputs[0])
    nt.links.new(math_node(nt, "MULTIPLY", math_node(nt, "MULTIPLY", side, floors), bar_strength * 0.35),
                 cyan_bar.inputs["Scale"])
    ug = nt.nodes.new("ShaderNodeVectorMath")
    ug.operation = "ADD"
    nt.links.new(ug_w.outputs[0], ug.inputs[0])
    nt.links.new(cyan_bar.outputs[0], ug.inputs[1])

    add1 = nt.nodes.new("ShaderNodeVectorMath")
    add1.operation = "ADD"
    nt.links.new(bar.outputs[0], add1.inputs[0])
    nt.links.new(win.outputs[0], add1.inputs[1])
    add2 = nt.nodes.new("ShaderNodeVectorMath")
    add2.operation = "ADD"
    nt.links.new(add1.outputs[0], add2.inputs[0])
    nt.links.new(ug.outputs[0], add2.inputs[1])
    nt.links.new(add2.outputs[0], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0
    # A sleeker, slightly metallic skin.
    bsdf.inputs["Roughness"].default_value = 0.45
    for link in list(bsdf.inputs["Roughness"].links):
        nt.links.remove(link)


def curtain_glass(window_strength):
    """The original glass, now a glazed facade with lit floors behind it."""
    mat = bpy.data.materials.new("curtain_glass")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.02, 0.025, 0.03, 1)
    bsdf.inputs["Roughness"].default_value = 0.08
    bsdf.inputs["Metallic"].default_value = 0.6
    s = nt.nodes.new("ShaderNodeVectorMath")
    s.operation = "SCALE"
    nt.links.new(window_grid(nt, density=1.0), s.inputs[0])
    s.inputs["Scale"].default_value = window_strength * 1.2
    nt.links.new(s.outputs[0], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0
    return mat


def hologram_material(name, path, tint, strength):
    mat = bpy.data.materials.new(f"holo_{name}")
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = node(nt, "ShaderNodeOutputMaterial", (900, 0))
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(path)
    tex.extension = "CLIP"
    # Scanlines across the hologram.
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    psep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], psep.inputs[0])
    scan = math_node(nt, "ADD", math_node(nt, "MULTIPLY",
                                          math_node(nt, "SINE", math_node(nt, "MULTIPLY", psep.outputs["Z"], 2.2)), 0.3), 0.75)
    alpha = math_node(nt, "MULTIPLY", tex.outputs["Alpha"], scan)
    # A dark translucent screen behind the artwork, so the signage reads
    # against the lit windows, plus a faint glow of the whole field.
    backing = nt.nodes.new("ShaderNodeEmission")
    backing.inputs["Color"].default_value = (*tint, 1)
    backing.inputs["Strength"].default_value = 0.05
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    screen = nt.nodes.new("ShaderNodeMixShader")
    screen.inputs["Fac"].default_value = 0.55
    nt.links.new(tr.outputs[0], screen.inputs[1])
    nt.links.new(backing.outputs[0], screen.inputs[2])
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*tint, 1)
    nt.links.new(math_node(nt, "MULTIPLY", alpha, strength), em.inputs["Strength"])
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(screen.outputs[0], add.inputs[0])
    nt.links.new(em.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], out.inputs["Surface"])
    return mat


# ---------------------------------------------------------------- scene

def setup_camera(scene, scale):
    cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.sensor_fit = "HORIZONTAL"
    cam.data.sensor_width = 24.0
    cam.data.lens = F_PX / SRC_W * 24.0
    cam.data.clip_start = 1.0
    cam.data.clip_end = 1e5
    cam.location = (0, 0, 0)
    cam.rotation_euler = (math.radians(90 + PITCH), 0, -math.radians(90 - YAW))
    scene.render.resolution_x = round(SRC_W * scale)
    scene.render.resolution_y = round(SRC_H * scale)
    bpy.context.view_layer.update()
    return cam


def to_px(scene, cam, p):
    v = world_to_camera_view(scene, cam, Vector(p))
    return v.x * SRC_W, (1 - v.y) * SRC_H


def ray(cam, px, py):
    d_cam = Vector(((px - SRC_W / 2) / F_PX, -(py - SRC_H / 2) / F_PX, -1.0))
    return (cam.matrix_world.to_3x3() @ d_cam).normalized()


def bisect(fn, lo, hi, iters=80):
    flo = fn(lo)
    for _ in range(iters):
        mid = 0.5 * (lo + hi)
        fm = fn(mid)
        if (fm > 0) == (flo > 0):
            lo, flo = mid, fm
        else:
            hi = mid
    return 0.5 * (lo + hi)


def solve_placement(scene, cam):
    """Point on the near bottom edge of the body, scaled so the roof lands
    at ROOF_Y, and the track position of the nose."""
    d = ray(cam, *BASE_PX)
    lam = bisect(lambda l: to_px(scene, cam, d * l + Vector((0, 0, BODY_HEIGHT)))[1] - ROOF_Y, 10.0, 1e5)
    base = d * lam

    def nose_err(x):
        return to_px(scene, cam, (x, base.y, base.z))[0] - NOSE_X

    # Walk left along the track until past the target (staying in front of
    # the camera), then bisect.
    lo, step = base.x, 10.0
    while nose_err(lo) > 0:
        lo -= step
        step *= 1.5
    x_nose = bisect(nose_err, lo, base.x)
    return base, x_nose


def build_train(scene, usdz, base, x_nose, workdir, window_strength, bar_strength):
    bpy.ops.wm.usd_import(filepath=usdz)
    # At this scale the seats, the pantograph (50 m tall) and the under-floor
    # boxes don't belong; the windows become the interior.
    drop = ("interior", "panto_", "undercarriage")
    for o in [o for o in scene.objects if o.type == "MESH" and o.name.startswith(drop)]:
        bpy.data.objects.remove(o, do_unlink=True)
    # Model frame: nose at +x, body from z 0.107 to 2.076, half-width 0.768.
    z0, z1, half_w, nose = 0.107, 2.076, 0.768, 6.686
    s = BODY_HEIGHT / (z1 - z0)
    rig = bpy.data.objects.new("train", None)
    scene.collection.objects.link(rig)
    for o in [o for o in scene.objects if o.parent is None and o not in (rig, scene.camera)]:
        o.parent = rig
    # Turn the train to face -x (toward the left of frame), scale, place.
    rig.rotation_euler = (0, 0, math.pi)
    rig.scale = (s, s, s)
    rig.location = (x_nose + nose * s, base.y + half_w * s, base.z - z0 * s)
    bpy.context.view_layer.update()

    body_z0 = base.z
    glass = curtain_glass(window_strength)
    for o in scene.objects:
        if o.type != "MESH":
            continue
        for i, slot in enumerate(o.material_slots):
            m = slot.material
            if m is None:
                continue
            if m.name.startswith("Glass"):
                o.material_slots[i].material = glass
            elif m.name in {"light"}:
                m.use_nodes = True
                b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
                # The light strip framing the windscreen: a cyan-white bar.
                b.inputs["Emission Color"].default_value = (0.7, 0.93, 1.0, 1)
                b.inputs["Emission Strength"].default_value = 3.5
    for m in bpy.data.materials:
        if m.name in {"exterior", "exterior_panto"} and not m.get("upgraded"):
            upgrade_body_material(m, body_z0, window_strength, bar_strength)
            m["upgraded"] = True

    # Holograms on the camera side (-y), a few metres off the skin, placed by
    # where they should land in the frame (source x pixels).
    tex = hologram_textures(workdir)
    y_face = base.y - 5.0

    def track_x_at(px):
        return bisect(lambda x: to_px(scene, scene.camera, (x, y_face, base.z + 0.5 * BODY_HEIGHT))[0] - px,
                      x_nose, x_nose + 3000.0)

    panels = [
        # name, frame x (px), height (fraction of body), width (m), tint, strength
        ("line", 520.0, 0.5, 85.0, (0.3, 0.9, 1.0), 1.6),
        ("logo", 735.0, 0.5, 55.0, (1.0, 0.3, 0.8), 1.6),
        ("ad", 960.0, 0.47, 95.0, (1.0, 0.68, 0.25), 1.5),
    ]
    for name, px, height_frac, width, tint, strength in panels:
        img = Image.open(tex[name])
        aspect = img.height / img.width
        bpy.ops.mesh.primitive_plane_add(size=1.0)
        p = bpy.context.active_object
        p.name = f"holo_{name}"
        p.scale = (width, width * aspect, 1)
        p.rotation_euler = (math.radians(90), 0, 0)
        p.location = (track_x_at(px), y_face, base.z + height_frac * BODY_HEIGHT)
        p.data.materials.append(hologram_material(name, tex[name], tint, strength))


def setup_world_and_lights(scene, base):
    world = bpy.data.worlds.new("night")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.012, 0.014, 0.02, 1)
    bg.inputs[1].default_value = 1.0
    # City glow from below and the warm sky above, both faint.
    for name, loc, energy, colour, size in (
        ("city_glow", (base.x, base.y - 400, base.z - 300), 1.5e4, (1.0, 0.7, 0.45), 600),
        ("sky_glow", (base.x + 300, base.y - 200, base.z + 600), 4e3, (0.9, 0.8, 0.65), 900),
    ):
        light = bpy.data.lights.new(name, "AREA")
        light.energy = energy
        light.color = colour
        light.size = size
        obj = bpy.data.objects.new(name, light)
        scene.collection.objects.link(obj)
        obj.location = loc
        obj.rotation_euler = (Vector((base.x, base.y + 40, base.z + 50)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()


def main():
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    cam = setup_camera(scene, args.scale)
    base, x_nose = solve_placement(scene, cam)
    print(f"placement: near bottom edge at {tuple(round(c, 1) for c in base)} m, nose at x={x_nose:.1f} m, "
          f"distance {base.length:.0f} m")
    build_train(scene, os.path.abspath(args.usdz), base, x_nose, args.workdir,
                window_strength=2.6, bar_strength=14.0)
    setup_world_and_lights(scene, base)

    r = scene.render
    r.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    r.film_transparent = True
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    r.filepath = os.path.abspath(args.out)
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
