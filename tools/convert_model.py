#!/usr/bin/env python3
"""Convert a gun model into a static .glb that Trackline loads.

    pip install usd-core numpy pillow pygltflib
    python3 tools/convert_model.py INPUT OUTPUT.glb [options]

Inputs: .usdz / .usdc / .usda / .usd, .obj (+ .mtl), .glb / .gltf, and .fbx
(through FBX2glTF: `npm install fbx2gltf`, or set FBX2GLTF=/path/to/FBX2glTF).

Output convention, which Trackline expects:
  metres, +X toward the muzzle, +Y up, +Z the gun's right side.
Knives use the same axes with the origin at the pivot (the karambit's ring),
set with --translate. Use --rotate to turn the model into that frame, for example
  --rotate y90      turn 90 degrees about Y (repeat or combine: --rotate y90 --rotate x-90)
  --flip-x          point the muzzle the other way (mirrors, then fixes winding)

Every mesh becomes one named glTF node with all transforms baked in, so
Trackline can map parts such as "stockWood" or "magazine" to skin zones.
Skeletons and animation are dropped; skinned meshes keep their bind pose.

Materials: UsdPreviewSurface (metal/rough and spec/gloss), OBJ/MTL colours and
maps, and existing glTF materials. Missing or wrong textures can be supplied:
  --tex MATERIAL=PREFIX   textures for MATERIAL from PREFIX + suffix, where the
                          suffix is one of _DF/_BaseColor/_Albedo/_D (colour),
                          _NM/_Normal/_N (normal), _M/_Metallic, _R/_Roughness,
                          _AO; the extension (.png/.jpg/.tga) is found for you
  --dx-normal MATERIAL    the material's normal map is DirectX style (green down)
  --emissive MATERIAL=#rrggbb   make a material glow (sights, lasers)
"""
import argparse
import glob
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile

import numpy as np
from PIL import Image
import pygltflib as gl


# --------------------------------------------------------------- data model
class Part:
    def __init__(self, name, P, N, UV, idx, mat):
        self.name, self.P, self.N, self.UV, self.idx, self.mat = name, P, N, UV, idx, mat


class Mat:
    def __init__(self, name):
        self.name = name
        self.base = None  # PIL RGB
        self.normal = None  # PIL RGB, OpenGL convention
        self.metal = None  # PIL L
        self.rough = None  # PIL L
        self.base_factor = [1, 1, 1, 1]
        self.metal_factor = 0.0
        self.rough_factor = 0.6
        self.emissive = None


def smooth_normals(P, idx):
    N = np.zeros_like(P)
    t = idx.reshape(-1, 3)
    fn = np.cross(P[t[:, 1]] - P[t[:, 0]], P[t[:, 2]] - P[t[:, 0]])
    for k in range(3):
        np.add.at(N, t[:, k], fn)
    return N


def fan(counts):
    starts = np.concatenate([[0], np.cumsum(counts)[:-1]])
    out = []
    for s, c in zip(starts, counts):
        for k in range(1, c - 1):
            out.extend([s, s + k, s + k + 1])
    return np.array(out, dtype=np.int64)


def open_image(path, mode=None):
    im = Image.open(path)
    im.load()
    if mode:
        im = im.convert(mode)
    return im


def find_texture(prefix, suffixes):
    for suf in suffixes:
        for ext in ('.png', '.jpg', '.jpeg', '.tga', '.PNG', '.JPG', '.TGA'):
            p = prefix + suf + ext
            if os.path.exists(p):
                return p
    # Ripped texture sets often carry an extra word before the suffix, for
    # example Carbine_S0_Clean_NM next to Carbine_S0_DF.
    for suf in suffixes:
        for ext in ('.png', '.jpg', '.jpeg', '.tga', '.PNG', '.JPG', '.TGA'):
            hits = sorted(glob.glob(glob.escape(prefix) + '_*' + suf + ext))
            if hits:
                return hits[0]
    return None


