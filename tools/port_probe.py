"""Where does a harbour badge sit, and can its TYPE be read off colour?

Two answers, one useful and one negative. Both were measured.

FINDING 1 — BADGES CAN BE LOCATED, AND STANDARD_PORT_LAYOUT DOES NOT MATCH
--------------------------------------------------------------------------
A badge is cream, and it floats in blue sea. That is a far cleaner separation
than anything on the island, where a gold wheat field is as bright as a token
face. One clause makes it work: the badge must be ENCLOSED BY SEA. The board
sits on a white cloth that is also bright and unsaturated and outweighs every
badge by area, so without that test the three largest "badges" are tablecloth.
Found 8 of 9 on DEVICE_RUN, all 8 landing on real badges.

Snapping those to coastal edges then produced the finding that matters:

    rotation of STANDARD_PORT_LAYOUT     mean error to observed badges
      0 deg                                1.50 hex radii
     60 deg                                0.23
    120 deg                                1.50
    180 deg                                0.23
    240 deg                                1.50
    300 deg                                0.23

The layout's POSITIONS are right — but as anchored they fit only under a 60,
180 or 300 degree turn, and the three that fit are indistinguishable because
the position set has 3-fold symmetry. Only the TYPES could separate them.

That is not a transcription error. The frame stays assembled while the tiles
are reshuffled, so the ring's rotation relative to the app's hex indexing —
which comes from whichever corner the player taps first — is arbitrary from
game to game. **A static port layout cannot be correct in general.** The
badge offset that fits best is 0.65 hex radii beyond the coastal edge midpoint.

FINDING 2 — TYPE BY COLOUR DOES NOT SEPARATE. Three attempts, all recorded:

    saturated pixels in a window     measured the SEA, which is the most
                                     saturated thing in frame; every badge
                                     came back cyan
    icon = bright non-cream          ore and the lumber log are DARK, fell
                                     under the body threshold and were
                                     discarded as 'not badge' — the two most
                                     distinctive icons scored zero
    icon = non-cream inside the      best of the three and still overlapping:
    cream body's extent              generic reaches 0.431, specific falls to
                                     0.292. Two 3:1s outscore two 2:1s.

The last failure is honest rather than tunable: the boat hull and dock timbers
overlap the badge and read as ink, and they are larger than a resource icon.
Per this repo's own rule, three tuning passes inside one frame is the point to
stop and question the frame — so this stays a negative result rather than a
fourth pass. What ships is DETECTED POSITIONS plus a player-confirmed type.

    PORT_PROBE_OUT=... python tools/port_probe.py locate   # offset candidates
    python -c "import sys;sys.path.insert(0,'tools');import port_probe;\
               port_probe.fit_rotation()"                  # the rotation table
"""
import sys
import numpy as np
from PIL import Image, ImageDraw

from board_shots import SHOTS, DEVICE_RUN, BOARD_B
from fit_probe import CAN, CORNERS, homography, apply_h

import os
#: Where the contact sheets go. Override with PORT_PROBE_OUT.
OUT = os.environ.get('PORT_PROBE_OUT', 'tools/out')
os.makedirs(OUT, exist_ok=True)

#: STANDARD_PORT_LAYOUT, transcribed from services/catanBoard.ts.
PORTS = [
    (18, 3, 'generic'), (17, 4, 'brick'), (12, 4, 'lumber'),
    (7, 5, 'generic'), (3, 0, 'grain'), (1, 0, 'ore'),
    (2, 1, 'generic'), (6, 2, 'wool'), (15, 2, 'generic'),
]

APOTHEM = np.cos(np.radians(30))  # 0.866 hex radii, centre -> edge midpoint


def badge_canonical(hex_index, edge, out):
    """Badge centre in canonical space, `out` hex-radii beyond the edge midpoint."""
    th = np.radians(240 + 60 * edge)
    d = np.array([np.cos(th), np.sin(th)])
    return CAN[hex_index] + d * (APOTHEM + out)


def load(path, corners):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    dst = np.array([[c[0] * w, c[1] * h] for c in corners], float)
    H = homography(CAN[CORNERS], dst)
    return im, H


