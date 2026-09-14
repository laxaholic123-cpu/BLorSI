"""Does harbour reading survive golden light? Measured, not assumed.

Reported from a device: under golden light hitting the board, harbour
POSITIONS came back wrong, TYPES came back wrong, and the screen still acted
as though all nine were right.

This replays the ten reference captures through the real probe pipeline with a
warm colour cast applied, and compares two position selectors and two
white-balance options:

  SELECTORS
    ring280   any legal ring on the coast (what shipped)
    frame     only the positions the frame's painted spots allow. The player
              confirmed the spots are painted on the ring and never move; the
              TypeScript measurement found the six rotations collapse to just
              TWO position sets sharing no position at all. Choosing between
              two disjoint sets should need very little evidence.

  WHITE BALANCE
    off       masks run on the raw pixels
    faces     each pixel is corrected by the nearby NUMBER TOKEN FACES. Every
              token is the same printed cream and each sits under the light of
              its own tile, so they are a white reference spread across the
              board -- which is what a partial wash of sunlight needs.

  CASTS
    none, warm, strong (whole board), half (strong on one side, fading out --
    the realistic sunbeam or lamp case, and the one a global correction cannot
    fix).

    python tools/light_probe.py
"""
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, 'tools')
import harbour_probe as hp  # noqa: E402

#: STANDARD_PORT_LAYOUT from services/catanBoard.ts, as (hex, edge).
STANDARD = [(18, 3), (17, 4), (12, 4), (7, 5), (3, 0), (1, 0), (2, 1), (6, 2), (15, 2)]

DESERT = 9  # the reference board; the app finds the desert by token presence

CASTS = {
    'none': None,
    'warm': {'gains': (1.12, 1.00, 0.78)},
    'strong': {'gains': (1.25, 1.02, 0.60)},
    'half': {'gains': (1.25, 1.02, 0.60), 'half': True},
}

MODE = {'cast': None, 'wb': 'off'}


# ── Frame geometry ───────────────────────────────────────────────────────────

_AXIDX = {tuple(a): i for i, a in enumerate(hp.AX)}


def rotate(hex_index, edge, steps):
    """Rotate a (hex, edge) by 60-degree steps. (q,r)->(-r,q+r) maps NW->NE."""
    q, r = hp.AX[hex_index]
    for _ in range(steps):
        q, r = -r, q + r
    return _AXIDX[(q, r)], (edge + steps) % 6


def frame_sets():
    sets = []
    for k in range(6):
        s = frozenset(rotate(h, e, k) for h, e in STANDARD)
        if s not in sets:
            sets.append(s)
    return sets


FRAMES = frame_sets()


def select_frame(scores):
    totals = sorted(
        ((sum(scores.get(key, 0.0) for key in f), i) for i, f in enumerate(FRAMES)),
        reverse=True,
    )
    best_total, best = totals[0]
    runner = totals[1][0] if len(totals) > 1 else 0.0
    return FRAMES[best], best_total, best_total - runner


# ── Light ────────────────────────────────────────────────────────────────────

def apply_cast(a, cast):
    gains = np.array(cast['gains'], dtype=np.float32)
    if cast.get('half'):
        w = a.shape[1]
        ramp = np.clip((w * 0.6 - np.arange(w, dtype=np.float32)) / (w * 0.25), 0, 1)
        g = 1 + (gains[None, :] - 1) * ramp[:, None]
        a = a * g[None, :, :]
    else:
        a = a * gains
    return np.clip(a, 0, 255)


def face_gains(a, H):
    """Per-token white gains: what makes each token face neutral grey."""
    g = np.linspace(-0.30, 0.30, 11)
    uu, vv = np.meshgrid(g, g)
    disc = (uu ** 2 + vv ** 2) <= 0.30 ** 2
    offs = np.stack([uu[disc], vv[disc]], 1)
    out = []
    for i, c in enumerate(hp.CAN):
        if i == DESERT:
            continue
        pts = hp.apply_h(H, c[None, :] + offs)
        xs = np.clip(pts[:, 0].round().astype(int), 0, a.shape[1] - 1)
        ys = np.clip(pts[:, 1].round().astype(int), 0, a.shape[0] - 1)
        px = a[ys, xs]
        lum = px.mean(1)
        top = px[lum >= np.percentile(lum, 75)]  # the face, not the ink
        ref = np.maximum(top.mean(0), 1.0)
        centre = hp.apply_h(H, c[None, :])[0]
        out.append((centre[0], centre[1], ref.mean() / ref))
    return out


