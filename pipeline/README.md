# building_1 render pipeline

Turns `building 1.ai` into a photographic night render: every coloured block drawn over the
reference photo is replaced by the sign/shop described in its text label, projected with the
photo's real perspective, then "shot" through a Nikon F3 + 20mm f/2.8 on Kodak Portra 400.

Final images (2400x3600, 2:3): [`building_1_render.jpg`](../render/building_1_render.jpg) (cinematic), [`building_1_render_portra.jpg`](../render/building_1_render_portra.jpg) (clean Portra, strong poster bloom), [`building_1_render_dither.png`](../render/building_1_render_dither.png) (retro dither).

## Stages

| # | Script | What it does |
|---|--------|--------------|
| 1 | `scripts/extract_ai.py`, `extract_rasters.py`, `decode_text.py`, `stories.py`, `ai2svg.py` | Decompress the Illustrator private data (zstd), decode the two reference photos (CMYK rasters), the block shapes and the 19 text labels. |
| 2 | `scripts/prep.py` | Base photo, block clip paths, neon stroke masks. |
| 3 | `scripts/lines.py`, `vp.py`, `camera.py` | LSD line detection -> RANSAC vanishing points (vertical + both facade directions) -> camera (focal + principal point from the orthocentre). |
| 4 | `scripts/geometry.py` | Rebuilds each hand-drawn block as a true rectangle on its facade plane (or a 3-D box), with metric aspect ratio and a 3-D frame for depth work -> `scene/signs.js`. |
| 5 | `scene/*.js` + `scripts/render.js` | Chromium renders the signs (perspective via CSS `matrix3d`), 3-D shop interiors (`depth.js`: recessed lit rooms, slabs, fins seen from below), and a matte (`foreground.js`) that puts the real train/overhead rail back in front of the facade signs. |
| 5b | `scripts/normals.py`, `scripts/relight.py` | Light transport from the screens: per-pixel surface orientation of the photo (edge energy toward each vanishing point fused with sign/train priors), then every sign is an area light on its true 3-D plane (sampled with its rendered colours) and irradiance at each surface point is integrated with inverse-square falloff, cosine at both ends, one-sided emission for wall screens and layered depth (facade / train / hanging boxes), plus a glossy lobe on the train body and rail. The added light multiplies the photo's own texture. |
| 6 | `scripts/composite.py` | Light spill onto the photo, bloom from bright sources, height haze (the tower is ~2 km tall), softness matched to the photo. |
| 6b | `scripts/atmos.py` | Fine detail and atmosphere in the style of the references: local-contrast texture on the concrete, a distant tower city (far facade planes through the solved camera, floors of lit window strips) visible through the megastructure's voids, flying vehicles in lanes parallel to the train, searchlight beams, and layered textured haze that thickens with height and is lit by the signs. |
| 7 | `scripts/lens.py` | Pure camera-rotation re-tilt (12 deg) for stronger converging verticals with true 3-point perspective, 35mm 2:3 crop, slight barrel distortion (-1.4% at corners), 1-stop vignette, lateral CA, corner softness. |
| 8 | `scripts/film.py` | Portra 400 night emulation: halation, soft shoulder/toe, restrained neon saturation, warm highlights/cool shadows, lab-scan sharpening, density-dependent grain. `--look cinematic` adds the near-monochrome teal-green grade with warm sodium highlights, hazy blacks and heavier grain. |
| 9 | `scripts/dither.py` | Optional retro variant: gold/black/blue palette, ordered 8x8 Bayer dither on a 3-px grid. |

## Run (after stages 1-4 have produced `scene/` assets)

```sh
node scripts/render.js scene/scene.html full out/full_2x.png 2
python3 scripts/normals.py
python3 scripts/relight.py out/full_2x.png out/relit_2x.png --gain 6 --spec 1.5
python3 scripts/composite.py out/relit_2x.png scene/base.png out/scene_2x.png out/full_2x.png
python3 scripts/atmos.py out/scene_2x.png out/atmos_2x.png
python3 scripts/lens.py out/atmos_2x.png out/stage_lens.png
python3 scripts/film.py out/stage_lens.png out/final.png --look cinematic --jpeg out/final.jpg
python3 scripts/dither.py out/stage_lens.png out/final_dither.png   # optional retro variant
```

