"""Do templates harvested from one board photo read a different one?

That is the whole question. Matching a photo against templates taken from the
SAME photo proves nothing — it is a lookup. The approach is only worth building
if examples from one capture read tokens in another, under different light, at
different angles, with the tokens lying however they happened to land.

Mirrors services/vision/tokenTemplates.ts and readFrame.sampleTokenFace step
for step, so a result here is a result there.

    python tools/template_probe.py --learn <photo> <4 corners> --test <photo> <4 corners>
"""
import argparse
import sys

sys.path.insert(0, 'tools')
import numpy as np
from PIL import Image

from fit_probe import CAN, CORNERS, homography, apply_h
from token_probe import otsu, components

TOKEN_RADIUS = 0.42
RINGS = 10
SECTORS = 48
SIZE = RINGS * SECTORS

TRUTH = [4, 11, 6, 5, 10, 11, 12, 4, 5, None, 8, 10, 2, 9, 3, 3, 6, 8, 9]


def locate_face(crop, size):
    """Same disc finder as binaryOps.locateBrightDisc."""
    cut = otsu(crop.ravel())
    comps = components(crop > cut, True)
    if not comps:
        return None
    big = max(comps, key=lambda k: k['size'])
    w = big['maxx'] - big['minx'] + 1
    h = big['maxy'] - big['miny'] + 1
    if min(w, h) / max(w, h) < 0.72:
        return None
    if big['minx'] <= 0 or big['miny'] <= 0 or big['maxx'] >= size - 1 or big['maxy'] >= size - 1:
        return None
    r = max(w, h) / 2.0
    if not (0.30 * size / 2 <= r <= 0.98 * size / 2):
        return None
    return (big['minx'] + big['maxx']) / 2.0, (big['miny'] + big['maxy']) / 2.0, r


def sample_face(crop, size):
    """Polar sample of one token face — mirrors readFrame.sampleTokenFace."""
    found = locate_face(crop, size)
    if found is None:
        cx = cy = (size - 1) / 2.0
        r = (size / 2) * 0.65
    else:
        cx, cy, r = found
    r *= 0.90

    yy, xx = np.mgrid[0:size, 0:size]
    inside = (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
    if inside.sum() < 40:
        return None
    cut = otsu(crop[inside])

    bits = np.zeros(SIZE, dtype=bool)
    for ring in range(RINGS):
        rr = r * ((ring + 0.5) / RINGS) * 0.92
        for sector in range(SECTORS):
            theta = 2 * np.pi * sector / SECTORS
            x = int(round(cx + rr * np.cos(theta)))
            y = int(round(cy + rr * np.sin(theta)))
            v = crop[y, x] if (0 <= x < size and 0 <= y < size) else 255
            bits[ring * SECTORS + sector] = v <= cut
    return bits


def rotate(bits, shift):
    out = bits.reshape(RINGS, SECTORS)
    return np.roll(out, -shift, axis=1).reshape(-1)


METRIC = 'agree'


def similarity(a, b):
    if METRIC == 'agree':
        # Plain agreement. Dominated by the blank face: two unrelated tokens
        # agree on most cells simply by both being mostly empty.
        return float((a == b).mean())
    if METRIC == 'jaccard':
        # Ink only: how much of the ink the two share, ignoring shared blank.
        inter = float((a & b).sum())
        union = float((a | b).sum())
        return inter / union if union else 0.0
    if METRIC == 'dice':
        inter = float((a & b).sum())
        total = float(a.sum() + b.sum())
        return 2 * inter / total if total else 0.0
    raise ValueError(METRIC)


def faces(photo, corners):
    im = Image.open(photo).convert('RGB')
    a = np.asarray(im).astype(np.float32)
    H_, W_ = a.shape[:2]
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]

    Hm = homography(CAN[CORNERS], np.array([(x * W_, y * H_) for x, y in corners], float))
    A = apply_h(Hm, np.array([CAN[7]]))[0]
    B = apply_h(Hm, np.array([CAN[11]]))[0]
    scale = np.hypot(*(B - A)) / (CAN[11][0] - CAN[7][0])
    radius = TOKEN_RADIUS * scale
    size = int(round(radius * 2))

    out = {}
    for i in range(19):
        if TRUTH[i] is None:
            continue
        ce = apply_h(Hm, np.array([CAN[i]]))[0]
        l, t = int(round(ce[0] - radius)), int(round(ce[1] - radius))
        if l < 0 or t < 0 or l + size > W_ or t + size > H_:
            continue
        s = sample_face(lum[t:t + size, l:l + size], size)
        if s is not None:
            out[i] = s
    return out


def parse_corners(vals):
    return [tuple(float(v) for v in c.split(',')) for c in vals]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--learn', nargs=5, required=True, metavar=('PHOTO', 'C1', 'C2', 'C3', 'C4'))
    ap.add_argument('--test', nargs=5, required=True, metavar=('PHOTO', 'C1', 'C2', 'C3', 'C4'))
    ap.add_argument('--metric', default='agree', choices=['agree','jaccard','dice'])
    args = ap.parse_args()
    global METRIC
    METRIC = args.metric

    learn = faces(args.learn[0], parse_corners(args.learn[1:]))
    test = faces(args.test[0], parse_corners(args.test[1:]))
    print(f'harvested {len(learn)} faces, testing {len(test)}')

    # One template per value, merged from every example of it.
    by_value = {}
    for i, bits in learn.items():
        by_value.setdefault(TRUTH[i], []).append(bits)

    library = []
    for value, samples in by_value.items():
        ref = samples[0]
        counts = np.zeros(SIZE)
        for s in samples:
            best_shift, best_score = 0, -1
            for shift in range(SECTORS):
                sc = similarity(ref, rotate(s, shift))
                if sc > best_score:
                    best_score, best_shift = sc, shift
            counts += rotate(s, best_shift).astype(float)
        library.append((value, counts > len(samples) / 2))
    print(f'library: {sorted(v for v, _ in library)}')

    print('\nhex | want | got | score | margin | trusted')
    ok = trusted_ok = trusted_n = 0
    for i, bits in sorted(test.items()):
        best = (None, -1, 0)
        by_val = {}
        for value, tpl in library:
            for shift in range(SECTORS):
                sc = similarity(bits, rotate(tpl, shift))
                if sc > best[1]:
                    best = (value, sc, shift)
                by_val[value] = max(by_val.get(value, 0), sc)
        runner = max((s for v, s in by_val.items() if v != best[0]), default=0)
        margin = max(0.0, best[1] - runner)
        trusted = best[1] >= 0.72 and margin >= 0.03
        hit = best[0] == TRUTH[i]
        if hit:
            ok += 1
        if trusted:
            trusted_n += 1
            if hit:
                trusted_ok += 1
        print(f'{i:3d} | {TRUTH[i]:4d} | {str(best[0]):3s} | {best[1]:.3f} | {margin:.3f} | '
              f'{"yes" if trusted else "no"}{"" if hit else "   <-- wrong"}')

    print(f'\ncorrect: {ok}/{len(test)}')
    if trusted_n:
        print(f'of the {trusted_n} it trusted, {trusted_ok} were right '
              f'({trusted_ok / trusted_n:.0%})')


if __name__ == '__main__':
    main()
