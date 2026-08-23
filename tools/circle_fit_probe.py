"""Fit an actual circle to the token face, instead of assuming its radius.

WHY THIS, AFTER FOUR TWEAKS FAILED
----------------------------------
The disc was sized at `1/CROP_PADDING` of the crop half-width, which is correct
only when the homography scale is exact — and it never is, because corners are
tapped by hand on a phone. A few percent generous and the disc overruns the
face onto tile. Mid-green tile comes in under the Otsu cut, forms a crescent of
"ink", the digit touches the crescent, and the merged blob reaches the disc
boundary and is rejected. The token then reads as NOTHING.

That killed all four RED tokens on the saved failing capture, and the deck
solver guessed 6/8 between them. Shrinking the disc, measuring the radius from
the face pixels, filling holes and excluding coloured tile were all tried and
all rejected (see CLAUDE.md). The remaining honest option is to measure the
face boundary directly.

HOW
---
1. Rough centre from the saturation centroid — good enough to cast from, which
   is all it has to be.
2. Cast rays outward. On each, find the OUTERMOST face-like pixel, not the
   first non-face one: the digit interrupts the face from the inside, so a
   first-crossing rule would stop on the numeral.
3. Fit a circle to those boundary points algebraically, then re-fit with
   outliers dropped. Glare, a finger, a neighbouring token or a ray that ran
   down a tile seam all produce boundary points that do not lie on the circle,
   and any one of them would drag a plain least-squares fit.

The fit corrects the CENTRE as well as the radius, which matters just as much:
an off-centre disc produces the same crescent as an oversized one.
"""
import sys

sys.path.insert(0, 'tools')
import numpy as np
from PIL import Image

import digit_match_probe as D
from board_shots import SHOTS, TRUTH, CROP_PADDING, HARD_CASE
from fit_probe import CAN, CORNERS, homography, apply_h
from token_probe import otsu, components

#: Consecutive non-face pixels that end a ray, as a fraction of the assumed
#: radius. Must exceed a digit stroke and fall short of the gap to a tile
#: border.
GAP = 0.10
#: Rays cast when looking for the face boundary.
RAYS = 64
#: How far out to search, as a multiple of the assumed radius. Generous, since
#: the whole problem is that the assumption runs large or small.
SEARCH = 1.25
#: A boundary point further than this many pixels from the fitted circle is not
#: on it. Expressed as a multiple of the median absolute residual.
OUTLIER_MAD = 2.5


