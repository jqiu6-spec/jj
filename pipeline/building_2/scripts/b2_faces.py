"""Face definitions for building 2: which drawn pieces make up each sign face, and its 4 corners (page 2x px)."""
import json, numpy as np, cv2
from PIL import Image
W2, H2 = 2910, 4112
FACES = {
 # name: (pieces, rotation for corner search in deg, kind)
 'trbox_top':   (['v59'], 0, 'top'),
 'trbox_left':  (['v60', 'v62'], 0, 'screen'),
 'trbox_front': (['v61', 'v63'], 0, 'screen'),
 'pink_top':    (['v58'], 0, 'screen'),
 'pink_mid':    (['v57'], 0, 'metal'),
 'pink_bot':    (['v56'], 0, 'screen'),
 'pink_side':   (['v49'], 0, 'metal'),
 'mint_v1':     (['r15'], 0, 'screen'),
 'cream_h':     (['r14'], 0, 'screen'),
 'mint_v2':     (['r16'], 0, 'screen'),
 'mag':         (['r7'], 0, 'screen'),
 'mascot':      (['v38'], 0, 'screen'),
 'kiosk':       (['r32'], 0, 'screen'),
 'pill':        (['r33'], 0, 'screen'),
 'arc':         (['v78'], 0, 'screen'),
 'cap_top':     (['v67', 'v73'], 0, 'screen'),
 'cap_front':   (['v68', 'v69', 'v70', 'v71'], 0, 'screen'),
 'cap_end':     (['v66', 'v72'], 0, 'screen'),
 'wedge_face':  (['v80', 'v86'], 0, 'screen'),
 'wedge_side':  (['v81', 'v82', 'v83', 'v87'], 0, 'metal'),
 'wedge_under': (['v84', 'v85'], 0, 'metal'),
 'moon_frame':  (['r39'], 0, 'metal'),
 'moon':        (['r13', 'r38'], 0, 'screen'),
 'blade1':      (['r42'], 0, 'screen'),
 'blade2':      (['r41'], 0, 'screen'),
 'blade3':      (['r17'], 0, 'screen'),
 'L_face':      (['v54'], 0, 'screen'),
 'L_side':      (['v52', 'v55'], 0, 'metal'),
 'L_bot':       (['v53'], 0, 'metal'),
 'rec_black':   (['r4', 'r18'], -30, 'void'),
 'rec_dots':    (['r3'], -25, 'void'),
 'rec_floor':   (['r5'], -25, 'screen'),
 'rec_wall':    (['r6'], 0, 'screen'),
 'rec_wall2':   (['r2'], 0, 'screen'),
 'band_front':  (['r19', 'r24', 'r25'], -32, 'screen'),
 'band_end':    (['r20', 'r23'], 0, 'screen'),
 'band_top':    (['r21', 'r22'], -38, 'screen'),
}
TILES = ['r28', 'r26', 'r30', 'r27', 'r31', 'r29']
for t in TILES: FACES['tile_' + t] = ([t], -30, 'screen')
for e in ('r8', 'r9', 'r10', 'r11', 'r12'): FACES['disc_' + e] = ([e], 0, 'disc')

def piece_alpha(p):
    im = np.asarray(Image.open(f'scene/masks/{p}.png'))
    return im[..., 3] if im.ndim == 3 else im

def face_mask(name):
    m = np.zeros((H2, W2), np.float32)
    for p in FACES[name][0]: m = np.maximum(m, piece_alpha(p).astype(np.float32) / 255)
    return m

def clean(m):
    b = (m > 0.35).astype(np.uint8)
    b = cv2.morphologyEx(b, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(b)
    if n > 2:                                            # keep components > 2% of the largest
        big = st[1:, cv2.CC_STAT_AREA].max()
        keep = [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] > 0.02 * big]
        b = np.isin(lab, keep).astype(np.uint8)
    # fill pin holes from the stippled rasters
    cnts, hier = cv2.findContours(b, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    for i, c in enumerate(cnts):
        if hier[0][i][3] >= 0 and cv2.contourArea(c) < 400: cv2.drawContours(b, [c], -1, 1, -1)
    return b

def corners(b, rot=0):
    """4 corners (TL,TR,BR,BL) = the 4 sharpest turns of the outer contour, ordered so edge TL->TR faces up."""
    cnts, _ = cv2.findContours(b, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cnts, key=cv2.contourArea)[:, 0, :].astype(np.float64)
    n = len(c); k = max(4, int(n * 0.025))
    a = c[(np.arange(n) - k) % n] - c; bb = c[(np.arange(n) + k) % n] - c
    cosang = (a * bb).sum(1) / (np.linalg.norm(a, axis=1) * np.linalg.norm(bb, axis=1) + 1e-9)
    sharp = cosang + 1                                  # 0 = straight, 2 = folded back
    sharp = np.convolve(np.r_[sharp[-3:], sharp, sharp[:3]], np.ones(7) / 7, 'valid')
    picks = []
    order = np.argsort(-sharp)
    for i in order:
        if all(min(abs(i - j), n - abs(i - j)) > n * 0.06 for j in picks): picks.append(i)
        if len(picks) == 4: break
    picks = sorted(picks)                                # contour order (OpenCV outer contours run clockwise in y-down)
    P = c[picks]
    ctr = c.mean(0)
    ang = np.arctan2(P[:, 1] - ctr[1], P[:, 0] - ctr[0]); P = P[np.argsort(ang)]     # clockwise in image coords
    best, bi = 9, 0
    for r in range(4):
        d = P[(r + 1) % 4] - P[r]; nrm = np.array([d[1], -d[0]]) / (np.linalg.norm(d) + 1e-9)
        if nrm[1] < best: best, bi = nrm[1], r
    P = np.roll(P, -bi, axis=0)
    idx = [int(np.argmin(((c - p) ** 2).sum(1))) for p in P]
    return c, idx

if __name__ == '__main__':
    out = {}
    vis = (np.asarray(Image.open('scene/base.png').convert('RGB')) // 2).copy()
    rng = np.random.default_rng(3)
    for name, (pieces, rot, kind) in FACES.items():
        b = clean(face_mask(name))
        c, idx = corners(b, rot)
        out[name] = dict(corners=[c[i].tolist() for i in idx], kind=kind, bbox=[int(c[:, 0].min()), int(c[:, 1].min()), int(c[:, 0].max()), int(c[:, 1].max())])
        col = rng.integers(80, 255, 3)
        vis[b > 0] = (vis[b > 0] * 0.4 + col * 0.6).astype(np.uint8)
        for k, i in enumerate(idx):
            cv2.circle(vis, tuple(int(v) for v in c[i]), 9, ((255, 0, 0), (0, 255, 0), (0, 128, 255), (255, 255, 0))[k], -1)
        cv2.putText(vis, name, (int(c[:, 0].min()), int(c[:, 1].min()) - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
    json.dump(out, open('scene/faces.json', 'w'))
    Image.fromarray(vis).resize((1455, 2056)).save('out/faces_vis.png')
    print(len(out), 'faces')
