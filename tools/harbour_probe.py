"""Read the harbours off a photo: WHERE they are and WHAT they trade.

RESULT
------
    positions   90/90 across 10 captures   (100%)
    types       83/90                      (92.2%)

Positions are SOLVED and types are good enough to propose. What ships is
detected positions plus proposed types the player can correct — which beats
the rotation control outright, because a rotation can only ever reproduce one
printed ring and this reads whatever frame is actually on the table.

HOW POSITIONS GOT TO 100%
-------------------------
Badges are found as cream blobs ENCLOSED BY SEA. The enclosure clause is the
whole trick: the board sits on a white cloth that is also bright and
unsaturated and outweighs every badge by area, so without it the three largest
"badges" are tablecloth.

That alone gives 11-22 blobs per photo — the real nine plus dock timbers and
glare. The RING CONSTRAINT removes the rest, exactly: nine harbours on a
thirty-edge coast spaced 3 or 4 apart means nine gaps summing to 30 with each
in {3,4}, which forces six 3s and three 4s. Only 280 legal rings exist.
Enumerate them, score each against the detections, keep the best. A false
positive on a timber cannot join a ring, because no legal ring has a harbour
there AND at the eight real ones. 10/10 captures exactly right.

It also confirmed the earlier finding from the other direction: the nine edges
recovered from pixels are exactly STANDARD_PORT_LAYOUT rotated 180 degrees.

TYPES: FOUR THINGS MATTERED, IN ORDER OF HOW MUCH
-------------------------------------------------
    raw window, saturated pixels          measures the SEA           ~chance
    + rectify to the edge normal          removes the boat           70.8%
    + normalise colour by the card cream   kills white balance        80.6%
    + centre the crop on the DETECTION     stops clipping the card    83.3%
    + colour bins over the whole card      fixes wool                 92.2%

Every earlier attempt sampled an axis-aligned box, and a badge is a rotated
card with a BOAT across it. The boat is darker than the icon, bigger than the
icon, and inside any square you draw — so the measurements were measuring the
boat. Rectifying to the known edge normal was worth more than every tuning
pass combined.

The cream card is its own light meter, the same trick the terrain reader uses
on token faces: same printed colour on every badge, so dividing by it cancels
the lamp and leaves the ink.

And the fourth instance of this repo's oldest bug: the icon predicate required
SATURATION, which cannot see grey ore or white wool — the exact two that kept
swapping. Describing the card by colour bins rather than segmenting one icon
sidesteps it, because a white sheep on a cream card leaves almost nothing to
segment.

THE COMPOSITION IS WORTH 12 POINTS. Four 3:1 and one 2:1 per resource turns
classification into an assignment with no freedom to spend: 92.2% with it
against 80.0% without, on identical scores. Same move that took the number
tokens to 180/180.

    python tools/harbour_probe.py locate      # per-capture edge assignments
    python tools/harbour_probe.py sheet       # rectified contact sheet
    python tools/harbour_probe.py classify    # feature table
    python -c "import sys;sys.path.insert(0,'tools');import harbour_probe as h;h.accuracy()"
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

from board_shots import SHOTS, DEVICE_RUN, HARD_CASE, BOARD_B
from fit_probe import CAN, CORNERS, homography, apply_h

OUT = os.environ.get('HARBOUR_PROBE_OUT', 'tools/out')
os.makedirs(OUT, exist_ok=True)

APOTHEM = float(np.cos(np.radians(30)))

#: How far beyond the coastal edge midpoint the badge centre sits, in hex
#: radii. Fitted in port_probe against detected badges; 0.65 was the best
#: single value across both boards.
BADGE_OUT = 0.65

AX = [(0,-2),(1,-2),(2,-2),(-1,-1),(0,-1),(1,-1),(2,-1),(-2,0),(-1,0),(0,0),
      (1,0),(2,0),(-2,1),(-1,1),(0,1),(1,1),(-2,2),(-1,2),(0,2)]
NEIGHBOUR = [(0,-1),(1,-1),(1,0),(0,1),(-1,1),(-1,0)]   # NW NE E SE SW W


def coastal_edges():
    """Every (hex, edge) whose neighbour is off the board — 30 of them."""
    idx = {tuple(a): i for i, a in enumerate(AX)}
    out = []
    for i, (q, r) in enumerate(AX):
        for e, (dq, dr) in enumerate(NEIGHBOUR):
            if (q + dq, r + dr) not in idx:
                out.append((i, e))
    return out


def edge_dir(edge):
    """Outward unit normal of a hex edge, in canonical space."""
    th = np.radians(240 + 60 * edge)
    return np.array([np.cos(th), np.sin(th)])


def badge_canonical(hex_index, edge, out=BADGE_OUT):
    return CAN[hex_index] + edge_dir(edge) * (APOTHEM + out)


def load(path, corners):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    dst = np.array([[c[0] * w, c[1] * h] for c in corners], float)
    return im, homography(CAN[CORNERS], dst)


def hsv(a):
    a = a.astype(np.float64) / 255.0
    mx = a.max(2); mn = a.min(2); d = mx - mn
    return np.where(mx > 0, d / np.maximum(mx, 1e-9), 0), mx


def is_sea(a):
    """Blue sea: the most saturated thing on the board and unmistakably cyan."""
    r = a[:, :, 0].astype(float); g = a[:, :, 1].astype(float); b = a[:, :, 2].astype(float)
    return (b > r + 25) & (b > 60) & (g > r)


def label_blobs(mask):
    """Tiny 4-connected labeller — no scipy in this environment."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    cur = 0
    out = []
    for y in range(h):
        for x in range(w):
            if not mask[y, x] or lab[y, x]:
                continue
            cur += 1
            stack = [(y, x)]
            lab[y, x] = cur
            pix = []
            while stack:
                cy, cx = stack.pop()
                pix.append((cy, cx))
                for ny, nx in ((cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny,nx] and not lab[ny,nx]:
                        lab[ny,nx] = cur
                        stack.append((ny,nx))
            out.append(pix)
    return out


def find_badges(path, corners):
    """Cream blobs enclosed by sea, returned in CANONICAL space.

    The enclosure test is the whole trick: the board sits on a white cloth
    which is also bright and unsaturated, and it outweighs every badge by area.
    """
    im, H = load(path, corners)
    W, Hh = im.size
    sc = 900 / max(W, Hh)
    small = im.resize((int(W*sc), int(Hh*sc)), Image.BILINEAR)
    a = np.asarray(small)
    s, v = hsv(a)
    sea = is_sea(a)

    o = apply_h(H, np.array([[0, 0], [1, 0]]))
    rpx = np.hypot(*(o[1]-o[0])) * sc
    centres = apply_h(H, CAN) * sc
    yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
    island = np.zeros(a.shape[:2], bool)
    for cx, cy in centres:
        island |= ((xx-cx)**2 + (yy-cy)**2) < (rpx*1.02)**2

    cream = (~island) & (s < 0.34) & (v > 0.42)
    kept = []
    for blob in label_blobs(cream):
        if len(blob) < (rpx*0.10)**2 or len(blob) > (rpx*0.85)**2:
            continue
        ys = np.array([p[0] for p in blob]); xs = np.array([p[1] for p in blob])
        cy, cx = ys.mean(), xs.mean()
        rad = max(4, int(np.sqrt(len(blob)/np.pi)))
        ring = (np.hypot(xx-cx, yy-cy) > rad*1.4) & (np.hypot(xx-cx, yy-cy) < rad*2.4)
        if ring.sum() and sea[ring].mean() > 0.5:
            kept.append((cx/sc, cy/sc, len(blob)))

    Hi = np.linalg.inv(H)
    if not kept:
        return [], H, im
    can = apply_h(Hi, np.array([[k[0], k[1]] for k in kept]))
    return [tuple(c) for c in can], H, im


def snap_to_edges(points):
    """Assign each detected badge to the coastal edge it sits off.

    Scored on distance from the badge's PREDICTED position for that edge, not
    by ray perpendicular — a far-out point sits near several rays, and the
    earlier ray version mis-assigned two badges on every board because of it.
    """
    ce = coastal_edges()
    preds = {(h, e): badge_canonical(h, e) for h, e in ce}
    used = set()
    out = []
    # Greedy nearest-first, so a confident badge claims its edge before an
    # ambiguous one can take it.
    pairs = []
    for i, p in enumerate(points):
        for key, q in preds.items():
            pairs.append((float(np.hypot(p[0]-q[0], p[1]-q[1])), i, key))
    pairs.sort()
    seen_pt = set()
    for d, i, key in pairs:
        if i in seen_pt or key in used or d > 0.85:
            continue
        seen_pt.add(i); used.add(key)
        out.append((key, points[i], d))
    return out


def locate():
    shots = [('DEVICE', *DEVICE_RUN), ('HARD', *HARD_CASE), ('BOARD_B', *BOARD_B)]
    shots += [(k, p, c) for k, (p, c) in SHOTS.items()]
    per_capture = {}
    for name, path, corners in shots:
        pts, _H, _im = find_badges(path, corners)
        snapped = snap_to_edges(pts)
        per_capture[name] = sorted(k for k, _p, _d in snapped)
        print(f'{name:<10} found {len(pts):>2} blobs, snapped {len(snapped):>2}: '
              + ' '.join(f'h{h}e{e}' for h, e in sorted(k for k, _p, _d in snapped)))

    # Is the FRAME the same across captures? If the ring never moved, every
    # capture should agree on which edges carry harbours.
    from collections import Counter
    tally = Counter()
    for edges in per_capture.values():
        for k in edges:
            tally[k] += 1
    print(f'\nedges seen, out of {len(per_capture)} captures:')
    for key, n in sorted(tally.items(), key=lambda kv: -kv[1]):
        print(f'  h{key[0]}e{key[1]}  {n}')
    strong = [k for k, n in tally.items() if n >= len(per_capture) * 0.6]
    print(f'\n{len(strong)} edges appear in most captures (want 9)')


# ─── The ring constraint ─────────────────────────────────────────────────────
#
# Nine harbours sit on a thirty-edge coast, spaced 3 or 4 apart. That is not a
# style choice: nine gaps summing to 30 with each in {3,4} forces exactly six
# 3s and three 4s, so the whole family of legal rings is tiny — 280 of them.
#
# Enumerate all of them, score each against the detections, keep the best. The
# structure does the work that a better blob detector could not: a false
# positive on a dock timber cannot join a ring, because no legal ring has a
# harbour there AND at the eight real ones.

COASTAL_WALK = [(0,[0,1]),(1,[0,1]),(2,[0,1,2]),(6,[1,2]),(11,[1,2,3]),(15,[2,3]),
                (18,[2,3,4]),(17,[3,4]),(16,[3,4,5]),(12,[4,5]),(7,[4,5,0]),
                (3,[5,0]),(0,[5])]
RING = [(h, e) for h, edges in COASTAL_WALK for e in edges]


def valid_rings():
    """Every legal set of nine harbour positions on the thirty-edge coast."""
    from itertools import combinations
    out = set()
    for start in range(30):
        for fours in combinations(range(9), 3):
            gaps = [4 if i in fours else 3 for i in range(9)]
            pos, cur = [], start
            for g in gaps:
                pos.append(cur % 30)
                cur += g
            out.add(tuple(sorted(pos)))
    return [list(r) for r in out]


_RINGS = None


def select_ring(scores):
    """Best-scoring legal ring. `scores` maps (hex, edge) -> evidence >= 0."""
    global _RINGS
    if _RINGS is None:
        _RINGS = valid_rings()
    by_pos = [scores.get(RING[i], 0.0) for i in range(30)]
    best, best_total = None, -1.0
    for r in _RINGS:
        total = sum(by_pos[i] for i in r)
        if total > best_total:
            best_total, best = total, r
    return [RING[i] for i in best], best_total


def evidence(path, corners):
    """Detection strength per coastal edge: 1 at the predicted spot, 0 far off."""
    pts, _H, _im = find_badges(path, corners)
    scores = {}
    for key in coastal_edges():
        q = badge_canonical(*key)
        d = min((float(np.hypot(p[0]-q[0], p[1]-q[1])) for p in pts), default=99.0)
        if d < 0.85:
            scores[key] = max(0.0, 1.0 - d / 0.85)
    return scores, pts


def centres_for(ring, pts):
    """The detected card centre for each chosen edge, or None to fall back."""
    out = {}
    for key in ring:
        q = badge_canonical(*key)
        best, bd = None, 0.85
        for pt in pts:
            d = float(np.hypot(pt[0]-q[0], pt[1]-q[1]))
            if d < bd:
                bd, best = d, pt
        out[key] = best
    return out


#: The nine harbours on this physical board, recovered independently by
#: detection and confirmed by every capture agreeing. Used as ground truth for
#: measuring the selector.
TRUTH_EDGES = [(0,0),(1,1),(3,5),(6,1),(11,2),(12,5),(15,3),(16,4),(17,3)]


def ring_accuracy():
    shots = [('DEVICE', *DEVICE_RUN), ('HARD', *HARD_CASE), ('BOARD_B', *BOARD_B)]
    shots += [(k, p, c) for k, (p, c) in SHOTS.items()]
    truth = set(TRUTH_EDGES)
    exact = 0
    total_hits = 0
    for name, path, corners in shots:
        scores, pts = evidence(path, corners)
        ring, _tot = select_ring(scores)
        hits = len(truth & set(ring))
        total_hits += hits
        exact += (hits == 9)
        flag = 'OK ' if hits == 9 else '   '
        missed = sorted(truth - set(ring))
        print(f'{flag}{name:<10} raw blobs {len(pts):>2}  ring hits {hits}/9'
              + ('' if hits == 9 else '  missed ' + ' '.join(f'h{h}e{e}' for h, e in missed)))
    n = len(shots)
    print(f'\nRING SELECTION: {exact}/{n} captures exactly right, '
          f'{total_hits}/{n*9} harbours ({100*total_hits/(n*9):.0f}%)')


# ─── Rectified badges ────────────────────────────────────────────────────────

def rectify(im, H, key, half=0.38, size=96, centre=None):
    """Sample the badge upright, in BADGE space rather than image space.

    The card faces out along its edge normal, so that normal defines the frame.
    Sampling a square in this frame puts the card in the same place in every
    crop regardless of where the harbour sits on the coast or how the photo was
    taken — which is what every earlier attempt lacked, and why they all ended
    up measuring the boat instead of the icon.
    """
    hexi, edge = key
    # Centre on the DETECTED card when there is one. The predicted spot is
    # right on average and off by up to a third of a radius on any given photo,
    # which is enough to clip the card or pull the neighbouring dock into the
    # patch — and a contaminated patch is what every earlier attempt measured.
    if centre is None:
        centre = badge_canonical(hexi, edge)
    centre = np.asarray(centre, dtype=float)
    n = edge_dir(edge)               # outward
    t = np.array([-n[1], n[0]])      # along the coast

    g = np.linspace(-half, half, size)
    vv, uu = np.meshgrid(g, g, indexing='ij')
    pts = centre[None, None, :] + uu[..., None] * t[None, None, :] \
                                + vv[..., None] * n[None, None, :]
    flat = apply_h(H, pts.reshape(-1, 2))
    a = np.asarray(im)
    xs = np.clip(flat[:, 0].round().astype(int), 0, a.shape[1] - 1)
    ys = np.clip(flat[:, 1].round().astype(int), 0, a.shape[0] - 1)
    return a[ys, xs].reshape(size, size, 3)


def sheet():
    """Contact sheet of every rectified badge, every capture. LOOK at it."""
    shots = [('DEVICE', *DEVICE_RUN), ('BOARD_B', *BOARD_B), ('HARD', *HARD_CASE)]
    shots += [(k, p, c) for k, (p, c) in SHOTS.items()]
    S = 96
    sheet_im = Image.new('RGB', (S * 9, S * len(shots)), 'black')
    for row, (name, path, corners) in enumerate(shots):
        scores, _pts = evidence(path, corners)
        ring, _ = select_ring(scores)
        im, H = load(path, corners)
        cen = centres_for(ring, _pts)
        for col, key in enumerate(ring):
            patch = rectify(im, H, key, size=S, centre=cen.get(key))
            sheet_im.paste(Image.fromarray(patch.astype(np.uint8)), (col * S, row * S))
        print(f'{name}: ' + ' '.join(f'h{h}e{e}' for h, e in ring))
    sheet_im.save(f'{OUT}/harbour_sheet.png')
    print(f'\nwrote {OUT}/harbour_sheet.png  ({sheet_im.size[0]}x{sheet_im.size[1]})')


# ─── Type classification ─────────────────────────────────────────────────────
#
# Ground truth, read off the rectified contact sheet and CHECKED against the
# component counts: four 3:1 and one 2:1 per resource. A misread would almost
# certainly break that, so the composition is a free validation of the labels
# the way the token bag was for the numbers.

TRUTH_TYPES = {
    (0, 0): 'generic', (1, 1): 'brick',   (6, 1): 'lumber',
    (11, 2): 'generic', (15, 3): 'grain', (17, 3): 'ore',
    (16, 4): 'generic', (12, 5): 'wool',  (3, 5): 'generic',
}

#: One 2:1 per resource, four 3:1. Straight from the box.
COMPOSITION = {'generic': 4, 'brick': 1, 'lumber': 1, 'grain': 1, 'ore': 1, 'wool': 1}


def card_features(patch):
    """Describe the CARD in a rectified badge, ignoring sea and boat.

    The card is the cream region. Everything coloured inside it is the resource
    icon; a 3:1 has none, only dark text on cream. Working inside the card is
    what the earlier attempts never did — they measured a square that always
    contained boat.
    """
    a = patch.astype(np.float64)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mx = a.max(2); mn = a.min(2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-9), 0)
    val = mx / 255.0

    sea = (b > r + 25) & (b > 60) & (g > r)
    cream = (~sea) & (val > 0.45) & (sat < 0.34)
    if cream.sum() < 40:
        return None

    ys, xs = np.nonzero(cream)
    cy, cx = ys.mean(), xs.mean()
    rad = max(6.0, np.sqrt(cream.sum() / np.pi) * 1.25)
    yy, xx = np.mgrid[0:patch.shape[0], 0:patch.shape[1]]
    card = (np.hypot(xx - cx, yy - cy) < rad) & (~sea)
    if card.sum() < 60:
        return None

    # THE ICON IS THE LARGEST NON-CREAM BLOB, whatever colour it is.
    #
    # It used to be "saturated pixels", and that silently could not see the two
    # resources that matter most here: ORE is grey and WOOL is white, so both
    # scored as having no icon at all and were read as 3:1. Every persistent
    # error in the measurement was one of those two — the predicate excluded
    # the very things it was looking for, which is this repo's oldest failure
    # shape and now its fourth recorded instance.
    #
    # Largest blob works because the alternative marks are TEXT: "2:1" is
    # several small thin components, an icon is one big one. Same reasoning
    # that made the digit reader take the largest blob in the token face.
    ink = card & (~cream)
    comps = label_blobs(ink)
    icon = np.zeros_like(card)
    if comps:
        biggest = max(comps, key=len)
        if len(biggest) >= 20:
            ys = np.array([q[0] for q in biggest]); xs = np.array([q[1] for q in biggest])
            icon[ys, xs] = True
    dark = card & (val < 0.34)
    # Kept alongside: how much of the card is SATURATED colour. The largest
    # blob finds grey ore and white wool; this separates a red brick from a
    # dark log, which share a size and not a hue.
    satcol = card & (sat > 0.30) & (val > 0.18)

    total = float(card.sum())
    feat = {
        'ink': float(ink.sum()) / total,
        'icon': float(icon.sum()) / total,
        'dark': float(dark.sum()) / total,
        'satcol': float(satcol.sum()) / total,
    }

    # THE CARD IS ITS OWN LIGHT METER.
    #
    # Raw icon colour is not comparable between captures: one photo is warm
    # lamplight, the next is daylight, and the same printed red lands in a
    # different place in RGB. That is exactly the problem the terrain reader
    # solved by fitting a plane to the token faces — same printed cream, spread
    # across the board, so it measures the light rather than the tile.
    #
    # Every badge carries its own copy of that reference: the cream card the
    # icon is printed on. Dividing by it cancels the illumination and leaves
    # the ink, which is the thing that actually differs between a brick and a
    # sheaf of grain.
    ref = a[cream].mean(0)
    ref = np.maximum(ref, 1.0)
    if icon.sum() > 20:
        m = a[icon].mean(0) / ref
    else:
        m = np.zeros(3)
    feat['r'], feat['g'], feat['b'] = m

    # COLOUR BINS OVER THE WHOLE CARD, not one segmented icon.
    #
    # Segmenting fails on wool specifically: a WHITE sheep on a cream card
    # leaves almost nothing non-cream except its outline, so the "icon" became
    # a thin dark shape indistinguishable from grey ore — which is exactly the
    # pair that kept swapping. Describing the card by what colours are ON it
    # sidesteps the segmentation entirely, and a 3:1 is then simply the card
    # with nothing but cream and text.
    cr, cg, cb = (a[:, :, 0] / ref[0], a[:, :, 1] / ref[1], a[:, :, 2] / ref[2])
    lum = (cr + cg + cb) / 3.0
    warm = cr - (cg + cb) / 2.0        # red/orange ink
    green = cg - (cr + cb) / 2.0
    n = float(card.sum())
    feat['bin_red'] = float((card & (warm > 0.18) & (lum > 0.35)).sum()) / n
    feat['bin_gold'] = float((card & (warm > 0.06) & (warm <= 0.18) & (lum > 0.55)).sum()) / n
    feat['bin_green'] = float((card & (green > 0.05)).sum()) / n
    feat['bin_dark'] = float((card & (lum < 0.45)).sum()) / n
    feat['bin_mid'] = float((card & (lum >= 0.45) & (lum < 0.78) & (abs(warm) <= 0.10)).sum()) / n
    feat['bin_pale'] = float((card & (lum >= 0.78) & (~cream)).sum()) / n

    # Hue as well as ratio: two icons can share a brightness ratio and sit on
    # opposite sides of the colour wheel.
    if icon.sum() > 20:
        rr, gg, bb = a[icon].mean(0)
        feat['hue'] = float(np.degrees(np.arctan2(np.sqrt(3)*(gg-bb), 2*rr-gg-bb)) % 360) / 360.0
    else:
        feat['hue'] = 0.0

    return feat


