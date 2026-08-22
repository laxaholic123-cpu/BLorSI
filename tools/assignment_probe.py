"""Does feeding the solver graded evidence beat feeding it one guess?

Every reader currently collapses to a single answer before the assignment sees
anything. readToken emits cost 0 for its pick and one flat penalty for the other
nine; reconcileBoard then asks only "does this equal that". So the solver is
told "this tile is an 8, and every other token is equally wrong" — which throws
away the shape of the evidence entirely.

The signals are individually weak but they fail in different directions:

  glyphs  one digit or two. Robust — it is a big feature — and splits the deck
          13/5, so it is worth more than anything else per bit.
  red     6 and 8 are the only red tokens. Black ink RULES THEM OUT, which is a
          hard constraint rather than a preference.
  pips    noisy at phone resolution, but "off by one" genuinely is better
          evidence than "off by four", and the flat penalty says otherwise.
  holes   weakest. Speckle inflates it, so its influence is capped.

Hungarian then solves globally with the deck enforced: one 2, one 12, two of
everything else. Several weak signals plus one exact constraint should beat any
single reader.

    python tools/assignment_probe.py <photo> --corners x,y x,y x,y x,y
"""
import argparse
import sys

sys.path.insert(0, 'tools')
import numpy as np
from PIL import Image

from fit_probe import CAN, CORNERS, homography, apply_h
from token_probe import otsu, components
from face_locate_probe import locate_face, circle_mask
from method_bench import hungarian

TOKEN_RADIUS = 0.42

# value -> (pips, glyphs, holes, red), from services/vision/tokenDecode.ts
SIG = {
    2: (1, 1, 0, False), 3: (2, 1, 0, False), 4: (3, 1, 0, False),
    5: (4, 1, 0, False), 6: (5, 1, 1, True), 8: (5, 1, 2, True),
    9: (4, 1, 1, False), 10: (3, 2, 1, False), 11: (2, 2, 0, False),
    12: (1, 2, 1, False),
}
# The deck: one 2, one 12, two of everything else.
BAG = [2] + [t for t in (3, 4, 5, 6, 8, 9, 10, 11) for _ in range(2)] + [12]

W_GLYPH = 14.0   # biggest, most robust feature
W_PIP = 3.0      # graded, not flat
W_HOLE = 1.5     # capped below; speckle inflates it
W_RED = 40.0     # effectively a constraint
HOLE_CAP = 3


def signals(crop, rgb_crop, size):
    """Extract pips / glyphs / holes / redness from one located token face."""
    found = locate_face(crop, size)
    if found is None:
        cx = cy = (size - 1) / 2.0
        r = (size / 2) * 0.65
    else:
        cx, cy, r = found
    r *= 0.90

    inside = circle_mask(size, cx, cy, r)
    if inside.sum() < 40:
        return None
    cut = otsu(crop[inside])
    mask = (crop <= cut) & inside

    min_blob = max(2, round(size * size * 0.0008))
    comps = [k for k in components(mask, True) if k['size'] >= min_blob]
    if not comps:
        return None
    largest = max(k['size'] for k in comps)
    glyphs = sum(1 for k in comps if k['size'] >= largest * 0.5)
    pips = sum(1 for k in comps if k['size'] < largest * 0.5)
    holes = sum(1 for k in components(mask, False)
                if k['minx'] > 0 and k['miny'] > 0
                and k['maxx'] < size - 1 and k['maxy'] < size - 1
                and k['size'] >= min_blob)

    # Redness measured against the token's own face, so white balance and the
    # lighting of the moment cancel — the same relative principle the terrain
    # classifier uses.
    ink = rgb_crop[mask]
    face = rgb_crop[inside & ~mask]
    is_red = None
    if len(ink) >= 12 and len(face) >= 12:
        warm = lambda a: a[:, 0].mean() - (a[:, 1].mean() + a[:, 2].mean()) / 2
        is_red = bool(warm(ink) - warm(face) > 18)

    return pips, glyphs, min(holes, HOLE_CAP), is_red


def naive(pips, glyphs, holes):
    """What the current decoder would say, for comparison."""
    by_pips = [v for v, s in SIG.items() if s[0] == pips]
    if not by_pips:
        return None
    by_glyphs = [v for v in by_pips if SIG[v][1] == glyphs]
    cands = by_glyphs or by_pips
    exact = [v for v in cands if SIG[v][2] == holes]
    if len(exact) == 1:
        return exact[0]
    return cands[0] if len(cands) == 1 else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('photo')
    ap.add_argument('--corners', nargs=4, required=True)
    ap.add_argument('--truth', default='4,11,6,5,10,11,12,4,5,,8,10,2,9,3,3,6,8,9')
    args = ap.parse_args()

    truth = [int(t) if t else None for t in args.truth.split(',')]

    im = Image.open(args.photo).convert('RGB')
    a = np.asarray(im).astype(np.float32)
    H_, W_ = a.shape[:2]
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]

    pts = [tuple(float(v) for v in c.split(',')) for c in args.corners]
    Hm = homography(CAN[CORNERS], np.array([(x * W_, y * H_) for x, y in pts], float))
    A = apply_h(Hm, np.array([CAN[7]]))[0]
    B = apply_h(Hm, np.array([CAN[11]]))[0]
    scale = np.hypot(*(B - A)) / (CAN[11][0] - CAN[7][0])
    radius = TOKEN_RADIUS * scale
    size = int(round(radius * 2))

    tiles, obs = [], []
    print('hex | want | p/g/h  red   | naive')
    for i in range(19):
        if truth[i] is None:
            continue
        ce = apply_h(Hm, np.array([CAN[i]]))[0]
        l, t = int(round(ce[0] - radius)), int(round(ce[1] - radius))
        if l < 0 or t < 0 or l + size > W_ or t + size > H_:
            continue
        got = signals(lum[t:t + size, l:l + size], a[t:t + size, l:l + size], size)
        if got is None:
            continue
        p, g, h, red = got
        tiles.append(i)
        obs.append(got)
        print(f'{i:3d} | {truth[i]:4d} | {p}/{g}/{h}  {str(red):5s} | {naive(p, g, h)}')

    # ── Cost matrix: tiles x deck slots ──────────────────────────────────────
    cost = []
    for (p, g, h, red) in obs:
        row = []
        for slot in BAG:
            sp, sg, sh, sred = SIG[slot]
            c = W_GLYPH * abs(g - sg) + W_PIP * abs(p - sp) + W_HOLE * abs(h - min(sh, HOLE_CAP))
            if red is not None and red != sred:
                c += W_RED
            row.append(c)
        cost.append(row)

    assign = hungarian(np.array(cost, dtype=float))
    solved = [BAG[assign[k]] for k in range(len(tiles))]

    n_naive = sum(1 for k, i in enumerate(tiles) if naive(*obs[k][:3]) == truth[i])
    n_solved = sum(1 for k, i in enumerate(tiles) if solved[k] == truth[i])

    print('\nhex | want | naive | solved')
    for k, i in enumerate(tiles):
        nv = naive(*obs[k][:3])
        flag = '  <-- fixed' if solved[k] == truth[i] and nv != truth[i] else (
            '  <-- BROKE' if nv == truth[i] and solved[k] != truth[i] else '')
        print(f'{i:3d} | {truth[i]:4d} | {str(nv):5s} | {solved[k]:6d}{flag}')

    print(f'\nper-tile decode, one guess each : {n_naive}/{len(tiles)}')
    print(f'graded evidence + deck constraint: {n_solved}/{len(tiles)}')


if __name__ == '__main__':
    main()
