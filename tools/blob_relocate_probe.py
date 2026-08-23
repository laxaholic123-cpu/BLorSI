"""Does saturation-based face location rescue blob counting?

Blob counting was measured at 9/18 and called its ceiling. But that number was
taken with locateBrightDisc, which finds the face by BRIGHTNESS — and a gold
wheat field is as bright as a cream token. Measured afterwards: it located 5 of
18 faces on one capture and 0 of 18 on another, silently falling back to a
guessed centre at 0.65 of the assumed radius. So "the pips are too small to
recover" and "we were not looking at the pips" were never separated.

Mirrors readFrame.readToken -> binaryOps -> decodeToken step for step, with only
the disc locator swapped, so the difference here is the difference there.

    python tools/blob_relocate_probe.py
"""
import sys
sys.path.insert(0, 'tools')
import numpy as np
from PIL import Image
from fit_probe import CAN, CORNERS, homography, apply_h
from token_probe import otsu, components

TOKEN_RADIUS = 0.42
SAT_RADIUS = 'area'
DROP_RIM = False
RIM_REACH = 0.93
TRUTH = [4, 11, 6, 5, 10, 11, 12, 4, 5, None, 8, 10, 2, 9, 3, 3, 6, 8, 9]

# value -> (pips, glyphs, holes, red), from tokenDecode.TOKEN_SIGNATURES.
SIG = {2:(1,1,0,False), 3:(2,1,0,False), 4:(3,1,0,False), 5:(4,1,0,False),
       6:(5,1,1,True), 8:(5,1,2,True), 9:(4,1,1,False), 10:(3,2,1,False),
       11:(2,2,0,False), 12:(1,2,0,False)}

SHOTS = {
 '668f66fa': ('tools/captures/668f66fa-336e-4750-b8b5-7a8ca72d02c4.jpg',
   [(0.36033829841462417,0.3151133873349144),(0.6301235448161349,0.31775884961325024),
    (0.6458563277912783,0.662966817220052),(0.37439455060886506,0.6641293310740636)]),
}


def locate_bright(gray, size):
    """binaryOps.locateBrightDisc — the current behaviour."""
    cut = otsu(gray.ravel())
    comps = components(gray > cut, True)
    if not comps: return None
    big = max(comps, key=lambda k: k['size'])
    w = big['maxx']-big['minx']+1; h = big['maxy']-big['miny']+1
    if min(w,h)/max(w,h) < 0.72: return None
    if big['minx']<=0 or big['miny']<=0 or big['maxx']>=size-1 or big['maxy']>=size-1: return None
    r = max(w,h)/2.0
    half = size/2
    if r < half*0.30 or r > half*0.98: return None
    return (big['minx']+big['maxx'])/2.0, (big['miny']+big['maxy'])/2.0, r


def locate_sat(rgb, size):
    """Bright AND grey. Nothing on a Catan tile is both except the token face."""
    a = rgb.astype(np.float32)/255.0
    mx = a.max(2); mn = a.min(2)
    sat = np.where(mx > 0, (mx-mn)/np.maximum(mx,1e-6), 0)
    mask = (sat < 0.30) & (mx > 0.50)
    # Keep only the blob covering the middle: tile borders are pale too, but
    # they run off the edge of the crop rather than sitting in the centre of it.
    yy, xx = np.mgrid[0:size, 0:size]
    c = (size-1)/2.0
    near = mask & (((xx-c)**2 + (yy-c)**2) <= (size*0.42)**2)
    if near.sum() < 60: return None
    ys, xs = np.nonzero(near)
    cx, cy = xs.mean(), ys.mean()
    # Radius from area, which survives a bite taken out of the blob by glare
    # better than the bounding box does.
    if SAT_RADIUS == 'area':
        # Area-derived: survives a bite taken out of the blob by glare, but the
        # blob is clipped by the centre window above, so it under-reports.
        r = np.sqrt(near.sum()/np.pi)
    else:
        r = (size/2)*SAT_RADIUS
    return cx, cy, r


def decode(pips, glyphs, holes, red):
    """tokenDecode.decodeToken, same order of resort."""
    by_pips = [v for v,s in SIG.items() if s[0]==pips]
    if not by_pips: return None
    by_glyphs = [v for v in by_pips if SIG[v][1]==glyphs]
    cand = by_glyphs if by_glyphs else by_pips
    exact = [v for v in cand if SIG[v][2]==holes]
    if len(exact)==1: return exact[0]
    if len(exact)>1: return None
    if len(cand)==1: return cand[0]
    if red is not None:
        byc = [v for v in cand if SIG[v][3]==red]
        if len(byc)==1: return byc[0]
    return None


