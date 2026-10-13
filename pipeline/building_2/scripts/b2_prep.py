"""Building 2 scene assets: upscaled base photo (page 1455x2056 @2x) and per-item block masks in page coords."""
import json, re
import numpy as np, cv2
from PIL import Image
X0, Y0 = -129.429184403833, -133.319672131148      # photo top-left in SVG coords
SC = 1.37926365188936; DPR = 2; W, H = 1455, 2056
a = np.load('rasters/r1.npy').astype(np.float32) / 255
c, m, y, k = [a[..., j] for j in range(4)]
rgb = np.stack([(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)], -1)
photo = Image.fromarray((rgb * 255).round().astype(np.uint8)); photo.save('scene/photo_native.png')
photo.resize((W * DPR, H * DPR), Image.LANCZOS).save('scene/base.png')
items = json.load(open('out/full.svg.json'))

def flatten(d):
    """SVG path (M/L/C/Z) -> list of polygons in page 1x coords"""
    polys, cur, pos = [], [], None
    for op, args in re.findall(r'([MLCZ])([^MLCZ]*)', d):
        v = [float(t) for t in args.split()]
        if op == 'M':
            if len(cur) > 2: polys.append(cur)
            pos = (v[0], v[1]); cur = [pos]
        elif op == 'L':
            for i in range(0, len(v), 2): pos = (v[i], v[i + 1]); cur.append(pos)
        elif op == 'C':
            for i in range(0, len(v), 6):
                p0 = np.array(pos); p1, p2, p3 = np.array(v[i:i + 2]), np.array(v[i + 2:i + 4]), np.array(v[i + 4:i + 6])
                for t in np.linspace(0, 1, 13)[1:]:
                    q = (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3
                    cur.append(tuple(q))
                pos = tuple(p3)
        elif op == 'Z':
            if len(cur) > 2: polys.append(cur)
            cur = [pos] if pos else []
    if len(cur) > 2: polys.append(cur)
    return [[((x - X0) * SC, (y_ - Y0) * SC) for x, y_ in p] for p in polys]

info = {}
for idx, it in enumerate(items):
    if it['kind'] == 'raster':
        i = it['i']
        if i == 1: continue
        r = np.load(f'rasters/e{i}.npy')
        a_, _, _, d_, tx, ty = it['mat']
        M = np.float32([[a_ * SC * DPR, 0, (tx - X0) * SC * DPR], [0, d_ * SC * DPR, (-ty - Y0) * SC * DPR]])
        al = cv2.warpAffine(r[..., 3], M, (W * DPR, H * DPR), flags=cv2.INTER_LINEAR)
        col = cv2.warpAffine(r[..., :3], M, (W * DPR, H * DPR), flags=cv2.INTER_LINEAR)
        Image.fromarray(np.dstack([col, al])).save(f'scene/masks/r{i}.png')
        ys, xs = np.nonzero(al > 127)
        info[f'r{i}'] = dict(bbox=[int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())], color=r[r[..., 3] > 200][:, :3].mean(0).round().tolist())
    elif it['kind'] in ('fill', 'both') and 'd' in it:
        polys = flatten(it['d'])
        if not polys: continue
        mk = np.zeros((H * DPR, W * DPR), np.uint8)
        for p in polys:
            cv2.fillPoly(mk, [np.round(np.array(p) * DPR * 4).astype(np.int32)], 255, lineType=cv2.LINE_AA, shift=2)
        if mk.max() == 0: continue
        Image.fromarray(mk).save(f'scene/masks/v{idx}.png')
        ys, xs = np.nonzero(mk > 127)
        if len(xs) == 0: continue
        info[f'v{idx}'] = dict(bbox=[int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())], color=it['fill'], poly=[np.round(p, 2).tolist() for p in polys])
json.dump(info, open('scene/items.json', 'w'))
print(len(info), 'items'); [print(k, v['bbox'], v['color']) for k, v in info.items()]
