import numpy as np
from PIL import Image, ImageDraw

AX = [(0,-2),(1,-2),(2,-2),(-1,-1),(0,-1),(1,-1),(2,-1),(-2,0),(-1,0),(0,0),
      (1,0),(2,0),(-2,1),(-1,1),(0,1),(1,1),(-2,2),(-1,2),(0,2)]
CAN = np.array([[np.sqrt(3)*(q+r/2), 1.5*r] for q,r in AX])
CORNERS = [0,2,18,16]

def homography(src, dst):
    A,b = [],[]
    for (x,y),(u,v) in zip(src,dst):
        A.append([x,y,1,0,0,0,-u*x,-u*y]); b.append(u)
        A.append([0,0,0,x,y,1,-v*x,-v*y]); b.append(v)
    return np.append(np.linalg.solve(np.array(A), np.array(b)),1).reshape(3,3)

def apply_h(H, pts):
    p = np.hstack([pts, np.ones((len(pts),1))]); q = p @ H.T
    return q[:,:2]/q[:,2:3]

def render(src, dst_corners, out, maxdim=600):
    im = Image.open(src).convert("RGB"); im.thumbnail((maxdim,maxdim))
    H = homography(CAN[CORNERS], np.array(dst_corners, float))
    centres = apply_h(H, CAN)
    d = ImageDraw.Draw(im)
    # hex outlines
    for i in range(19):
        verts = []
        for k in range(6):
            th = np.radians(60*k - 90)
            verts.append(CAN[i] + np.array([np.cos(th), np.sin(th)]))
        pv = apply_h(H, np.array(verts))
        d.polygon([tuple(p) for p in pv], outline=(0,255,0))
    for i,(x,y) in enumerate(centres):
        d.ellipse([x-11,y-11,x+11,y+11], outline=(255,255,0), width=2)
        d.text((x-6,y-6), str(i), fill=(255,0,0))
    for x,y in dst_corners:
        d.ellipse([x-6,y-6,x+6,y+6], fill=(255,0,255))
    im.save(out)
    return centres, im.size

# ─────────────────────────────────────────────────────────────────────────────
# MEASURED RESULT (photo 0, full board, corners marked BY HAND so geometry is
# as good as it can get — this isolates the recogniser from the detector).
#
#   raw colour classification:  4 deserts and 1 ore, against a true 1 and 3.
#                               ~12 of 19 tiles right.
#   after the constraint solver: counts become exactly correct, 5 tiles moved.
#                               Two moves visibly right (hex 4 grey -> ore,
#                               hex 5 green -> wool). The desert lands on the
#                               wrong tile, because several pale tiles look
#                               equally desert-like and the solver must pick one.
#   with crude token-presence:   WORSE. Detected tokens on only 8 of 18 tiles,
#                               and pushed the desert onto a mountain.
#
# WHY TOKEN PRESENCE FAILED: it tested "centre is bright and desaturated", but
# the desert itself is bright and desaturated (L 72, chroma 26) — the very tile
# it is meant to identify. Distinguishing a printed circle from pale terrain
# needs SHAPE, not colour: find the circular edge, not the fill.
#
# CONCLUSION: the pipeline's structure works — geometry, accumulation, and the
# constraint solver all do their jobs. The perception layer is not good enough:
# terrain colour alone confuses pale/grey tiles, and token detection needs real
# shape analysis. That is a bigger piece of work than the surrounding machinery.
# ─────────────────────────────────────────────────────────────────────────────
