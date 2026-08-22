"""Does locating the token face first fix the decode?

The contact sheet from token_probe.py showed the real failure: the crop assumes
the token face is centred and fills it, and neither is true. Measured on a real
capture, the face is about 64% of the assumed radius and sits up to half a
radius off centre. So the decoder was thresholding the surrounding TILE as ink,
calling that huge region a glyph, and demoting the actual digits to pips.

This tries the obvious repair — find the bright disc, then decode inside it —
and scores it against the same board, so the change can be judged before any of
it is written in TypeScript.

    python tools/face_locate_probe.py <photo> --corners x,y x,y x,y x,y
"""
import argparse
import sys

sys.path.insert(0, 'tools')
import numpy as np
from PIL import Image

from fit_probe import CAN, CORNERS, homography, apply_h
from token_probe import otsu, components

TOKEN_RADIUS = 0.42

# pips, glyphs, holes -> value, from services/vision/tokenDecode.ts
SIGNATURES = [
    (1, 1, 0, 2), (2, 1, 0, 3), (3, 1, 0, 4), (4, 1, 0, 5), (5, 1, 1, 6),
    (5, 1, 2, 8), (4, 1, 1, 9), (3, 2, 1, 10), (2, 2, 0, 11), (1, 2, 1, 12),
]


def decode(pips, glyphs, holes):
    by_pips = [s for s in SIGNATURES if s[0] == pips]
    if not by_pips:
        return None
    by_glyphs = [s for s in by_pips if s[1] == glyphs]
    cands = by_glyphs or by_pips
    exact = [s for s in cands if s[2] == holes]
    if len(exact) == 1:
        return exact[0][3]
    if len(cands) == 1:
        return cands[0][3]
    return None


def circle_mask(size, cx, cy, r):
    yy, xx = np.mgrid[0:size, 0:size]
    return (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r


def locate_face(crop, size):
    """Find the token's bright face inside the crop.

    The face is the brightest large blob. Returns None when what is found is
    implausible — spilling to the crop edge means the tile is bright too and
    the disc was not really found, which must fall back rather than guess.
    """
    cut = otsu(crop.ravel())
    comps = components(crop > cut, True)
    if not comps:
        return None
    big = max(comps, key=lambda k: k['size'])
    w = big['maxx'] - big['minx'] + 1
    h = big['maxy'] - big['miny'] + 1
    cx = (big['minx'] + big['maxx']) / 2.0
    cy = (big['miny'] + big['maxy']) / 2.0
    r = max(w, h) / 2.0
    # A found face must look like a disc, and must not run off the crop.
    if min(w, h) / max(w, h) < 0.72:
        return None
    if big['minx'] <= 0 or big['miny'] <= 0 or big['maxx'] >= size - 1 or big['maxy'] >= size - 1:
        return None
    if not (0.30 * size / 2 <= r <= 0.98 * size / 2):
        return None
    return cx, cy, r


def read(crop, size, mode):
    if mode == 'current':
        cx = cy = (size - 1) / 2.0
        r = (size / 2) * 0.92
    else:
        found = locate_face(crop, size)
        if found is None:
            cx = cy = (size - 1) / 2.0
            r = (size / 2) * 0.65   # measured: the face is ~64% of the assumed radius
        else:
            cx, cy, r = found
        r *= 0.90   # pull inside the printed rim

    inside = circle_mask(size, cx, cy, r)
    if inside.sum() < 40:
        return None, 0, 0, 0
    cut = otsu(crop[inside])
    mask = (crop <= cut) & inside

    min_blob = max(2, round(size * size * 0.0008))
    comps = [k for k in components(mask, True) if k['size'] >= min_blob]
    if not comps:
        return None, 0, 0, 0
    largest = max(k['size'] for k in comps)
    glyphs = [k for k in comps if k['size'] >= largest * 0.5]
    pips = [k for k in comps if k['size'] < largest * 0.5]
    holes = sum(1 for k in components(mask, False)
                if k['minx'] > 0 and k['miny'] > 0
                and k['maxx'] < size - 1 and k['maxy'] < size - 1)
    return decode(len(pips), len(glyphs), holes), len(pips), len(glyphs), holes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('photo')
    ap.add_argument('--corners', nargs=4, required=True)
    ap.add_argument('--truth', default='4,11,6,5,10,11,12,4,5,,8,10,2,9,3,3,6,8,9',
                    help='19 comma-separated tokens, empty for the desert')
    ap.add_argument('--skip', default='', help='hex indices to ignore (overlay-contaminated)')
    args = ap.parse_args()

    truth = [int(t) if t else None for t in args.truth.split(',')]
    skip = {int(s) for s in args.skip.split(',') if s.strip()}

    im = Image.open(args.photo).convert('RGB')
    a = np.asarray(im).astype(np.float32) / 255.0
    H_, W_ = a.shape[:2]
    lum = (0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]) * 255.0

    pts = [tuple(float(v) for v in c.split(',')) for c in args.corners]
    Hm = homography(CAN[CORNERS], np.array([(x * W_, y * H_) for x, y in pts], float))
    A = apply_h(Hm, np.array([CAN[7]]))[0]
    B = apply_h(Hm, np.array([CAN[11]]))[0]
    scale = np.hypot(*(B - A)) / (CAN[11][0] - CAN[7][0])
    radius = TOKEN_RADIUS * scale
    size = int(round(radius * 2))

    print(f'crop {size}x{size}px   (skipping {sorted(skip) or "nothing"})\n')
    print('hex | want | current | located |   current p/g/h  |  located p/g/h')
    score = {'current': 0, 'located': 0}
    n = 0
    for i in range(19):
        if i in skip or truth[i] is None:
            continue
        ce = apply_h(Hm, np.array([CAN[i]]))[0]
        l, t = int(round(ce[0] - radius)), int(round(ce[1] - radius))
        if l < 0 or t < 0 or l + size > W_ or t + size > H_:
            continue
        crop = lum[t:t + size, l:l + size]
        n += 1
        cur, cp, cg, ch = read(crop, size, 'current')
        loc, lp, lg, lh = read(crop, size, 'located')
        if cur == truth[i]:
            score['current'] += 1
        if loc == truth[i]:
            score['located'] += 1
        flag = '  <-- fixed' if loc == truth[i] and cur != truth[i] else (
            '  <-- BROKE' if cur == truth[i] and loc != truth[i] else '')
        print(f'{i:3d} | {truth[i]:4d} | {str(cur):7s} | {str(loc):7s} |'
              f'  {cp}/{cg}/{ch}          |  {lp}/{lg}/{lh}{flag}')

    print(f'\ncurrent  (assume centred, fills crop): {score["current"]}/{n}')
    print(f'located  (find the face, then decode):  {score["located"]}/{n}')


if __name__ == '__main__':
    main()
