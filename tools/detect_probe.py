"""Research harness: can the board be located WITHOUT the player marking it?

RESULT: NO — not with this approach. Recorded so the same dead end is not
retried.

Method: segment land by colour, take the radial profile from its centroid, find
the six hexagon corner directions, derive a homography, sample all 19 hexes,
classify, and compare the per-terrain counts against the true (4,4,4,3,3,1).

Measured across a twelve-photo reference set: mean absolute tile-count error
22.7 out of 19 — no better than chance. Rendering the detected hex centres over
the photos showed why:

  1. TEN OF TWELVE PHOTOS ARE CLOSE-UPS. The full board is not in frame, so
     there is nothing to detect. This is the decisive finding: it is a property
     of the photos people actually take, not a weakness of the algorithm.
  2. The colour segmentation leaks — an off-white tablecloth reads as land.
  3. The "is the whole board visible?" heuristic misfires in both directions,
     so the pipeline cannot even reliably tell when it should decline.

Conclusion: the geometry has to be supplied, not inferred. Either the player
marks the board (four corner taps on a still), or the capture step constrains it
(align the board to an on-screen guide, so the homography is known before a
pixel is read). Everything downstream is fast and deterministic once it is.

Run:  python tools/detect_probe.py
"""

import numpy as np, glob, os
from PIL import Image

REF = {'grain':(61.5,4.6,46.2),'wool':(53.2,-25.6,38.6),'lumber':(37.7,-7.1,16.4),
       'brick':(36.8,15.4,23.2),'ore':(60.3,-0.5,0.1),'desert':(72.3,-2.2,25.8)}
NAMES = list(REF); R = np.array([REF[n] for n in NAMES]); W = np.array([0.4,1.0,1.0])
TRUE = {'grain':4,'wool':4,'lumber':4,'brick':3,'ore':3,'desert':1}

def to_lab(rgb):
    a = rgb.astype(np.float64)
    a = np.where(a<=0.04045, a/12.92, ((a+0.055)/1.055)**2.4)
    M = np.array([[0.4124,0.3576,0.1805],[0.2126,0.7152,0.0722],[0.0193,0.1192,0.9505]])
    xyz = (a@M.T)/np.array([0.95047,1.0,1.08883])
    e,k = 216/24389, 24389/27
    f = np.where(xyz>e, np.cbrt(xyz), (k*xyz+16)/116)
    return np.stack([116*f[...,1]-16,500*(f[...,0]-f[...,1]),200*(f[...,1]-f[...,2])],-1)

def erode(m, n=1):
    for _ in range(n):
        m = m & np.roll(m,1,0) & np.roll(m,-1,0) & np.roll(m,1,1) & np.roll(m,-1,1)
    return m

# canonical: pointy-top axial -> cartesian
AX = [(0,-2),(1,-2),(2,-2),(-1,-1),(0,-1),(1,-1),(2,-1),(-2,0),(-1,0),(0,0),
      (1,0),(2,0),(-2,1),(-1,1),(0,1),(1,1),(-2,2),(-1,2),(0,2)]
CAN = np.array([[np.sqrt(3)*(q+r/2), 1.5*r] for q,r in AX])
CORNERS = [0,2,18,16]                       # tl, tr, br, bl
CORNER_ANG = np.array([-120,-60,60,120])    # canonical direction of each, degrees

def homography(src, dst):
    A,b = [],[]
    for (x,y),(u,v) in zip(src,dst):
        A.append([x,y,1,0,0,0,-u*x,-u*y]); b.append(u)
        A.append([0,0,0,x,y,1,-v*x,-v*y]); b.append(v)
    try: h = np.linalg.solve(np.array(A), np.array(b))
    except np.linalg.LinAlgError: return None
    return np.append(h,1).reshape(3,3)

def apply_h(H, pts):
    p = np.hstack([pts, np.ones((len(pts),1))])
    q = p @ H.T
    return q[:,:2]/q[:,2:3]