def face_predicate(rgb, size):
    """Bright AND grey. Nothing on a Catan tile is both except the token face."""
    a = rgb.astype(np.float32) / 255.0
    mx = a.max(2)
    mn = a.min(2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    return (sat < 0.30) & (mx > 0.50)


def rough_centre(facey, size):
    yy, xx = np.mgrid[0:size, 0:size]
    c = (size - 1) / 2.0
    reach = (size / 2) * (1 / CROP_PADDING) * 1.05
    near = facey & (((xx - c) ** 2 + (yy - c) ** 2) <= reach * reach)
    if near.sum() < 60:
        return None
    ys, xs = np.nonzero(near)
    return xs.mean(), ys.mean()


def boundary_points(facey, cx, cy, size, assumed):
    """Where the face run ENDS along each ray.

    Not the outermost face-like pixel: Catan tile borders are pale sandy cream,
    unsaturated and bright, so they satisfy the face test too. A ray heading
    into a tile seam keeps finding "face" well past the token and drags the
    radius out.

    Not the first non-face pixel either: the digit interrupts the face from the
    inside, so a first-crossing rule fits a circle to the numeral. Instead,
    walk out and end the run only on a SUSTAINED stretch of non-face — long
    enough to be the tile, too long to be a digit stroke. Rays that still stop
    early on a thick stroke are handled by the outlier rejection in the fit.
    """
    pts = []
    steps = int(assumed * SEARCH)
    gap_tolerance = max(3, int(assumed * GAP))
    for k in range(RAYS):
        th = 2 * np.pi * k / RAYS
        dx, dy = np.cos(th), np.sin(th)
        last = None
        gap = 0
        seen_face = False
        for step in range(4, steps):
            x = int(round(cx + step * dx))
            y = int(round(cy + step * dy))
            if x < 0 or y < 0 or x >= size or y >= size:
                break
            if facey[y, x]:
                last = (x, y)
                seen_face = True
                gap = 0
            elif seen_face:
                # Only a gap AFTER the face has begun can end the run. The
                # numeral sits at the token's CENTRE, so every ray starts
                # inside it; counting that as a gap ended each ray on the digit
                # and fitted a circle to the numeral instead of the face —
                # measured, a median radius of 0.33x the assumed one.
                gap += 1
                if gap > gap_tolerance:
                    break
        if last is not None:
            pts.append(last)
    return pts


def fit_circle(points):
    """Algebraic (Kasa) fit: x^2 + y^2 + Dx + Ey + F = 0."""
    if len(points) < 8:
        return None
    P = np.array(points, dtype=float)
    x, y = P[:, 0], P[:, 1]
    A = np.column_stack([x, y, np.ones(len(P))])
    b = -(x * x + y * y)
    try:
        sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    except np.linalg.LinAlgError:
        return None
    Dc, Ec, Fc = sol
    cx, cy = -Dc / 2, -Ec / 2
    under = cx * cx + cy * cy - Fc
    if under <= 0:
        return None
    return cx, cy, float(np.sqrt(under))


def fit_face_circle(rgb, size, assumed):
    facey = face_predicate(rgb, size)
    rough = rough_centre(facey, size)
    if rough is None:
        return None
    pts = boundary_points(facey, rough[0], rough[1], size, assumed)
    fit = fit_circle(pts)
    if fit is None:
        return None

    # Re-fit without the points that are not on the circle. One pass is enough:
    # the first fit is already close, and a second rejection round starts
    # discarding real boundary on a genuinely elliptical (tilted) token.
    cx, cy, r = fit
    P = np.array(pts, dtype=float)
    resid = np.abs(np.hypot(P[:, 0] - cx, P[:, 1] - cy) - r)
    mad = np.median(resid)
    if mad > 0:
        keep = P[resid <= max(2.0, OUTLIER_MAD * mad)]
        if len(keep) >= 8:
            refit = fit_circle([tuple(p) for p in keep])
            if refit is not None:
                cx, cy, r = refit

    # A fit wildly away from the assumption is a fit that found something else —
    # a neighbouring token, a pale tile border, the sea frame. Fall back rather
    # than trust it.
    if not (0.55 * assumed <= r <= 1.35 * assumed):
        return None
    if np.hypot(cx - (size - 1) / 2, cy - (size - 1) / 2) > assumed * 0.6:
        return None
    return cx, cy, r


def shape_from(rgb, gray, size, locator):
    got = locator(rgb, size)
    if got is None:
        return None
    cx, cy, r = got
    r *= 0.9
    yy, xx = np.mgrid[0:size, 0:size]
    inside = (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
    if inside.sum() < 40:
        return None
    cut = otsu(gray[inside])
    mask = (gray <= cut) & inside
    mb = max(2, round(size * size * 0.0008))
    comps = [c for c in components(mask, True) if c['size'] >= mb]
    keep = []
    for c in comps:
        box = [(c['minx'], c['miny']), (c['maxx'], c['miny']),
               (c['minx'], c['maxy']), (c['maxx'], c['maxy'])]
        if max(np.hypot(px - cx, py - cy) for px, py in box) <= r * 0.99:
            keep.append(c)
    if not keep:
        return None
    largest = max(c['size'] for c in keep)
    glyphs = [c for c in keep if c['size'] >= largest * 0.5]
    lab = np.zeros((size, size), bool)
    for c in glyphs:
        lab[c['miny']:c['maxy'] + 1, c['minx']:c['maxx'] + 1] |= \
            mask[c['miny']:c['maxy'] + 1, c['minx']:c['maxx'] + 1]
    if lab.sum() < 30:
        return None
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
    return out, D.ink_is_red(rgb, lab, inside)


def make_locator(mode, assumed):
    if mode == 'assumed':
        return lambda rgb, size: D.locate_sat(rgb, size)

    def fitted(rgb, size):
        got = fit_face_circle(rgb, size, assumed)
        # Fall back to the assumption when the fit refuses; a refusal means it
        # could not find a plausible circle, not that the token is absent.
        return got if got is not None else D.locate_sat(rgb, size)
    return fitted


def load(photo, corners, mode):
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
    assumed = (size / 2) * (1 / CROP_PADDING)
    locator = make_locator(mode, assumed)
    out = {}
    for i in range(19):
        if TRUTH[i] is None:
            continue
        ce = apply_h(Hm, np.array([CAN[i]]))[0]
        l, t = int(round(ce[0] - rad)), int(round(ce[1] - rad))
        if l < 0 or t < 0 or l + size > W_ or t + size > H_:
            continue
        g = shape_from(a[t:t + size, l:l + size], lum[t:t + size, l:l + size], size, locator)
        if g is not None:
            out[i] = g
    return out


def measure(mode):
    hard = load(HARD_CASE[0], HARD_CASE[1], mode)
    missing = [i for i in range(19) if TRUTH[i] is not None and i not in hard]
    bank = {n: load(p, c, mode) for n, (p, c) in SHOTS.items()}
    refs = sum(len(v) for v in bank.values())

    ok = n = a_ok = a_n = 0
    wrong = []
    for held in bank:
        lib = [(TRUTH[i], d) for o, f in bank.items() if o != held for i, (d, _) in f.items()]
        for i, (d, red) in bank[held].items():
            best = {}
            for v, t in lib:
                s = max(float((d == np.roll(t, -k, axis=1)).mean()) for k in range(D.SECTORS))
                if s > best.get(v, 0):
                    best[v] = s
            win = max(best, key=best.get)
            got = D.disambiguate_with_ink(win, red)
            n += 1
            ok += got == TRUTH[i]
            if best[win] >= D.ACCEPT_SCORE:
                a_n += 1
                a_ok += got == TRUTH[i]
                if got != TRUTH[i]:
                    wrong.append(f'{held} hex{i} {TRUTH[i]}->{got}')

    print(f'{mode:9s} HARD {len(hard):2d}/18 (missing {missing})')
    print(f'{"":9s} refs {refs:3d}/126  LOO {ok}/{n} ({ok / n:.0%})  '
          f'precision {a_ok}/{a_n} ({a_ok / max(1, a_n):.0%})  coverage {a_n / n:.0%}')
    if wrong:
        print(f'{"":9s} wrong but accepted: {wrong}')
    return hard


if __name__ == '__main__':
    import sys as _s
    if len(_s.argv) > 1 and _s.argv[1] == 'sweep':
        for g in (0.06, 0.10, 0.15, 0.22, 0.30):
            globals()['GAP'] = g
            print(f'--- gap {g:.2f} ---')
            measure('fitted')
    else:
        measure('assumed')
        measure('fitted')