def white_balance(a, H):
    """Inverse-distance blend of the token gains, so a partial wash is local."""
    refs = face_gains(a, H)
    h, w = a.shape[:2]
    gh, gw = 48, 64
    ys = (np.arange(gh) + 0.5) * h / gh
    xs = (np.arange(gw) + 0.5) * w / gw
    X, Y = np.meshgrid(xs, ys)
    num = np.zeros((gh, gw, 3), np.float64)
    den = np.zeros((gh, gw, 1), np.float64)
    for cx, cy, gain in refs:
        d2 = (X - cx) ** 2 + (Y - cy) ** 2 + (0.05 * w) ** 2
        wgt = (1.0 / d2)[..., None]
        num += wgt * gain[None, None, :]
        den += wgt
    field = (num / den).astype(np.float32)
    full = np.stack([
        np.asarray(Image.fromarray(field[..., c]).resize((w, h), Image.BILINEAR))
        for c in range(3)
    ], -1)
    return np.clip(a * full, 0, 255)


_orig_load = hp.load


def patched_load(path, corners):
    im, H = _orig_load(path, corners)
    if MODE['cast'] is None and MODE['wb'] == 'off':
        return im, H
    a = np.asarray(im).astype(np.float32)
    if MODE['cast'] is not None:
        a = apply_cast(a, MODE['cast'])
    if MODE['wb'] == 'faces':
        a = white_balance(a, H)
    return Image.fromarray(a.astype(np.uint8)), H


hp.load = patched_load


# ── Measurement ──────────────────────────────────────────────────────────────

def shots():
    s = [('DEVICE', *hp.DEVICE_RUN), ('BOARD_B', *hp.BOARD_B), ('HARD', *hp.HARD_CASE)]
    return s + [(k, p, c) for k, (p, c) in hp.SHOTS.items()]


def truth_features(path, corners, pts):
    im, H = hp.load(path, corners)
    cen = hp.centres_for(hp.TRUTH_EDGES, pts)
    return [
        (key, hp.TRUTH_TYPES[key], hp.card_features(hp.rectify(im, H, key, centre=cen.get(key))))
        for key in hp.TRUTH_EDGES
    ]


def main():
    truth = frozenset(hp.TRUTH_EDGES)
    print(f'frame position sets: {len(FRAMES)}; '
          f'reference board is one of them: {truth in FRAMES}; '
          f'shared positions between sets: {len(FRAMES[0] & FRAMES[1]) if len(FRAMES) > 1 else "-"}')
    if truth not in FRAMES:
        print('STOP: the reference board is not a rotation of STANDARD_PORT_LAYOUT.')
        return

    # Training bank for types: uncast, no white balance, truth positions.
    MODE['cast'], MODE['wb'] = None, 'off'
    bank = {}
    for name, path, corners in shots():
        _s, pts = hp.evidence(path, corners)
        bank[name] = truth_features(path, corners, pts)

    print(f'\n{"cast":<7} {"wb":<6} {"badges":>7} {"ring280":>8} {"frame":>6} '
          f'{"min margin":>10} {"types":>7}')
    for cast_name, cast in CASTS.items():
        for wb in ('off', 'faces'):
            MODE['cast'], MODE['wb'] = cast, wb
            badges = ring_hits = frame_ok = type_hits = type_total = 0
            margins = []
            for name, path, corners in shots():
                scores, pts = hp.evidence(path, corners)
                badges += len(pts)
                ring, _ = hp.select_ring(scores)
                ring_hits += len(truth & set(ring))
                fset, _tot, margin = select_frame(scores)
                frame_ok += int(fset == truth)
                margins.append(margin)

                others = [(n, k, t, f) for n, e in bank.items() if n != name
                          for k, t, f in e if f is not None]
                prof = hp.profile(others)
                scale = hp.feature_scale(others)
                test = truth_features(path, corners, pts)
                usable = [(k, t, f) for k, t, f in test if f is not None]
                type_total += 9
                if len(usable) == 9:
                    got = hp.assign([f for _k, _t, f in usable], prof, scale)
                    type_hits += sum(1 for (_k, t, _f), g in zip(usable, got) if t == g)
            n = len(shots())
            print(f'{cast_name:<7} {wb:<6} {badges / n:>7.1f} {ring_hits:>4}/{9 * n:<3} '
                  f'{frame_ok:>3}/{n:<2} {min(margins):>10.2f} {type_hits:>3}/{type_total}')


