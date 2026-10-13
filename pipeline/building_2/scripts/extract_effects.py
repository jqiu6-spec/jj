"""Decode the effect rasters of building2.ai: interleaved CMYK followed by a separate 8-bit alpha plane.

usage: python3 -I scripts/extract_effects.py in/private.ai rasters
The %%BeginData byte count in these blocks only covers the CMYK part; the alpha plane follows it (5 bytes/pixel in
total). Writes rasters/e<i>.npy as RGBA uint8 (raster 1 is the CMYK photo, handled by extract_rasters.py).
"""
import re, sys, numpy as np
src, outdir = sys.argv[1], sys.argv[2]
d = open(src, 'rb').read()
pat = re.compile(rb'\[ ([-0-9. e]+) \] 0 0 (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) [^\r\n]*[\r\n]%%BeginData: (\d+)[\r\n]')
for i, m in enumerate(pat.finditer(d, d.find(b'%AI5_BeginLayer')), 1):
    if i == 1 or int(m.group(9)) != 1: continue        # photo / rasters without alpha
    w, h = int(m.group(4)), int(m.group(5)); st = m.end()
    a = np.frombuffer(d[st + 3:st + 3 + w * h * 5], np.uint8)
    cmyk = a[:w * h * 4].reshape(h, w, 4).astype(np.float32) / 255; al = a[w * h * 4:].reshape(h, w)
    c, mm, y, k = [cmyk[..., j] for j in range(4)]
    rgb = np.stack([(1 - c) * (1 - k), (1 - mm) * (1 - k), (1 - y) * (1 - k)], -1)
    np.save(f'{outdir}/e{i}.npy', np.dstack([(rgb * 255 + .5).astype(np.uint8), al]))
    print('effect raster', i, w, h)
