"""Read number tokens by matching the DIGIT SHAPE against examples of it.

Match, do not identify. The token is already located, there are exactly ten
possible answers, and every one is printed identically on the same board — so
the job is recognising which of ten known things this is, not reading arbitrary
text. Four fixes, each measured, are what make it work:

  1. PAD THE CROP. It was sized at exactly TOKEN_RADIUS * scale with no margin,
     so a token sitting off-centre on its tile was clipped by the crop boundary
     before anything downstream ran — 8 of 18 on the reference capture. A
     clipped token is also where the tile crescent below comes from.
  2. Locate the face by SATURATION, not brightness. A gold wheat field is as
     bright as a cream token; locating by brightness found 5 of 18 faces on one
     capture and 0 of 18 on another, then silently fell back to a guess.
     Nothing on a Catan tile is both bright and grey except the token face.
  3. Drop the rim crescent. The tile is darker than the face, so any of it
     inside the sampled disc thresholds as ink and, being the largest blob, is
     mistaken for the digit while the real digit is demoted to a pip. It
     arrives from outside, so it touches the disc boundary; the digit never does.
  4. Match the DIGIT, centred and scaled on its own extent — not the face. Print
     size, camera distance and face-centring all drop out.

Matching the whole face instead of the digit is what produced the earlier
"3/12, the approach does not work" result.

LEAVE-ONE-PHOTO-OUT is the test: build the library from six captures and read
the seventh, seven times over. Every capture shows the same physical board, so
a template is never matched against an example of ITSELF — that would be a
lookup, and it is the trap the first cross-photo attempt fell into.

    python tools/digit_match_probe.py
"""
import sys

sys.path.insert(0, 'tools')
import numpy as np
from PIL import Image

from board_shots import SHOTS, TRUTH, CROP_PADDING
from fit_probe import CAN, CORNERS, homography, apply_h
from token_probe import otsu, components

TOKEN_RADIUS = 0.42
RINGS, SECTORS = 12, 64

#: The face fills this fraction of the crop half-width, by construction.
FACE_FRACTION = 1.0 / CROP_PADDING
#: Blobs reaching past this much of the disc came in from the tile.
RIM_REACH = 0.99
#: Commit above this, decline below it. A declined token costs a tap; a wrong
#: one is expensive and invisible.
ACCEPT_SCORE = 0.91
#: Use ink colour to settle 6 against 9.
USE_INK = True


