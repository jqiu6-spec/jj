"""Photoreal Cycles renders of the lemonade storyboard.

Steps (from the sketch):
  1 cut  2 squeeze  3 pour  4 add water + sugar  5 pour into cup  6 final

Usage (needs the `bpy` module, e.g. `pip install bpy==5.2.2`):
  python lemonade.py --step 1 [--scale 0.5] [--samples 64] [--out renders/step1.png]
"""
import argparse
import math
import os
import random
import time

import bpy  # noqa: I001  (bpy must load before bmesh/mathutils)
import bmesh
from mathutils import Matrix, Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, "textures")

# ---------------------------------------------------------------------------
# small utilities
# ---------------------------------------------------------------------------


def smoothstep(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def srgb(r, g, b, a=1.0):
    def f(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (f(r), f(g), f(b), a)


def wrap_pi(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def qbez(p0, c, p1, n):
    """Quadratic bezier points (excluding p0)."""
    out = []
    for i in range(1, n + 1):
        t = i / n
        out.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
                    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]))
    return out


def catmull(pts, n_per=12):
    pts = [Vector(p) for p in pts]
    P = [pts[0]] + pts + [pts[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n_per):
            t = k / n_per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    out.append(pts[-1])
    return out


def make_obj(name, verts, faces, mats=(), mat_idx=None, uvs=None, recalc=True,
             sharp_angle=None, smooth=True):
    bm = bmesh.new()
    bv = [bm.verts.new(v) for v in verts]
    bm.verts.index_update()
    made = []
    for k, f in enumerate(faces):
        try:
            bf = bm.faces.new([bv[i] for i in f])
        except ValueError:
            continue
        if mat_idx is not None:
            bf.material_index = mat_idx[k]
        made.append(bf)
    if uvs is not None:
        lay = bm.loops.layers.uv.new("UVMap")
        for bf in made:
            for lp in bf.loops:
                lp[lay].uv = uvs[lp.vert.index]
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:
        f.smooth = smooth
    if sharp_angle is not None:
        for e in bm.edges:
            if e.is_manifold and e.calc_face_angle(0.0) > sharp_angle:
                e.smooth = False
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    for m in mats:
        me.materials.append(m)
    return obj


def revolve(name, profile, seg=128, fn=None, tags=None, mats=(), mat_of=None, uv_of=None,
            sharp_angle=math.radians(50)):
    """Revolve a CCW (r, z) profile around Z.  fn(theta, tag, r, z) -> (r, z) deforms it."""
    verts, faces, rings, uvs, ring_tag = [], [], [], [], []
    for i, (r, z) in enumerate(profile):
        tag = tags[i] if tags else None
        if r < 1e-9:
            rings.append([len(verts)] * seg)
            verts.append((0.0, 0.0, z))
            uvs.append(uv_of(0.0, tag, 0.0) if uv_of else (0.5, 0.5))
        else:
            ring = []
            for j in range(seg):
                th = 2 * math.pi * j / seg
                rr, zz = fn(th, tag, r, z) if fn else (r, z)
                ring.append(len(verts))
                verts.append((rr * math.cos(th), rr * math.sin(th), zz))
                uvs.append(uv_of(th, tag, r) if uv_of else (j / seg, i / len(profile)))
            rings.append(ring)
        ring_tag.append(tag)
    mat_idx = []
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        mi = mat_of(ring_tag[i], ring_tag[i + 1]) if mat_of else 0
        for j in range(seg):
            j2 = (j + 1) % seg
            q = []
            for v in (a[j], a[j2], b[j2], b[j]):
                if v not in q:
                    q.append(v)
            if len(q) >= 3:
                faces.append(q)
                mat_idx.append(mi)
    return make_obj(name, verts, faces, mats=mats, mat_idx=mat_idx, uvs=uvs,
                    sharp_angle=sharp_angle)


def sweep(name, pts, radii, seg=24, mats=(), squash=None, up=None, cap=True):
    """Tube along a polyline.  squash[i] scales the cross-section along the binormal."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    T = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    frames = []
    if up is not None:
        up = Vector(up)
        for t in T:
            nn = (up - t * up.dot(t)).normalized()
            frames.append((nn, t.cross(nn)))
    else:
        ref = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0))
        nn = T[0].cross(ref).normalized()
        for t in T:
            nn = (nn - t * nn.dot(t)).normalized()
            frames.append((nn, t.cross(nn)))
    verts, faces = [], []
    for i in range(n):
        nn, bb = frames[i]
        s = squash[i] if squash else 1.0
        for j in range(seg):
            a = 2 * math.pi * j / seg
            verts.append(pts[i] + radii[i] * (math.cos(a) * nn + s * math.sin(a) * bb))
    for i in range(n - 1):
        for j in range(seg):
            j2 = (j + 1) % seg
            faces.append((i * seg + j, i * seg + j2, (i + 1) * seg + j2, (i + 1) * seg + j))
    if cap:
        for end, sign in ((0, -1), (n - 1, 1)):
            c = len(verts)
            verts.append(pts[end] + T[end] * radii[end] * 0.6 * sign)
            for j in range(seg):
                faces.append((end * seg + j, end * seg + (j + 1) % seg, c))
    return make_obj(name, verts, faces, mats=mats, sharp_angle=None)


def bake_world(obj):
    """Apply the object's transform (and modifiers) to its mesh."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    me.transform(obj.matrix_world)
    obj.modifiers.clear()
    obj.data = me
    obj.matrix_world = Matrix.Identity(4)
    return obj


def cut_below(obj, z):
    """Keep the part of a closed (baked) mesh below the horizontal plane z and cap it."""
    bake_world(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, z), plane_no=(0, 0, 1),
                                 clear_outer=True)
    cut = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
    out = bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=cut)
    for f in out["geom"]:
        if isinstance(f, bmesh.types.BMFace):
            f.smooth = False
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def drop_to(obj, z=0.0):
    bpy.context.view_layer.update()
    mw = obj.matrix_world
    zmin = min((mw @ v.co).z for v in obj.data.vertices)
    obj.location.z += z - zmin


def world_point(obj, local):
    bpy.context.view_layer.update()
    return obj.matrix_world @ Vector(local)


# ---------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------


