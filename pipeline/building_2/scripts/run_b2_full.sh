#!/bin/sh
# full building-2 chain after the sign artwork exists (run from b2/); scene/base.png = EDSR super-resolved photo
set -e
t0=$(date +%s)
python3 -I scripts/b2_tex.py > /dev/null && node scripts/b2_texrender.js tex/list.json > /dev/null
python3 -I scripts/b2_signs.py | grep -E "ball|LED|signs done"
python3 -I scripts/b2_relight.py out/full_2x.png out/relit_noballs_2x.png --gain 3 --no-balls --debug out/relit_light.png
python3 -I scripts/b2_balltrace.py out/relit_noballs_2x.png out/relit_2x.png --gain 2 --debug out/bt_light.png | tail -2
python3 -I scripts/b2_composite.py out/relit_2x.png scene/base.png out/scene_2x.png out/full_2x.png
python3 -I scripts/b2_atmos.py out/scene_2x.png out/atmos_2x.png
python3 -I scripts/b2_lens.py out/atmos_2x.png out/stage_lens.png
python3 -I scripts/film.py out/stage_lens.png out/final.png --look cinematic --jpeg out/final.jpg
python3 -I scripts/film.py out/stage_lens.png out/final_portra.png --jpeg out/final_portra.jpg
python3 -I scripts/dither.py out/stage_lens.png out/final_dither.png
echo "chain done in $(( $(date +%s) - t0 )) s"