def probe(path):
    im = Image.open(path).convert("RGB"); im.thumbnail((700,700))
    a = np.asarray(im).astype(np.float32)/255.0
    H_, W_ = a.shape[:2]
    mx,mn = a.max(2),a.min(2); s = np.where(mx>0,(mx-mn)/np.maximum(mx,1e-6),0); v = mx
    r,g,b = a[...,0],a[...,1],a[...,2]
    sea = (b>r+0.10)&(b>g+0.05)&(s>0.25); table=(s<0.16)&(v>0.66); dark=v<0.10
    land = erode(~sea & ~table & ~dark, 3)
    if land.sum() < 500: return None, "no land found"

    ys,xs = np.nonzero(land)
    cx,cy = xs.mean(), ys.mean()
    ang = np.degrees(np.arctan2(ys-cy, xs-cx))
    rad = np.hypot(xs-cx, ys-cy)

    # radial profile: max radius per 2-degree bin
    bins = ((ang+180)//2).astype(int).clip(0,179)
    prof = np.zeros(180)
    np.maximum.at(prof, bins, rad)
    # smooth circularly
    k = np.ones(9)/9
    prof = np.convolve(np.r_[prof[-8:],prof,prof[:8]], k, 'same')[8:-8]

    # best global rotation: hexagon has 6 peaks 60 deg apart
    best_off, best_score = 0, -1
    for off in np.arange(0,60,1.0):
        idx = (((CORNER_ANG[:,None]+np.arange(0,360,60)[None,:]+off+180)%360)//2).astype(int)
        score = prof[np.unique(idx)%180].sum()
        if score > best_score: best_score, best_off = score, off

    dst = []
    for a_can in CORNER_ANG:
        theta = a_can + best_off
        bi = int(((theta+180)%360)//2) % 180
        rr = prof[bi]
        # corner-tile CENTRE sits at ~0.794 of the outer vertex radius
        rr *= 0.794
        th = np.radians(theta)
        dst.append([cx+rr*np.cos(th), cy+rr*np.sin(th)])
    Hm = homography(CAN[CORNERS], np.array(dst))
    if Hm is None: return None, "degenerate"

    centres = apply_h(Hm, CAN)
    scale = np.hypot(*(centres[11]-centres[7]))/ (CAN[11][0]-CAN[7][0])   # px per canonical unit
    counts = {n:0 for n in NAMES}
    good = 0
    for i,(px,py) in enumerate(centres):
        samples = []
        for rr in (0.55,0.80):
            for t in np.arange(0,360,30):
                x = px + scale*rr*np.cos(np.radians(t)); y = py + scale*rr*np.sin(np.radians(t))
                xi,yi = int(round(x)), int(round(y))
                if 0<=xi<W_ and 0<=yi<H_: samples.append(a[yi,xi])
        if len(samples) < 8: continue
        lab = to_lab(np.array(samples))
        med = np.median(lab,0)
        if med[0] < 18 or (med[0] > 82 and np.hypot(med[1],med[2]) < 18):
            continue            # sample-quality gate
        d = np.sqrt((((med-R)*W)**2).sum(1))
        counts[NAMES[int(d.argmin())]] += 1
        good += 1
    return counts, good

print(f"{'photo':<30} {'grain':>6}{'wool':>6}{'lumbr':>6}{'brick':>6}{'ore':>6}{'desrt':>6}  used  err")
print(f"{'TRUE':<30} " + "".join(f"{TRUE[n]:>6}" for n in NAMES))
print("-"*80)
errs=[]
for f in sorted(glob.glob(r"C:\Users\laxah\OneDrive\Desktop\Board Pictures\*.jpg")):
    c, used = probe(f)
    if c is None: print(f"{os.path.basename(f):<30} {used}"); continue
    err = sum(abs(c[n]-TRUE[n]) for n in NAMES)
    errs.append(err)
    print(f"{os.path.basename(f):<30} " + "".join(f"{c[n]:>6}" for n in NAMES) + f"  {used:>4}  {err:>3}")
if errs: print(f"\nmean absolute tile-count error: {np.mean(errs):.1f} of 19")