def locate():
    """Draw the nine badge candidates at several offsets, so one can be picked."""
    path, corners = DEVICE_RUN
    im, H = load(path, corners)
    im = im.copy()
    d = ImageDraw.Draw(im)
    colours = [(255, 0, 0), (255, 160, 0), (0, 255, 0), (0, 200, 255), (255, 0, 255)]
    for ci, out in enumerate([0.3, 0.5, 0.7, 0.9, 1.1]):
        pts = apply_h(H, np.array([badge_canonical(h, e, out) for h, e, _ in PORTS]))
        for (x, y) in pts:
            r = 26
            d.ellipse([x - r, y - r, x + r, y + r], outline=colours[ci], width=6)
    im.thumbnail((1400, 1400))
    im.save(f'{OUT}/port_locate.png')
    print('wrote port_locate.png — offsets 0.3 red, 0.5 orange, 0.7 green, 0.9 cyan, 1.1 magenta')


def crops(out=0.7, size=140):
    """Contact sheet of the nine badges at the chosen offset, for every capture."""
    shots = [('DEVICE', *DEVICE_RUN), ('BOARD_B', *BOARD_B)]
    shots += [(k, p, c) for k, (p, c) in SHOTS.items()]
    sheet = Image.new('RGB', (size * 9, size * len(shots)), 'black')
    for row, (name, path, corners) in enumerate(shots):
        im, H = load(path, corners)
        pts = apply_h(H, np.array([badge_canonical(h, e, out) for h, e, _ in PORTS]))
        # scale: one hex radius in pixels, to size the crop consistently
        o = apply_h(H, np.array([[0, 0], [1, 0]]))
        radius_px = np.hypot(*(o[1] - o[0]))
        half = int(radius_px * 0.42)
        for col, (x, y) in enumerate(pts):
            box = (int(x - half), int(y - half), int(x + half), int(y + half))
            c = im.crop(box).resize((size, size), Image.LANCZOS)
            sheet.paste(c, (col * size, row * size))
        print(f'{name}: radius_px={radius_px:.0f} half={half}')
    sheet.save(f'{OUT}/port_crops.png')
    print(f'wrote port_crops.png  columns = {[t for _,_,t in PORTS]}')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'locate'
    if cmd == 'locate':
        locate()
    else:
        crops(float(sys.argv[2]) if len(sys.argv) > 2 else 0.7)


# ─── Finding the badges directly ──────────────────────────────────────────────
#
# The sea is strongly blue and the badge is printed cream. That is a far cleaner
# separation than anything on the island, where a gold wheat field is as bright
# as a token face. So rather than trusting a predicted offset, find the cream
# blobs in the sea and measure where they actually are.

def rgb_to_hsv_arr(a):
    a = a.astype(np.float64) / 255.0
    mx = a.max(2); mn = a.min(2); d = mx - mn
    v = mx
    s = np.where(mx > 0, d / np.maximum(mx, 1e-9), 0)
    return s, v


def label_blobs(mask):
    """Tiny 4-connected labeller — no scipy dependency."""
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


def find_badges(name, path, corners, dump=False):
    im, H = load(path, corners)
    W, Hh = im.size
    scale = 900 / max(W, Hh)
    small = im.resize((int(W*scale), int(Hh*scale)), Image.BILINEAR)
    a = np.asarray(small)
    s, v = rgb_to_hsv_arr(a)

    # Island mask: everything inside the 19 hexes is off limits.
    o = apply_h(H, np.array([[0,0],[1,0]]))
    radius_px = np.hypot(*(o[1]-o[0])) * scale
    centres = apply_h(H, CAN) * scale
    yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
    island = np.zeros(a.shape[:2], bool)
    for cx, cy in centres:
        island |= ((xx-cx)**2 + (yy-cy)**2) < (radius_px*1.05)**2

    # Sea ring: outside the island but within reach of it.
    bx, by = centres.mean(0)
    far = np.hypot(xx-bx, yy-by)
    ring = (~island) & (far < radius_px*5.2)

    cream = ring & (s < 0.28) & (v > 0.55)
    blobs = [b for b in label_blobs(cream) if len(b) >= (radius_px*0.10)**2]
    blobs.sort(key=len, reverse=True)
    cents = []
    for b in blobs[:14]:
        ys = np.array([p[0] for p in b]); xs = np.array([p[1] for p in b])
        cents.append((xs.mean()/scale, ys.mean()/scale, len(b)))
    print(f'{name}: radius_px={radius_px/scale:.0f} cream blobs kept={len(cents)}')
    if dump:
        d = ImageDraw.Draw(small)
        for cx, cy, n in cents:
            x, y = cx*scale, cy*scale
            d.ellipse([x-14,y-14,x+14,y+14], outline=(255,0,0), width=3)
        small.save(f'{OUT}/port_found_{name}.png')
    return cents, H, radius_px/scale