class NT:
    def __init__(self, mat):
        self.nt = mat.node_tree
        self.n = self.nt.nodes
        self.l = self.nt.links

    @staticmethod
    def sock(coll, key):
        if isinstance(key, int):
            return coll[key]
        for s in coll:
            if s.identifier == key:
                return s
        for s in coll:
            if s.name == key and getattr(s, "enabled", True):
                return s
        for s in coll:
            if s.name == key:
                return s
        raise KeyError(key)

    def set(self, s, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.l.new(v, s)
        elif isinstance(v, bpy.types.Node):
            self.l.new(v.outputs[0], s)
        else:
            s.default_value = v

    def node(self, typ, props=None, **ins):
        nd = self.n.new(typ)
        for k, v in (props or {}).items():
            setattr(nd, k, v)
        for k, v in ins.items():
            self.set(self.sock(nd.inputs, k.replace("__", " ")), v)
        return nd

    def inp(self, nd, key, v):
        self.set(self.sock(nd.inputs, key), v)

    def out(self, nd, key):
        return self.sock(nd.outputs, key)

    def math(self, op, a, b=0.0, clamp=False):
        nd = self.n.new("ShaderNodeMath")
        nd.operation = op
        nd.use_clamp = clamp
        self.set(nd.inputs[0], a)
        self.set(nd.inputs[1], b)
        return nd.outputs[0]

    def mix(self, fac, a, b, blend="MIX"):
        nd = self.n.new("ShaderNodeMix")
        nd.data_type = "RGBA"
        nd.blend_type = blend
        self.set(self.sock(nd.inputs, "Factor_Float"), fac)
        self.set(self.sock(nd.inputs, "A_Color"), a)
        self.set(self.sock(nd.inputs, "B_Color"), b)
        return self.sock(nd.outputs, "Result_Color")

    def maprange(self, v, a, b, c=0.0, d=1.0, interp="SMOOTHSTEP"):
        nd = self.n.new("ShaderNodeMapRange")
        nd.interpolation_type = interp
        self.set(nd.inputs[0], v)
        nd.inputs[1].default_value = a
        nd.inputs[2].default_value = b
        nd.inputs[3].default_value = c
        nd.inputs[4].default_value = d
        return nd.outputs[0]


def new_mat(name):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    nt.nodes.clear()
    t = NT(m)
    out = t.node("ShaderNodeOutputMaterial")
    bsdf = t.node("ShaderNodeBsdfPrincipled")
    t.l.new(bsdf.outputs[0], out.inputs["Surface"])
    return m, t, bsdf, out


MATS = {}


def mat_peel():
    if "peel" in MATS:
        return MATS["peel"]
    m, t, b, _ = new_mat("lemon_peel")
    tc = t.node("ShaderNodeTexCoord")
    obj = t.out(tc, "Object")
    pores = t.node("ShaderNodeTexVoronoi", Vector=obj, Scale=420.0, Randomness=1.0)
    pores_d = t.out(pores, "Distance")
    pore_h = t.maprange(pores_d, 0.0, 0.55, 0.0, 1.0)
    und = t.node("ShaderNodeTexNoise", Vector=obj, Scale=55.0, Detail=6.0, Roughness=0.55)
    big = t.node("ShaderNodeTexNoise", Vector=obj, Scale=9.0, Detail=3.0)
    height = t.math("ADD", t.math("MULTIPLY", pore_h, 0.65), t.math("MULTIPLY", t.out(und, "Fac"), 0.5))
    bump = t.node("ShaderNodeBump", Strength=0.45, Distance=0.0006, Height=height)
    # colour: yellow with mottling, slightly greener toward the poles (object Z is the long axis)
    sep = t.node("ShaderNodeSeparateXYZ", Vector=obj)
    pole = t.maprange(t.math("ABSOLUTE", t.out(sep, "Z")), 0.024, 0.04, 0.0, 1.0)
    c1 = t.mix(t.out(big, "Fac"), srgb(238, 186, 22), srgb(250, 212, 52))
    c2 = t.mix(t.math("MULTIPLY", pole, 0.55), c1, srgb(196, 178, 40))
    spots = t.node("ShaderNodeTexVoronoi", Vector=obj, Scale=150.0)
    c3 = t.mix(t.math("MULTIPLY", t.maprange(t.out(spots, "Distance"), 0.05, 0.0, 0, 1), 0.25), c2,
               srgb(205, 140, 10))
    t.inp(b, "Base Color", c3)
    t.inp(b, "Roughness", t.math("ADD", 0.36, t.math("MULTIPLY", pore_h, -0.12)))
    t.inp(b, "Subsurface Weight", 0.25)
    t.inp(b, "Subsurface Radius", (1.0, 0.75, 0.3))
    t.inp(b, "Subsurface Scale", 0.0025)
    t.inp(b, "Coat Weight", 0.35)
    t.inp(b, "Coat Roughness", 0.22)
    t.inp(b, "Normal", t.out(bump, "Normal"))
    t.inp(b, "Coat Normal", t.out(bump, "Normal"))
    MATS["peel"] = m
    return m


def load_img(name, data=False):
    path = os.path.join(TEX, name)
    img = bpy.data.images.load(path, check_existing=True)
    if data:
        img.colorspace_settings.name = "Non-Color"
    return img


def mat_cut(spent=False):
    key = "cut_spent" if spent else "cut"
    if key in MATS:
        return MATS[key]
    m, t, b, _ = new_mat("lemon_" + key)
    tc = t.node("ShaderNodeTexCoord")
    uv = t.out(tc, "UV")
    col = t.node("ShaderNodeTexImage", {"image": load_img("lemon_cut_color.png"), "extension": "EXTEND"}, Vector=uv)
    hgt = t.node("ShaderNodeTexImage", {"image": load_img("lemon_cut_height.png", True), "extension": "EXTEND",
                                         "interpolation": "Cubic"}, Vector=uv)
    msk = t.node("ShaderNodeTexImage", {"image": load_img("lemon_cut_mask.png", True), "extension": "EXTEND"},
                 Vector=uv)
    sep = t.node("ShaderNodeSeparateColor", Color=t.out(msk, "Color"))
    pulp = t.out(sep, "Red")
    bump = t.node("ShaderNodeBump", Strength=0.9 if not spent else 1.0, Distance=0.0012,
                  Height=t.out(hgt, "Color"))
    base = t.out(col, "Color")
    if spent:
        base = t.mix(0.35, base, srgb(200, 170, 90), "MULTIPLY")
    t.inp(b, "Base Color", base)
    t.inp(b, "Roughness", t.math("ADD", 0.45, t.math("MULTIPLY", pulp, -0.3)))
    t.inp(b, "Subsurface Weight", t.math("ADD", 0.35, t.math("MULTIPLY", pulp, 0.5)))
    t.inp(b, "Subsurface Radius", (1.0, 0.8, 0.35))
    t.inp(b, "Subsurface Scale", 0.004)
    t.inp(b, "Coat Weight", t.math("MULTIPLY", pulp, 0.0 if spent else 0.8))
    t.inp(b, "Coat Roughness", 0.04)
    t.inp(b, "Coat IOR", 1.34)
    t.inp(b, "Normal", t.out(bump, "Normal"))
    MATS[key] = m
    return m


def shadow_pass(t, bsdf, out, tint=(1, 1, 1, 1)):
    """Let shadow rays through refractive surfaces (cheap stand-in for caustics)."""
    lp = t.node("ShaderNodeLightPath")
    tr = t.node("ShaderNodeBsdfTransparent", Color=tint)
    mx = t.node("ShaderNodeMixShader", Fac=t.out(lp, "Is Shadow Ray"))
    t.l.new(bsdf.outputs[0], mx.inputs[1])
    t.l.new(tr.outputs[0], mx.inputs[2])
    t.l.new(mx.outputs[0], out.inputs["Surface"])


def mat_glass(name="glass", rough=0.0, tint=(1, 1, 1, 1)):
    if name in MATS:
        return MATS[name]
    m, t, b, out = new_mat(name)
    t.inp(b, "Base Color", tint)
    t.inp(b, "Transmission Weight", 1.0)
    t.inp(b, "Roughness", rough)
    t.inp(b, "IOR", 1.5)
    shadow_pass(t, b, out, (0.92, 0.92, 0.92, 1))
    MATS[name] = m
    return m


def mat_liquid(name, ior=1.333, scatter=None, density=0.0, absorb=None, absorb_density=0.0, anis=0.3):
    if name in MATS:
        return MATS[name]
    m, t, b, out = new_mat(name)
    t.inp(b, "Base Color", (1, 1, 1, 1))
    t.inp(b, "Transmission Weight", 1.0)
    t.inp(b, "Roughness", 0.0)
    t.inp(b, "IOR", ior)
    shadow_pass(t, b, out, (0.95, 0.95, 0.95, 1))
    if density > 0:
        # cloudiness (scatter) and colour (absorption) are controlled separately
        sc = t.node("ShaderNodeVolumeScatter", Color=scatter, Density=density, Anisotropy=anis)
        ab = t.node("ShaderNodeVolumeAbsorption", Color=absorb, Density=absorb_density)
        add = t.node("ShaderNodeAddShader")
        t.l.new(sc.outputs[0], add.inputs[0])
        t.l.new(ab.outputs[0], add.inputs[1])
        t.l.new(add.outputs[0], out.inputs["Volume"])
    MATS[name] = m
    return m


def mat_lemonade():
    return mat_liquid("lemonade", scatter=(1.0, 0.97, 0.88, 1), density=11.0,
                      absorb=(1.0, 0.86, 0.3, 1), absorb_density=26.0)


def mat_juice():
    return mat_liquid("juice", scatter=(1.0, 0.95, 0.8, 1), density=22.0,
                      absorb=(1.0, 0.8, 0.16, 1), absorb_density=40.0)


def mat_water():
    return mat_liquid("water")


def mat_ice():
    if "ice" in MATS:
        return MATS["ice"]
    m, t, b, out = new_mat("ice")
    tc = t.node("ShaderNodeTexCoord")
    nz = t.node("ShaderNodeTexNoise", Vector=t.out(tc, "Object"), Scale=90.0, Detail=4.0)
    bump = t.node("ShaderNodeBump", Strength=0.12, Distance=0.0005, Height=t.out(nz, "Fac"))
    t.inp(b, "Transmission Weight", 1.0)
    t.inp(b, "Roughness", 0.03)
    t.inp(b, "IOR", 1.31)
    t.inp(b, "Normal", t.out(bump, "Normal"))
    shadow_pass(t, b, out, (0.9, 0.9, 0.9, 1))
    v = t.node("ShaderNodeVolumeScatter", Color=(1, 1, 1, 1), Density=6.0)
    t.l.new(v.outputs[0], out.inputs["Volume"])
    MATS["ice"] = m
    return m


def mat_ceramic():
    if "ceramic" in MATS:
        return MATS["ceramic"]
    m, t, b, _ = new_mat("ceramic")
    t.inp(b, "Base Color", srgb(240, 238, 232))
    t.inp(b, "Roughness", 0.3)
    t.inp(b, "Subsurface Weight", 0.15)
    t.inp(b, "Subsurface Scale", 0.002)
    t.inp(b, "Coat Weight", 1.0)
    t.inp(b, "Coat Roughness", 0.03)
    MATS["ceramic"] = m
    return m


def mat_steel():
    if "steel" in MATS:
        return MATS["steel"]
    m, t, b, _ = new_mat("steel")
    tc = t.node("ShaderNodeTexCoord")
    mp = t.node("ShaderNodeMapping", Vector=t.out(tc, "Object"))
    t.inp(mp, "Scale", (4.0, 600.0, 600.0))
    nz = t.node("ShaderNodeTexNoise", Vector=mp, Scale=3.0, Detail=2.0)
    t.inp(b, "Base Color", srgb(205, 205, 208))
    t.inp(b, "Metallic", 1.0)
    t.inp(b, "Roughness", t.maprange(t.out(nz, "Fac"), 0.3, 0.7, 0.12, 0.24, "LINEAR"))
    t.inp(b, "Anisotropic", 0.5)
    MATS["steel"] = m
    return m


def mat_plain(name, color, rough=0.5, **extra):
    if name in MATS:
        return MATS[name]
    m, t, b, _ = new_mat(name)
    t.inp(b, "Base Color", color)
    t.inp(b, "Roughness", rough)
    for k, v in extra.items():
        t.inp(b, k.replace("_", " "), v)
    MATS[name] = m
    return m


def mat_wood(name="wood", light=(222, 192, 146), dark=(170, 128, 82), scale=(1.5, 30.0, 30.0)):
    if name in MATS:
        return MATS[name]
    m, t, b, _ = new_mat(name)
    tc = t.node("ShaderNodeTexCoord")
    mp = t.node("ShaderNodeMapping", Vector=t.out(tc, "Object"))
    t.inp(mp, "Scale", scale)
    nz = t.node("ShaderNodeTexNoise", Vector=mp, Scale=1.2, Detail=12.0, Roughness=0.62, Distortion=0.6)
    wave = t.node("ShaderNodeTexWave", {"wave_type": "BANDS", "bands_direction": "Y", "wave_profile": "SAW"},
                  Vector=mp, Scale=0.9, Distortion=14.0, Detail=8.0, Detail__Scale=1.5)
    fine = t.node("ShaderNodeTexNoise", Vector=mp, Scale=14.0, Detail=6.0)
    rings = t.maprange(t.out(wave, "Fac"), 0.7, 1.0, 0.0, 1.0)
    col = t.mix(t.maprange(t.out(nz, "Fac"), 0.3, 0.7), srgb(*light), srgb(*dark))
    col = t.mix(t.math("MULTIPLY", rings, 0.35), col, srgb(*dark))
    col = t.mix(t.math("MULTIPLY", t.out(fine, "Fac"), 0.18), col, srgb(*dark))
    bump = t.node("ShaderNodeBump", Strength=0.15, Distance=0.0003, Height=t.out(fine, "Fac"))
    t.inp(b, "Base Color", col)
    t.inp(b, "Roughness", 0.55)
    t.inp(b, "Normal", t.out(bump, "Normal"))
    MATS[name] = m
    return m


def mat_marble():
    if "marble" in MATS:
        return MATS["marble"]
    m, t, b, _ = new_mat("marble")
    tc = t.node("ShaderNodeTexCoord")
    obj = t.out(tc, "Object")
    n1 = t.node("ShaderNodeTexNoise", Vector=obj, Scale=2.2, Detail=12.0, Roughness=0.62, Distortion=3.5)
    vein = t.maprange(t.math("ABSOLUTE", t.math("SUBTRACT", t.out(n1, "Fac"), 0.5)), 0.0, 0.022, 1.0, 0.0)
    n2 = t.node("ShaderNodeTexNoise", Vector=obj, Scale=7.0, Detail=6.0, Distortion=1.0)
    vein2 = t.maprange(t.math("ABSOLUTE", t.math("SUBTRACT", t.out(n2, "Fac"), 0.5)), 0.0, 0.01, 1.0, 0.0)
    cloud = t.node("ShaderNodeTexNoise", Vector=obj, Scale=3.0, Detail=4.0)
    base = t.mix(t.out(cloud, "Fac"), srgb(232, 230, 226), srgb(244, 243, 240))
    col = t.mix(t.math("MULTIPLY", vein, 0.55), base, srgb(150, 150, 155))
    col = t.mix(t.math("MULTIPLY", vein2, 0.25), col, srgb(170, 170, 172))
    t.inp(b, "Base Color", col)
    t.inp(b, "Roughness", 0.16)
    t.inp(b, "Subsurface Weight", 0.1)
    t.inp(b, "Subsurface Scale", 0.003)
    MATS["marble"] = m
    return m


def mat_sugar():
    if "sugar" in MATS:
        return MATS["sugar"]
    m, t, b, _ = new_mat("sugar")
    tc = t.node("ShaderNodeTexCoord")
    vor = t.node("ShaderNodeTexVoronoi", Vector=t.out(tc, "Object"), Scale=1400.0)
    bump = t.node("ShaderNodeBump", Strength=0.8, Distance=0.0004, Height=t.out(vor, "Distance"))
    t.inp(b, "Base Color", srgb(246, 245, 240))
    t.inp(b, "Roughness", 0.32)
    t.inp(b, "Subsurface Weight", 0.6)
    t.inp(b, "Subsurface Scale", 0.0015)
    t.inp(b, "Normal", t.out(bump, "Normal"))
    MATS["sugar"] = m
    return m


def mat_crystal():
    return mat_plain("crystal", (1, 1, 1, 1), 0.08, Transmission_Weight=0.85, IOR=1.55)


def mat_straw():
    if "straw" in MATS:
        return MATS["straw"]
    m, t, b, _ = new_mat("paper_straw")
    tc = t.node("ShaderNodeTexCoord")
    sep = t.node("ShaderNodeSeparateXYZ", Vector=t.out(tc, "Object"))
    ang = t.math("ARCTAN2", t.out(sep, "Y"), t.out(sep, "X"))
    s = t.math("ADD", t.math("MULTIPLY", t.out(sep, "Z"), 55.0), t.math("MULTIPLY", ang, 1 / (2 * math.pi)))
    stripe = t.maprange(t.math("PINGPONG", s, 0.5), 0.22, 0.28)
    paper = t.node("ShaderNodeTexNoise", Vector=t.out(tc, "Object"), Scale=900.0, Detail=2.0)
    t.inp(b, "Base Color", t.mix(stripe, srgb(250, 248, 240), srgb(245, 196, 40)))
    t.inp(b, "Roughness", 0.65)
    bump = t.node("ShaderNodeBump", Strength=0.2, Distance=0.0002, Height=t.out(paper, "Fac"))
    t.inp(b, "Normal", t.out(bump, "Normal"))
    MATS["straw"] = m
    return m


# ---------------------------------------------------------------------------
# props
# ---------------------------------------------------------------------------

LEMON_A, LEMON_B = 0.032, 0.0265


def _lemon_shape(a, b, seed, nub_top=0.0065, nub_bot=0.0035, wob=0.022):
    off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))

    def fn(th, tag, r, z):
        if r <= 0:
            return r, z
        p = Vector((math.cos(th) * 1.4, math.sin(th) * 1.4, z / a * 1.2)) + off
        return r * (1 + wob * noise.noise(p) + 0.012 * noise.noise(p * 3.0)), z

    def prof(u0, u1, n):
        pts = []
        for i in range(n + 1):
            # cosine spacing gives more detail near the nubs
            w = i / n
            u = u0 + (u1 - u0) * (0.5 - 0.5 * math.cos(math.pi * w)) if u0 < 0 else u0 + (u1 - u0) * math.sin(
                0.5 * math.pi * w)
            r = b * math.sqrt(max(0.0, 1 - u * u)) * (1 - 0.06 * u * u)
            nub = nub_top if u > 0 else nub_bot
            z = a * u + math.copysign(nub * abs(u) ** 9, u)
            pts.append((r, z))
        return pts

    return fn, prof