def dx_to_gl(im):
    """Flip green and rebuild blue for a DirectX / Unreal normal map."""
    a = np.asarray(im.convert('RGB'), dtype=np.float32) / 255.0
    x = a[..., 0] * 2 - 1
    y = -(a[..., 1] * 2 - 1)
    z = np.sqrt(np.clip(1 - x * x - y * y, 0, 1))
    out = np.stack([x, y, z], -1) * 0.5 + 0.5
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), 'RGB')


# ---------------------------------------------------------------------- USD
def load_usd(src):
    from pxr import Gf, Usd, UsdGeom, UsdShade

    if src.lower().endswith('.usdz'):
        tmp = tempfile.mkdtemp()
        with zipfile.ZipFile(src) as z:
            z.extractall(tmp)
        layer = [n for n in os.listdir(tmp) if n.lower().endswith(('.usdc', '.usda', '.usd'))][0]
        root, stage = tmp, Usd.Stage.Open(os.path.join(tmp, layer))
    else:
        root, stage = os.path.dirname(os.path.abspath(src)), Usd.Stage.Open(src)

    def tex(inp):
        if not inp or not inp.HasConnectedSource():
            return None
        src_ = inp.GetConnectedSources()[0][0]
        t = UsdShade.Shader(src_.source.GetPrim())
        if t.GetIdAttr().Get() != 'UsdUVTexture' or t.GetInput('file').Get() is None:
            return None
        f = t.GetInput('file').Get()
        im = open_image(f.resolvedPath or os.path.join(root, f.path))
        ch = src_.sourceName
        if ch in ('r', 'g', 'b', 'a'):
            im = im.convert('RGBA').getchannel(ch.upper()) if im.mode not in ('L',) else im
        return im

    def const(shader, name, default):
        i = shader.GetInput(name)
        if i and not i.HasConnectedSource() and i.Get() is not None:
            return i.Get()
        return default

    mats, mat_ids = [], {}

    def material(usd_mat):
        key = str(usd_mat.GetPath()) if usd_mat else None
        if key in mat_ids:
            return mat_ids[key]
        m = Mat(usd_mat.GetPrim().GetName() if usd_mat else 'default')
        surf = None
        if usd_mat:
            for c in usd_mat.GetPrim().GetChildren():
                s = UsdShade.Shader(c)
                if s and s.GetIdAttr().Get() == 'UsdPreviewSurface':
                    surf = s
        if surf:
            base = tex(surf.GetInput('diffuseColor'))
            m.normal = tex(surf.GetInput('normal'))
            if const(surf, 'useSpecularWorkflow', 0):
                # Specular/glossiness: estimate metalness from the specular
                # level and take the metal colour from the specular colour.
                spec = tex(surf.GetInput('specularColor'))
                gloss = tex(surf.GetInput('glossiness'))
                if base is not None and spec is not None:
                    size = base.size
                    d = np.asarray(base.convert('RGB'), np.float32) / 255
                    s = np.asarray(spec.convert('RGB').resize(size), np.float32) / 255
                    lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
                    smax = lin(s).max(-1)
                    metal = np.clip((smax - 0.04) / 0.5, 0, 1)
                    col = d * (1 - metal[..., None]) + s * metal[..., None]
                    base = Image.fromarray((col * 255 + 0.5).astype(np.uint8), 'RGB')
                    m.metal = Image.fromarray((metal * 255 + 0.5).astype(np.uint8), 'L')
                    m.metal_factor = 1.0
                if gloss is not None:
                    g = np.asarray(gloss.convert('L'), np.float32)
                    m.rough = Image.fromarray((255 - g).astype(np.uint8), 'L')
                    m.rough_factor = 1.0
                else:
                    m.rough_factor = 1 - float(const(surf, 'glossiness', 0.4))
            else:
                m.metal = tex(surf.GetInput('metallic'))
                m.rough = tex(surf.GetInput('roughness'))
                m.metal_factor = 1.0 if m.metal else float(const(surf, 'metallic', 0.0))
                m.rough_factor = 1.0 if m.rough else float(const(surf, 'roughness', 0.6))
            if base is not None:
                m.base = base.convert('RGB')
            else:
                c = const(surf, 'diffuseColor', Gf.Vec3f(0.8, 0.8, 0.8))
                m.base_factor = [float(c[0]), float(c[1]), float(c[2]), 1.0]
        mat_ids[key] = len(mats)
        mats.append(m)
        return mat_ids[key]

    mpu = UsdGeom.GetStageMetersPerUnit(stage) or 0.01
    z_up = UsdGeom.GetStageUpAxis(stage) == 'Z'
    xc = UsdGeom.XformCache()
    parts = []
    for prim in stage.Traverse():
        if not prim.IsA(UsdGeom.Mesh) or UsdGeom.Imageable(prim).ComputeVisibility() == UsdGeom.Tokens.invisible:
            continue
        mesh = UsdGeom.Mesh(prim)
        pts = np.array(mesh.GetPointsAttr().Get() or [], np.float64)
        counts = np.array(mesh.GetFaceVertexCountsAttr().Get() or [], np.int64)
        fvi = np.array(mesh.GetFaceVertexIndicesAttr().Get() or [], np.int64)
        if not len(pts) or not len(counts):
            continue
        M = np.array(xc.GetLocalToWorldTransform(prim), np.float64)
        pos = (np.hstack([pts, np.ones((len(pts), 1))]) @ M)[:, :3] * mpu
        corners = fan(counts)
        flip = (mesh.GetOrientationAttr().Get() == UsdGeom.Tokens.leftHanded) != (np.linalg.det(M[:3, :3]) < 0)
        if flip:
            corners = corners.reshape(-1, 3)[:, [0, 2, 1]].reshape(-1)
        st_pv = None
        for pv in UsdGeom.PrimvarsAPI(prim).GetPrimvars():
            if pv.GetTypeName().role == 'TextureCoordinate' or pv.GetPrimvarName() in ('st', 'st0', 'UVMap', 'uv'):
                st_pv = pv
                break
        st = np.array(st_pv.ComputeFlattened(), np.float64) if st_pv else None
        st_i = st_pv.GetInterpolation() if st_pv else None
        nrm = mesh.GetNormalsAttr().Get()
        n_i = mesh.GetNormalsInterpolation() if nrm else None
        nrm = np.array(nrm, np.float64) if nrm else None
        if st_i == 'faceVarying' or n_i == 'faceVarying':
            P = pos[fvi]
            N = (nrm if n_i == 'faceVarying' else nrm[fvi]) if nrm is not None else None
            UV = (st if st_i == 'faceVarying' else st[fvi]) if st is not None else None
            idx = corners
        else:
            P, idx = pos, fvi[corners]
            N = nrm if n_i in ('vertex', 'varying') else None
            UV = st if st_i in ('vertex', 'varying') else None
        N = smooth_normals(P, idx) if N is None else N @ np.linalg.inv(M[:3, :3]).T
        if UV is not None:
            UV = UV.copy()
            UV[:, 1] = 1 - UV[:, 1]
        mat, _ = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()
        name = re.sub(r'_Material__?\d+_\d+$', '', prim.GetName())
        parts.append(Part(name, P, N, UV, idx, material(mat)))
    if z_up:
        for p in parts:
            p.P = p.P @ np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], np.float64)
            p.N = p.N @ np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], np.float64)
    return parts, mats


