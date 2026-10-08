#!/usr/bin/env python3
"""Write model/hinged_sound_box.3dm (Rhino 8 format) from model/parameters.json.

Run tools/export-models.mjs first; it writes parameters.json from the editor's geometry code.
Needs the rhino3dm package:  pip install rhino3dm
"""
import json
import math
from pathlib import Path

import rhino3dm as r3

MODEL = Path(__file__).resolve().parent.parent / "model"

LAYERS = (
    ("shell", "Shell (A C D E)", "#7d8a83"),
    ("baffle", "Baffles (F)", "#2b6954"),
    ("lid", "Lid + flap (B G, hinged)", "#4f6f99"),
)


def rgba(hex_color, alpha=255):
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), alpha)


def main():
    data = json.loads((MODEL / "parameters.json").read_text())
    params, hinge = data["parameters"], data["hinge"]

    doc = r3.File3dm()
    doc.Settings.ModelUnitSystem = r3.UnitSystem.Millimeters
    doc.Settings.ModelAbsoluteTolerance = 0.01

    top = r3.Layer()
    top.Name = "Hinged sound box"
    top_index = doc.Layers.Add(top)
    top_id = doc.Layers.FindIndex(top_index).Id

    layer_index = {}
    for key, name, color in LAYERS:
        layer = r3.Layer()
        layer.Name = name
        layer.Color = rgba(color)
        layer.ParentLayerId = top_id
        layer_index[key] = doc.Layers.Add(layer)

    angle = math.radians(hinge["open_angle_deg"])
    turn = r3.Transform.Rotation(-angle, r3.Vector3d(1, 0, 0), r3.Point3d(*hinge["pivot_mm"]))

    for part in data["parts"]:
        box = r3.BoundingBox(r3.Point3d(*part["min_mm"]), r3.Point3d(*part["max_mm"]))
        brep = r3.Brep.CreateFromBox(r3.Box(box))
        if part["hinged"] and angle:
            brep.Transform(turn)
        attrs = r3.ObjectAttributes()
        attrs.Name = f'{part["id"]} {part["name"]}'
        attrs.LayerIndex = layer_index[part["group"]]
        attrs.ObjectColor = rgba(part["color"])
        attrs.ColorSource = r3.ObjectColorSource.ColorFromObject
        attrs.SetUserString("part", part["id"])
        attrs.SetUserString("cut_size_mm", part["cut_size_mm"])
        attrs.SetUserString("thickness_mm", str(params["thickness"]))
        if part["hinged"]:
            attrs.SetUserString("hinge", f'rotate about X through {hinge["pivot_mm"]} (closed = 0 deg)')
        doc.Objects.AddBrep(brep, attrs)

    out = MODEL / "hinged_sound_box.3dm"
    if not doc.Write(str(out), 8):
        raise SystemExit(f"Could not write {out}")
    print(f"{out.name:<24} {out.stat().st_size:>7} bytes, {len(data['parts'])} parts")


if __name__ == "__main__":
    main()