def lemon(name, seed=0, a=LEMON_A, b=LEMON_B):
    fn, prof = _lemon_shape(a, b, seed)
    pts = prof(-1.0, 1.0, 96)
    pts[0] = (0.0, pts[0][1])
    pts[-1] = (0.0, pts[-1][1])
    return revolve(name, pts, seg=96, fn=fn, mats=(mat_peel(),), sharp_angle=None)


def lemon_half(name, seed=0, a=LEMON_A, b=LEMON_B, bulge=0.0012, spent=False):
    """Half lemon, cut face at z=0 facing -Z, dome toward +Z."""
    fn, prof = _lemon_shape(a, b, seed)
    profile, tags = [], []
    ns = 14
    for i in range(ns):
        s = i / ns
        profile.append((b * s, -bulge * (1 - s * s)))
        tags.append(("cap", s))
    for (r, z) in prof(0.0, 1.0, 60):
        profile.append((r, z))
        tags.append(("peel", None))
    profile[-1] = (0.0, profile[-1][1])

    def uv_of(th, tag, r):
        if tag and tag[0] == "cap":
            s = tag[1]
            return (0.5 + 0.5 * s * math.cos(th), 0.5 + 0.5 * s * math.sin(th))
        return (0.5 + 0.5 * math.cos(th), 0.5 + 0.5 * math.sin(th))

    # faces starting on a cap ring (including the outermost band up to the rind) get the cut-face material
    return revolve(name, profile, seg=128, fn=fn, tags=tags, mats=(mat_peel(), mat_cut(spent)),
                   mat_of=lambda t0, t1: 1 if t0[0] == "cap" else 0, uv_of=uv_of,
                   sharp_angle=math.radians(55))