# ---------------------------------------------------------------------- OBJ
def load_obj(src):
    root = os.path.dirname(os.path.abspath(src))
    V, VT, VN = [], [], []
    mats, mat_ids = [], {}
    mtl = {}
    groups = {}  # (object, material) -> list of corner triples per face
    obj_name, cur_mat = 'part', None
    order = []
    with open(src, encoding='utf-8', errors='replace') as f:
        for line in f:
            t = line.split()
            if not t:
                continue
            if t[0] == 'v':
                V.append([float(x) for x in t[1:4]])
            elif t[0] == 'vt':
                VT.append([float(x) for x in t[1:3]])
            elif t[0] == 'vn':
                VN.append([float(x) for x in t[1:4]])
            elif t[0] in ('o', 'g'):
                obj_name = ' '.join(t[1:]) or 'part'
            elif t[0] == 'usemtl':
                cur_mat = ' '.join(t[1:])
            elif t[0] == 'mtllib':
                path = os.path.join(root, ' '.join(t[1:]))
                if os.path.exists(path):
                    mtl.update(parse_mtl(path))
            elif t[0] == 'f':
                key = (obj_name, cur_mat)
                if key not in groups:
                    groups[key] = []
                    order.append(key)
                face = []
                for c in t[1:]:
                    ids = (c.split('/') + ['', ''])[:3]
                    face.append(tuple(int(i) if i else 0 for i in ids))
                groups[key].append(face)
    V, VT, VN = np.array(V or [[0, 0, 0]]), np.array(VT or [[0, 0]]), np.array(VN or [[0, 0, 1]])

    def material(name):
        if name in mat_ids:
            return mat_ids[name]
        m = Mat(name or 'default')
        d = mtl.get(name, {})
        if 'Kd' in d:
            m.base_factor = [*d['Kd'], 1.0]
        if 'Ns' in d:
            m.rough_factor = float(np.clip(1 - np.sqrt(d['Ns'] / 1000.0), 0.1, 1.0))
        if 'map_Kd' in d and os.path.exists(os.path.join(root, d['map_Kd'])):
            m.base = open_image(os.path.join(root, d['map_Kd']), 'RGB')
            m.base_factor = [1, 1, 1, 1]
        for k in ('map_Bump', 'bump', 'norm'):
            if k in d and os.path.exists(os.path.join(root, d[k])):
                m.normal = open_image(os.path.join(root, d[k]), 'RGB')
        mat_ids[name] = len(mats)
        mats.append(m)
        return mat_ids[name]

    parts = []
    for key in order:
        faces = groups[key]
        lookup, P, N, UV, idx = {}, [], [], [], []
        for face in faces:
            ids = []
            for c in face:
                if c not in lookup:
                    lookup[c] = len(P)
                    vi, ti, ni = c
                    P.append(V[vi - 1 if vi > 0 else vi])
                    UV.append(VT[ti - 1 if ti > 0 else ti] if ti else [0, 0])
                    N.append(VN[ni - 1 if ni > 0 else ni] if ni else [0, 0, 0])
                ids.append(lookup[c])
            for k in range(1, len(ids) - 1):
                idx.extend([ids[0], ids[k], ids[k + 1]])
        P, N, UV, idx = np.array(P, np.float64), np.array(N, np.float64), np.array(UV, np.float64), np.array(idx, np.int64)
        if not np.any(N):
            N = smooth_normals(P, idx)
        UV[:, 1] = 1 - UV[:, 1]
        name = key[0] if key[1] is None or len([k for k in order if k[0] == key[0]]) == 1 else f'{key[0]}_{key[1]}'
        parts.append(Part(name, P, N, UV, idx, material(key[1])))
    return parts, mats