def classify():
    shots = [('DEVICE', *DEVICE_RUN), ('BOARD_B', *BOARD_B), ('HARD', *HARD_CASE)]
    shots += [(k, p, c) for k, (p, c) in SHOTS.items()]
    rows = []
    for name, path, corners in shots:
        scores, _pts = evidence(path, corners)
        ring, _ = select_ring(scores)
        im, H = load(path, corners)
        for key in ring:
            f = card_features(rectify(im, H, key))
            if f is None:
                continue
            rows.append((name, key, TRUTH_TYPES.get(key, '?'), f))

    print(f'{len(rows)} badges measured\n')
    print(f'{"type":<8} {"n":>3} {"icon%":>7} {"dark%":>7} {"ink%":>7} '
          f'{"R":>5} {"G":>5} {"B":>5}')
    for t in ['generic', 'brick', 'lumber', 'grain', 'ore', 'wool']:
        sub = [f for _n, _k, tt, f in rows if tt == t]
        if not sub:
            continue
        def mean(k): return sum(f[k] for f in sub) / len(sub)
        print(f'{t:<8} {len(sub):>3} {mean("icon"):>7.3f} {mean("dark"):>7.3f} '
              f'{mean("ink"):>7.3f} {mean("r"):>5.2f} {mean("g"):>5.2f} {mean("b"):>5.2f}')

    gen = [f['icon'] for _n, _k, t, f in rows if t == 'generic']
    spec = [f['icon'] for _n, _k, t, f in rows if t not in ('generic', '?')]
    print(f'\nicon%: generic max {max(gen):.3f} | specific min {min(spec):.3f} '
          f'-> {"CLEAN" if max(gen) < min(spec) else "OVERLAP"}')