def lemon_wheel(name, b=LEMON_B * 0.97, thick=0.0065, seed=3):
    fn, _ = _lemon_shape(LEMON_A, b, seed)
    profile, tags = [], []
    ns = 12
    for i in range(ns + 1):
        s = i / ns
        profile.append((b * s, -thick / 2))
        tags.append(("cap", s))
    profile.append((b, thick / 2))
    tags.append(("cap", 1.0))
    for i in range(ns - 1, -1, -1):
        s = i / ns
        profile.append((b * s, thick / 2))
        tags.append(("cap", s))

    def uv_of(th, tag, r):
        s = tag[1]
        return (0.5 + 0.5 * s * math.cos(th), 0.5 + 0.5 * s * math.sin(th))

    def mat_of(t0, t1):
        return 0 if (t0[1] == 1.0 and t1[1] == 1.0) else 1

    return revolve(name, profile, seg=128, fn=lambda th, tg, r, z: (fn(th, tg, r, 0.0)[0], z), tags=tags,
                   mats=(mat_peel(), mat_cut()), mat_of=mat_of, uv_of=uv_of, sharp_angle=math.radians(50))


def vessel(r_out, H, t, base, n=70, corner=0.006, inner_corner=0.008, cavity_top=0.06, eps=0.00015):
    """Closed CCW profile of a glass vessel and the profile of its (slightly enlarged) cavity."""
    out = [(0.0, 0.0), (r_out(0.0) - corner, 0.0)]
    out += qbez((r_out(0.0) - corner, 0.0), (r_out(0.0), 0.0), (r_out(corner), corner), 5)
    for i in range(1, n + 1):
        z = corner + (H - corner) * i / n
        out.append((r_out(z), z))
    # rounded rim
    cx = r_out(H) - t / 2
    for i in range(1, 12):
        ph = math.pi * i / 12
        out.append((cx + t / 2 * math.cos(ph), H + t / 2 * math.sin(ph)))
    inner = []
    for i in range(n + 1):
        z = H - (H - base - inner_corner) * i / n
        inner.append((r_out(z) - t, z))
    zc = base + inner_corner
    ic = qbez((r_out(zc) - t, zc), (r_out(base) - t, base), (r_out(base) - t - inner_corner, base), 6)
    inner += ic
    prof = out + inner + [(0.0, base)]

    cav = [(0.0, base - eps), (r_out(base) - t - inner_corner, base - eps)]
    rc = [(r + eps, z) for (r, z) in reversed(inner)]
    cav += [(p[0], p[1] - (eps if p[1] <= base + 1e-6 else 0)) for p in rc[1:]]
    top = cav[-1]
    cav += [(top[0], H + cavity_top), (0.0, H + cavity_top)]
    return prof, cav


def tumbler_fn(z):
    return 0.0325 + (0.0395 - 0.0325) * (z / 0.125) ** 1.1


def tumbler(name):
    prof, cav = vessel(tumbler_fn, 0.125, 0.0022, 0.012, corner=0.004, inner_corner=0.006)
    obj = revolve(name, prof, seg=128, mats=(mat_glass(),), sharp_angle=None)
    return obj, cav


PITCHER_CTRL = [(0.0, 0.056), (0.03, 0.0615), (0.08, 0.0635), (0.14, 0.058), (0.185, 0.0515), (0.21, 0.0545)]


def pitcher_fn(z, scale=1.0):
    from scipy.interpolate import PchipInterpolator
    zs = [p[0] * scale for p in PITCHER_CTRL]
    rs = [p[1] * scale for p in PITCHER_CTRL]
    f = PchipInterpolator(zs, rs)
    return float(f(min(max(z, 0.0), zs[-1])))


def spout_fn(H, width=0.33, ext=0.017, lift=0.004, zone=0.05):
    def fn(th, tag, r, z):
        if r <= 0:
            return r, z
        a = wrap_pi(th)
        g = math.exp(-(a / width) ** 2)
        side = math.exp(-((abs(a) - width * 1.6) / (width * 0.6)) ** 2)
        h = smoothstep(H - zone, H + 0.002, z) ** 2
        return r + ext * g * h - 0.004 * side * h, z + lift * g * h
    return fn


def pitcher(name, scale=1.0, handle=True, mat=None):
    H = 0.21 * scale
    rf = lambda z: pitcher_fn(z, scale)
    prof, cav = vessel(rf, H, 0.003 * scale, 0.009 * scale, n=90, corner=0.008 * scale,
                       inner_corner=0.012 * scale)
    fn = spout_fn(H, ext=0.017 * scale, lift=0.004 * scale, zone=0.05 * scale)
    mat = mat or mat_glass()
    obj = revolve(name, prof, seg=160, fn=fn, mats=(mat,), sharp_angle=None)
    parts = [obj]
    if handle:
        z0, z1 = H - 0.032 * scale, 0.05 * scale
        ctrl = [(-(rf(z0) - 0.004 * scale), 0, z0),
                (-(rf(z0) + 0.03 * scale), 0, z0 + 0.002 * scale),
                (-(rf(0.13 * scale) + 0.05 * scale), 0, 0.13 * scale),
                (-(rf(0.08 * scale) + 0.042 * scale), 0, 0.075 * scale),
                (-(rf(z1) - 0.004 * scale), 0, z1)]
        pts = catmull(ctrl, 14)
        h = sweep(name + "_handle", pts, [0.0072 * scale] * len(pts), seg=24, mats=(mat,),
                  squash=[1.35] * len(pts), up=(0, 1, 0))
        parts.append(h)
    for p in parts[1:]:
        p.parent = obj
    return obj, cav, fn


def cavity_liquid(name, cav, fn, container, level, mat, seg=128):
    liq = revolve(name, cav, seg=seg, fn=fn, mats=(mat,), sharp_angle=None)
    liq.matrix_world = container.matrix_world.copy()
    return cut_below(liq, level)


# --- juicer -----------------------------------------------------------------

J_FLOOR, J_TIP, J_RIM = 0.009, 0.074, 0.038
J_CONE_R = 0.031


def _juicer_parts():
    outer = [(0.0, 0.0), (0.044, 0.0)]
    outer += qbez((0.044, 0.0), (0.072, 0.002), (0.0762, J_RIM), 16)
    rim = []
    for i in range(1, 12):
        ph = math.pi * i / 12
        rim.append((0.0732 + 0.003 * math.cos(ph), J_RIM + 0.003 * math.sin(ph)))
    wall = qbez((0.0702, J_RIM), (0.067, J_FLOOR), (0.052, J_FLOOR), 16)
    floor = [(0.042, J_FLOOR)]
    floor += qbez((0.042, J_FLOOR), (J_CONE_R + 0.002, J_FLOOR), (J_CONE_R, J_FLOOR + 0.006), 5)
    cone = []
    z0 = J_FLOOR + 0.006
    for i in range(1, 40):
        w = i / 40
        z = z0 + (J_TIP - z0) * (1 - (1 - w) ** 1.6)
        r = J_CONE_R * ((J_TIP - z) / (J_TIP - z0)) ** 0.62
        cone.append((r, z))
    cone.append((0.0, J_TIP))
    return outer, rim, wall, floor, cone


def juicer_fn(th, tag, r, z):
    if r <= 0:
        return r, z
    if tag == "cone":
        k = 12
        f = (th * k / (2 * math.pi)) % 1.0
        tri = abs(2 * f - 1)  # 1 on ridges, 0 in grooves
        fade = smoothstep(J_TIP, J_TIP - 0.014, z) * smoothstep(J_FLOOR + 0.002, J_FLOOR + 0.012, z)
        return r * (1 - 0.2 * fade * (1 - tri) ** 1.4), z
    a = wrap_pi(th)
    g = math.exp(-(a / 0.3) ** 2)
    h = smoothstep(0.016, J_RIM + 0.003, z)
    return r + 0.014 * g * h * h, z - 0.003 * g * h