def locate_sat(rgb, size):
    """Bright AND grey. Nothing else on a Catan tile is both."""
    a = rgb.astype(np.float32) / 255.0
    mx = a.max(2)
    mn = a.min(2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    # 0.45, not 0.30: the printed cream sits at 0.33-0.37 saturation, so a
    # 0.30 cut excluded the face itself and the centroid was computed over
    # stray pixels. Must match FACE_MAX_SATURATION in digitSample.ts.
    mask = (sat < 0.45) & (mx > 0.50)
    yy, xx = np.mgrid[0:size, 0:size]
    c = (size - 1) / 2.0
    # Just wide enough for the face, so pale tile borders stay out of it.
    reach = (size / 2) * FACE_FRACTION * 1.05
    near = mask & (((xx - c) ** 2 + (yy - c) ** 2) <= reach * reach)
    if near.sum() < 60:
        return None
    ys, xs = np.nonzero(near)
    return xs.mean(), ys.mean(), (size / 2) * FACE_FRACTION


def ink_is_red(rgb, mask, inside):
    """Is the ink warmer than the paper it sits on?

    Mirrors readFrame.inkIsRed. Absolute colour is useless under a warm lamp —
    the face is printed cream and is already warm — so the question is whether
    the INK is warmer than the FACE. Returns None when there is too little of
    either to judge, because an absent signal must leave the reading alone.
    """
    face = inside & ~mask
    if mask.sum() < 12 or face.sum() < 12:
        return None
    a = rgb.astype(np.float32)
    warmth = lambda m: a[..., 0][m].mean() - (a[..., 1][m].mean() + a[..., 2][m].mean()) / 2
    # 40, not 18: measured over 162 tokens, red ink sits at 58.9+ and black
    # reaches 25.1, so 18 was inside the black class. Must match
    # INK_RED_WARMTH in digitSample.ts.
    return bool(warmth(mask) - warmth(face) > 40)


def digit_shape(rgb, gray, size):
    """Polar sample of the digit alone, scaled to its own reach.

    Also returns the ink colour, which settles the one thing shape cannot.
    """
    found = locate_sat(rgb, size)
    if found is None:
        return None
    cx, cy, r = found
    r *= 0.9                                  # inside the printed rim
    yy, xx = np.mgrid[0:size, 0:size]
    inside = (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
    if inside.sum() < 40:
        return None
    cut = otsu(gray[inside])
    mask = (gray <= cut) & inside

    min_blob = max(2, round(size * size * 0.0008))
    comps = [c for c in components(mask, True) if c['size'] >= min_blob]
    keep = []
    for c in comps:
        box = [(c['minx'], c['miny']), (c['maxx'], c['miny']),
               (c['minx'], c['maxy']), (c['maxx'], c['maxy'])]
        if max(np.hypot(px - cx, py - cy) for px, py in box) <= r * RIM_REACH:
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

    out = np.zeros((RINGS, SECTORS), np.float32)
    for ring in range(RINGS):
        rr = dr * ((ring + 0.5) / RINGS)
        for s in range(SECTORS):
            th = 2 * np.pi * s / SECTORS
            x = int(round(dcx + rr * np.cos(th)))
            y = int(round(dcy + rr * np.sin(th)))
            out[ring, s] = lab[y, x] if (0 <= x < size and 0 <= y < size) else 0
    return out, ink_is_red(rgb, lab, inside)


def shapes(photo, corners):
    im = Image.open(photo).convert('RGB')
    a = np.asarray(im)
    H_, W_ = a.shape[:2]
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    Hm = homography(CAN[CORNERS], np.array([(x * W_, y * H_) for x, y in corners], float))
    A = apply_h(Hm, np.array([CAN[7]]))[0]
    B = apply_h(Hm, np.array([CAN[11]]))[0]
    scale = np.hypot(*(B - A)) / (CAN[11][0] - CAN[7][0])
    rad = TOKEN_RADIUS * scale * CROP_PADDING
    size = int(round(rad * 2))

    out = {}
    for i in range(19):
        if TRUTH[i] is None:
            continue
        ce = apply_h(Hm, np.array([CAN[i]]))[0]
        left, top = int(round(ce[0] - rad)), int(round(ce[1] - rad))
        if left < 0 or top < 0 or left + size > W_ or top + size > H_:
            continue
        got = digit_shape(a[top:top + size, left:left + size],
                          lum[top:top + size, left:left + size], size)
        if got is not None:
            out[i] = got
    return out


def disambiguate_with_ink(value, is_red):
    """Settle 6 against 9, which shape alone never can.

    A 6 turned 180 degrees IS a 9, so rotation-invariant matching cannot
    separate them by shape and should not pretend to — measured, every accepted
    error was this pair, at margins from +0.000 to +0.014. Ink colour settles it
    completely: 6 and 8 are the only red tokens, so a red 6-or-9 is a 6 and a
    black one is a 9. Mirrors ocrTokens.disambiguateWithInk.
    """
    if is_red is None:
        return value
    if value == 6 and not is_red:
        return 9
    if value == 9 and is_red:
        return 6
    return value


def match(d, is_red, library):
    """Best value over every template at every rotation."""
    best = {}
    for v, tpl in library:
        s = max(float((d == np.roll(tpl, -k, axis=1)).mean()) for k in range(SECTORS))
        if s > best.get(v, 0.0):
            best[v] = s
    win = max(best, key=best.get)
    runner = max((s for vv, s in best.items() if vv != win), default=0.0)
    score = best[win]
    if USE_INK:
        win = disambiguate_with_ink(win, is_red)
    return win, score, score - runner


def main():
    print('sampling all captures...')
    bank = {name: shapes(photo, corners) for name, (photo, corners) in SHOTS.items()}
    for name, d in bank.items():
        print(f'  {name}: {len(d)}/18 digits recovered')

    print('\nleave-one-photo-out — library from the other six, never from itself\n')
    print('held out    correct   accepted   of those right')
    total = total_n = accepted = accepted_ok = 0
    misses = []
    for held in bank:
        library = [(TRUTH[i], d)
                   for other, faces in bank.items() if other != held
                   for i, (d, _) in faces.items()]
        ok = n = a_n = a_ok = 0
        for i, (d, is_red) in bank[held].items():
            want = TRUTH[i]
            got, score, margin = match(d, is_red, library)
            n += 1
            ok += got == want
            if score >= ACCEPT_SCORE:
                a_n += 1
                a_ok += got == want
                if got != want:
                    misses.append((held, i, want, got, score, margin))
        print(f'{held:10s}  {ok:2d}/{n:<3d}    {a_n:4d}       {a_ok:5d}/{a_n}')
        total += ok
        total_n += n
        accepted += a_n
        accepted_ok += a_ok

    print(f'\nOVERALL   {total}/{total_n} correct ({total / total_n:.0%})')
    if accepted:
        print(f'ACCEPTED  {accepted_ok}/{accepted} right '
              f'({accepted_ok / accepted:.1%} precision), '
              f'{accepted / total_n:.0%} of all tokens auto-filled')
    print(f'DECLINED  {total_n - accepted} left for the player, about '
          f'{(total_n - accepted) / len(bank):.0f} taps per board')
    if misses:
        print('\nwrong but accepted:')
        for h, i, w, g, s, m in misses:
            print(f'  {h} hex{i}: wanted {w}, got {g} (score {s:.3f}, margin {m:+.3f})')


if __name__ == '__main__':
    main()
