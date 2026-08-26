"""Use the digit's HOLE COUNT to break the shape ties that are producing errors.

WHY THIS, AND WHY IT WAS REJECTED BEFORE
----------------------------------------
Holes were measured early and dismissed: an 8 showed its two loops only 5 times
in 9. But that was measured through a face predicate that never matched the face
(see CLAUDE.md), so the mask being counted was full of tile. Re-measured with
the sampler fixed, 198 of 200 tokens show the EXACT expected hole count.

More useful still, the two failures both LOST a hole — glare closing a loop —
and no token has ever gained one. So "more holes than expected" is near
impossible, while "fewer" happens occasionally. The penalty is asymmetric to
match.

    0 holes : 2, 3, 5, 11, 12
    1 hole  : 4, 6, 9, 10
    2 holes : 8

That separates 5 from 8 and 5 from 6 — which is exactly what the errors on a
newly arranged board were: 6->5, 5->6, 5->8, 8->5. It does NOT separate 6 from
9 (both one hole), which is fine: ink colour and pip direction already do.
"""
import sys

sys.path.insert(0, 'tools')
import numpy as np
from PIL import Image

import digit_match_probe as D
from board_shots import SHOTS, TRUTH, CROP_PADDING, HARD_CASE, DEVICE_RUN
from fit_probe import CAN, CORNERS, homography, apply_h
from token_probe import otsu, components

#: A second physical arrangement of the same set. Its truth was not entered by
#: hand — it was read off the crops and then VALIDATED against the token bag
#: (exactly one 2, one 12, two of everything else), which it matches exactly.
NEW_BOARD = ('tools/captures/ed077f23-a9a3-4cd9-8d45-11f83544a907.jpg',
             [(0.3553182772855668, 0.2984845164465526),
              (0.6707862025652187, 0.2894142562624008),
              (0.6547219258332814, 0.7083182392423114),
              (0.35381221866711116, 0.6841307576497395)])
TRUTH_NEW = [6, 6, 11, 10, 5, 4, 12, 8, 5, None, 11, 8, 9, 10, 4, 2, 3, 9, 3]

HOLES = {2: 0, 3: 0, 4: 1, 5: 0, 6: 1, 8: 2, 9: 1, 10: 1, 11: 0, 12: 0}

#: Score subtracted when a template has FEWER holes than the digit shows.
#: Glare cannot open a loop, so this direction is near-impossible and is
#: penalised hard.
PENALTY_TOO_FEW = 0.20
#: Subtracted when a template has MORE holes than the digit shows. Glare fills
#: loops, so this happens for real and is penalised gently.
PENALTY_TOO_MANY = 0.05


