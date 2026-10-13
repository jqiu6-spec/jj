"""Orthographic ring model: shared pitch; far well wall (concave, far arc) and inner tower (convex, near arc)."""
import numpy as np, json
from scipy.optimize import least_squares
C2 = np.array([(10,548),(75,532),(140,516),(210,503),(300,498),(410,503),(470,520),(530,545),(580,572),(625,600)], float)
C3 = np.array([(307,897),(350,878),(400,856),(450,832),(500,806),(550,780),(600,752),(650,725),(670,712),(730,650),(790,600),(830,550),(865,500),(890,450),(905,400),(918,350),(925,300),(930,260)], float)
def ell(p, C, far):
    xc, R, y0, s = p
    t = np.clip((C[:, 0] - xc) / R, -1, 1)
    return y0 + (-1 if far else 1) * R * s * np.sqrt(1 - t * t)
def res(q):
    s = q[0]
    r2 = ell((q[1], q[2], q[3], s), C2, True) - C2[:, 1]
    r3 = ell((q[4], q[5], q[6], s), C3, False) - C3[:, 1]
    pen = np.r_[np.maximum(0, np.abs(C2[:, 0] - q[1]) - q[2] * .999), np.maximum(0, np.abs(C3[:, 0] - q[4]) - q[5] * .999)] * 10
    return np.r_[r2, r3, pen]
best = None
for s0 in (0.2, 0.35, 0.5, 0.7):
    for R0 in (400, 600, 900):
        for r0 in (500, 700, 1000):
            q0 = np.array([s0, 300, R0, 498 + R0 * s0, 300 + r0 * 0.9 , r0, 260, ])
            q0[6] = 897 - r0 * s0 * np.sqrt(max(1e-3, 1 - ((307 - q0[4]) / r0) ** 2))
            sol = least_squares(res, q0, bounds=([0.02, -2000, 100, -5000, -2000, 100, -5000], [0.99, 3000, 5000, 5000, 4000, 5000, 5000]))
            rms = np.sqrt(np.mean(res(sol.x)[:len(C2) + len(C3)] ** 2))
            if best is None or rms < best[0]: best = (rms, sol.x)
rms, q = best
print('rms %.2f px  pitch %.1f deg  well xc %.0f R %.0f y0 %.0f   tower xt %.0f r %.0f y0 %.0f' % (rms, np.degrees(np.arcsin(q[0])), q[1], q[2], q[3], q[4], q[5], q[6]))
print('C2 resid', (ell((q[1], q[2], q[3], q[0]), C2, True) - C2[:, 1]).round(1))
print('C3 resid', (ell((q[4], q[5], q[6], q[0]), C3, False) - C3[:, 1]).round(1))
json.dump(dict(s=q[0], well=[q[1], q[2], q[3]], tower=[q[4], q[5], q[6]]), open('out/b2_ortho.json', 'w'))