def parse_mtl(path):
    out, cur = {}, None
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            t = line.split()
            if not t:
                continue
            if t[0] == 'newmtl':
                cur = ' '.join(t[1:])
                out[cur] = {}
            elif cur is None:
                continue
            elif t[0] in ('Kd', 'Ks', 'Ka', 'Ke'):
                out[cur][t[0]] = [float(x) for x in t[1:4]]
            elif t[0] in ('Ns', 'd', 'Ni'):
                out[cur][t[0]] = float(t[1])
            elif t[0].startswith('map_') or t[0] in ('bump', 'norm'):
                out[cur][t[0]] = t[-1]
    return out


# --------------------------------------------------------------- glTF / FBX
def load_gltf(src):
    g = gl.GLTF2().load(src)
    blob = g.binary_blob() or b''
    root = os.path.dirname(os.path.abspath(src))

    def buffer_bytes(view_index):
        v = g.bufferViews[view_index]
        b = g.buffers[v.buffer]
        if b.uri is None:
            data = blob
        elif b.uri.startswith('data:'):
            import base64
            data = base64.b64decode(b.uri.split(',', 1)[1])
        else:
            with open(os.path.join(root, b.uri), 'rb') as f:
                data = f.read()
        return data[(v.byteOffset or 0):(v.byteOffset or 0) + v.byteLength], v.byteStride

    comp = {gl.FLOAT: np.float32, gl.UNSIGNED_INT: np.uint32, gl.UNSIGNED_SHORT: np.uint16, gl.UNSIGNED_BYTE: np.uint8,
            gl.SHORT: np.int16, gl.BYTE: np.int8}
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

    def accessor(i):
        a = g.accessors[i]
        data, stride = buffer_bytes(a.bufferView)
        dt = np.dtype(comp[a.componentType])
        n = width[a.type]
        if stride and stride != dt.itemsize * n:
            raw = np.frombuffer(data, np.uint8)
            rows = np.stack([raw[(a.byteOffset or 0) + k * stride:(a.byteOffset or 0) + k * stride + dt.itemsize * n] for k in range(a.count)])
            arr = rows.view(dt).reshape(a.count, n)
        else:
            arr = np.frombuffer(data, dt, a.count * n, a.byteOffset or 0).reshape(a.count, n)
        arr = arr.astype(np.float64)
        if a.normalized and dt != np.float32:
            arr /= np.iinfo(dt).max
        return arr if n > 1 else arr[:, 0]

    def image(i):
        im = g.images[i]
        if im.bufferView is not None:
            data, _ = buffer_bytes(im.bufferView)
            return Image.open(io.BytesIO(data))
        if im.uri and im.uri.startswith('data:'):
            import base64
            return Image.open(io.BytesIO(base64.b64decode(im.uri.split(',', 1)[1])))
        return Image.open(os.path.join(root, im.uri)) if im.uri else None

    mats = []
    for gm in g.materials or []:
        m = Mat(gm.name or 'material')
        p = gm.pbrMetallicRoughness or gl.PbrMetallicRoughness()
        m.base_factor = list(p.baseColorFactor or [1, 1, 1, 1])
        m.metal_factor = 1.0 if p.metallicFactor is None else p.metallicFactor
        m.rough_factor = 1.0 if p.roughnessFactor is None else p.roughnessFactor
        if p.baseColorTexture is not None:
            im = image(g.textures[p.baseColorTexture.index].source)
            if im is not None and im.size != (1, 1):
                m.base = im.convert('RGB')
        if gm.normalTexture is not None:
            im = image(g.textures[gm.normalTexture.index].source)
            if im is not None and im.size != (1, 1):
                m.normal = im.convert('RGB')
        if p.metallicRoughnessTexture is not None:
            im = image(g.textures[p.metallicRoughnessTexture.index].source)
            if im is not None and im.size != (1, 1):
                im = im.convert('RGB')
                m.rough, m.metal = im.getchannel('G'), im.getchannel('B')
        mats.append(m)
    if not mats:
        mats.append(Mat('default'))

    def local(n):
        if n.matrix:
            return np.array(n.matrix, np.float64).reshape(4, 4).T
        t = np.array(n.translation or [0, 0, 0], np.float64)
        x, y, z, w = n.rotation or [0, 0, 0, 1]
        s = np.array(n.scale or [1, 1, 1], np.float64)
        R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        M = np.eye(4)
        M[:3, :3] = R * s
        M[:3, 3] = t
        return M

    parts = []
    names = {}

    def walk(i, parent):
        n = g.nodes[i]
        M = parent @ local(n)
        if n.mesh is not None:
            for k, pr in enumerate(g.meshes[n.mesh].primitives):
                if pr.mode not in (None, 4):
                    continue
                P = accessor(pr.attributes.POSITION)
                P = (np.hstack([P, np.ones((len(P), 1))]) @ M.T)[:, :3]
                idx = accessor(pr.indices).astype(np.int64) if pr.indices is not None else np.arange(len(P))
                N = accessor(pr.attributes.NORMAL) if pr.attributes.NORMAL is not None else None
                N = smooth_normals(P, idx) if N is None else N @ np.linalg.inv(M[:3, :3])
                UV = accessor(pr.attributes.TEXCOORD_0) if pr.attributes.TEXCOORD_0 is not None else None
                if np.linalg.det(M[:3, :3]) < 0:
                    idx = idx.reshape(-1, 3)[:, [0, 2, 1]].reshape(-1)
                base = n.name or g.meshes[n.mesh].name or f'part{len(parts)}'
                base = re.sub(r'_Material__?\d+_\d+$', '', base)
                name = base if len(g.meshes[n.mesh].primitives) == 1 else f'{base}_{k}'
                names[name] = names.get(name, 0) + 1
                if names[name] > 1:
                    name = f'{name}_{names[name]}'
                parts.append(Part(name, P, N, UV, idx, pr.material or 0))
        for c in n.children or []:
            walk(c, M)

    scene = g.scenes[g.scene or 0]
    for i in scene.nodes:
        walk(i, np.eye(4))
    return parts, mats


