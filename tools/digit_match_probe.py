"""Read number tokens by matching the DIGIT SHAPE against examples of it.

The idea is the same one that failed before — match, do not identify — but
applied to the right thing. Three fixes, each measured, stack to make it work:

  1. Locate the face by SATURATION, not brightness. A gold wheat field is as
     bright as a cream token; locateBrightDisc found 5 of 18 faces on one
     capture and 0 of 18 on another, silently falling back to a guessed centre.
     Nothing on a Catan tile is both bright and grey except the token face.
  2. Drop the rim crescent. The tile is darker than the face, so any of it
     inside the sampled disc thresholds as ink and, being the largest blob,
     gets called the digit. It arrives from outside, so it touches the disc
     boundary; the digit never does.
  3. Match the DIGIT, centred and scaled on its own extent — not the whole
     face. Print size, camera distance and face-centring all drop out.

Matching the whole face instead of the digit is what produced the earlier 3/12
"the approach does not work" result.

    python tools/digit_match_probe.py
"""
import sys
sys.path.insert(0, 'tools')
import numpy as np
from PIL import Image
from fit_probe import CAN, CORNERS, homography, apply_h
from token_probe import otsu, components

TOKEN_RADIUS = 0.42
RINGS, SECTORS = 12, 64
FACE_RADIUS = 0.70          # of the crop half-width, once located
RIM_REACH = 0.99            # blobs reaching past this much of the disc are tile
ACCEPT_SCORE = 0.91         # separated correct from wrong perfectly on the pilot

MULTI = True

TRUTH = [4, 11, 6, 5, 10, 11, 12, 4, 5, None, 8, 10, 2, 9, 3, 3, 6, 8, 9]

SHOTS = {
 'A': ('tools/captures/668f66fa-336e-4750-b8b5-7a8ca72d02c4.jpg',
   [(0.36033829841462417,0.3151133873349144),(0.6301235448161349,0.31775884961325024),
    (0.6458563277912783,0.662966817220052),(0.37439455060886506,0.6641293310740636)]),
 'B': ('tools/captures/PXL_20260822_204040222.jpg',
   [(0.346,0.318),(0.629,0.318),(0.637,0.690),(0.337,0.690)]),
}


def locate_sat(rgb, size):
    a = rgb.astype(np.float32)/255.0
    mx = a.max(2); mn = a.min(2)
    sat = np.where(mx > 0, (mx-mn)/np.maximum(mx,1e-6), 0)
    mask = (sat < 0.30) & (mx > 0.50)
    yy, xx = np.mgrid[0:size, 0:size]
    c = (size-1)/2.0
    near = mask & (((xx-c)**2 + (yy-c)**2) <= (size*0.42)**2)
    if near.sum() < 60: return None
    ys, xs = np.nonzero(near)
    return xs.mean(), ys.mean(), (size/2)*FACE_RADIUS


def digit_shape(rgb, gray, size):
    """Polar sample of the digit alone, scaled to its own reach."""
    f = locate_sat(rgb, size)
    if f is None: return None
    cx, cy, r = f; r *= 0.9
    yy, xx = np.mgrid[0:size, 0:size]
    inside = (xx-cx)**2 + (yy-cy)**2 <= r*r
    if inside.sum() < 40: return None
    cut = otsu(gray[inside]); mask = (gray <= cut) & inside

    min_blob = max(2, round(size*size*0.0008))
    comps = [c for c in components(mask, True) if c['size'] >= min_blob]
    keep = []
    for c in comps:
        box = [(c['minx'],c['miny']),(c['maxx'],c['miny']),
               (c['minx'],c['maxy']),(c['maxx'],c['maxy'])]
        if max(np.hypot(px-cx, py-cy) for px,py in box) <= r*RIM_REACH:
            keep.append(c)
    if not keep: return None

    largest = max(c['size'] for c in keep)
    glyphs = [c for c in keep if c['size'] >= largest*0.5]
    lab = np.zeros((size,size), bool)
    for c in glyphs:
        lab[c['miny']:c['maxy']+1, c['minx']:c['maxx']+1] |= \
            mask[c['miny']:c['maxy']+1, c['minx']:c['maxx']+1]
    if lab.sum() < 30: return None

    ys, xs = np.nonzero(lab)
    dcx, dcy = xs.mean(), ys.mean()
    dr = np.hypot(xs-dcx, ys-dcy).max()
    if dr < 4: return None

    out = np.zeros((RINGS, SECTORS), np.float32)
    for ring in range(RINGS):
        rr = dr*((ring+0.5)/RINGS)
        for s in range(SECTORS):
            th = 2*np.pi*s/SECTORS
            x = int(round(dcx+rr*np.cos(th))); y = int(round(dcy+rr*np.sin(th)))
            out[ring, s] = lab[y, x] if (0 <= x < size and 0 <= y < size) else 0
    return out


def shapes(photo, corners):
    im = Image.open(photo).convert('RGB'); a = np.asarray(im); H_, W_ = a.shape[:2]
    lum = 0.2126*a[...,0]+0.7152*a[...,1]+0.0722*a[...,2]
    Hm = homography(CAN[CORNERS], np.array([(x*W_, y*H_) for x,y in corners], float))
    A = apply_h(Hm, np.array([CAN[7]]))[0]; B = apply_h(Hm, np.array([CAN[11]]))[0]
    scale = np.hypot(*(B-A))/(CAN[11][0]-CAN[7][0])
    radius = TOKEN_RADIUS*scale; size = int(round(radius*2))
    out = {}
    for i in range(19):
        if TRUTH[i] is None: continue
        ce = apply_h(Hm, np.array([CAN[i]]))[0]
        l, t = int(round(ce[0]-radius)), int(round(ce[1]-radius))
        if l<0 or t<0 or l+size>W_ or t+size>H_: continue
        d = digit_shape(a[t:t+size,l:l+size], lum[t:t+size,l:l+size], size)
        if d is not None: out[i] = d
    return out


def agree(x, y): return float((x == y).mean())


def match(d, library):
    sc = {}
    for v, tpl in library:
        sc[v] = max(agree(d, np.roll(tpl, -s, axis=1)) for s in range(SECTORS))
    win = max(sc, key=sc.get)
    runner = max((s for vv,s in sc.items() if vv != win), default=0.0)
    return win, sc[win], sc[win]-runner


learn = shapes(*SHOTS['A'])
test = shapes(*SHOTS['B'])
print(f'digits recovered: learn {len(learn)}/18, test {len(test)}/18')

by = {}
for i, d in learn.items(): by.setdefault(TRUTH[i], []).append(d)
# Every example is its own template and the best one wins, rather than
# averaging them: two tokens of a value can differ in stroke and glare, and
# blurring them together loses whichever one would have matched.
library = [(v, d) for v, ds in by.items() for d in ds] if MULTI else           [(v, ds[0]) for v, ds in by.items()]
print(f'library covers {sorted(v for v,_ in library)}\n')

print('hex want got  score margin  accepted')
ok = acc = acc_ok = 0
for i in sorted(test):
    want = TRUTH[i]
    got, score, margin = match(test[i], library)
    taken = score >= ACCEPT_SCORE
    ok += got == want
    if taken:
        acc += 1; acc_ok += got == want
    print(f'{i:3d} {want:4d} {got:3d}  {score:.3f} {margin:+.3f}  '
          f'{"yes" if taken else "no ":3s}{"" if got==want else "   <-- wrong"}')

print(f'\nCROSS-PHOTO: {ok}/{len(test)} correct')
if acc: print(f'accepted at >={ACCEPT_SCORE}: {acc_ok}/{acc} right, {len(test)-acc} left for the player')
