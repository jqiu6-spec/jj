#!/usr/bin/env python3
"""Import a Rhino scene of the sound box into the editor.

    python3 tools/import_3dm.py [scene.3dm]

Reads the .3dm (default: rhino/sound_box_foamboard_Rhino_scene.3dm) and:

1. Checks every part against the parametric model in model/parameters.json: parts are matched by
   name prefix (A_, B_, C1_, ... G_). Hinged parts are compared after finding the lid's hinge axis
   and opening angle from the geometry itself.
2. Extracts the render setup: rectangular softbox lights, saved camera views, PBR materials,
   background gradient, ground plane and skylight.
3. Writes model/rhino_scene.json and embeds the same data in index.html, where the editor's
   "Rhino scene" preset reproduces it.
4. If parts are missing, writes <scene>_complete.3dm next to the original: the missing parts are
   copied from a sibling part with the same material setup, so the materials stay as authored.

Needs: pip install rhino3dm. Run tools/export-models.mjs first so parameters.json is current.
"""
import json
import math
import re
import sys
from pathlib import Path

import rhino3dm as r3

ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / "model"
DEFAULT_SCENE = ROOT / "rhino" / "sound_box_foamboard_Rhino_scene.3dm"
PART_RE = re.compile(r"^(A|B|C1|C2|D|E|F\d+|G)(?:_|$)")
TOL = 0.05  # mm


def vec(v):
    return [round(v.X, 4), round(v.Y, 4), round(v.Z, 4)]


def rgb_hex(c):
    return "#%02x%02x%02x" % (c[0], c[1], c[2])


def box_corners(lo, hi):
    return [[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]


def hinge_bbox(lo, hi, pivot_yz, deg):
    """Bounding box of a closed lid part after rotating -deg about X through (y, z)."""
    a = math.radians(deg)
    cs, sn = math.cos(a), math.sin(a)
    py, pz = pivot_yz
    pts = []
    for x, y, z in box_corners(lo, hi):
        dy, dz = y - py, z - pz
        pts.append([x, py + dy * cs + dz * sn, pz - dy * sn + dz * cs])
    return [min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)]


def bbox_error(a, b):
    return max(abs(a[0][i] - b[0][i]) for i in range(3)) if a and b else math.inf


def fit_hinge(found, expected, params):
    """Find the hinge edge and opening angle that put the closed lid parts where the scene has them."""
    W, H, t = params["depth"], params["height"], params["thickness"]
    candidates = {"wall": (W, H - t), "lid": (W, H)}
    best = None
    for name, pivot in candidates.items():
        for step in range(0, 18001):
            deg = step / 100
            err = 0
            for pid in ("B", "G"):
                if pid not in found or pid not in expected:
                    continue
                lo, hi = hinge_bbox(expected[pid]["min_mm"], expected[pid]["max_mm"], pivot, deg)
                f = found[pid]
                err = max(err, max(abs(lo[i] - f["min"][i]) for i in range(3)), max(abs(hi[i] - f["max"][i]) for i in range(3)))
            if best is None or err < best[2]:
                best = (name, pivot, err, deg)
    name, pivot, err, deg = best
    return {"hinge_axis": name, "pivot_mm": [0, pivot[0], pivot[1]], "open_angle_deg": round(deg, 2), "fit_error_mm": round(err, 4)}


def pbr(rc):
    xml = rc.XML(False)
    p = dict(re.findall(r'<parameter type="[^"]+" name="([^"]+)">([^<]*)<', xml))
    col = [float(v) for v in p.get("pbr-base-color", "1,1,1,1").split(",")]
    return {
        "name": rc.Name,
        "base_color": "#%02x%02x%02x" % tuple(round(c * 255) for c in col[:3]),
        "roughness": float(p.get("pbr-roughness", 0.5)),
        "metallic": float(p.get("pbr-metallic", 0)),
        "specular": float(p.get("pbr-specular", 0.5)),
        "bump_on": p.get("pbr-bump-on") == "true",
    }