def find():
    for name, path, corners in [('DEVICE', *DEVICE_RUN), ('BOARD_B', *BOARD_B)]:
        cents, H, rpx = find_badges(name, path, corners, dump=True)
        # Report each blob in canonical space, via the INVERSE homography.
        Hi = np.linalg.inv(H)
        pts = np.array([[c[0], c[1]] for c in cents])
        can = apply_h(Hi, pts)
        for (cx, cy), (qx, qy), c in zip(pts, can, cents):
            print(f'   px=({cx:7.0f},{cy:7.0f}) canonical=({qx:6.2f},{qy:6.2f}) '
                  f'r={np.hypot(qx,qy):5.2f} area={c[2]}')


def sweep():
    """For each of the nine known port edges, where does cream peak going out?

    A 1-D calibration with a strong signal. It also CHECKS the layout: a port
    whose response never peaks is one whose (hex, edge) is wrong.
    """
    shots = [('DEVICE', *DEVICE_RUN), ('BOARD_B', *BOARD_B)]
    shots += [(k, p, c) for k, (p, c) in SHOTS.items()]
    offs = np.arange(0.15, 1.45, 0.05)
    agg = np.zeros((len(PORTS), len(offs)))
    for name, path, corners in shots:
        im, H = load(path, corners)
        a = np.asarray(im)
        s, v = rgb_to_hsv_arr(a)
        cream = (s < 0.30) & (v > 0.50)
        o = apply_h(H, np.array([[0, 0], [1, 0]]))
        rpx = np.hypot(*(o[1] - o[0]))
        for pi, (hx, ed, _t) in enumerate(PORTS):
            for oi, out in enumerate(offs):
                p = apply_h(H, badge_canonical(hx, ed, out)[None])[0]
                r = int(rpx * 0.16)
                x0, y0 = int(p[0] - r), int(p[1] - r)
                x1, y1 = int(p[0] + r), int(p[1] + r)
                if x0 < 0 or y0 < 0 or x1 >= a.shape[1] or y1 >= a.shape[0]:
                    continue
                agg[pi, oi] += cream[y0:y1, x0:x1].mean()
    agg /= len(shots)
    print('offset:      ' + ' '.join(f'{o:4.2f}' for o in offs))
    for pi, (hx, ed, t) in enumerate(PORTS):
        best = offs[int(agg[pi].argmax())]
        bar = ' '.join(f'{x:4.2f}' for x in agg[pi])
        print(f'h{hx:>2} e{ed} {t:<8} {bar}   peak@{best:.2f}')
    print()
    print('mean over ports: ' + ' '.join(f'{x:4.2f}' for x in agg.mean(0)))
    print('BEST GLOBAL OFFSET =', offs[int(agg.mean(0).argmax())])


def is_sea(a):
    """Blue sea: the most saturated thing on the board and unmistakably cyan."""
    r = a[:, :, 0].astype(float); g = a[:, :, 1].astype(float); b = a[:, :, 2].astype(float)
    return (b > r + 25) & (b > 60) & (g > r)