def load_fbx(src):
    exe = os.environ.get('FBX2GLTF')
    if not exe:
        here = os.path.dirname(os.path.abspath(__file__))
        plat = {'darwin': 'Darwin', 'win32': 'Windows_NT'}.get(sys.platform, 'Linux')
        cands = glob.glob(os.path.join(here, '..', 'node_modules', 'fbx2gltf', 'bin', plat, 'FBX2glTF*'))
        exe = cands[0] if cands else None
    if not exe:
        sys.exit('FBX input needs FBX2glTF: run `npm install fbx2gltf` or set FBX2GLTF=/path/to/FBX2glTF')
    out = os.path.join(tempfile.mkdtemp(), 'model')
    subprocess.run([exe, '--binary', '--input', src, '--output', out], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return load_gltf(out + '.glb')


# ------------------------------------------------------------------- output
def jpeg(im, q):
    b = io.BytesIO()
    im.save(b, 'JPEG', quality=q, optimize=True)
    return b.getvalue()


def fit(im, size):
    if im is None or max(im.size) <= size:
        return im
    k = size / max(im.size)
    return im.resize((max(1, int(im.size[0] * k)), max(1, int(im.size[1] * k))), Image.LANCZOS)


def write_glb(parts, mats, dst, max_tex):
    blob = bytearray()
    views, accessors = [], []

    def view(data, target=None):
        while len(blob) % 4:
            blob.append(0)
        v = gl.BufferView(buffer=0, byteOffset=len(blob), byteLength=len(data))
        if target is not None:
            v.target = target
        blob.extend(data)
        views.append(v)
        return len(views) - 1

    def acc(arr, kind, ctype, target, mm=False):
        a = gl.Accessor(bufferView=view(arr.tobytes(), target), componentType=ctype, count=len(arr), type=kind)
        if mm:
            a.min, a.max = arr.min(0).tolist(), arr.max(0).tolist()
        accessors.append(a)
        return len(accessors) - 1

    used = sorted({p.mat for p in parts})
    remap = {m: i for i, m in enumerate(used)}
    nodes, meshes = [], []
    for p in parts:
        N = p.N / np.maximum(np.linalg.norm(p.N, axis=1, keepdims=True), 1e-12)
        at = gl.Attributes(POSITION=acc(p.P.astype(np.float32), 'VEC3', gl.FLOAT, gl.ARRAY_BUFFER, True),
                           NORMAL=acc(N.astype(np.float32), 'VEC3', gl.FLOAT, gl.ARRAY_BUFFER))
        if p.UV is not None:
            at.TEXCOORD_0 = acc(p.UV.astype(np.float32), 'VEC2', gl.FLOAT, gl.ARRAY_BUFFER)
        small = len(p.P) < 65535
        ind = acc(p.idx.astype(np.uint16 if small else np.uint32), 'SCALAR',
                  gl.UNSIGNED_SHORT if small else gl.UNSIGNED_INT, gl.ELEMENT_ARRAY_BUFFER)
        meshes.append(gl.Mesh(name=p.name, primitives=[gl.Primitive(attributes=at, indices=ind, material=remap[p.mat])]))
        nodes.append(gl.Node(name=p.name, mesh=len(meshes) - 1))

    images, textures, gmats = [], [], []

    def tex(im, q, name):
        images.append(gl.Image(bufferView=view(jpeg(fit(im, max_tex), q)), mimeType='image/jpeg', name=name))
        textures.append(gl.Texture(source=len(images) - 1, sampler=0))
        return len(textures) - 1

    for mi in used:
        m = mats[mi]
        pbr = gl.PbrMetallicRoughness(baseColorFactor=m.base_factor, metallicFactor=m.metal_factor,
                                      roughnessFactor=m.rough_factor)
        out = gl.Material(name=m.name, doubleSided=True, pbrMetallicRoughness=pbr)
        if m.base is not None:
            pbr.baseColorTexture = gl.TextureInfo(index=tex(m.base.convert('RGB'), 88, f'{m.name}_base'))
        if m.normal is not None:
            out.normalTexture = gl.NormalMaterialTexture(index=tex(m.normal.convert('RGB'), 90, f'{m.name}_normal'))
        if m.metal is not None or m.rough is not None:
            size = (m.metal or m.rough).size
            metal = m.metal.convert('L').resize(size) if m.metal is not None else Image.new('L', size, int(255 * m.metal_factor))
            rough = m.rough.convert('L').resize(size) if m.rough is not None else Image.new('L', size, int(255 * m.rough_factor))
            pbr.metallicFactor = pbr.roughnessFactor = 1.0
            pbr.metallicRoughnessTexture = gl.TextureInfo(
                index=tex(Image.merge('RGB', (Image.new('L', size, 255), rough, metal)), 88, f'{m.name}_mr'))
        if m.emissive:
            out.emissiveFactor = m.emissive
        gmats.append(out)

    while len(blob) % 4:
        blob.append(0)
    doc = gl.GLTF2(asset=gl.Asset(generator='trackline convert_model.py', version='2.0'), scene=0,
                   scenes=[gl.Scene(nodes=list(range(len(nodes))))], nodes=nodes, meshes=meshes,
                   accessors=accessors, bufferViews=views, buffers=[gl.Buffer(byteLength=len(blob))],
                   materials=gmats, textures=textures, images=images,
                   samplers=[gl.Sampler(magFilter=gl.LINEAR, minFilter=gl.LINEAR_MIPMAP_LINEAR, wrapS=gl.REPEAT, wrapT=gl.REPEAT)])
    doc.set_binary_blob(bytes(blob))
    os.makedirs(os.path.dirname(os.path.abspath(dst)) or '.', exist_ok=True)
    doc.save_binary(dst)
    tris = sum(len(p.idx) for p in parts) // 3
    lo = np.min([p.P.min(0) for p in parts], 0)
    hi = np.max([p.P.max(0) for p in parts], 0)
    print(f'wrote {dst}: {len(parts)} parts, {tris} triangles, {len(images)} textures, '
          f'{os.path.getsize(dst) / 1e6:.2f} MB, size {hi[0] - lo[0]:.3f} x {hi[1] - lo[1]:.3f} x {hi[2] - lo[2]:.3f} m')


# --------------------------------------------------------------------- main
def rotation(spec):
    axis, deg = spec[0].lower(), float(spec[1:])
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    return {'x': np.array([[1, 0, 0], [0, c, -s], [0, s, c]]),
            'y': np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]]),
            'z': np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])}[axis]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--max-texture', type=int, default=2048)
    ap.add_argument('--rotate', action='append', default=[], help='e.g. y90, x-90, z180 (applied in order)')
    ap.add_argument('--flip-x', action='store_true', help='mirror along X (muzzle the other way)')
    ap.add_argument('--scale', type=float, default=1.0)
    ap.add_argument('--translate', default='', help='X,Y,Z metres added after rotate and scale (move the origin, e.g. to a knife ring)')
    ap.add_argument('--tex', action='append', default=[], help='MATERIAL=PREFIX')
    ap.add_argument('--dx-normal', action='append', default=[], help='MATERIAL with a DirectX normal map')
    ap.add_argument('--emissive', action='append', default=[], help='MATERIAL=#rrggbb')
    ap.add_argument('--drop', action='append', default=[], help='drop parts whose name contains this')
    ap.add_argument('--decimate', type=float, default=0, help='keep this fraction of triangles (e.g. 0.3); needs pip install fast-simplification')
    ap.add_argument('--verbose', action='store_true')
    a = ap.parse_args()

    ext = a.src.lower().rsplit('.', 1)[-1]
    loader = {'usdz': load_usd, 'usd': load_usd, 'usdc': load_usd, 'usda': load_usd, 'obj': load_obj,
              'glb': load_gltf, 'gltf': load_gltf, 'fbx': load_fbx}.get(ext)
    if not loader:
        sys.exit(f'unsupported input: .{ext}')
    if not a.verbose:
        devnull, saved = os.open(os.devnull, os.O_WRONLY), os.dup(2)
        os.dup2(devnull, 2)
    try:
        parts, mats = loader(a.src)
    finally:
        if not a.verbose:
            os.dup2(saved, 2)

    for spec in a.tex:
        name, prefix = spec.split('=', 1)
        for m in mats:
            if m.name != name:
                continue
            b = find_texture(prefix, ['_DF', '_BaseColor', '_basecolor', '_Albedo', '_albedo', '_Diffuse', '_diffuse', '_D', '_Color'])
            n = find_texture(prefix, ['_NM', '_Normal', '_normal', '_N'])
            mt = find_texture(prefix, ['_M', '_Metallic', '_metallic', '_Metalness'])
            r = find_texture(prefix, ['_R', '_Roughness', '_roughness'])
            if b:
                m.base, m.base_factor = open_image(b, 'RGB'), [1, 1, 1, 1]
            if n:
                m.normal = open_image(n, 'RGB')
            if mt:
                m.metal, m.metal_factor = open_image(mt, 'L'), 1.0
            if r:
                m.rough, m.rough_factor = open_image(r, 'L'), 1.0
            print(f'  {name}: base={bool(b)} normal={bool(n)} metal={bool(mt)} rough={bool(r)}')
    for name in a.dx_normal:
        for m in mats:
            if m.name == name and m.normal is not None:
                m.normal = dx_to_gl(m.normal)
    for spec in a.emissive:
        name, col = spec.split('=', 1)
        col = col.lstrip('#')
        for m in mats:
            if m.name == name:
                m.emissive = [int(col[i:i + 2], 16) / 255 for i in (0, 2, 4)]
                m.base_factor = [*m.emissive, 1]
    if a.drop:
        parts = [p for p in parts if not any(d in p.name for d in a.drop)]

    R = np.eye(3)
    for spec in a.rotate:
        R = rotation(spec) @ R
    shift = np.array([float(v) for v in a.translate.split(',')]) if a.translate else np.zeros(3)
    for p in parts:
        p.P = (p.P @ R.T) * a.scale + shift
        p.N = p.N @ R.T
        if a.flip_x:
            p.P[:, 0] *= -1
            p.N[:, 0] *= -1
            p.idx = p.idx.reshape(-1, 3)[:, [0, 2, 1]].reshape(-1)
    if a.decimate and 0 < a.decimate < 1:
        for p in parts:
            decimate(p, a.decimate)
    write_glb(parts, mats, a.dst, a.max_texture)


def decimate(p, keep):
    """Quadric-reduce a part to about `keep` of its triangles. Each vertex
    that survives keeps its own texture coordinate and normal, and the
    texture's seams stay borders, so the texture still lines up."""
    import fast_simplification as fs
    tri = p.idx.reshape(-1, 3).astype(np.int64)
    if len(tri) < 2000:
        return
    _, _, collapses = fs.simplify(p.P.astype(np.float32), tri, target_reduction=1 - keep, return_collapses=True)
    P2, F2, mapping = fs.replay_simplification(p.P.astype(np.float32), tri, collapses)
    first = np.full(len(P2), -1, np.int64)
    for old in range(len(mapping) - 1, -1, -1):
        first[mapping[old]] = old
    first[first < 0] = 0
    p.P = P2.astype(np.float64)
    p.UV = p.UV[first]
    p.N = p.N[first]
    p.idx = F2.reshape(-1).astype(np.int64)
    print(f'  {p.name}: {len(tri)} -> {len(F2)} triangles')


if __name__ == '__main__':
    main()
