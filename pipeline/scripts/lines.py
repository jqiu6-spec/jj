"""Detect line segments in the photo (page coords = native px * 1.37926) and visualise by orientation."""
import sys, json
import numpy as np, cv2
S = sys.argv[1]
SC = 1.37926365188936
img = cv2.imread(f'{S}/scene/photo_native.png')
g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
# boost the dark photo so structure edges are detectable
g = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(g)
g2 = cv2.resize(g, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
segs = lsd.detect(g2)[0].reshape(-1, 4) / 2 * SC
L = np.hypot(segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1])
segs = segs[L > 28]
print(len(segs), 'segments')
json.dump(segs.round(2).tolist(), open(f'{S}/out/segs.json', 'w'))
vis = cv2.resize(cv2.cvtColor(g, cv2.COLOR_GRAY2BGR), (1455, 2056)) // 2
for x1, y1, x2, y2 in segs:
    ang = np.degrees(np.arctan2(y2 - y1, x2 - x1)) % 180
    col = (0, 255, 255) if 70 < ang < 110 else (255, 120, 0) if ang < 45 or ang > 135 else (0, 0, 255)
    cv2.line(vis, (int(x1), int(y1)), (int(x2), int(y2)), col, 2)
cv2.imwrite(f'{S}/out/lines.png', vis)