Requires Python 3 (numpy, Pillow, opencv-python-headless, zstandard), Node + Playwright/Chromium,
and the Google Fonts listed in `scene/fonts.css` (downloaded into `fonts/`). Large derived images
(`base.png`, photo crops) are regenerated from the `.ai` file and not committed.

# building_2 render pipeline

`building 2.ai` has no text labels: its blocks are coloured shapes (vector faces plus 41 effect rasters) drawn
over a night photo of a ring-shaped megastructure. Each block was read as a sign whose type follows its shape
and colour, and rendered in the same cinematic style as building 1.

Final images (2400x3600, 2:3): [`building_2_render.jpg`](../render/building_2_render.jpg) (cinematic),
[`building_2_render_portra.jpg`](../render/building_2_render_portra.jpg) (clean Portra),
[`building_2_render_dither.png`](../render/building_2_render_dither.png) (retro dither). Process images are in
[`render/process_b2`](../render/process_b2). The finished frames then go through a post pass (`b2_post.py`, stage 10
below) that gives the flat light panels a body and adds the SORA TAXI billboard on the lower-left wall.

| Block (colour in the .ai) | Rendered as |
|---|---|
| blue/purple box, top right | suspended LED box: curved jellyfish screen, AQUA deep-sea aquarium ad, roof with edge strip |
| lilac stacked boxes | 夜光 BAR / OPEN 24時 lightboxes with a marquee-bulb band |
| mint / pale-green verticals, cream strip | くすり pharmacy, ホテル MIDORI (red 空室 LED), Ring Line 7 station sign |
| magenta curved screen + pale-yellow rounded square | curved LED screen with the PURIN pudding mascot |
| four thin curved strokes, six dots | neon tubes and indicator lamps |
| blue curved box + peach wedge | SKY LOUNGE 72F capsule sign with a wedge-shaped lightbox fin |
| blue pill, blue ellipses | 銭湯 bath-house column, round kanji lanterns |
| blue panel with a round hole + grey frame | HOTEL LUNA billboard in a metal frame, with a NEWS 360 LED ball set into the hole |
| green/pink gradient-mesh balls (big one with a peach band, small one on the ring band) | spherical LED screens playing a 360-degree news channel; the peach band is the BREAKING ticker |
| three green parallelograms, mint L | ラーメン / 餃子 / 生ビール izakaya blade signs, 24h L-sign |
| coral/purple/magenta ring band, checker, black recess, pink ledge | RING SEVEN curved LED band (bioluminescent cell screen, 夜市 night-market tiles) over a lit hangar opening |
| (not in the .ai: added in the post pass) | SORA TAXI flying-taxi billboard on the lower-left wall, under the 24h L-sign: a blue LED board in a metal frame in the HOTEL LUNA family |

