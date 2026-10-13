import re, sys, os
from PIL import Image
import numpy as np
src, outdir = sys.argv[1], sys.argv[2]
os.makedirs(outdir, exist_ok=True)
d = open(src, 'rb').read()
layer_start = d.find(b'%AI5_BeginLayer')
pat = re.compile(rb'\[ ([-0-9. e]+) \] 0 0 (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) [^\r\n]*[\r\n]%%BeginData: (\d+)[\r\n]')
i = 0
for m in pat.finditer(d, layer_start):
    mat = [float(x) for x in m.group(1).split()]
    w, h = int(m.group(4)), int(m.group(5))
    bits, itype, alpha = int(m.group(6)), int(m.group(7)), int(m.group(8))
    n = int(m.group(12))
    body = d[m.end():m.end()+n]
    assert body[:3] in (b'XI\r', b'XI\n'), body[:5]
    raw = body[3:]
    ch = len(raw) // (w*h)
    arr = np.frombuffer(raw[:w*h*ch], np.uint8).reshape(h, w, ch)
    i += 1
    print(i, 'mat', mat, 'size', w, h, 'type', itype, 'alpha', alpha, 'ch', ch, 'extra', len(raw)-w*h*ch, 'offset', m.start())
    np.save(f'{outdir}/r{i}.npy', arr)
    if ch == 4:
        c, mm, y, k = [arr[..., j].astype(float)/255 for j in range(4)]
        rgb = np.stack([(1-c)*(1-k), (1-mm)*(1-k), (1-y)*(1-k)], -1)
        Image.fromarray((rgb*255).astype(np.uint8)).save(f'{outdir}/r{i}_cmyk.png')
        Image.fromarray(arr[..., :3]).save(f'{outdir}/r{i}_first3.png')
        Image.fromarray(arr[..., 1:4]).save(f'{outdir}/r{i}_last3.png')