def badges(name, path, corners, dump=True):
    """Cream blobs ENCLOSED BY SEA. That last clause is the whole trick — the
    board sits on a white cloth which is also bright and unsaturated, and it
    outweighs every badge by area."""
    im, H = load(path, corners)
    W, Hh = im.size
    sc = 900 / max(W, Hh)
    small = im.resize((int(W*sc), int(Hh*sc)), Image.BILINEAR)
    a = np.asarray(small)
    s, v = rgb_to_hsv_arr(a)
    sea = is_sea(a)

    o = apply_h(H, np.array([[0, 0], [1, 0]]))
    rpx = np.hypot(*(o[1]-o[0])) * sc
    centres = apply_h(H, CAN) * sc
    yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
    island = np.zeros(a.shape[:2], bool)
    for cx, cy in centres:
        island |= ((xx-cx)**2 + (yy-cy)**2) < (rpx*1.02)**2

    cream = (~island) & (s < 0.32) & (v > 0.45)
    kept = []
    for blob in label_blobs(cream):
        if len(blob) < (rpx*0.12)**2 or len(blob) > (rpx*0.75)**2:
            continue
        ys = np.array([p[0] for p in blob]); xs = np.array([p[1] for p in blob])
        cy, cx = ys.mean(), xs.mean()
        rad = max(4, int(np.sqrt(len(blob)/np.pi)))
        # annulus just outside the blob
        ring = (np.hypot(xx-cx, yy-cy) > rad*1.4) & (np.hypot(xx-cx, yy-cy) < rad*2.4)
        if ring.sum() == 0:
            continue
        frac = sea[ring].mean()
        if frac > 0.55:
            kept.append((cx/sc, cy/sc, len(blob), frac))
    kept.sort(key=lambda k: -k[2])
    Hi = np.linalg.inv(H)
    print(f'{name}: found {len(kept)} sea-enclosed cream blobs (want 9)')
    rows = []
    if kept:
        can = apply_h(Hi, np.array([[k[0], k[1]] for k in kept]))
        for (qx, qy), k in zip(can, kept):
            rows.append((qx, qy, np.hypot(qx, qy)))
            print(f'   canonical=({qx:6.2f},{qy:6.2f}) r={np.hypot(qx,qy):5.2f} '
                  f'area={k[2]:5d} seafrac={k[3]:.2f}')
    if dump:
        d = ImageDraw.Draw(small)
        for k in kept:
            x, y = k[0]*sc, k[1]*sc
            d.ellipse([x-15, y-15, x+15, y+15], outline=(255, 0, 0), width=4)
        small.save(f'{OUT}/port_badges_{name}.png')
    return rows


def findall():
    for name, path, corners in [('DEVICE', *DEVICE_RUN), ('BOARD_B', *BOARD_B)]:
        badges(name, path, corners)


NEIGHBOUR = [(0,-1),(1,-1),(1,0),(0,1),(-1,1),(-1,0)]  # NW NE E SE SW W


def coastal_edges():
    idx = {tuple(a): i for i, a in enumerate(AX_LIST)}
    out = []
    for i, (q, r) in enumerate(AX_LIST):
        for e, (dq, dr) in enumerate(NEIGHBOUR):
            if (q+dq, r+dr) not in idx:
                out.append((i, e))
    return out


AX_LIST = [(0,-2),(1,-2),(2,-2),(-1,-1),(0,-1),(1,-1),(2,-1),(-2,0),(-1,0),(0,0),
           (1,0),(2,0),(-2,1),(-1,1),(0,1),(1,1),(-2,2),(-1,2),(0,2)]


