#!/bin/sh
# Render every storyboard step at final quality, then assemble the storyboard.
# PY should point at a Python that has `bpy` (pip install bpy==5.2.2 pillow scipy).
PY=${PY:-python3}
SCALE=${SCALE:-0.8}
SAMPLES=${SAMPLES:-128}
cd "$(dirname "$0")"
$PY make_textures.py
for s in 1 2 3 4 5 6; do
  $PY lemonade.py --step $s --scale $SCALE --samples $SAMPLES --out renders/step$s.png
done
$PY storyboard.py