def run(mode, photo, corners, verbose=False):
    im = Image.open(photo).convert('RGB')
    a = np.asarray(im); H_, W_ = a.shape[:2]
    lum = 0.2126*a[...,0]+0.7152*a[...,1]+0.0722*a[...,2]
    Hm = homography(CAN[CORNERS], np.array([(x*W_, y*H_) for x,y in corners], float))
    A = apply_h(Hm, np.array([CAN[7]]))[0]; B = apply_h(Hm, np.array([CAN[11]]))[0]
    scale = np.hypot(*(B-A))/(CAN[11][0]-CAN[7][0])
    radius = TOKEN_RADIUS*scale; size = int(round(radius*2))

    ok = located = 0
    feat_ok = {'pips':0, 'glyphs':0, 'holes':0, 'red':0}
    n = 0
    rows = []
    for i in range(19):
        if TRUTH[i] is None: continue
        ce = apply_h(Hm, np.array([CAN[i]]))[0]
        l, t = int(round(ce[0]-radius)), int(round(ce[1]-radius))
        if l<0 or t<0 or l+size>W_ or t+size>H_: continue
        n += 1
        gray = lum[t:t+size, l:l+size]
        rgb = a[t:t+size, l:l+size]

        found = locate_bright(gray, size) if mode=='bright' else locate_sat(rgb, size)
        if found is not None:
            located += 1
            cx, cy, r = found
        else:
            cx = cy = (size-1)/2.0; r = (size/2)*0.65   # binaryOps.fallbackDisc
        r *= 0.9                                        # inside the printed rim

        yy, xx = np.mgrid[0:size, 0:size]
        inside = (xx-cx)**2 + (yy-cy)**2 <= r*r
        if inside.sum() < 20: continue
        cut = otsu(gray[inside])
        mask = (gray <= cut) & inside

        min_blob = max(2, round(size*size*0.0008))
        comps = [c for c in components(mask, True) if c['size'] >= min_blob]

        if DROP_RIM:
            # The tile is darker than the face, so any part of it inside the
            # sampled disc thresholds as ink — a crescent hugging one side.
            # Being the biggest blob, it gets called the glyph, the real digit
            # is demoted to a pip, and every count collapses. It arrives from
            # OUTSIDE, so it touches the disc boundary; the digit and pips
            # never do. Reach of the disc edge, not of the crop.
            keep = []
            for c in comps:
                corners_ = [(c['minx'], c['miny']), (c['maxx'], c['miny']),
                            (c['minx'], c['maxy']), (c['maxx'], c['maxy'])]
                far = max(np.hypot(px-cx, py-cy) for px, py in corners_)
                if far <= r*RIM_REACH: keep.append(c)
            comps = keep
            if not comps: continue
        if not comps: continue
        largest = max(c['size'] for c in comps)
        glyphs = [c for c in comps if c['size'] >= largest*0.5]
        pips   = [c for c in comps if c['size'] <  largest*0.5]

        bg = components(~mask, False if False else True) if False else components(np.logical_not(mask), True)
        holes = len([c for c in bg if c['minx']>0 and c['miny']>0
                     and c['maxx']<size-1 and c['maxy']<size-1])

        ink = mask; face = inside & ~mask
        red = None
        if ink.sum() >= 12 and face.sum() >= 12:
            warm = lambda m: (rgb[...,0][m].mean() - (rgb[...,1][m].mean()+rgb[...,2][m].mean())/2)
            red = bool(warm(ink) - warm(face) > 18)

        want = TRUTH[i]
        wp, wg, wh, wr = SIG[want]
        feat_ok['pips']   += (len(pips)==wp)
        feat_ok['glyphs'] += (len(glyphs)==wg)
        feat_ok['holes']  += (holes==wh)
        feat_ok['red']    += (red==wr)
        got = decode(len(pips), len(glyphs), holes, red)
        ok += (got == want)
        rows.append((i, want, got, len(pips), wp, len(glyphs), wg, holes, wh, red, wr))

    if verbose:
        print('hex want got | pips  glyph hole  red')
        for i,w,g,p,wp,gl,wg,h,wh,r,wr in rows:
            flag = '' if g==w else '  <-- wrong'
            print(f'{i:3d} {w:4d} {str(g):3s} | {p}/{wp}   {gl}/{wg}   {h}/{wh}   '
                  f'{str(r)[:1]}/{str(wr)[:1]}{flag}')
    return ok, n, located, feat_ok


for name, (photo, corners) in SHOTS.items():
    print(f'=== {name} ===')
    ok, n, loc, f = run('bright', photo, corners)
    print(f'bright      : decoded {ok:2d}/{n}  located {loc:2d}/{n}  '
          f'pips {f["pips"]:2d} glyphs {f["glyphs"]:2d} holes {f["holes"]:2d} red {f["red"]:2d}')
    globals()['DROP_RIM'] = True
    for rad in (0.60, 0.70, 0.75, 0.80, 0.85, 0.90):
        for reach in (0.85, 0.93, 0.99):
            globals()['SAT_RADIUS'] = rad; globals()['RIM_REACH'] = reach
            ok, n, loc, f = run('sat', photo, corners)
            print(f'sat r={rad:.2f} reach={reach:.2f}: decoded {ok:2d}/{n}  '
                  f'pips {f["pips"]:2d} glyphs {f["glyphs"]:2d} holes {f["holes"]:2d} red {f["red"]:2d}')
