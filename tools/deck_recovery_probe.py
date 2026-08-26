"""Two questions the player asked, measured.

1. When a token is declined, can the TOKEN BAG deduce it?

   The bag is fixed: one 2, one 12, two of everything else. So every number the
   reader commits to removes a possibility from the ones it did not. If the
   values still missing are all distinct from each other, the leftovers are
   forced and nothing has to be guessed.

2. Is PIP COUNT worth re-measuring, the way hole count was?

   Pips were the original design and were abandoned at "9 of 18, and that is
   its ceiling". But that ceiling was measured through a face predicate that
   never matched the face — the same measurement error that made hole counting
   look useless. Pip count maps to a PAIR of values:

       1 pip : 2, 12       3 pips: 4, 10      5 pips: 6, 8
       2 pips: 3, 11       4 pips: 5, 9

   and holes split every pair that shape finds hard — 5 from 9, 6 from 8 —
   while failing only on 2/12, 3/11 and 4/10, which shape finds trivial because
   one is a single digit and the other is two.
"""
import sys
from collections import Counter
from itertools import permutations

sys.path.insert(0, 'tools')
import numpy as np
from PIL import Image

import digit_match_probe as D
import hole_penalty_probe as H
from board_shots import SHOTS, TRUTH
from fit_probe import CAN, CORNERS, homography, apply_h
from token_probe import otsu, components

BAG = Counter({2: 1, 12: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2})
PIPS = {2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1}


def count_pips(rgb, gray, size):
    """How many pips, using the wider disc they actually sit in.

    The digit mask deliberately excludes them: it shrinks the disc and keeps
    only large blobs. Pips need their own, wider disc and a smaller floor —
    with the old settings they survived on under half the tokens.
    """
    f = D.locate_sat(rgb, size)
    if f is None:
        return None
    cx, cy, r = f
    digit_r = r * 0.9
    pip_r = r * 0.98
    yy, xx = np.mgrid[0:size, 0:size]
    d2 = (xx - cx) ** 2 + (yy - cy) ** 2
    inside = d2 <= digit_r * digit_r
    if inside.sum() < 40:
        return None
    cut = otsu(gray[inside])

    mb = max(2, round(size * size * 0.0008))
    comps = [c for c in components((gray <= cut) & inside, True) if c['size'] >= mb]
    keep = [c for c in comps
            if max(np.hypot(px - cx, py - cy) for px, py in
                   [(c['minx'], c['miny']), (c['maxx'], c['miny']),
                    (c['minx'], c['maxy']), (c['maxx'], c['maxy'])]) <= digit_r * 0.99]
    if not keep:
        return None
    largest = max(c['size'] for c in keep)
    lab = np.zeros((size, size), bool)
    for c in [c for c in keep if c['size'] >= largest * 0.5]:
        lab[c['miny']:c['maxy'] + 1, c['minx']:c['maxx'] + 1] |= \
            ((gray <= cut) & inside)[c['miny']:c['maxy'] + 1, c['minx']:c['maxx'] + 1]
    if lab.sum() < 30:
        return None
    ys, xs = np.nonzero(lab)
    dcx, dcy = xs.mean(), ys.mean()
    dr = np.hypot(xs - dcx, ys - dcy).max()

    pip_floor = max(2, round(size * size * 0.0004))
    pips = [c for c in components((gray <= cut) & (d2 <= pip_r * pip_r), True)
            if pip_floor <= c['size'] < largest * 0.5
            and np.hypot((c['minx'] + c['maxx']) / 2 - dcx,
                         (c['miny'] + c['maxy']) / 2 - dcy) >= dr * 0.35]
    return len(pips)


def load_pips(photo, corners, truth):
    im = Image.open(photo).convert('RGB')
    a = np.asarray(im)
    H_, W_ = a.shape[:2]
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    Hm = homography(CAN[CORNERS], np.array([(x * W_, y * H_) for x, y in corners], float))
    A = apply_h(Hm, np.array([CAN[7]]))[0]
    B = apply_h(Hm, np.array([CAN[11]]))[0]
    scale = np.hypot(*(B - A)) / (CAN[11][0] - CAN[7][0])
    rad = D.TOKEN_RADIUS * scale * H.CROP_PADDING
    size = int(round(rad * 2))
    out = {}
    for i in range(19):
        if truth[i] is None:
            continue
        ce = apply_h(Hm, np.array([CAN[i]]))[0]
        l, t = int(round(ce[0] - rad)), int(round(ce[1] - rad))
        if l < 0 or t < 0 or l + size > W_ or t + size > H_:
            continue
        n = count_pips(a[t:t + size, l:l + size], lum[t:t + size, l:l + size], size)
        if n is not None:
            out[i] = (n, truth[i])
    return out


# ── 1. Does the bag deduce what the reader declined? ─────────────────────────
print('QUESTION 1 — can the token bag deduce a declined token?\n')
bank = H.bank
determined = guessed = boards = 0
for held, faces in bank.items():
    library = [(t, d) for o, f in bank.items() if o != held
               for i, (d, _r, _h, t) in f.items()]
    accepted, declined = {}, []
    for i, (d, red, holes, want) in faces.items():
        best = {}
        for v, tpl in library:
            s = max(float((d == np.roll(tpl, -k, axis=1)).mean()) for k in range(D.SECTORS))
            if s > best.get(v, 0):
                best[v] = s
        win = max(best, key=best.get)
        got = D.disambiguate_with_ink(win, red)
        if best[win] >= D.ACCEPT_SCORE:
            accepted[i] = got
        else:
            declined.append((i, want))
    if not declined:
        boards += 1
        continue
    boards += 1
    remaining = BAG.copy()
    for v in accepted.values():
        remaining[v] -= 1
    left = sorted(v for v, n in remaining.items() for _ in range(max(0, n)))
    # The declined slots must take the leftover values. Unique iff the leftovers
    # are all the same multiset regardless of order — i.e. all identical values.
    unique = len(set(left)) == 1 or len(left) == 1
    print(f'  {held:10s} declined {len(declined)}  leftovers {left}  '
          + ('-> FORCED, deduced exactly' if unique
             else f'-> {len(set(permutations(left)))} orderings, must guess'))
    if unique:
        determined += 1
    else:
        guessed += 1
print(f'\n  boards with nothing declined : {boards - determined - guessed}/{boards}')
print(f'  declines the bag forced      : {determined}')
print(f'  declines needing a guess     : {guessed}')

# ── 2. Is pip count reliable now? ────────────────────────────────────────────
print('\n\nQUESTION 2 — is PIP COUNT reliable now that sampling is fixed?\n')
by = {}
allshots = [('boardB', H.NEW_BOARD, H.TRUTH_NEW)] + [(n, v, TRUTH) for n, v in SHOTS.items()]
for label, (photo, corners), truth in allshots:
    for i, (n, want) in load_pips(photo, corners, truth).items():
        by.setdefault(want, []).append(n)

print('value  expect   pips seen                       agrees')
total = agree = 0
for v in sorted(by):
    hs = by[v]
    d = {}
    for h in hs:
        d[h] = d.get(h, 0) + 1
    a_ = sum(1 for h in hs if h == PIPS[v])
    total += len(hs)
    agree += a_
    print(f'{v:5d}  {PIPS[v]:6d}   {str(dict(sorted(d.items()))):30s}  {a_}/{len(hs)}')
print(f'\n  pip count exactly right: {agree}/{total} ({agree / total:.0%})')
print('  (hole count, for comparison, was 198/200)')