# ─── Constrained assignment ──────────────────────────────────────────────────
#
# Per-badge scores alone leave a few outliers — a badge under glare, or one
# whose crop caught the edge of the card. The composition fixes them: nine
# harbours, four of them 3:1 and exactly one 2:1 per resource. That turns
# "which type is this badge" into an ASSIGNMENT with no freedom to spend, and
# it is the same move that took the number tokens from 94% to 180/180.

FEATURES = ('icon', 'dark', 'satcol', 'r', 'g', 'b', 'hue',
            'bin_red', 'bin_gold', 'bin_green', 'bin_dark', 'bin_mid', 'bin_pale')
SLOTS = ['generic'] * 4 + ['brick', 'lumber', 'grain', 'ore', 'wool']


def feature_scale(rows):
    """Per-axis spread across the training rows, so no axis dominates."""
    allv = np.array([[f[k] for k in FEATURES] for _n, _k, _t, f in rows])
    # Interquartile spread, for the same reason the profile is a median.
    q1, q3 = np.percentile(allv, [25, 75], axis=0)
    return np.maximum((q3 - q1) / 1.35, 1e-3)


def profile(rows):
    """MEDIAN feature vector per type.

    Median rather than mean because one badge under glare, or one crop that
    caught the edge of the card, drags a mean for the whole type — and with
    only ten examples per resource that is a large pull. The median ignores it.
    """
    out = {}
    for t in set(t for _n, _k, t, _f in rows):
        sub = [f for _n, _k, tt, f in rows if tt == t]
        out[t] = np.array([float(np.median([f[k] for f in sub])) for k in FEATURES])
    return out