TYPES = ['generic', 'brick', 'lumber', 'grain', 'ore', 'wool']
RESOURCES = ['brick', 'lumber', 'grain', 'ore', 'wool']


def assign_tolerant(cost):
    """Composition-constrained labelling that tolerates a badge with no features.

    The first run of this probe reused hp.assign, which needs all nine feature
    vectors -- so one declined card zeroed a whole capture, and the types column
    reported declines as misreads. A declined badge costs the same for every
    type here, which is what the app's assignTypes does.
    """
    from itertools import combinations, permutations
    best, best_cost = None, float('inf')
    for gen in combinations(range(9), 4):
        base = sum(cost[i]['generic'] for i in gen)
        rest = [i for i in range(9) if i not in gen]
        for perm in permutations(RESOURCES):
            c = base + sum(cost[rest[k]][perm[k]] for k in range(5))
            if c < best_cost:
                best_cost, best = c, (rest, perm)
    labels = ['generic'] * 9
    rest, perm = best
    for k, i in enumerate(rest):
        labels[i] = perm[k]
    return labels


def types_mode():
    """Per-badge type accuracy under each cast, trained and tested the SAME way.

    Profiles are rebuilt under the white-balance mode being tested, from the
    other captures, so a balanced test image is never compared with profiles
    learned from unbalanced ones -- the mismatch that made the first run report
    0/90 with balancing switched on.
    """
    centres = {}
    MODE['cast'], MODE['wb'] = None, 'off'
    for name, path, corners in shots():
        _s, pts = hp.evidence(path, corners)
        centres[name] = hp.centres_for(hp.TRUTH_EDGES, pts)

    def feats(path, corners, name):
        im, H = hp.load(path, corners)
        return [(key, hp.TRUTH_TYPES[key],
                 hp.card_features(hp.rectify(im, H, key, centre=centres[name].get(key))))
                for key in hp.TRUTH_EDGES]

    print('cast    wb      types   declined')
    for wb in ('off', 'faces'):
        MODE['cast'], MODE['wb'] = None, wb
        bank = {name: feats(path, corners, name) for name, path, corners in shots()}
        for cast_name, cast in CASTS.items():
            MODE['cast'] = cast
            hits = declined = 0
            for name, path, corners in shots():
                others = [(n, k, t, f) for n, e in bank.items() if n != name
                          for k, t, f in e if f is not None]
                prof = hp.profile(others)
                scale = hp.feature_scale(others)
                test = bank[name] if cast is None else feats(path, corners, name)
                cost = []
                for _k, _t, f in test:
                    if f is None:
                        declined += 1
                        cost.append({tt: 0.0 for tt in TYPES})
                        continue
                    v = np.array([f[kk] for kk in hp.FEATURES])
                    cost.append({tt: float(np.linalg.norm((v - prof[tt]) / scale)) for tt in TYPES})
                labels = assign_tolerant(cost)
                hits += sum(1 for (_k, t, _f), g in zip(test, labels) if t == g)
            print(f'{cast_name:<7} {wb:<6} {hits:>3}/90   {declined:>3}')


if __name__ == '__main__':
    if 'types' in sys.argv:
        types_mode()
    else:
        main()