def match_layout():
    """Which coastal edge does each OBSERVED badge belong to?

    For every coastal (hex, edge), the badge would lie along a ray from the hex
    centre through the edge midpoint. Score each observed badge against every
    ray by perpendicular distance, then read off the best.
    """
    obs = {}
    for name, path, corners in [('DEVICE', *DEVICE_RUN), ('BOARD_B', *BOARD_B)]:
        obs[name] = badges(name, path, corners, dump=False)

    # Merge: cluster observations from both captures that agree within 0.45
    pool = [p for rows in obs.values() for p in rows]
    clusters = []
    for qx, qy, _r in pool:
        for c in clusters:
            if np.hypot(c[0][0]-qx, c[0][1]-qy) < 0.45:
                c.append((qx, qy)); break
        else:
            clusters.append([(qx, qy)])
    cents = [(np.mean([p[0] for p in c]), np.mean([p[1] for p in c]), len(c))
             for c in clusters]
    cents.sort(key=lambda c: -c[2])
    cents = [c for c in cents if c[2] >= 2][:9]

    ce = coastal_edges()
    print(f'\n{len(cents)} merged badge positions (seen in both captures):\n')
    layout = {(h, e): t for h, e, t in PORTS}
    for cx, cy, n in cents:
        best = []
        for (h, e) in ce:
            th = np.radians(240 + 60*e)
            d = np.array([np.cos(th), np.sin(th)])
            v = np.array([cx, cy]) - CAN[h]
            along = v @ d
            perp = abs(v[0]*d[1] - v[1]*d[0])
            if along <= 0:
                continue
            best.append((perp, along, h, e))
        best.sort()
        perp, along, h, e = best[0]
        mark = 'IN LAYOUT' if (h, e) in layout else '  --     '
        print(f'badge ({cx:6.2f},{cy:6.2f}) n={n} -> hex{h:>2} edge{e} '
              f'(NW NE E SE SW W)[{e}]  perp={perp:.2f} out={along-0.866:.2f}  {mark}'
              + (f'  layout says {layout[(h,e)]}' if (h, e) in layout else ''))

    print('\nSTANDARD_PORT_LAYOUT edges NOT matched by any observed badge:')
    matched = set()
    for cx, cy, n in cents:
        best = []
        for (h, e) in ce:
            th = np.radians(240 + 60*e)
            d = np.array([np.cos(th), np.sin(th)])
            v = np.array([cx, cy]) - CAN[h]
            if v @ d <= 0: continue
            best.append((abs(v[0]*d[1]-v[1]*d[0]), h, e))
        best.sort(); matched.add((best[0][1], best[0][2]))
    for h, e, t in PORTS:
        if (h, e) not in matched:
            print(f'   hex{h:>2} edge{e}  {t}')


def rot(p, k):
    """Rotate a canonical point by k*60 degrees about the board centre."""
    th = np.radians(60 * k)
    c, s = np.cos(th), np.sin(th)
    return np.array([p[0]*c - p[1]*s, p[0]*s + p[1]*c])


def fit_rotation():
    """Is STANDARD_PORT_LAYOUT right, and merely turned relative to the photo?

    The frame stays assembled while the tiles are reshuffled, so the ring's
    rotation relative to the player's corner taps is arbitrary game to game.
    If that is what is going on, one of the six rotations will fit sharply and
    the other five will not.
    """
    obs = []
    for name, path, corners in [('DEVICE', *DEVICE_RUN), ('BOARD_B', *BOARD_B)]:
        obs += [(x, y) for x, y, _ in badges(name, path, corners, dump=False)]
    clusters = []
    for qx, qy in obs:
        for c in clusters:
            if np.hypot(c[0][0]-qx, c[0][1]-qy) < 0.45:
                c.append((qx, qy)); break
        else:
            clusters.append([(qx, qy)])
    O = np.array([[np.mean([p[0] for p in c]), np.mean([p[1] for p in c])]
                  for c in clusters if len(c) >= 2])
    print(f'\n{len(O)} badge positions confirmed in BOTH captures\n')

    for out in [0.55, 0.65, 0.75, 0.85]:
        P = np.array([badge_canonical(h, e, out) for h, e, _ in PORTS])
        line = []
        for k in range(6):
            R = np.array([rot(p, k) for p in P])
            d = np.sqrt(((O[:, None, :] - R[None, :, :])**2).sum(2)).min(1)
            line.append(d.mean())
        best = int(np.argmin(line))
        print(f'  out={out:.2f}  ' + '  '.join(
            f'{k*60:>3}d:{v:5.2f}' for k, v in enumerate(line))
            + f'   BEST {best*60}d')


#: Ground truth for DEVICE_RUN, read off the contact sheet by eye. Positions are
#: full-resolution pixel centres of each badge; types are what the badge says.
#: Composition checks out exactly — four generic and one of each resource —
#: which is a free validation that nothing was misread.
DEVICE_TRUTH = [
    ((928, 942),  'generic'),
    ((1709, 911), 'brick'),
    ((2417, 1285),'lumber'),
    ((514, 1621), 'generic'),
    ((2860, 1989),'generic'),
    ((495, 2431), 'wool'),
    ((2474, 2758),'grain'),
    ((881, 3206), 'generic'),
    ((1758, 3182),'ore'),
]