def assign(feats, prof, scale):
    """Best type per badge, subject to the box's composition.

    Brute force over the 9!/4! = 15120 distinct assignments. Small enough to be
    exact, and exactness is the point — a greedy pass would spend the single
    'ore' slot on whichever badge happened to score first.
    """
    from itertools import permutations
    vecs = [np.array([f[k] for k in FEATURES]) for f in feats]
    # Scale comes from the TRAINING set. Taking it from the nine badges being
    # classified made the axes depend on the very thing being measured, and it
    # cost more than the constraint gained: constrained accuracy fell BELOW
    # plain nearest-profile, which is the tell that the cost matrix is wrong
    # rather than the assignment.
    cost = np.array([[np.linalg.norm((v - prof[t]) / scale) for t in SLOTS] for v in vecs])

    best, best_cost = None, float('inf')
    seen = set()
    for perm in permutations(range(9)):
        key = tuple(SLOTS[p] for p in perm)
        if key in seen:
            continue
        seen.add(key)
        c = sum(cost[i][perm[i]] for i in range(9))
        if c < best_cost:
            best_cost, best = c, key
    return list(best)


def accuracy():
    """Leave-one-capture-out: learn the look of a type from other photos."""
    shots = [('DEVICE', *DEVICE_RUN), ('BOARD_B', *BOARD_B), ('HARD', *HARD_CASE)]
    shots += [(k, p, c) for k, (p, c) in SHOTS.items()]

    per_capture = {}
    for name, path, corners in shots:
        scores, _pts = evidence(path, corners)
        ring, _ = select_ring(scores)
        im, H = load(path, corners)
        cen = centres_for(ring, _pts)
        entries = []
        for key in ring:
            f = card_features(rectify(im, H, key, centre=cen.get(key)))
            entries.append((key, TRUTH_TYPES.get(key, '?'), f))
        per_capture[name] = entries

    total = right = 0
    unconstrained_right = 0
    for held, entries in per_capture.items():
        others = [(n, k, t, f) for n, e in per_capture.items() if n != held
                  for k, t, f in e if f is not None]
        prof = profile(others)
        usable = [(k, t, f) for k, t, f in entries if f is not None]
        if len(usable) != 9:
            print(f'{held:<10} only {len(usable)} badges measurable — skipped')
            continue
        got = assign([f for _k, _t, f in usable], prof, feature_scale(others))
        hits = sum(1 for (k, t, _f), g in zip(usable, got) if t == g)
        right += hits
        total += 9

        # What the same scores would give with no composition constraint.
        sc = feature_scale(others)
        for _k, t, f in usable:
            v = np.array([f[key] for key in FEATURES])
            nearest = min(prof, key=lambda tt: float(np.linalg.norm((v - prof[tt]) / sc)))
            unconstrained_right += (nearest == t)

        bad = [f'h{k[0]}e{k[1]} {t}->{g}'
               for (k, t, _f), g in zip(usable, got) if t != g]
        flag = 'OK ' if hits == 9 else '   '
        print(f'{flag}{held:<10} {hits}/9' + ('' if hits == 9 else '  ' + ' '.join(bad)))

    print(f'\nWITH the composition constraint : {right}/{total} '
          f'({100*right/max(total,1):.1f}%)')
    print(f'WITHOUT it (nearest profile)    : {unconstrained_right}/{total} '
          f'({100*unconstrained_right/max(total,1):.1f}%)')


