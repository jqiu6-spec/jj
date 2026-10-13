#!/bin/sh
# Building 2 pipeline. Run from a work dir containing in/building.pdf (= building2.ai) and these scripts in scripts/,
# with the shared tools (extract_ai.py, extract_rasters.py, film.py, dither.py) from ../../scripts copied next to them
# and the Google fonts in fonts/ (see ../../README.md). Playwright: PW=/path/to/playwright.
set -e
python3 -I scripts/extract_ai.py in/building.pdf in/private.bin          # zstd AIPrivateData -> in/private.ai
tail -c +21 in/private.bin | zstd -d -c > in/private.ai && tr '\r' '\n' < in/private.ai > in/private.txt
sed -n "32079,396305p" in/private.txt > in/layer.txt                     # the layer block of this file
python3 -I scripts/extract_rasters.py in/private.ai rasters              # r1 = the CMYK photo
python3 -I scripts/extract_effects.py in/private.ai rasters              # e2..e42 = CMYK + alpha-plane effect blocks
python3 -I scripts/ai2svg.py in/layer.txt rasters out/full.svg "-140 -140 1070 1500"
python3 -I scripts/b2_prep.py                                            # base.png + per-piece masks in page coords
python3 -I scripts/b2_vvp.py && python3 -I scripts/b2_ortho.py           # vertical VP + orthographic ring fit
python3 -I scripts/b2_geom.py                                            # depth / normal proxy
python3 -I scripts/b2_faces.py                                           # faces + corners
python3 -I scripts/b2_tex.py && node scripts/b2_texrender.js tex/list.json
# NEWS 360 ball textures (html sources in building_2/tex/, copied into tex/)
echo '[{"name":"news360","w":2048,"h":1024,"file":"tex/news360.html"},{"name":"news360_big","w":2048,"h":1024,"file":"tex/news360_big.html"}]' > tex/news360_list.json
node scripts/b2_texrender.js tex/news360_list.json
python3 -I scripts/b2_signs.py
python3 -I scripts/b2_relight.py out/full_2x.png out/relit_2x.png --gain 3 --debug out/relit_light.png
python3 -I scripts/b2_composite.py out/relit_2x.png scene/base.png out/scene_2x.png out/full_2x.png
python3 -I scripts/b2_atmos.py out/scene_2x.png out/atmos_2x.png
python3 -I scripts/b2_lens.py out/atmos_2x.png out/stage_lens.png
python3 -I scripts/film.py out/stage_lens.png out/final.png --look cinematic --jpeg out/final.jpg
python3 -I scripts/film.py out/stage_lens.png out/final_portra.png --jpeg out/final_portra.jpg
python3 -I scripts/dither.py out/stage_lens.png out/final_dither.png