def juicer(name):
    outer, rim, wall, floor, cone = _juicer_parts()
    prof = outer + rim + wall + floor + cone
    tags = ["o"] * len(outer) + ["o"] * len(rim) + ["o"] * len(wall) + ["o"] * len(floor) + ["cone"] * len(cone)
    obj = revolve(name, prof, seg=192, fn=juicer_fn, tags=tags, mats=(mat_ceramic(),), sharp_angle=None)
    # loop handle opposite the spout
    ctrl = [(-0.071, 0, 0.033), (-0.088, 0, 0.034), (-0.1, 0, 0.029), (-0.098, 0, 0.019), (-0.084, 0, 0.016),
            (-0.07, 0, 0.018)]
    pts = catmull(ctrl, 10)
    h = sweep(name + "_handle", pts, [0.0042] * len(pts), seg=20, mats=(mat_ceramic(),),
              squash=[1.6] * len(pts), up=(0, 0, 1))
    h.parent = obj
    return obj


def juicer_cavity(eps=0.0003):
    outer, rim, wall, floor, cone = _juicer_parts()
    cav = list(reversed([(r - eps, z) for (r, z) in cone]))  # tip -> base
    cav[0] = (0.0, J_TIP + 0.0)
    tags = ["cone"] * len(cav)
    fl = [(r, z - eps) for (r, z) in reversed(floor)]
    wl = [(r + eps, z) for (r, z) in reversed(wall)]
    cav += fl + wl
    tags += ["o"] * (len(fl) + len(wl))
    cav += [(0.0702 + eps, J_TIP + 0.01), (0.0, J_TIP + 0.01)]
    tags += ["o", "o"]
    # profile runs tip->down cone->floor->wall->top: CCW in (r, z)
    return cav, tags


def juicer_liquid(name, jobj, level, mat):
    cav, tags = juicer_cavity()
    liq = revolve(name, cav, seg=192, fn=juicer_fn, tags=tags, mats=(mat,), sharp_angle=None)
    liq.matrix_world = jobj.matrix_world.copy()
    return cut_below(liq, level)


def spout_dir(obj):
    d = obj.matrix_world.to_3x3() @ Vector((1, 0, 0))
    d.z = 0
    return d.normalized()


def juicer_lip_local():
    r, z = juicer_fn(0.0, "o", 0.0762, J_RIM + 0.003)
    return Vector((r - 0.001, 0.0, z))


# --- knife / board / misc -----------------------------------------------------


def knife(name):
    L, nx, nk = 0.2, 70, 10
    verts, faces = [], []

    def top(x):
        return 0.046 if x < 0.11 else 0.046 - (0.046 - 0.006) * smoothstep(0.11, L, x) ** 1.25

    def bot(x):
        return 0.006 * smoothstep(0.06, L, x) ** 2

    def thick(x, f):
        ts = 0.0024 * (1 - 0.6 * x / L)
        return max(0.00012, ts * f ** 0.9)

    grid = []
    for side in (1, -1):
        g = []
        for i in range(nx + 1):
            x = L * i / nx
            row = []
            for k in range(nk + 1):
                f = k / nk
                y = bot(x) + (top(x) - bot(x)) * f
                if i == nx:
                    y = bot(x)
                row.append(len(verts))
                verts.append((x, y, side * thick(x, f) / 2))
            g.append(row)
        grid.append(g)
    A, B = grid
    for i in range(nx):
        for k in range(nk):
            faces.append((A[i][k], A[i + 1][k], A[i + 1][k + 1], A[i][k + 1]))
            faces.append((B[i][k], B[i][k + 1], B[i + 1][k + 1], B[i + 1][k]))
        faces.append((A[i][nk], A[i + 1][nk], B[i + 1][nk], B[i][nk]))  # spine
        faces.append((A[i][0], B[i][0], B[i + 1][0], A[i + 1][0]))  # edge
    for k in range(nk):
        faces.append((A[0][k], A[0][k + 1], B[0][k + 1], B[0][k]))
        faces.append((A[nx][k], B[nx][k], B[nx][k + 1], A[nx][k + 1]))
    blade = make_obj(name, verts, faces, mats=(mat_steel(),), sharp_angle=math.radians(35))
    # handle
    bpy.ops.mesh.primitive_cube_add(size=1)
    hd = bpy.context.active_object
    hd.name = name + "_handle"
    hd.scale = (0.115, 0.026, 0.017)
    hd.location = (-0.0625, 0.022, 0)
    bev = hd.modifiers.new("bev", "BEVEL")
    bev.width = 0.0075
    bev.segments = 6
    hd.data.materials.append(mat_plain("handle", srgb(34, 30, 28), 0.32, Coat_Weight=0.5))
    for p in hd.data.polygons:
        p.use_smooth = True
    bpy.ops.mesh.primitive_cube_add(size=1)
    bo = bpy.context.active_object
    bo.name = name + "_bolster"
    bo.scale = (0.012, 0.03, 0.0175)
    bo.location = (-0.004, 0.024, 0)
    b2 = bo.modifiers.new("bev", "BEVEL")
    b2.width = 0.004
    b2.segments = 4
    bo.data.materials.append(mat_steel())
    for p in bo.data.polygons:
        p.use_smooth = True
    for x in (-0.03, -0.065, -0.1):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.0028, depth=0.0176, location=(x, 0.022, 0))
        rv = bpy.context.active_object
        rv.data.materials.append(mat_steel())
        rv.parent = blade
    hd.parent = blade
    bo.parent = blade
    return blade


def rounded_slab(name, w, d, h, rad, mat, bevel=0.003):
    pts = []
    for cx, cy, a0 in ((w / 2 - rad, d / 2 - rad, 0), (-w / 2 + rad, d / 2 - rad, 90),
                       (-w / 2 + rad, -d / 2 + rad, 180), (w / 2 - rad, -d / 2 + rad, 270)):
        for i in range(13):
            a = math.radians(a0 + 90 * i / 12)
            pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
    n = len(pts)
    verts = [(x, y, 0.0) for x, y in pts] + [(x, y, h) for x, y in pts]
    faces = [list(range(n - 1, -1, -1)), list(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    obj = make_obj(name, verts, faces, mats=(mat,), sharp_angle=math.radians(40))
    bev = obj.modifiers.new("bev", "BEVEL")
    bev.width = bevel
    bev.segments = 4
    bev.limit_method = "ANGLE"
    bev.angle_limit = math.radians(40)
    bev.harden_normals = False
    return obj


def ice_cube(name, size=0.024, seed=0, mat=None):
    rnd = random.Random(seed)
    sx, sy, sz = (size * rnd.uniform(0.9, 1.1) for _ in range(3))
    rad = size * 0.2
    n = 8
    verts, faces = [], []
    idx = {}

    def vid(p):
        key = tuple(round(c, 6) for c in p)
        if key not in idx:
            idx[key] = len(verts)
            verts.append(key)
        return idx[key]

    # 6 faces of a subdivided cube in [-1, 1]
    for axis in range(3):
        for sgn in (-1, 1):
            for i in range(n):
                for j in range(n):
                    quad = []
                    for (a, b) in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)):
                        u, v = -1 + 2 * a / n, -1 + 2 * b / n
                        p = [0, 0, 0]
                        p[axis] = sgn
                        p[(axis + 1) % 3] = u
                        p[(axis + 2) % 3] = v
                        quad.append(vid(p))
                    if sgn < 0:
                        quad.reverse()
                    faces.append(quad)
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    off = Vector((seed * 1.3, seed * 0.7, seed * 2.1))
    out = []
    for (x, y, z) in verts:
        p = Vector((x * hx, y * hy, z * hz))
        c = Vector((max(-hx + rad, min(hx - rad, p.x)), max(-hy + rad, min(hy - rad, p.y)),
                    max(-hz + rad, min(hz - rad, p.z))))
        d = p - c
        q = c + d.normalized() * rad if d.length > 1e-9 else p
        q += q.normalized() * size * 0.03 * noise.noise(q * 60 + off)
        out.append(tuple(q))
    return make_obj(name, out, faces, mats=(mat or mat_ice(),), sharp_angle=None)


def straw(name, length=0.195, r=0.0031, t=0.0003):
    prof = [(r - t, 0.0), (r, 0.0), (r, length), (r - t, length)]
    # CCW: inner bottom -> outer bottom -> outer top -> inner top (closes back down the inner wall)
    return revolve(name, prof, seg=40, mats=(mat_straw(),), sharp_angle=math.radians(60))