def classify_probe():
    """Can a badge's TYPE be read off colour?

    3:1 badges are cream and text only. 2:1 badges carry a big saturated
    resource icon. So 'is there a saturated blob' separates generic from
    specific, and the blob's hue names the resource. Both are ranking questions
    against a known composition, which is the shape this codebase already
    solves well.
    """
    path, corners = DEVICE_RUN
    im, H = load(path, corners)
    a = np.asarray(im).astype(float)
    o = apply_h(H, np.array([[0, 0], [1, 0]]))
    rpx = np.hypot(*(o[1]-o[0]))
    half = int(rpx * 0.20)
    print(f'radius_px={rpx:.0f} sample half-width={half}\n')
    print(f'{"truth":<9} {"satfrac":>7} {"meanhue":>8} {"R":>4} {"G":>4} {"B":>4}')
    rows = []
    for (px, py), truth in DEVICE_TRUTH:
        c = a[py-half:py+half, px-half:px+half]
        mx = c.max(2); mn = c.min(2)
        sat = np.where(mx > 0, (mx-mn)/np.maximum(mx, 1e-9), 0)
        # the icon is the saturated part; the badge body is cream
        ink = sat > 0.35
        frac = ink.mean()
        if ink.sum() > 20:
            mean = c[ink].mean(0)
        else:
            mean = c.reshape(-1, 3).mean(0)
        r, g, b = mean
        hue = np.degrees(np.arctan2(np.sqrt(3)*(g-b), 2*r-g-b)) % 360
        rows.append((truth, frac, hue, r, g, b))
        print(f'{truth:<9} {frac:7.3f} {hue:8.1f} {r:4.0f} {g:4.0f} {b:4.0f}')
    print('\ngeneric satfrac:', sorted(f'{f:.3f}' for t, f, *_ in rows if t == 'generic'))
    print('specific satfrac:', sorted(f'{f:.3f}' for t, f, *_ in rows if t != 'generic'))


def classify2():
    """Isolate the badge, THEN look inside it.

    The first attempt measured the sea: it is the most saturated thing in the
    window, so 'saturated pixels' selected ocean and every badge came back
    cyan. The icon has to be found INSIDE the cream body, not in the window.
    """
    path, corners = DEVICE_RUN
    im, H = load(path, corners)
    a = np.asarray(im).astype(float)
    o = apply_h(H, np.array([[0, 0], [1, 0]]))
    rpx = np.hypot(*(o[1]-o[0]))
    half = int(rpx * 0.26)
    sheet = Image.new('RGB', (160*9, 160*2), 'black')
    print(f'{"truth":<9} {"body%":>6} {"icon%":>6} {"hue":>6}  {"R":>4}{"G":>4}{"B":>4}')
    rows = []
    for i, ((px, py), truth) in enumerate(DEVICE_TRUTH):
        c = a[py-half:py+half, px-half:px+half]
        mx = c.max(2); mn = c.min(2)
        sat = np.where(mx > 0, (mx-mn)/np.maximum(mx, 1e-9), 0)
        val = mx / 255.0
        r, g, b = c[:, :, 0], c[:, :, 1], c[:, :, 2]
        sea = (b > r + 25) & (b > 60) & (g > r)
        body = (~sea) & (val > 0.42)          # badge body + its icon + the dock
        # icon: inside the body, but coloured rather than cream
        cream = body & (sat < 0.30)
        icon = body & (sat >= 0.30)
        bodyfrac = body.mean(); iconfrac = icon.sum() / max(body.sum(), 1)
        if icon.sum() > 30:
            mean = c[icon].mean(0)
        else:
            mean = np.array([0, 0, 0.0])
        rr, gg, bb = mean
        hue = np.degrees(np.arctan2(np.sqrt(3)*(gg-bb), 2*rr-gg-bb)) % 360
        rows.append((truth, bodyfrac, iconfrac, hue, rr, gg, bb))
        print(f'{truth:<9} {bodyfrac:6.2f} {iconfrac:6.2f} {hue:6.1f}  {rr:4.0f}{gg:4.0f}{bb:4.0f}')
        crop = Image.fromarray(c.astype(np.uint8)).resize((160, 160), Image.LANCZOS)
        sheet.paste(crop, (i*160, 0))
        vis = np.zeros_like(c); vis[cream] = [200,200,200]; vis[icon] = c[icon]
        sheet.paste(Image.fromarray(vis.astype(np.uint8)).resize((160,160), Image.NEAREST), (i*160,160))
    sheet.save(f'{OUT}/port_classify.png')
    print('\nwrote port_classify.png  (row 1 crop, row 2 cream=grey / icon=colour)')
    print('generic iconfrac:', sorted(round(r[2],3) for r in rows if r[0]=='generic'))
    print('specific iconfrac:', sorted(round(r[2],3) for r in rows if r[0]!='generic'))