def dump():
    """Write every rectified badge to disk, for the TypeScript port to check.

    Same contract as `tools/dump_crops.py` for the digit reader: the port is
    verified against the PHOTOS, not against a unit test that agrees with
    whatever the port happens to do. A features table computed here travels
    alongside, so a mismatch says which feature drifted rather than only that
    the answer changed.
    """
    import json
    import pathlib
    shots = [('DEVICE', *DEVICE_RUN), ('BOARD_B', *BOARD_B), ('HARD', *HARD_CASE)]
    shots += [(k, p, c) for k, (p, c) in SHOTS.items()]
    S = 96
    blob = bytearray()
    meta = []
    for name, path, corners in shots:
        scores, pts = evidence(path, corners)
        ring, _ = select_ring(scores)
        im, H = load(path, corners)
        cen = centres_for(ring, pts)
        for key in ring:
            patch = rectify(im, H, key, size=S, centre=cen.get(key))
            blob += np.ascontiguousarray(patch, dtype=np.uint8).tobytes()
            f = card_features(patch)
            meta.append({
                'capture': name,
                'hex': int(key[0]),
                'edge': int(key[1]),
                'truth': TRUTH_TYPES.get(key, '?'),
                'features': None if f is None else {k: float(f[k]) for k in FEATURES},
            })
    pathlib.Path('tools/harbour_patches.bin').write_bytes(bytes(blob))
    pathlib.Path('tools/harbour_patches.json').write_text(json.dumps({
        'size': S, 'features': list(FEATURES), 'patches': meta,
    }, indent=1))
    print(f'wrote {len(meta)} patches of {S}x{S} '
          f'({len(blob)/1e6:.1f}MB) + features for {sum(1 for m in meta if m["features"])}')