def pour_stream(name, start, direction, v0, z_end, r0, mat, n=70, seed=0, lead=0.006):
    g = 9.81
    direction = Vector(direction).normalized()
    t_end = math.sqrt(max(2 * (start.z - z_end) / g, 1e-6))
    pts, radii, squash = [], [], []
    rnd = random.Random(seed)
    ph1, ph2 = rnd.uniform(0, 6), rnd.uniform(0, 6)
    # a short lead-in inside the source liquid, along the pour direction
    for k in range(4):
        f = k / 4
        pts.append(start - direction * lead * (1 - f) + Vector((0, 0, 0.001 * (1 - f))))
        radii.append(r0 * 1.15)
        squash.append(0.45)
    for i in range(n + 1):
        w = i / n
        tt = t_end * w ** 1.5
        p = start + direction * v0 * tt - Vector((0, 0, 0.5 * g * tt * tt))
        speed = math.hypot(v0, g * tt)
        rr = r0 * math.sqrt(max(v0, 0.12) / max(speed, 0.12))
        rr *= 1 + 0.06 * math.sin(w * 31 + ph1) + 0.04 * math.sin(w * 67 + ph2)
        pts.append(p)
        radii.append(rr)
        squash.append(0.45 + 0.55 * smoothstep(0.0, 0.35, w))
    return sweep(name, pts, radii, seg=28, mats=(mat,), squash=squash, up=(0, 0, 1))


def spoon(name, sugar=True):
    """Teaspoon with its bowl centred at the origin, handle toward -X."""
    a, b, d = 0.021, 0.0145, 0.0065
    verts, faces = [], []
    nu, nphi = 14, 48
    th = 0.0011
    rings_top, rings_bot = [], []
    for side, store in ((0, rings_top), (1, rings_bot)):
        center = len(verts)
        verts.append((0, 0, -d + (-th if side else 0)))
        store.append([center] * nphi)
        for i in range(1, nu + 1):
            u = i / nu
            ring = []
            for j in range(nphi):
                ph = 2 * math.pi * j / nphi
                x, y = a * u * math.cos(ph), b * u * math.sin(ph)
                if x > 0:
                    x *= 1 + 0.15 * u  # pointier front
                z = -d * (1 - u * u) - (th if side else 0) * (1 - 0.5 * u)
                ring.append(len(verts))
                verts.append((x, y, z))
            store.append(ring)
    for rings in (rings_top, rings_bot):
        for i in range(nu):
            for j in range(nphi):
                j2 = (j + 1) % nphi
                q = []
                for v in (rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]):
                    if v not in q:
                        q.append(v)
                faces.append(q)
    for j in range(nphi):
        j2 = (j + 1) % nphi
        faces.append((rings_top[nu][j], rings_top[nu][j2], rings_bot[nu][j2], rings_bot[nu][j]))
    bowl = make_obj(name, verts, faces, mats=(mat_steel(),), sharp_angle=None)
    ctrl = [(-0.019, 0, 0.0003), (-0.035, 0, 0.002), (-0.07, 0, 0.008), (-0.11, 0, 0.014), (-0.125, 0, 0.0155)]
    pts = catmull(ctrl, 12)
    radii = [0.0022 + 0.0035 * smoothstep(0.4, 1.0, i / (len(pts) - 1)) for i in range(len(pts))]
    radii[0] = 0.0028
    h = sweep(name + "_handle", pts, radii, seg=20, mats=(mat_steel(),), squash=[0.33] * len(pts), up=(0, 0, 1))
    h.parent = bowl
    if sugar:
        sverts, sfaces = [], []
        top = len(sverts)
        sverts.append((0.002, 0, 0.0058))
        rings = [[top] * nphi]
        for i in range(1, nu + 1):
            u = i / nu
            ring = []
            for j in range(nphi):
                ph = 2 * math.pi * j / nphi
                x, y = 0.93 * a * u * math.cos(ph), 0.93 * b * u * math.sin(ph)
                p = Vector((x, y, 0))
                z = 0.0058 * (1 - u ** 1.7) + 0.0005 * noise.noise(p * 400) - 0.0004
                ring.append(len(sverts))
                sverts.append((x, y, z))
            rings.append(ring)
        bot = len(sverts)
        sverts.append((0, 0, -d * 0.8))
        rings.append([bot] * nphi)
        for i in range(len(rings) - 1):
            for j in range(nphi):
                j2 = (j + 1) % nphi
                q = []
                for v in (rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]):
                    if v not in q:
                        q.append(v)
                sfaces.append(q)
        s = make_obj(name + "_sugar", sverts, sfaces, mats=(mat_sugar(),), sharp_angle=None)
        s.parent = bowl
    return bowl


def grains(name, centers, size=0.0007, mat=None, seed=0):
    rnd = random.Random(seed)
    verts, faces = [], []
    cube_v = [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]
    cube_f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    for c in centers:
        s = size * rnd.uniform(0.6, 1.2)
        rot = Matrix.Rotation(rnd.uniform(0, 6.3), 3, "X") @ Matrix.Rotation(rnd.uniform(0, 6.3), 3, "Y")
        base = len(verts)
        for v in cube_v:
            p = rot @ Vector((v[0] * s * 0.5, v[1] * s * 0.5, v[2] * s * 0.5 * rnd.uniform(0.7, 1.0)))
            verts.append(tuple(Vector(c) + p))
        faces += [tuple(base + i for i in f) for f in cube_f]
    return make_obj(name, verts, faces, mats=(mat or mat_crystal(),), recalc=False, smooth=False)


def bowl(name, R=0.05, H=0.036, t=0.0045):
    rf = lambda z: R * (0.62 + 0.38 * math.sin(0.5 * math.pi * min(z / H, 1.0)) ** 0.7)
    prof, cav = vessel(rf, H, t, 0.006, n=40, corner=0.005, inner_corner=0.012)
    return revolve(name, prof, seg=128, mats=(mat_ceramic(),), sharp_angle=None), rf


def heap(name, R, h, z0, seed=0):
    verts, faces = [], []
    nu, nphi = 20, 64
    verts.append((0, 0, z0 + h))
    rings = [[0] * nphi]
    for i in range(1, nu + 1):
        u = i / nu
        ring = []
        for j in range(nphi):
            ph = 2 * math.pi * j / nphi
            p = Vector((R * u * math.cos(ph), R * u * math.sin(ph), 0))
            z = z0 + h * (1 - u ** 1.8) + 0.0012 * noise.noise(p * 90 + Vector((seed, 0, 0)))
            ring.append(len(verts))
            verts.append((p.x, p.y, z))
        rings.append(ring)
    bot = len(verts)
    verts.append((0, 0, z0 - 0.02))
    rings.append([bot] * nphi)
    for i in range(len(rings) - 1):
        for j in range(nphi):
            j2 = (j + 1) % nphi
            q = []
            for v in (rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]):
                if v not in q:
                    q.append(v)
            faces.append(q)
    return make_obj(name, verts, faces, mats=(mat_sugar(),), sharp_angle=None)


def droplets(name, glass_rf, zmin, zmax, count, seed=0, angle_range=(-2.2, -0.9)):
    """Condensation beads on the outside of a tumbler."""
    rnd = random.Random(seed)
    verts, faces = [], []
    n_lat, n_lon = 5, 10
    for _ in range(count):
        z = rnd.uniform(zmin, zmax)
        th = rnd.uniform(*angle_range)
        rr = glass_rf(z)
        s = rnd.choice([0.0003, 0.0004, 0.0005, 0.0007, 0.001]) * rnd.uniform(0.8, 1.2)
        nrm = Vector((math.cos(th), math.sin(th), 0))
        c = Vector((rr * math.cos(th), rr * math.sin(th), z)) - nrm * s * 0.25
        tang = Vector((-math.sin(th), math.cos(th), 0))
        up = Vector((0, 0, 1))
        base = len(verts)
        verts.append(tuple(c + nrm * s * 0.75))
        for i in range(1, n_lat + 1):
            lat = (math.pi / 2) * i / n_lat
            for j in range(n_lon):
                lon = 2 * math.pi * j / n_lon
                d = tang * math.cos(lon) * math.sin(lat) + up * math.sin(lon) * math.sin(lat) * 1.15
                verts.append(tuple(c + d * s + nrm * s * 0.75 * math.cos(lat)))
        for j in range(n_lon):
            faces.append((base, base + 1 + j, base + 1 + (j + 1) % n_lon))
        for i in range(n_lat - 1):
            for j in range(n_lon):
                a0 = base + 1 + i * n_lon
                a1 = a0 + n_lon
                faces.append((a0 + j, a1 + j, a1 + (j + 1) % n_lon, a0 + (j + 1) % n_lon))
        last = base + 1 + (n_lat - 1) * n_lon
        cb = len(verts)
        verts.append(tuple(c - nrm * s * 0.1))
        for j in range(n_lon):
            faces.append((last + (j + 1) % n_lon, last + j, cb))
    return make_obj(name, verts, faces, mats=(mat_water(),), sharp_angle=None)