def classify3():
    """Take the badge's EXTENT from its cream body, then look inside it.

    Attempt 2 excluded the icon by brightness — ore and the lumber log are dark,
    fell under the body threshold, and were discarded as 'not badge', so the two
    most distinctive icons scored zero. The body defines WHERE the badge is; what
    is inside it is then icon whether it is bright or not.
    """
    path, corners = DEVICE_RUN
    im, H = load(path, corners)
    a = np.asarray(im).astype(float)
    o = apply_h(H, np.array([[0, 0], [1, 0]]))
    rpx = np.hypot(*(o[1]-o[0])); half = int(rpx*0.26)
    sheet = Image.new('RGB', (160*9, 160*2), 'black')
    print(f'{"truth":<9} {"inkfrac":>8} {"hue":>6}  {"R":>4}{"G":>4}{"B":>4}')
    rows = []
    for i, ((px, py), truth) in enumerate(DEVICE_TRUTH):
        c = a[py-half:py+half, px-half:px+half]
        mx = c.max(2); mn = c.min(2)
        sat = np.where(mx > 0, (mx-mn)/np.maximum(mx, 1e-9), 0)
        val = mx/255.0
        r, g, b = c[:,:,0], c[:,:,1], c[:,:,2]
        sea = (b > r+25) & (b > 60) & (g > r)
        cream = (~sea) & (val > 0.50) & (sat < 0.30)
        comps = label_blobs(cream)
        if not comps:
            rows.append((truth, 0.0, 0.0)); continue
        big = max(comps, key=len)
        ys = np.array([p[0] for p in big]); xs = np.array([p[1] for p in big])
        y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
        region = np.zeros(cream.shape, bool); region[y0:y1+1, x0:x1+1] = True
        region &= ~sea                       # the bbox corners hang over the sea
        ink = region & ~cream                # icon OR text, bright or dark
        inkfrac = ink.sum()/max(region.sum(), 1)
        mean = c[ink].mean(0) if ink.sum() > 30 else np.zeros(3)
        rr, gg, bb = mean
        hue = np.degrees(np.arctan2(np.sqrt(3)*(gg-bb), 2*rr-gg-bb)) % 360
        rows.append((truth, inkfrac, hue))
        print(f'{truth:<9} {inkfrac:8.3f} {hue:6.1f}  {rr:4.0f}{gg:4.0f}{bb:4.0f}')
        sheet.paste(Image.fromarray(c.astype(np.uint8)).resize((160,160), Image.LANCZOS), (i*160,0))
        vis = np.zeros_like(c); vis[region & cream] = [190,190,190]; vis[ink] = c[ink]
        sheet.paste(Image.fromarray(vis.astype(np.uint8)).resize((160,160), Image.NEAREST), (i*160,160))
    sheet.save(f'{OUT}/port_classify3.png')
    gen = sorted(round(r[1],3) for r in rows if r[0]=='generic')
    spec = sorted(round(r[1],3) for r in rows if r[0]!='generic')
    print(f'\ngeneric  inkfrac {gen}')
    print(f'specific inkfrac {spec}')
    print(f'SEPARATION: max(generic)={max(gen):.3f}  min(specific)={min(spec):.3f} '
          f'-> {"CLEAN" if max(gen) < min(spec) else "OVERLAP"}')
