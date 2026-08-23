"""Can a number token be read by MATCHING it against examples of itself?

VERDICT: no, not this way. Measured, then abandoned. Kept as evidence so the
idea is not re-attempted from scratch.

THE TEST
--------
Leave-one-out on a single photo: eight values appear twice on the board, so a
template is harvested from one physical token and used to read the OTHER one.
Same photo, same lamp, same camera, different token at a different rotation on a
different tile. This is the EASIEST possible version of the task and a necessary
condition — templates that cannot survive it will never read a second photo.

A cross-PHOTO run was tried first and produced 3/18. That number was garbage:
the second photo's corners were stale, so every crop landed on bare tile and the
result was scored against a truth array for a board that was not in the frame.
Check that crops contain tokens before believing any accuracy figure from them.

WHAT WAS FIXED ALONG THE WAY (real, and worth keeping in mind)
-------------------------------------------------------------
Locating the face by BRIGHTNESS does not work — a gold wheat field is as bright
as a cream token, and the disc finder located 5 of 18 faces on one photo and 0
of 18 on another, silently falling back to a guessed centre. SATURATION
separates them completely: nothing on a Catan tile is both bright and grey
except the token. Switching to it tightened the per-face ink fraction from
0.14-0.78 to 0.19-0.50, which is what a cream disc with a dark digit should give.
That fixed the SAMPLING. It did not fix the matching.

WHAT DID NOT MOVE IT
--------------------
    binary agreement          2/12      metric is not the problem
    binary Jaccard / Dice     3/12      ink-only comparison is not either
    grey-value NCC            3/12      keeping the greys is not either
    sampling radius 0.65-0.95 flat      alignment is not the remaining gap
    chance                  ~1.2/12

Only "10" matched confidently, both times (NCC 0.60, margin 0.18+) — wide,
two-digit, distinctive. Every single-digit token failed. A polar grid at this
resolution just does not carry enough shape to separate 5 from 6 from 8 from 9
once print, glare and centring vary.

    python tools/token_match_probe.py
"""

import sys
sys.path.insert(0, 'tools')
import numpy as np
from PIL import Image
import template_probe as tp

PHOTO = 'tools/captures/668f66fa-336e-4750-b8b5-7a8ca72d02c4.jpg'
CORNERS = [(0.36033829841462417,0.3151133873349144),(0.6301235448161349,0.31775884961325024),
           (0.6458563277912783,0.662966817220052),(0.37439455060886506,0.6641293310740636)]
REFINE = True

def refine(rgb, size):
    """Centre on the token face using saturation, within a crop already close."""
    a = rgb.astype(np.float32)/255.0
    mx = a.max(2); mn = a.min(2)
    sat = np.where(mx > 0, (mx-mn)/np.maximum(mx,1e-6), 0)
    mask = (sat < 0.30) & (mx > 0.50)
    yy, xx = np.mgrid[0:size, 0:size]
    c = (size-1)/2.0
    # Only the blob covering the middle counts; tile borders touch the edges.
    near = mask & (((xx-c)**2 + (yy-c)**2) <= (size*0.42)**2)
    if near.sum() < 60: return None
    ys, xs = np.nonzero(near)
    return xs.mean(), ys.mean(), size/2*0.80

def sample(rgb, lum, size):
    if REFINE:
        got = refine(rgb, size)
        if got is None: return None
        cx, cy, r = got
    else:
        cx = cy = (size-1)/2.0; r = size/2*0.80
    yy, xx = np.mgrid[0:size, 0:size]
    inside = (xx-cx)**2 + (yy-cy)**2 <= r*r
    if inside.sum() < 40: return None
    cut = tp.otsu(lum[inside])
    bits = np.zeros(tp.SIZE, bool)
    for ring in range(tp.RINGS):
        rr = r*((ring+0.5)/tp.RINGS)
        for s in range(tp.SECTORS):
            th = 2*np.pi*s/tp.SECTORS
            x = int(round(cx+rr*np.cos(th))); y = int(round(cy+rr*np.sin(th)))
            v = lum[y,x] if (0<=x<size and 0<=y<size) else 255
            bits[ring*tp.SECTORS+s] = v <= cut
    return bits

def harvest():
    im = Image.open(PHOTO).convert('RGB')
    a = np.asarray(im); H_, W_ = a.shape[:2]
    lum = 0.2126*a[...,0]+0.7152*a[...,1]+0.0722*a[...,2]
    Hm = tp.homography(tp.CAN[tp.CORNERS], np.array([(x*W_, y*H_) for x,y in CORNERS], float))
    A = tp.apply_h(Hm, np.array([tp.CAN[7]]))[0]; B = tp.apply_h(Hm, np.array([tp.CAN[11]]))[0]
    scale = np.hypot(*(B-A))/(tp.CAN[11][0]-tp.CAN[7][0])
    radius = tp.TOKEN_RADIUS*scale; size = int(round(radius*2))
    out = {}
    for i in range(19):
        if tp.TRUTH[i] is None: continue
        ce = tp.apply_h(Hm, np.array([tp.CAN[i]]))[0]
        l, t = int(round(ce[0]-radius)), int(round(ce[1]-radius))
        if l<0 or t<0 or l+size>W_ or t+size>H_: continue
        s = sample(a[t:t+size, l:l+size], lum[t:t+size, l:l+size], size)
        if s is not None: out[i] = s
    return out

for REFINE_ in (False, True):
    globals()['REFINE'] = REFINE_
    f = harvest()
    inks = [b.mean() for b in f.values()]
    by = {}
    for i, b in f.items(): by.setdefault(tp.TRUTH[i], []).append((i, b))
    pairs = {v: p for v, p in by.items() if len(p) >= 2}
    for m in ('agree','jaccard','dice'):
        tp.METRIC = m
        ok = n = 0
        for v, items in pairs.items():
            for k, (idx, bits) in enumerate(items):
                lib = []
                for v2, items2 in by.items():
                    cand = [b for j,(ii,b) in enumerate(items2) if not (v2==v and j==k)]
                    if cand: lib.append((v2, cand[0]))
                best = (None,-1)
                for v2, t in lib:
                    for sh in range(tp.SECTORS):
                        sc = tp.similarity(bits, tp.rotate(t, sh))
                        if sc > best[1]: best = (v2, sc)
                n += 1; ok += (best[0] == v)
        print(f'refine={str(REFINE_):5s} {m:7s}: leave-one-out {ok}/{n}   '
              f'faces {len(f)}/18  ink {min(inks):.2f}-{max(inks):.2f}')