def emit_profiles():
    """Emit the bundled type profiles as TypeScript.

    Trained on ALL captures, unlike `accuracy()`, which holds one out to
    estimate how this generalises. Both are right for their job: the held-out
    number is the honest claim, and the shipped profile should use everything
    known.
    """
    shots = [('DEVICE', *DEVICE_RUN), ('BOARD_B', *BOARD_B), ('HARD', *HARD_CASE)]
    shots += [(k, p, c) for k, (p, c) in SHOTS.items()]
    rows = []
    for name, path, corners in shots:
        scores, pts = evidence(path, corners)
        ring, _ = select_ring(scores)
        im, H = load(path, corners)
        cen = centres_for(ring, pts)
        for key in ring:
            f = card_features(rectify(im, H, key, centre=cen.get(key)))
            if f is not None:
                rows.append((name, key, TRUTH_TYPES.get(key, '?'), f))

    prof = profile(rows)
    scale = feature_scale(rows)
    print(f'// Harvested by `python tools/harbour_probe.py profiles` from '
          f'{len(rows)} badges across {len(shots)} captures.')
    print('export const TYPE_PROFILES: Record<string, number[]> = {')
    for t_ in ['generic', 'brick', 'lumber', 'grain', 'ore', 'wool']:
        if t_ not in prof:
            continue
        vals = ', '.join(f'{v:.6f}' for v in prof[t_])
        print(f'  {t_}: [{vals}],')
    print('};')
    print('export const FEATURE_SCALE: number[] = [' +
          ', '.join(f'{v:.6f}' for v in scale) + '];')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'locate'
    {
        'locate': locate,
        'ring': ring_accuracy,
        'classify': classify,
        'accuracy': accuracy,
        'sheet': sheet,
        'dump': dump,
        'profiles': emit_profiles,
    }[cmd]()
