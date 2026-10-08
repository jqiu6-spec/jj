# Hinged sound box: editable 3D model

A 3D model of the full-scale hinged sound box from *Hinged sound box: full-scale assembly and cutting templates* (8 October 2026). It has 12 parts in 5 mm stock. The body is 260 × 200 × 100 mm, and 260 × 206 × 100 mm closed with the lid flap. The clear interior is 250 × 190 × 90 mm.

## Files

| File | Open with | What you get |
| --- | --- | --- |
| `index.html` | Any browser | The editor. Change the dimensions, open the lid, explode the parts, click a part to inspect or recolour it, read the fit checks and cut list, and export everything as a zip. |
| `model/hinged_sound_box.3dm` | Rhino 7/8 | One closed polysurface per part, named `A Base` … `G Front lid flap`, on the layers *Shell*, *Baffles* and *Lid + flap*. Each object carries its cut size as user text. |
| `model/hinged_sound_box.glb` | Blender, Rhino 8, KeyShot, web viewers | Named parts in three groups: *Body*, *Baffles* and *Lid hinge*. There are three materials, so the groups can be re-skinned separately. |
| `model/hinged_sound_box.obj` + `.mtl` | Any 3D app | One object per part, with colours. |
| `model/hinged_sound_box.stl` | Slicers, mesh tools | The whole assembly as one mesh. |
| `model/hinged_sound_box.scad` | OpenSCAD | Parametric source. Every dimension is a variable at the top and also appears in the Customizer. |
| `model/parameters.json` | Anything | All dimensions, the fit checks and each part's box. |

## Coordinates

- **Units:** millimetres. The `.glb` is in metres because glTF requires it, and Blender imports it at the correct size.
- **Origin:** the outer front-left-bottom corner of base A. X runs left to right (length), Y runs front to back (depth) and Z points up.
- **Up axis:** OBJ and GLB are Y-up with the front of the box facing +Z, which Blender and Rhino convert on import. STL, 3DM and SCAD are Z-up.
- **Lid hinge:** the lid and flap pivot on the outside top edge of the back wall, at y = 200, z = 95. The committed files have the lid open 95°, as in the drawing's assembly view. To pose the lid:
  - **Blender:** rotate the *Lid hinge* empty on X. 0° is closed and −95° is the exported pose.
  - **OpenSCAD:** set `lid_angle`.
  - **Rhino:** rotate the *Lid + flap* layer about the X axis through (0, 200, 95).

## Regenerating the files

The editor and the committed files share one copy of the geometry code. It lives in `index.html`, between the `SOUNDBOX CORE START` and `END` markers.

```sh
node tools/export-models.mjs              # GLB, OBJ, STL, SCAD, JSON at the drawing dimensions
node tools/export-models.mjs state.json   # or your own { "params": {...}, "material": "birch" }
pip install rhino3dm && python3 tools/export_3dm.py   # Rhino .3dm from parameters.json
```

## Notes carried over from the drawing

- **Source bay:** the inherited baffle positions leave a 30 mm source bay. Measure your cassette player before cutting. The editor keeps this item flagged as *Check*.
- **Front wall:** the editor hides the front wall by default to match the PDF's cutaway view. It is always part of the model and of every export.
- **Flap clearance:** the 1 mm gap between the flap and the front wall does not scale with the box. Glue, tape and coating can close it.
- **Sketch model:** these are sketch-model dimensions, not a tested acoustic design. Dry-fit every part with the actual board. The tape hinge still needs a physical test.