# ---------------------------------------------------------------------------
# environment
# ---------------------------------------------------------------------------


def setup(scale, samples):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.012
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    sc.cycles.max_bounces = 32
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 6
    sc.cycles.transmission_bounces = 32
    sc.cycles.volume_bounces = 8
    sc.cycles.transparent_max_bounces = 8
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.cycles.blur_glossy = 1.0
    sc.cycles.sample_clamp_indirect = 8.0
    sc.render.resolution_x = int(1800 * scale)
    sc.render.resolution_y = int(1350 * scale)
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    # PBR Neutral keeps the lemons' saturated yellows (AgX bleaches them)
    sc.view_settings.view_transform = "Khronos PBR Neutral"
    sc.view_settings.exposure = -0.45
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_depth = "8"

    # world: soft, slightly cool sky light
    w = bpy.data.worlds.new("world")
    sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], ramp.inputs[0])
    ramp.color_ramp.elements[0].position = 0.45
    ramp.color_ramp.elements[0].color = srgb(70, 66, 60)
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = srgb(225, 232, 240)
    nt.links.new(ramp.outputs[0], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.12
    nt.links.new(bg.outputs[0], out.inputs["Surface"])

    # marble counter + plaster wall
    bpy.ops.mesh.primitive_plane_add(size=3.0, location=(0, 0.3, 0))
    counter = bpy.context.active_object
    counter.name = "counter"
    counter.data.materials.append(mat_marble())
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0.95, 0.75), rotation=(math.radians(90), 0, 0))
    wall = bpy.context.active_object
    wall.scale = (3.0, 1.5, 1)
    wall.name = "wall"
    m, t, b, _ = new_mat("plaster")
    tcn = t.node("ShaderNodeTexCoord")
    nz = t.node("ShaderNodeTexNoise", Vector=t.out(tcn, "Object"), Scale=4.0, Detail=6.0)
    t.inp(b, "Base Color", t.mix(t.out(nz, "Fac"), srgb(168, 180, 186), srgb(184, 195, 200)))
    t.inp(b, "Roughness", 0.9)
    wall.data.materials.append(m)

    # window key light (back-left), soft fill (front-right), rim light behind the props
    def area(name, loc, target, size, size_y, power, color=(1, 1, 1), cam_vis=False):
        ld = bpy.data.lights.new(name, "AREA")
        ld.shape = "RECTANGLE"
        ld.size, ld.size_y = size, size_y
        ld.energy = power
        ld.color = color
        o = link(bpy.data.objects.new(name, ld))
        o.location = loc
        o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        o.visible_camera = cam_vis
        return o

    area("window", (-0.95, 0.55, 0.75), (0, 0.05, 0.05), 1.0, 1.3, 60, (1.0, 0.97, 0.92))
    area("fill", (0.9, -0.9, 0.55), (0, 0, 0.08), 1.4, 1.0, 14, (0.95, 0.97, 1.0))
    area("rim", (0.35, 0.75, 0.32), (0, 0, 0.08), 0.7, 0.35, 10, (1.0, 0.96, 0.9))

    # black flags: only seen in reflections/refractions, they give glass edges definition
    flag = mat_plain("flag", (0.005, 0.005, 0.005, 1), 0.9)
    for loc in ((-0.55, -0.35, 0.3), (0.6, 0.0, 0.3)):
        bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
        f = bpy.context.active_object
        f.scale = (0.45, 0.7, 1)
        f.rotation_euler = (Vector((0, 0.05, 0.15)) - Vector(loc)).to_track_quat("Z", "Y").to_euler()
        f.data.materials.append(flag)
        f.visible_camera = False
        f.visible_shadow = False
        f.visible_diffuse = False
    return sc


def camera(loc, target, lens=55, fstop=4.0, focus=None):
    cd = bpy.data.cameras.new("cam")
    cd.lens = lens
    cd.sensor_width = 36
    cam = link(bpy.data.objects.new("cam", cd))
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cd.dof.use_dof = True
    cd.dof.aperture_fstop = fstop
    cd.dof.focus_distance = (Vector(focus or target) - Vector(loc)).length
    cd.clip_start = 0.01
    bpy.context.scene.camera = cam
    return cam


def place(obj, loc=None, rot=None):
    if rot is not None:
        obj.rotation_euler = tuple(math.radians(a) for a in rot)
    if loc is not None:
        obj.location = loc
    bpy.context.view_layer.update()
    return obj


# ---------------------------------------------------------------------------
# the six steps
# ---------------------------------------------------------------------------

BOARD_TOP = 0.022


def step1():
    """Cut: a lemon halved on a wooden board with a chef's knife."""
    board = rounded_slab("board", 0.44, 0.28, BOARD_TOP, 0.03, mat_wood())
    place(board, (0.0, 0.03, 0.0), (0, 0, -6))
    whole = lemon("lemon_whole", seed=1)
    place(whole, (-0.105, 0.085, 0), (0, 90, 28))
    drop_to(whole, BOARD_TOP)
    h1 = lemon_half("half_up", seed=2)
    place(h1, (0.035, 0.02, 0), (180 + 8, 4, 30))
    drop_to(h1, BOARD_TOP)
    h2 = lemon_half("half_side", seed=2)
    place(h2, (-0.045, -0.035, 0), (-100, 0, 22))
    drop_to(h2, BOARD_TOP - 0.001)
    wheel = lemon_wheel("wheel", seed=5)
    place(wheel, (0.105, -0.045, 0), (2, 0, 10))
    drop_to(wheel, BOARD_TOP)
    kn = knife("knife")
    place(kn, (0.135, -0.1, 0), (0, 0, 172))
    drop_to(kn, BOARD_TOP)
    bg = lemon("lemon_bg", seed=7)
    place(bg, (-0.23, 0.27, 0), (0, 90, -35))
    drop_to(bg, 0)
    bg2 = lemon("lemon_bg2", seed=9)
    place(bg2, (-0.16, 0.33, 0), (0, 90, 60))
    drop_to(bg2, 0)
    camera((0.03, -0.46, 0.36), (0.0, 0.025, 0.035), lens=50, fstop=5.6, focus=(0.0, 0.0, 0.04))


def step2():
    """Squeeze: a lemon half pressed onto a ceramic reamer, juice pooling in the dish."""
    j = juicer("juicer")
    place(j, (0, 0, 0), (0, 0, -25))
    juicer_liquid("juice_pool", j, J_FLOOR + 0.0085, mat_juice())
    h = lemon_half("half_pressed", seed=4)
    place(h, (0.002, 0.0, J_TIP - 0.030), (4, -5, 0))
    h2 = lemon_half("half_fresh", seed=6)
    place(h2, (0.115, -0.07, 0), (180 + 6, 0, 0))
    drop_to(h2, 0)
    spent = lemon_half("half_spent", seed=8)
    spent.scale = (1.0, 1.0, 0.8)
    place(spent, (-0.12, -0.04, 0), (-115, 0, -40))
    drop_to(spent, 0)
    wl = lemon("lemon_bg", seed=3)
    place(wl, (-0.09, 0.15, 0), (0, 90, 20))
    drop_to(wl, 0)
    wl2 = lemon("lemon_bg2", seed=11)
    place(wl2, (0.12, 0.2, 0), (0, 90, -50))
    drop_to(wl2, 0)
    # a few seeds in the juice
    for k, (x, y) in enumerate(((0.045, -0.02), (0.04, 0.025), (-0.05, 0.01))):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0035, location=(x, y, J_FLOOR + 0.008),
                                             segments=24, ring_count=12)
        s = bpy.context.active_object
        s.scale = (1.0, 0.45, 0.3)
        s.rotation_euler = (0, 0, k * 1.3)
        s.data.materials.append(mat_plain("seed", srgb(236, 226, 186), 0.3, Subsurface_Weight=0.4))
        for p in s.data.polygons:
            p.use_smooth = True
    camera((0.02, -0.43, 0.32), (0.0, 0.005, 0.035), lens=52, fstop=5.0, focus=(0.0, -0.02, 0.04))