def light_data(g):
    corner = g.Location
    length, width = g.Length, g.Width
    center = [corner.X + length.X / 2 + width.X / 2, corner.Y + length.Y / 2 + width.Y / 2, corner.Z + length.Z / 2 + width.Z / 2]
    d = g.Direction
    n = math.sqrt(d.X ** 2 + d.Y ** 2 + d.Z ** 2) or 1
    return {
        "name": g.Name,
        "style": str(g.LightStyle).split(".")[-1],
        "center_mm": [round(c, 3) for c in center],
        "size_mm": [round(math.sqrt(length.X ** 2 + length.Y ** 2 + length.Z ** 2), 3), round(math.sqrt(width.X ** 2 + width.Y ** 2 + width.Z ** 2), 3)],
        "length_vec_mm": vec(length),
        "width_vec_mm": vec(width),
        "direction": [round(d.X / n, 5), round(d.Y / n, 5), round(d.Z / n, 5)],
        "intensity": g.Intensity,
        "color": rgb_hex(g.Diffuse),
        "enabled": g.IsEnabled,
    }


def view_data(name, vp):
    return {
        "name": name,
        "perspective": vp.IsPerspectiveProjection,
        "location_mm": vec(vp.CameraLocation),
        "direction": vec(vp.CameraDirection),
        "target_mm": [round(vp.CameraLocation.X + vp.CameraDirection.X, 3), round(vp.CameraLocation.Y + vp.CameraDirection.Y, 3), round(vp.CameraLocation.Z + vp.CameraDirection.Z, 3)],
        "up": vec(vp.CameraUp),
    }


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SCENE
    doc = r3.File3dm.Read(str(src))
    if doc is None:
        raise SystemExit(f"Could not read {src}")
    expected = {p["id"]: p for p in json.loads((MODEL / "parameters.json").read_text())["parts"]}
    params = json.loads((MODEL / "parameters.json").read_text())["parameters"]
    layers = [l.FullPath for l in doc.Layers]

    found, objects = {}, {}
    for o in doc.Objects:
        name = o.Attributes.Name or ""
        m = PART_RE.match(name)
        if m and isinstance(o.Geometry, r3.Brep):
            bb = o.Geometry.GetBoundingBox()
            found[m.group(1)] = {"name": name, "layer": layers[o.Attributes.LayerIndex], "min": vec(bb.Min), "max": vec(bb.Max), "solid": o.Geometry.IsSolid}
            objects[m.group(1)] = o

    hinge = fit_hinge(found, expected, params)
    report = []
    for pid, exp in expected.items():
        if pid not in found:
            report.append({"part": pid, "status": "missing", "note": f"{exp['name']} is not in the scene"})
            continue
        want = (exp["min_mm"], exp["max_mm"])
        if exp["hinged"]:
            want = hinge_bbox(exp["min_mm"], exp["max_mm"], hinge["pivot_mm"][1:], hinge["open_angle_deg"])
        err = bbox_error(want, (found[pid]["min"], found[pid]["max"]))
        report.append({"part": pid, "status": "ok" if err <= TOL else "moved", "error_mm": round(err, 4), "name_in_scene": found[pid]["name"], "layer": found[pid]["layer"]})
    for pid in found:
        if pid not in expected:
            report.append({"part": pid, "status": "extra", "note": f"{found[pid]['name']} is not in the parametric model"})

    lights = [light_data(o.Geometry) for o in doc.Objects if isinstance(o.Geometry, r3.Light)]
    views = [view_data(v.Name, v.Viewport) for v in doc.Views] + [view_data(v.Name, v.Viewport) for v in doc.NamedViews]
    materials = {rc.Name: pbr(rc) for rc in doc.RenderContent if str(rc.Kind) == "material"}
    env = next((rc for rc in doc.RenderContent if str(rc.Kind) == "environment"), None)
    env_color = None
    if env is not None:
        m = re.search(r'name="background-color">([^<]+)<', env.XML(False))
        if m:
            env_color = "#%02x%02x%02x" % tuple(round(float(c) * 255) for c in m.group(1).split(",")[:3])
    rs = doc.Settings.RenderSettings

    scene = {
        "source": src.name,
        "units": str(doc.Settings.ModelUnitSystem).split(".")[-1],
        "parts": report,
        "missing": [r["part"] for r in report if r["status"] == "missing"],
        "lid": hinge,
        "lights": lights,
        "views": views,
        "materials": materials,
        "environment": {"name": env.Name if env else None, "color": env_color},
        "background": {"top": rgb_hex(rs.BackgroundColorTop), "bottom": rgb_hex(rs.BackgroundColorBottom)},
        "ground_plane": {"enabled": rs.GroundPlane.Enabled, "shadow_only": rs.GroundPlane.ShadowOnly, "altitude_mm": rs.GroundPlane.Altitude},
        "skylight": {"enabled": rs.Skylight.Enabled},
        "sun": {"enabled": rs.Sun.EnableOn},
    }
    (MODEL / "rhino_scene.json").write_text(json.dumps(scene, indent=2) + "\n")

    # Embed in the editor so the "Rhino scene" preset works offline and inside the artifact viewer.
    page = ROOT / "index.html"
    html = page.read_text()
    block = re.compile(r'(<script type="application/json" id="rhino-scene">\n)(.*?)(\n</script>)', re.S)
    if not block.search(html):
        raise SystemExit("rhino-scene block not found in index.html")
    page.write_text(block.sub(lambda m: m.group(1) + json.dumps(scene, separators=(",", ":")) + m.group(3), html, count=1))

    # Complete copy with missing parts filled in from a sibling of the same kind and attachment side.
    if scene["missing"]:
        added = []
        for pid in scene["missing"]:
            exp = expected[pid]
            same = [k for k, e in expected.items() if k in objects and k[0] == pid[0] and e.get("attached_to") == exp.get("attached_to") and not e["hinged"]]
            if not same:
                continue
            twin = same[0]
            shift = [exp["min_mm"][i] - expected[twin]["min_mm"][i] for i in range(3)]
            size_ok = all(abs(exp["size_mm"][i] - expected[twin]["size_mm"][i]) < 1e-6 for i in range(3))
            if not size_ok:
                continue
            geo = objects[twin].Geometry.Duplicate()
            geo.Transform(r3.Transform.Translation(*shift))
            attrs = objects[twin].Attributes
            new = r3.ObjectAttributes()
            new.Name = objects[twin].Attributes.Name.replace(twin, pid, 1)
            new.LayerIndex = attrs.LayerIndex
            new.MaterialSource = attrs.MaterialSource
            new.MaterialIndex = attrs.MaterialIndex
            new.ColorSource = attrs.ColorSource
            new.ObjectColor = attrs.ObjectColor
            for key, value in (attrs.GetUserStrings() or []):
                new.SetUserString(key, value)
            new.SetUserString("imported_note", f"added by import_3dm.py: copy of {twin} moved {shift} mm")
            doc.Objects.AddBrep(geo, new)
            added.append(f"{pid} (copy of {twin})")
        if added:
            out = src.with_name(src.stem + "_complete.3dm")
            doc.Write(str(out), 8)
            print(f"Wrote {out.relative_to(ROOT)} with {', '.join(added)}")

    print(f"Imported {src.name}: {len(found)} parts, {len(lights)} lights, {len(views)} views, {len(materials)} materials")
    print(f"Lid: hinge on the {hinge['hinge_axis']} top edge (pivot y={hinge['pivot_mm'][1]}, z={hinge['pivot_mm'][2]}), open {hinge['open_angle_deg']} deg, fit error {hinge['fit_error_mm']} mm")
    for r in report:
        print(f"  {r['part']:<3} {r['status']:<7} {r.get('error_mm', '')} {r.get('note', '')}")


if __name__ == "__main__":
    main()
