# Hinged sound box: editable 3D model

A 3D model of the full-scale hinged sound box from *Hinged sound box: full-scale assembly and cutting templates* (8 October 2026). It has 12 parts in 5 mm stock. The body is 260 × 200 × 100 mm, and 260 × 206 × 100 mm closed with the lid flap. The clear interior is 250 × 190 × 90 mm.

## Files

| File | Open with | What you get |
| --- | --- | --- |
| `index.html` | Any browser | The editor. Change the dimensions, open the lid, explode the parts, click a part to inspect or recolour it, read the fit checks and cut list, and export everything as a zip. |
| `presentation/` | Any viewer, printer | Realistic orthographic renders, three A3 presentation sheets and a print-ready PDF. |
| `rhino/*.3dm` | Rhino 8 | Your render scene (imported) and a complete copy with the missing baffle F1 added. |
| `model/hinged_sound_box.3dm` | Rhino 7/8 | One closed polysurface per part, named `A Base` … `G Front lid flap`, on the layers *Shell*, *Baffles* and *Lid + flap*. Each object carries its cut size as user text. |
| `model/hinged_sound_box.glb` | Blender, Rhino 8, KeyShot, web viewers | Named parts in three groups: *Body*, *Baffles* and *Lid hinge*. There are three materials, so the groups can be re-skinned separately. |
| `model/hinged_sound_box.obj` + `.mtl` | Any 3D app | One object per part, with colours. |
| `model/hinged_sound_box.stl` | Slicers, mesh tools | The whole assembly as one mesh. |
| `model/hinged_sound_box.scad` | OpenSCAD | Parametric source. Every dimension is a variable at the top and also appears in the Customizer. |
| `model/parameters.json` | Anything | All dimensions, the fit checks and each part's box. |

## Presentation drawings

`presentation/` holds a presentation set made by the editor's **Presentation set (.zip)** button. The button rebuilds it from whatever you have set up: dimensions, lid hinge, finish and scene lighting.

| File | What it shows |
| --- | --- |
| `presentation/hinged_sound_box_presentation_A3.pdf` | The three sheets below in one PDF. Print at A3, 100%. |
| `presentation/sheets/sheet1_orthographic_views.png` | Plan, front, left-end and right-end elevations in third-angle projection at 1:2, with overall dimensions, a scale bar and a closed axonometric. |
| `presentation/sheets/sheet2_lid_opening.png` | Left-end elevations at 1:3 with the lid closed, half open and fully open. The lid's front edge path is dashed and the tape hinge is marked. Underneath is the same sequence as axonometrics. |
| `presentation/sheets/sheet3_how_it_works.png` | Plan with the lid removed at 1:2. Walls are cut solid and the sound path runs from the source bay past the five baffles to the outlet. Also the back elevation with the hinge axis, and an exploded axonometric tagged A–G with a parts list. |
| `presentation/renders/*.png` | The 12 individual realistic renders on transparent backgrounds. All are orthographic (parallel projection) at 4 px per model mm, so plans and elevations share one scale. |

Sheets are A3 landscape at 200 dpi. The axonometrics follow the imported Rhino camera and are not to scale. The orthographic toggle in the 3D view switches the live camera to parallel projection, so you can frame your own orthographic views.

## Rhino scene import

`rhino/sound_box_foamboard_Rhino_scene.3dm` is the Rhino 8 render scene, imported with `tools/import_3dm.py`. The import does three things:

- **Checks the parts:** every part is matched by name prefix and checked against the parametric model. All 11 parts in the file match to 0.0 mm.
- **Fixes the gap:** baffle **F1 is missing** from that file. `rhino/sound_box_foamboard_Rhino_scene_complete.3dm` is the same scene with F1 added. It is a copy of F3, the other back-attached baffle, moved into F1's slot, so it keeps the same materials.
- **Moves the scene into the editor:** it carries over the lid pose (open 105°, hinged on the lid's top rear edge, fitted to 0.0 mm), both rectangular softbox lights, the render camera, the PBR foamboard values (paper #f2f2f2, roughness 0.86; cut core #ededed, roughness 0.96), the gradient background, the shadow-only ground plane and the skylight. The result goes to `model/rhino_scene.json` and is embedded in `index.html`.

The editor opens in this *Rhino scene*. Use *Scene → Studio* for the built-in photo studio. In the Rhino scene, the light slider turns the whole softbox rig around the box. The texture images behind the bump maps are not embedded in the .3dm (they point to Rhino's local texture cache), so the editor uses its own paper and foam textures instead.

To re-import after editing the scene in Rhino:

```sh
python3 tools/import_3dm.py rhino/sound_box_foamboard_Rhino_scene.3dm
```

## Coordinates

- **Units:** millimetres. The `.glb` is in metres because glTF requires it, and Blender imports it at the correct size.
- **Origin:** the outer front-left-bottom corner of base A. X runs left to right (length), Y runs front to back (depth) and Z points up.
- **Up axis:** OBJ and GLB are Y-up with the front of the box facing +Z, which Blender and Rhino convert on import. STL, 3DM and SCAD are Z-up.
- **Lid hinge:** by default the lid and flap pivot on the outside top edge of the back wall, at y = 200, z = 95. The Rhino scene hinges on the lid's top rear edge instead (y = 200, z = 100); *Hinge axis* in the editor and `hinge_on_lid_top` in the .scad switch between the two. The committed files have the lid open 95°, as in the drawing's assembly view. To pose the lid:
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
- **Closed box:** all four walls are on by default. Turn off *Front wall* in the editor to get the PDF's cutaway view of the baffles; every export always includes it.
- **Outlet:** per the drawing, panel E leaves a 40 × 90 mm opening beside the front wall at the right end. That opening is the sound outlet, not a missing panel. Set *Outlet* to 0 to close the end completely.
- **Flap clearance:** the 1 mm gap between the flap and the front wall does not scale with the box. Glue, tape and coating can close it.
- **Sketch model:** these are sketch-model dimensions, not a tested acoustic design. Dry-fit every part with the actual board. The tape hinge still needs a physical test.
