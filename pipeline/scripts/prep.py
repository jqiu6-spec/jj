"""Prepare scene assets: upscaled base photo, block clip paths (page coords), neon stroke masks."""
import json, re, sys
import numpy as np
from PIL import Image, ImageFilter

S = sys.argv[1]  # scratchpad root
X0, Y0 = 665.382172042382, 0.971206638198964
SCALE = 1.37926365188936
DPR = 2
W, H = 1455, 2056

# base photo (CMYK -> RGB)
a = np.load(f'{S}/rasters/r5.npy').astype(float) / 255
c, m, y, k = [a[..., j] for j in range(4)]
rgb = np.stack([(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)], -1)
photo = Image.fromarray((rgb * 255).round().astype(np.uint8))
photo.save(f'{S}/scene/photo_native.png')
up = photo.resize((W * DPR, H * DPR), Image.LANCZOS)
up.save(f'{S}/scene/base.png')

# block paths translated into page coords
items = json.load(open(f'{S}/out/full.svg.json'))
def translate(d, dx, dy):
    out = []
    for op, args in re.findall(r'([MLCSZ])([^MLCSZ]*)', d):
        v = [float(x) for x in args.split()]
        pts = ' '.join(f'{v[i] - dx:.2f} {v[i + 1] - dy:.2f}' for i in range(0, len(v), 2))
        out.append(op + pts)
    return ' '.join(out)
B = {}
for i, it in enumerate(items):
    if 'd' in it and it['kind'] != 'raster':
        B[i] = translate(it['d'], X0, Y0)

# grainy neon strokes the user drew (rasters 7-10): clean alpha -> smooth masks
masks = {}
for i in (7, 8, 9, 10):
    r = np.load(f'{S}/rasters/r{i}.npy')
    al = Image.fromarray(r[..., 3])
    al = al.filter(ImageFilter.GaussianBlur(6))
    arr = np.array(al).astype(float)
    arr = np.clip((arr - 40) * 6, 0, 255).astype(np.uint8)
    col = r[r[..., 3] > 60][:, :3].mean(0)
    rgba = np.zeros(r.shape[:2] + (4,), np.uint8)
    rgba[..., :3] = col.astype(np.uint8)
    rgba[..., 3] = arr
    Image.fromarray(rgba).save(f'{S}/scene/neon{i}.png')
    mat = [it for it in items if it.get('kind') == 'raster' and it['i'] == i][0]['mat']
    masks[i] = dict(x=mat[4] - X0, y=-mat[5] - Y0, w=r.shape[1] * mat[0], h=r.shape[0] * mat[3],
                    color='#%02x%02x%02x' % tuple(int(v) for v in col))
with open(f'{S}/scene/data.js', 'w') as f:
    f.write('const B=' + json.dumps(B) + ';\n')
    f.write('const NMASK=' + json.dumps(masks) + ';\n')
print('ok', len(B), masks)
