"""Can individual HEXES be detected per frame, so the camera can move freely?

RESULT WITH COLOUR BLOBS: NO — 1 to 8 blobs detected against 19 expected.

Cause, confirmed by rendering the masks: hexes merge. The sand borders between
tiles are pale, and so is the DESERT — so a "pale = border" rule swallows the
desert and bridges it into the surrounding border lattice, connecting several
hexes into one blob.

WHAT THE MASKS DID SHOW: the border lattice itself is crisp and unbroken. The
board's structure is clearly detectable — just not by colour segmentation of the
tile interiors. Detecting the BORDERS as lines (Hough-style) and fitting a hex
grid to them is the approach the evidence actually supports.

Kept as a record of what was tried, and because the mask-rendering harness is
what made the failure legible.

Run:  python tools/hex_detect_probe.py
"""

import numpy as np, glob, os
from PIL import Image
from collections import deque

def load(path, maxdim=520):
    im = Image.open(path).convert("RGB"); im.thumbnail((maxdim, maxdim))
    return np.asarray(im).astype(np.float32)/255.0

def hex_mask(a):
    mx, mn = a.max(2), a.min(2)
    s = np.where(mx>0, (mx-mn)/np.maximum(mx,1e-6), 0)
    v = mx
    r,g,b = a[...,0],a[...,1],a[...,2]
    sea = (b > r+0.06) & (b > g+0.03)          # blue frame
    pale = (s < 0.28) & (v > 0.62)             # sand borders, tokens, table
    dark = v < 0.12
    return (~sea) & (~pale) & (~dark) & (s > 0.16)

def components(mask, min_px):
    H,W = mask.shape
    seen = np.zeros((H,W), bool)
    out = []
    for sy in range(H):
        for sx in range(W):
            if mask[sy,sx] and not seen[sy,sx]:
                q = deque([(sy,sx)]); seen[sy,sx]=True
                pts=[]
                while q:
                    y,x = q.popleft(); pts.append((y,x))
                    for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
                        ny,nx = y+dy, x+dx
                        if 0<=ny<H and 0<=nx<W and mask[ny,nx] and not seen[ny,nx]:
                            seen[ny,nx]=True; q.append((ny,nx))
                if len(pts) >= min_px:
                    ys = np.array([p[0] for p in pts]); xs = np.array([p[1] for p in pts])
                    out.append(dict(n=len(pts), cy=ys.mean(), cx=xs.mean(),
                                    h=ys.max()-ys.min()+1, w=xs.max()-xs.min()+1))
    return out

def probe(path):
    a = load(path); H,W = a.shape[:2]
    m = hex_mask(a)
    # a hex is a decent fraction of the frame; ignore specks and huge merges
    comps = components(m, min_px=int(H*W*0.0025))
    # keep blobs that are roughly as wide as tall (a hex is compact)
    good = [c for c in comps if 0.55 < c['w']/max(1,c['h']) < 1.8 and c['n'] < H*W*0.15]
    return len(comps), good, (H,W)

print(f"{'photo':<30} {'blobs':>6} {'hex-like':>9}   median size  spacing CV")
for f in sorted(glob.glob(r"C:\Users\laxah\OneDrive\Desktop\Board Pictures\*.jpg")):
    total, good, (H,W) = probe(f)
    if len(good) >= 3:
        sizes = np.array([c['n'] for c in good])
        pts = np.array([[c['cx'], c['cy']] for c in good])
        # nearest-neighbour distance for each blob; a lattice has consistent spacing
        d = np.sqrt(((pts[:,None,:]-pts[None,:,:])**2).sum(2))
        np.fill_diagonal(d, np.inf)
        nn = d.min(1)
        cv = nn.std()/max(nn.mean(),1e-6)
        print(f"{os.path.basename(f):<30} {total:6d} {len(good):9d}   {int(np.median(sizes)):>10}  {cv:8.3f}")
    else:
        print(f"{os.path.basename(f):<30} {total:6d} {len(good):9d}   (too few)")
