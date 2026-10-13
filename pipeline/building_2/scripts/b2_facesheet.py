import json, numpy as np, cv2, sys
from PIL import Image, ImageDraw
sys.path.insert(0, 'scripts')
from b2_faces import FACES, face_mask, clean
F = json.load(open('scene/faces.json'))
tiles = []
for name, f in F.items():
    if FACES[name][2] == 'disc': continue
    b = clean(face_mask(name))
    x0, y0, x1, y1 = f['bbox']; pad = 20
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad); x1, y1 = x1 + pad, y1 + pad
    crop = np.dstack([b[y0:y1, x0:x1] * 120] * 3).astype(np.uint8)
    for k, p in enumerate(f['corners']):
        cv2.circle(crop, (int(p[0] - x0), int(p[1] - y0)), max(4, (x1 - x0) // 40), ((255, 0, 0), (0, 255, 0), (0, 128, 255), (255, 255, 0))[k], -1)
    t = Image.fromarray(crop); t.thumbnail((220, 220))
    c = Image.new('RGB', (230, 245), (40, 40, 40)); c.paste(t, (5, 20)); ImageDraw.Draw(c).text((5, 4), name, fill=(255, 255, 255))
    tiles.append(c)
cols = 8; rows = (len(tiles) + cols - 1) // cols
sh = Image.new('RGB', (230 * cols, 245 * rows))
for i, t in enumerate(tiles): sh.paste(t, ((i % cols) * 230, (i // cols) * 245))
sh.save('out/facesheet.png')
