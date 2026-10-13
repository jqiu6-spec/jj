"""Convert the native Illustrator layer data to SVG (paths + rasters + text frames)."""
import re, sys, json, base64, io
import numpy as np
from PIL import Image

layer_path, raster_dir, out_svg = sys.argv[1], sys.argv[2], sys.argv[3]
opts = sys.argv[4] if len(sys.argv) > 4 else ''
lines = open(layer_path, encoding='latin-1').read().split('\n')

def cmyk(c, m, y, k):
    r, g, b = [round(255 * (1 - v) * (1 - k)) for v in (c, m, y)]
    return f'#{r:02x}{g:02x}{b:02x}'

num = r'-?[0-9.]+(?:e-?\d+)?'
fill, stroke, lw = '#000', '#000', 1.0
path = []
compound = None
out = []
group_depth = 0
raster_i = 0
in_raster = False
items = []  # (kind, d, fill, stroke, lw)

def emit(d, f, s, w, kind):
    items.append(dict(kind=kind, d=d, fill=f, stroke=s, lw=w))

for ln in lines:
    if ln.startswith('%AI5_BeginRaster'):
        raster_i += 1; in_raster = True; continue
    if ln.startswith('%AI5_EndRaster'):
        in_raster = False; continue
    if in_raster:
        m = re.match(r'\[ (.*) \] (\d+) (\d+) 0 Xh', ln)
        if m:
            mat = [float(x) for x in m.group(1).split()]
            items.append(dict(kind='raster', i=raster_i, mat=mat, w=int(m.group(2)), h=int(m.group(3))))
        continue
    if not ln or ln.startswith('%'):
        continue
    t = ln.split()
    op = t[-1]
    if op == 'k' and len(t) == 5:
        fill = cmyk(*map(float, t[:4]))
    elif op == 'K' and len(t) == 5:
        stroke = cmyk(*map(float, t[:4]))
    elif op in ('x', 'X') and len(t) >= 7:
        v = list(map(float, t[:4]))
        if op == 'x': fill = cmyk(*v)
        else: stroke = cmyk(*v)
    elif op in ('Xa', 'XA') and len(t) == 4:
        r, g, b = [round(255 * float(v)) for v in t[:3]]
        c = f'#{r:02x}{g:02x}{b:02x}'
        if op == 'Xa': fill = c
        else: stroke = c
    elif op in ('g', 'G') and len(t) == 2:
        v = round(255 * float(t[0])); c = f'#{v:02x}{v:02x}{v:02x}'
        if op == 'g': fill = c
        else: stroke = c
    elif op == 'w' and len(t) == 2:
        lw = float(t[0])
    elif 'w' in t and op == 'd':
        i = t.index('w'); lw = float(t[i - 1])
    elif op in ('m',) and len(t) == 3:
        path.append(f'M{t[0]} {-float(t[1]):.3f}')
    elif op in ('l', 'L') and len(t) == 3:
        path.append(f'L{t[0]} {-float(t[1]):.3f}')
    elif op in ('c', 'C') and len(t) == 7:
        v = list(map(float, t[:6]))
        path.append(f'C{v[0]:.3f} {-v[1]:.3f} {v[2]:.3f} {-v[3]:.3f} {v[4]:.3f} {-v[5]:.3f}')
    elif op in ('v', 'V') and len(t) == 5:
        v = list(map(float, t[:4]))
        path.append(f'S{v[0]:.3f} {-v[1]:.3f} {v[2]:.3f} {-v[3]:.3f}')  # approx
    elif op in ('y', 'Y') and len(t) == 5:
        v = list(map(float, t[:4]))
        path.append(f'C{v[0]:.3f} {-v[1]:.3f} {v[2]:.3f} {-v[3]:.3f} {v[2]:.3f} {-v[3]:.3f}')
    elif ln == '*u':
        compound = []
    elif ln == '*U':
        if compound:
            emit(' '.join(compound), cfill, cstroke, lw, ckind)
        compound = None
    elif op in ('f', 'F', 's', 'S', 'b', 'B', 'n', 'N', 'h', 'H') and len(t) == 1:
        if path:
            d = ' '.join(path) + (' Z' if op in 'fsbnhF' else '')
            kind = {'f': 'fill', 'F': 'fill', 's': 'stroke', 'S': 'stroke', 'b': 'both', 'B': 'both'}.get(op, 'none')
            if compound is not None:
                compound.append(d); cfill, cstroke, ckind = fill, stroke, kind
            else:
                emit(d, fill, stroke, lw, kind)
        path = []

def raster_png(i):
    a = np.load(f'{raster_dir}/r{i}.npy').astype(float) / 255
    if a.shape[2] == 4 and i in (1,):
        c, m, y, k = [a[..., j] for j in range(4)]
        rgb = np.stack([(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)], -1)
        im = Image.fromarray((rgb * 255).astype(np.uint8))
    else:
        # rasterized effects: interleaved CMYK + a separate alpha plane (decoded to e<i>.npy as RGBA)
        im = Image.fromarray(np.load(f'{raster_dir}/e{i}.npy'), 'RGBA')
    buf = io.BytesIO(); im.save(buf, 'PNG')
    return base64.b64encode(buf.getvalue()).decode()

vb = opts or '-1640 -110 4950 2175'
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}">', f'<rect x="-5000" y="-5000" width="20000" height="20000" fill="#fff"/>']
for it in items:
    if it['kind'] == 'raster':
        a, b, c, d, tx, ty = it['mat']
        svg.append(f'<image href="data:image/png;base64,{raster_png(it["i"])}" width="{it["w"]}" height="{it["h"]}" transform="matrix({a} {b} {c} {d} {tx} {-ty})" preserveAspectRatio="none"/>')
    else:
        f = it['fill'] if it['kind'] in ('fill', 'both') else 'none'
        s = it['stroke'] if it['kind'] in ('stroke', 'both') else 'none'
        if it['kind'] == 'none':
            s = '#00aaff'; svg.append(f'<path d="{it["d"]}" fill="none" stroke="{s}" stroke-width="1" stroke-dasharray="4 3" fill-rule="evenodd"/>'); continue
        svg.append(f'<path d="{it["d"]}" fill="{f}" stroke="{s}" stroke-width="{it["lw"]}" fill-rule="nonzero"/>')
svg.append('</svg>')
open(out_svg, 'w').write('\n'.join(svg))
json.dump([{k: v for k, v in it.items() if k != 'd'} | ({'d': it['d']} if 'd' in it else {}) for it in items], open(out_svg + '.json', 'w'))
print(len(items), 'items')