| # | Script (`building_2/scripts`) | What it does |
|---|---|---|
| 1 | `extract_effects.py`, `ai2svg.py` | Effect rasters are interleaved CMYK followed by a separate alpha plane (the `%%BeginData` count only covers the CMYK part). |
| 2 | `b2_prep.py` | Base photo at page scale and a mask per drawn piece. |
| 3 | `b2_vvp.py`, `b2_ortho.py`, `b2_geom.py` | Verticals are almost parallel (vanishing point ~22,000 px away), so the camera is a telephoto. An orthographic ring model is fitted to traced balcony and rim curves: 41.7 deg pitch, concave well wall and convex near walls. Output: per-pixel 3-D position and normal (walls, walkway tops, the courtyard behind the opening). |
| 4 | `b2_faces.py` | Faces from the pieces; 4 corners per face from contour curvature. |
| 5 | `b2_tex.py`, `b2_texrender.js` | Sign artwork rendered flat in Chromium (Japanese and display fonts). |
| 6 | `b2_signs.py` | Each texture is mapped onto its block with a Coons patch built from the block's own boundary curves (curved screens follow the ring), with mild perspective foreshortening. Tiles use homographies. Materials: LED pixel grid, lightbox diffuser with metal bezel, dark painted returns, neon tubes, lamps. Procedural textures: the cell screen and the hangar interior. It also records each face's 3-D position and normal on the surface it is mounted on. |
| 7 | `b2_relight.py` | Area-light transport from every emitting cell: inverse square, cosine at both ends, haze extinction, one- or two-sided emission. Receivers are the proxy surfaces with balcony micro-geometry (offset and wrapped cosine), lit with the photo's own texture as albedo. |
| 8 | `b2_composite.py`, `b2_atmos.py` | Spill, bloom and diffuse poster glow, plus depth haze into the well. Also: fine detail, a distant skyline above the rim, craft circling on the ring's ellipses, searchlights, and textured haze lit by the signs. |
| 6b | `b2_sphere.py`, `tex/news360.html`, `tex/news360_big.html` | Spherical LED news screens. The two green/pink balls are gradient meshes that exist only in the PDF layer of the .ai (shading type 7), so their circles come from the PDF clip paths. Each ball maps an equirectangular NEWS 360 texture onto a sphere seen by the tilted camera: mip-filtered anisotropic lookup, an LED grid sized to the same physical pitch as the flat screens, viewing-angle falloff, a glossy cover with Fresnel reflection and a glint. Only the billboard ball gets a mounting collar. The big ball's axis is tipped back 25 deg and its ticker sits at +10.5 deg so it follows the drawn band; it lights the wall behind it as a two-sided emitter. The three balls show different parts of the channel. |
| 9 | `b2_lens.py`, then shared `film.py` / `dither.py` | 5 deg downward re-tilt through a 20 mm-class pinhole, 2:3 frame, barrel distortion, lateral CA, vignette and glare. Then the Portra 400 / cinematic film stage. |
| 10 | `b2_post.py`, `tex/sora_taxi.html` | Post pass on the finished 2400x3600 frames. (a) Support structure for the flat light panels (くすり, 環状七号線, ホテル MIDORI, PURIN, HOTEL LUNA, the three izakaya blades, the METRO kiosk, the 夜光 BAR boxes), which were drawn as decals and read as floating. Each wall screen becomes a thin LED cabinet (0.12 m, dark painted return with a lit bezel) on a steel sub-frame, held off the wall on outrigger brackets with wall plates, bolted to wall rails; side posts get diagonal ties, and screens over 5 m get a lattice between the brackets. The standoff (0.45-1.3 m), member sections (0.08-0.2 m) and bracket spacing scale with the panel size. Everything is projected with the mounting normal at that point of the ring (from the ring geometry and the camera pitch, so the depth direction turns around the ring: toward the top of the frame at the far point, up-right on the left wall, up-left on the right) at the local scale in px per metre; the structure is only drawn past the edges that face the wall footprint, the wall behind those edges falls into the panel's shadow with a soft contact shadow beyond, and the members are dark steel lit by the local glow of the scene. The blades are thin sheets hung on cantilever arms with a tie rod, the ones in front hiding the structure of the ones behind; the hovering NEWS 360 ball stays in front of HOTEL LUNA. (b) The SORA TAXI billboard: a 3:2 board on the lower-left wall following its rows, same LED pixel grid, metal frame and structure as the other screens, its light spilled and bloomed onto the wall, the lens vignette of that corner, then the film chain (halation, shoulder/toe, grade, scan sharpening, grain) of the frame it sits in. Panel outlines are segmented from the Portra frame (every variant shares the geometry; the blades are given as quads because they light the wall too strongly to segment), the cinematic and Portra frames are edited with their own looks, and the dither variant is re-quantised from the edited Portra frame inside the edited area. It runs on the finished frames because the `.ai` assets of stages 1-9 are not in the repository. Process image: `process_b2/08_panel_body_and_sora_taxi.jpg`. |

Run: `scripts/run_b2.sh` (see the header for the expected layout).