def sample(rgb, gray, size):
    """Digit shape, ink colour, and hole count in one pass."""
    f = D.locate_sat(rgb, size)
    if f is None:
        return None
    cx, cy, r = f
    r *= 0.9
    yy, xx = np.mgrid[0:size, 0:size]
    inside = (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
    if inside.sum() < 40:
        return None
    cut = otsu(gray[inside])
    mask = (gray <= cut) & inside
    mb = max(2, round(size * size * 0.0008))
    comps = [c for c in components(mask, True) if c['size'] >= mb]
    keep = [c for c in comps
            if max(np.hypot(px - cx, py - cy) for px, py in
                   [(c['minx'], c['miny']), (c['maxx'], c['miny']),
                    (c['minx'], c['maxy']), (c['maxx'], c['maxy'])]) <= r * 0.99]
    if not keep:
        return None
    largest = max(c['size'] for c in keep)
    lab = np.zeros((size, size), bool)
    for c in [c for c in keep if c['size'] >= largest * 0.5]:
        lab[c['miny']:c['maxy'] + 1, c['minx']:c['maxx'] + 1] |= \
            mask[c['miny']:c['maxy'] + 1, c['minx']:c['maxx'] + 1]
    if lab.sum() < 30:
        return None

    # Enclosed background, sized against the digit so speckle does not count
    # and the gap between two strokes does not either.
    floor = max(4, round(lab.sum() * 0.02))
    bg = components(np.logical_not(lab), True)
    holes = sum(1 for c in bg if c['minx'] > 0 and c['miny'] > 0
                and c['maxx'] < size - 1 and c['maxy'] < size - 1
                and c['size'] >= floor)

    ys, xs = np.nonzero(lab)
    dcx, dcy = xs.mean(), ys.mean()
    dr = np.hypot(xs - dcx, ys - dcy).max()
    if dr < 4:
        return None
    out = np.zeros((D.RINGS, D.SECTORS), np.float32)
    for ring in range(D.RINGS):
        rr = dr * ((ring + 0.5) / D.RINGS)
        for s in range(D.SECTORS):
            th = 2 * np.pi * s / D.SECTORS
            x = int(round(dcx + rr * np.cos(th)))
            y = int(round(dcy + rr * np.sin(th)))
            out[ring, s] = lab[y, x] if (0 <= x < size and 0 <= y < size) else 0
    return out, D.ink_is_red(rgb, lab, inside), holes


def load(photo, corners, truth):
    im = Image.open(photo).convert('RGB')
    a = np.asarray(im)
    H_, W_ = a.shape[:2]
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    Hm = homography(CAN[CORNERS], np.array([(x * W_, y * H_) for x, y in corners], float))
    A = apply_h(Hm, np.array([CAN[7]]))[0]
    B = apply_h(Hm, np.array([CAN[11]]))[0]
    scale = np.hypot(*(B - A)) / (CAN[11][0] - CAN[7][0])
    rad = D.TOKEN_RADIUS * scale * CROP_PADDING
    size = int(round(rad * 2))
    out = {}
    for i in range(19):
        if truth[i] is None:
            continue
        ce = apply_h(Hm, np.array([CAN[i]]))[0]
        l, t = int(round(ce[0] - rad)), int(round(ce[1] - rad))
        if l < 0 or t < 0 or l + size > W_ or t + size > H_:
            continue
        g = sample(a[t:t + size, l:l + size], lum[t:t + size, l:l + size], size)
        if g is not None:
            out[i] = (*g, truth[i])
    return out


ALL = [('device', DEVICE_RUN, TRUTH), ('hard', HARD_CASE, TRUTH),
       ('newboard', NEW_BOARD, TRUTH_NEW)] + [(n, v, TRUTH) for n, v in SHOTS.items()]

print('sampling...')
bank = {label: load(photo, corners, truth) for label, (photo, corners), truth in ALL}
print(f'{sum(len(v) for v in bank.values())} tokens across {len(bank)} captures\n')


def run(use_holes):
    ok = n = a_ok = a_n = 0
    wrong = []
    for held in bank:
        library = [(t, d, h) for o, f in bank.items() if o != held
                   for i, (d, _r, h, t) in f.items()]
        for i, (d, red, holes, want) in bank[held].items():
            best = {}
            for value, tpl, _th in library:
                s = max(float((d == np.roll(tpl, -k, axis=1)).mean())
                        for k in range(D.SECTORS))
                if use_holes:
                    expected = HOLES[value]
                    if expected > holes:
                        s -= PENALTY_TOO_FEW * (expected - holes)
                    elif expected < holes:
                        s -= PENALTY_TOO_MANY * (holes - expected)
                if s > best.get(value, -9):
                    best[value] = s
            win = max(best, key=best.get)
            got = D.disambiguate_with_ink(win, red)
            n += 1
            ok += got == want
            if best[win] >= D.ACCEPT_SCORE:
                a_n += 1
                a_ok += got == want
                if got != want:
                    wrong.append(f'{held}/h{i} {want}->{got}@{best[win]:.2f}')
    return ok, n, a_ok, a_n, wrong


for use in (False, True):
    ok, n, a_ok, a_n, wrong = run(use)
    label = 'with holes ' if use else 'shape only '
    print(f'{label}: overall {ok:3d}/{n} ({ok / n:3.0%})   '
          f'accepted {a_ok}/{a_n} ({a_ok / max(1, a_n):4.0%})   '
          f'coverage {a_n / n:3.0%}')
    if wrong:
        print(f'{"":13s} wrong but accepted: {wrong}')