def step3():
    """Pour: juice from the juicer into a glass pitcher."""
    p, cav, fn = pitcher("pitcher")
    place(p, (0.07, 0.04, 0), (0, 0, 180 + 35))
    juice_level = 0.033
    cavity_liquid("pitcher_juice", cav, fn, p, juice_level, mat_juice())
    j = juicer("juicer")
    place(j, (0, 0, 0), (22, 36, 0))
    lip_local = juicer_lip_local()
    target_lip = Vector((0.045, 0.04, 0.262))
    j.location = target_lip - (j.matrix_world.to_3x3() @ lip_local)
    bpy.context.view_layer.update()
    lip = world_point(j, lip_local)
    juicer_liquid("juicer_juice", j, lip.z + 0.0004, mat_juice())
    d = spout_dir(j)
    pour_stream("stream", lip + d * 0.0005 + Vector((0, 0, -0.0012)), d, 0.17, juice_level - 0.004, 0.0034,
                mat_juice(), seed=1)
    for k, (x, y, sd) in enumerate(((-0.16, -0.05, 2), (-0.11, 0.18, 5))):
        h = lemon_half("spent%d" % k, seed=sd)
        h.scale = (1, 1, 0.8)
        place(h, (x, y, 0), (180 + 10, 0, k * 40))
        drop_to(h, 0)
    wl = lemon("lemon_bg", seed=12)
    place(wl, (0.2, 0.17, 0), (0, 90, -30))
    drop_to(wl, 0)
    camera((0.0, -0.72, 0.36), (0.02, 0.04, 0.17), lens=44, fstop=5.6, focus=(0.06, 0.03, 0.15))


def step4():
    """Add water and sugar to the pitcher."""
    p, cav, fn = pitcher("pitcher")
    place(p, (0.0, 0.03, 0), (0, 0, 200))
    level = 0.105
    cavity_liquid("pitcher_lemonade", cav, fn, p, level, mat_lemonade())
    # water jug pouring from the right (its spout faces -X)
    jug, jcav, jfn = pitcher("jug", scale=0.72, mat=mat_ceramic())
    place(jug, (0, 0, 0), (0, 64, 180))
    lip_local = Vector((pitcher_fn(0.21 * 0.72, 0.72) + 0.017 * 0.72 - 0.0015, 0, 0.21 * 0.72 + 0.004 * 0.72))
    target = Vector((0.03, 0.03, 0.29))
    jug.location = target - (jug.matrix_world.to_3x3() @ lip_local)
    bpy.context.view_layer.update()
    lip = world_point(jug, lip_local)
    cavity_liquid("jug_water", jcav, jfn, jug, lip.z + 0.0005, mat_water())
    pour_stream("water_stream", lip + Vector((-0.0005, 0, -0.0012)), (-1, 0, 0), 0.16, level - 0.004, 0.0036,
                mat_water(), seed=4)
    # spoon of sugar from the left
    sp = spoon("spoon")
    sp.scale = (1.45, 1.45, 1.45)
    place(sp, (-0.045, 0.0, 0.25), (-18, 28, -8))
    tip = world_point(sp, (0.024, 0.0, -0.001))
    rnd = random.Random(3)
    cs = []
    for _ in range(900):
        t = rnd.random() ** 1.6
        z = tip.z - t * (tip.z - level)
        spread = 0.0018 + 0.005 * t
        cs.append((tip.x + 0.006 * t + rnd.gauss(0, spread), tip.y + rnd.gauss(0, spread * 0.8), z))
    grains("falling_sugar", cs, size=0.0011)
    # sugar bowl
    bw, rf = bowl("sugar_bowl")
    place(bw, (-0.155, -0.075, 0), (0, 0, 0))
    hp = heap("sugar_heap", 0.041, 0.012, 0.024, seed=2)
    place(hp, (-0.155, -0.075, 0))
    w1 = lemon("lemon1", seed=13)
    place(w1, (0.16, -0.06, 0), (0, 90, 15))
    drop_to(w1, 0)
    h1 = lemon_half("half1", seed=14)
    place(h1, (0.205, 0.035, 0), (180 + 8, 0, 0))
    drop_to(h1, 0)
    camera((0.0, -0.74, 0.31), (0.0, 0.02, 0.165), lens=50, fstop=5.6, focus=(0.0, 0.03, 0.15))


def tumbler_with_ice(name, loc, level, n_ice, seed=0, rot=0):
    g, cav = tumbler(name)
    place(g, loc, (0, 0, rot))
    cavity_liquid(name + "_lemonade", cav, None, g, level, mat_lemonade())
    rnd = random.Random(seed)
    spots = [(-0.011, -0.012), (0.012, -0.008), (0.0, 0.013), (-0.013, 0.01), (0.013, 0.013)]
    for k in range(n_ice):
        ic = ice_cube("%s_ice%d" % (name, k), size=rnd.uniform(0.021, 0.025), seed=seed * 10 + k)
        dx, dy = spots[k]
        place(ic, (loc[0] + dx, loc[1] + dy, level - 0.009 + 0.012 * (k % 2) - 0.004 * (k // 2)),
              (rnd.uniform(-25, 25), rnd.uniform(-25, 25), rnd.uniform(0, 90)))
    return g


def step5():
    """Pour into cup: lemonade from the pitcher into an iced glass."""
    tumbler_with_ice("glass", (0.075, -0.01, 0), 0.062, 3, seed=2)
    p, cav, fn = pitcher("pitcher")
    place(p, (0, 0, 0), (0, 48, 0))
    lip_local = Vector((pitcher_fn(0.21) + 0.017 - 0.0015, 0, 0.21 + 0.004))
    target = Vector((0.052, -0.01, 0.205))
    p.location = target - (p.matrix_world.to_3x3() @ lip_local)
    bpy.context.view_layer.update()
    lip = world_point(p, lip_local)
    cavity_liquid("pitcher_lemonade", cav, fn, p, lip.z + 0.0006, mat_lemonade())
    pour_stream("stream", lip + Vector((0.0004, 0, -0.0012)), (1, 0, 0), 0.19, 0.058, 0.0052, mat_lemonade(),
                seed=7)
    w1 = lemon("lemon1", seed=15)
    place(w1, (0.2, 0.12, 0), (0, 90, -20))
    drop_to(w1, 0)
    h1 = lemon_half("half1", seed=16)
    place(h1, (0.17, -0.1, 0), (180 + 6, 0, 0))
    drop_to(h1, 0)
    camera((0.03, -0.64, 0.24), (0.035, 0.0, 0.135), lens=50, fstop=5.6, focus=(0.07, -0.01, 0.1))


def step6():
    """Final: an iced glass of lemonade with a lemon wheel and a paper straw."""
    level = 0.108
    tumbler_with_ice("glass", (0, 0, 0), level, 4, seed=5)
    st = straw("straw")
    place(st, (0.012, 0.012, 0.014), (-9, 12, 0))
    wh = lemon_wheel("wheel", seed=4)
    rim_r = tumbler_fn(0.125)
    th = math.radians(-35)
    place(wh, ((rim_r + 0.008) * math.cos(th), (rim_r + 0.008) * math.sin(th), 0.125 - 0.003),
          (90, 0, math.degrees(th)))
    droplets("condensation", tumbler_fn, 0.015, level - 0.004, 420, seed=3, angle_range=(-2.6, -0.5))
    # background
    p, cav, fn = pitcher("pitcher")
    place(p, (-0.17, 0.26, 0), (0, 0, 150))
    cavity_liquid("pitcher_lemonade", cav, fn, p, 0.15, mat_lemonade())
    for k, (x, y, rz, sd) in enumerate(((0.13, 0.14, 30, 21), (0.19, 0.2, -60, 22))):
        w = lemon("lemon%d" % k, seed=sd)
        place(w, (x, y, 0), (0, 90, rz))
        drop_to(w, 0)
    h1 = lemon_half("half", seed=23)
    place(h1, (0.095, -0.05, 0), (180 + 7, 0, 0))
    drop_to(h1, 0)
    camera((0.0, -0.5, 0.14), (0.0, 0.0, 0.098), lens=60, fstop=3.2, focus=(0.0, -0.035, 0.08))


STEPS = {1: step1, 2: step2, 3: step3, 4: step4, 5: step5, 6: step6}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", type=int, required=True)
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--samples", type=int, default=256)
    ap.add_argument("--out", default=None)
    ap.add_argument("--blend", default=None)
    args = ap.parse_args()
    sc = setup(args.scale, args.samples)
    STEPS[args.step]()
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend))
    sc.render.filepath = os.path.abspath(args.out or os.path.join(HERE, "renders", "step%d.png" % args.step))
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print("rendered step %d in %.1fs -> %s" % (args.step, time.time() - t, sc.render.filepath))


if __name__ == "__main__":
    main()
