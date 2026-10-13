# building_1 render pipeline

Turns `building 1.ai` into a photographic night render: every coloured block drawn over the
reference photo is replaced by the sign/shop described in its text label, projected with the
photo's real perspective, then "shot" through a Nikon F3 + 20mm f/2.8 on Kodak Portra 400.

Final image: [`../render/building_1_render.jpg`](../render/building_1_render.jpg) (2400x3600, 2:3).

## Stages

| # | Script | What it does |
|---|--------|--------------|
| 1 | `scripts/extract_ai.py`, `extract_rasters.py`, `decode_text.py`, `stories.py`, `ai2svg.py` | Decompress the Illustrator private data (zstd), decode the two reference photos (CMYK rasters), the block shapes and the 19 text labels. |
| 2 | `scripts/prep.py` | Base photo, block clip paths, neon stroke masks. |
| 3 | `scripts/lines.py`, `vp.py`, `camera.py` | LSD line detection -> RANSAC vanishing points (vertical + both facade directions) -> camera (focal + principal point from the orthocentre). |
| 4 | `scripts/geometry.py` | Rebuilds each hand-drawn block as a true rectangle on its facade plane (or a 3-D box), with metric aspect ratio and a 3-D frame for depth work -> `scene/signs.js`. |
| 5 | `scene/*.js` + `scripts/render.js` | Chromium renders the signs (perspective via CSS `matrix3d`), 3-D shop interiors (`depth.js`: recessed lit rooms, slabs, fins seen from below), and a matte (`foreground.js`) that puts the real train/overhead rail back in front of the facade signs. |
| 6 | `scripts/composite.py` | Light spill onto the photo, bloom from bright sources, height haze (the tower is ~2 km tall), softness matched to the photo. |
| 7 | `scripts/lens.py` | Pure camera-rotation re-tilt (12 deg) for stronger converging verticals with true 3-point perspective, 35mm 2:3 crop, slight barrel distortion (-1.4% at corners), 1-stop vignette, lateral CA, corner softness. |
| 8 | `scripts/film.py` | Portra 400 night emulation: halation, soft shoulder/toe, restrained neon saturation, warm highlights/cool shadows, lab-scan sharpening, density-dependent grain. |

## Run (after stages 1-4 have produced `scene/` assets)

```sh
node scripts/render.js scene/scene.html full out/full_2x.png 2
python3 scripts/composite.py out/full_2x.png scene/base.png out/scene_2x.png
python3 scripts/lens.py out/scene_2x.png out/stage_lens.png
python3 scripts/film.py out/stage_lens.png out/final.png --jpeg out/final.jpg
```

Requires Python 3 (numpy, Pillow, opencv-python-headless, zstandard), Node + Playwright/Chromium,
and the Google Fonts listed in `scene/fonts.css` (downloaded into `fonts/`). Large derived images
(`base.png`, photo crops) are regenerated from the `.ai` file and not committed.
