"""Count how often every gate in the reader actually fires.

WHY THIS EXISTS
---------------
Three separate bugs in this project were all the same bug: a predicate that
silently never matched, hidden behind a fallback or behind a stage that limped
on regardless. `locateBrightDisc` found the face on 5 of 18 tokens. `decodeToken`
called nineteen tiles confident and got fourteen wrong. The face predicate cut
at saturation 0.30 when the face measures 0.33-0.37, so it excluded the very
thing it was looking for and passed 1-2.5% of each crop.

None of those were visible by reading the code. All three were obvious the
moment someone counted. So: count everything.

A gate that NEVER fires is dead code hiding a wrong assumption. A gate that
ALWAYS fires is not a gate. A gate whose measured quantity sits right on its
threshold is a coin flip. All three are reported here.

    python tools/gate_audit.py
"""
import sys

sys.path.insert(0, 'tools')
import numpy as np
from PIL import Image

import digit_match_probe as D
from board_shots import SHOTS, TRUTH, CROP_PADDING, HARD_CASE, DEVICE_RUN
from fit_probe import CAN, CORNERS, homography, apply_h
from token_probe import otsu, components

ALL = [('device', DEVICE_RUN), ('hard', HARD_CASE)] + list(SHOTS.items())

# Mirrors the constants in services/vision/digitSample.ts.
FACE_MAX_SATURATION = 0.45
FACE_MIN_BRIGHT = 127 / 255
RIM_REACH = 0.99
PIP_SIZE_CUT = 0.5
INK_WARMTH_MARGIN = 18


class Gate:
    """One threshold, and the values that were actually tested against it."""

    def __init__(self, name, threshold, direction, note=''):
        self.name = name
        self.threshold = threshold
        self.direction = direction     # 'reject_below' or 'reject_above'
        self.note = note
        self.values = []
        self.rejected = 0

    def check(self, value):
        self.values.append(value)
        bad = value < self.threshold if self.direction == 'reject_below' else value > self.threshold
        if bad:
            self.rejected += 1
        return not bad

    def report(self):
        v = np.array(self.values, dtype=float)
        if len(v) == 0:
            return f'{self.name:26s} NEVER EVALUATED'
        pct = 100 * self.rejected / len(v)
        if self.direction == 'reject_below':
            margin = np.percentile(v, 5) / self.threshold if self.threshold else float('inf')
            headroom = f'p5={np.percentile(v, 5):.3g} vs {self.threshold:g}'
        else:
            margin = self.threshold / max(np.percentile(v, 95), 1e-9)
            headroom = f'p95={np.percentile(v, 95):.3g} vs {self.threshold:g}'
        flag = ''
        if pct == 0 and margin > 3:
            flag = '   <- never fires, huge margin'
        elif pct == 0:
            flag = '   <- never fires'
        elif pct > 60:
            flag = '   <- rejects most input'
        elif 0.75 < margin < 1.33:
            flag = '   <- values sit ON the threshold'
        return (f'{self.name:26s} rejects {pct:5.1f}%  ({self.rejected}/{len(v)})  '
                f'{headroom}{flag}')


gates = {
    'crop fits in photo':   Gate('crop fits in photo', 0.5, 'reject_below'),
    'face pixels >= 60':    Gate('face pixels >= 60', 60, 'reject_below'),
    'face saturation':      Gate('face saturation', FACE_MAX_SATURATION, 'reject_above'),
    'face brightness':      Gate('face brightness', FACE_MIN_BRIGHT, 'reject_below'),
    'disc area >= 40':      Gate('disc area >= 40', 40, 'reject_below'),
    'blob >= minBlob':      Gate('blob >= minBlob', 1.0, 'reject_below'),
    'digit pixels >= 30':   Gate('digit pixels >= 30', 30, 'reject_below'),
    'digit reach >= 4':     Gate('digit reach >= 4', 4, 'reject_below'),
    'ink px >= 12':         Gate('ink px >= 12', 12, 'reject_below'),
    'face px >= 12':        Gate('face px >= 12', 12, 'reject_below'),
    'ink warmth |margin|':  Gate('ink warmth |margin|', INK_WARMTH_MARGIN, 'reject_below'),
    'pip weight > 0':       Gate('pip weight > 0', 1, 'reject_below'),
    'pip vector length':    Gate('pip vector length', 0.25, 'reject_below'),
}

stats = {
    'tokens': 0, 'sampled': 0,
    'kept_blobs': [], 'dropped_blobs': [], 'glyph_blobs': [],
    'true_radius_ratio': [], 'centre_offset': [],
    'pips_found': 0, 'ink_known': 0, 'ink_red': 0,
    'face_located': 0,
}


def audit(photo, corners):
    im = Image.open(photo).convert('RGB')
    a = np.asarray(im).astype(np.float32)
    H_, W_ = a.shape[:2]
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    Hm = homography(CAN[CORNERS], np.array([(x * W_, y * H_) for x, y in corners], float))
    A = apply_h(Hm, np.array([CAN[7]]))[0]
    B = apply_h(Hm, np.array([CAN[11]]))[0]
    scale = np.hypot(*(B - A)) / (CAN[11][0] - CAN[7][0])
    rad = D.TOKEN_RADIUS * scale * CROP_PADDING
    size = int(round(rad * 2))
    assumed = (size / 2) / CROP_PADDING

    for i in range(19):
        if TRUTH[i] is None:
            continue
        stats['tokens'] += 1
        ce = apply_h(Hm, np.array([CAN[i]]))[0]
        l, t = int(round(ce[0] - rad)), int(round(ce[1] - rad))
        fits = 1.0 if (l >= 0 and t >= 0 and l + size <= W_ and t + size <= H_) else 0.0
        if not gates['crop fits in photo'].check(fits):
            continue

        rgb = a[t:t + size, l:l + size]
        gray = lum[t:t + size, l:l + size]
        n = rgb / 255.0
        mx = n.max(2); mn = n.min(2)
        sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)

        yy, xx = np.mgrid[0:size, 0:size]
        c = (size - 1) / 2.0
        reach = (size / 2) / CROP_PADDING * 1.05
        facey = (sat < FACE_MAX_SATURATION) & (mx > FACE_MIN_BRIGHT)
        near = facey & (((xx - c) ** 2 + (yy - c) ** 2) <= reach * reach)

        if not gates['face pixels >= 60'].check(float(near.sum())):
            continue
        stats['face_located'] += 1
        ys, xs = np.nonzero(near)
        cx, cy = xs.mean(), ys.mean()
        stats['centre_offset'].append(np.hypot(cx - c, cy - c) / assumed)

        # How saturated / bright is the face we DID find? Reported so a future
        # lighting change that pushes it past the cut shows up here first.
        core = near & (((xx - cx) ** 2 + (yy - cy) ** 2) <= (assumed * 0.6) ** 2)
        if core.sum() > 20:
            gates['face saturation'].check(float(np.median(sat[core])))
            gates['face brightness'].check(float(np.median(mx[core])))

        # True face extent, now that the centre is trustworthy.
        dist = np.hypot(xx - cx, yy - cy)
        edge = None
        for r in range(6, int(size * 0.5)):
            ring = (dist >= r - 0.5) & (dist < r + 0.5)
            if ring.sum() < 8:
                break
            if facey[ring].mean() >= 0.5:
                edge = r
        if edge:
            stats['true_radius_ratio'].append(edge / assumed)

        r = assumed * 0.9
        inside = dist <= r
        if not gates['disc area >= 40'].check(float(inside.sum())):
            continue
        cut = otsu(gray[inside])
        mask = (gray <= cut) & inside

        min_blob = max(2, round(size * size * 0.0008))
        raw = components(mask, True)
        for cc in raw:
            gates['blob >= minBlob'].check(cc['size'] / min_blob)
        comps = [cc for cc in raw if cc['size'] >= min_blob]
        keep = []
        for cc in comps:
            box = [(cc['minx'], cc['miny']), (cc['maxx'], cc['miny']),
                   (cc['minx'], cc['maxy']), (cc['maxx'], cc['maxy'])]
            if max(np.hypot(px - cx, py - cy) for px, py in box) <= r * RIM_REACH:
                keep.append(cc)
        stats['kept_blobs'].append(len(keep))
        stats['dropped_blobs'].append(len(comps) - len(keep))
        if not keep:
            continue

        largest = max(cc['size'] for cc in keep)
        glyphs = [cc for cc in keep if cc['size'] >= largest * PIP_SIZE_CUT]
        stats['glyph_blobs'].append(len(glyphs))
        lab = np.zeros((size, size), bool)
        for cc in glyphs:
            lab[cc['miny']:cc['maxy'] + 1, cc['minx']:cc['maxx'] + 1] |= \
                mask[cc['miny']:cc['maxy'] + 1, cc['minx']:cc['maxx'] + 1]
        if not gates['digit pixels >= 30'].check(float(lab.sum())):
            continue
        dys, dxs = np.nonzero(lab)
        dcx, dcy = dxs.mean(), dys.mean()
        dr = np.hypot(dxs - dcx, dys - dcy).max()
        if not gates['digit reach >= 4'].check(float(dr)):
            continue
        stats['sampled'] += 1

        face_mask = inside & ~lab
        gates['ink px >= 12'].check(float(lab.sum()))
        gates['face px >= 12'].check(float(face_mask.sum()))
        if lab.sum() >= 12 and face_mask.sum() >= 12:
            warm = lambda m: (rgb[..., 0][m].mean()
                              - (rgb[..., 1][m].mean() + rgb[..., 2][m].mean()) / 2)
            delta = warm(lab) - warm(face_mask)
            gates['ink warmth |margin|'].check(abs(delta))
            stats['ink_known'] += 1
            if delta > INK_WARMTH_MARGIN:
                stats['ink_red'] += 1

        pip_floor = max(2, round(size * size * 0.0004))
        pips = [cc for cc in components((gray <= cut) & (dist <= assumed * 0.98), True)
                if pip_floor <= cc['size'] < largest * PIP_SIZE_CUT
                and np.hypot((cc['minx'] + cc['maxx']) / 2 - dcx,
                             (cc['miny'] + cc['maxy']) / 2 - dcy) >= dr * 0.35]
        gates['pip weight > 0'].check(float(len(pips)))
        if pips:
            w = sum(p['size'] for p in pips)
            px = sum((p['minx'] + p['maxx']) / 2 * p['size'] for p in pips) / w
            py = sum((p['miny'] + p['maxy']) / 2 * p['size'] for p in pips) / w
            gates['pip vector length'].check(float(np.hypot(px - dcx, py - dcy) / dr))
            if np.hypot(px - dcx, py - dcy) > dr * 0.25:
                stats['pips_found'] += 1


for label, (photo, corners) in ALL:
    audit(photo, corners)

print(f'audited {stats["tokens"]} tokens across {len(ALL)} captures\n')
print('GATES — a gate that never fires hides an assumption; one that sits on')
print('its threshold is a coin flip.\n')
for g in gates.values():
    print('  ' + g.report())

print(f'\nSTAGE OUTCOMES')
print(f'  face located          {stats["face_located"]}/{stats["tokens"]}')
print(f'  digit sampled         {stats["sampled"]}/{stats["tokens"]}')
print(f'  ink colour known      {stats["ink_known"]}/{stats["tokens"]}'
      f'  (red on {stats["ink_red"]})')
print(f'  pip direction known   {stats["pips_found"]}/{stats["tokens"]}')

for key, label, target in [
    ('true_radius_ratio', 'true face radius / assumed', 1.0),
    ('centre_offset', 'centre offset / assumed radius', 0.0),
]:
    v = np.array(stats[key])
    if len(v):
        print(f'\n  {label}: median {np.median(v):.2f}  '
              f'p5 {np.percentile(v, 5):.2f}  p95 {np.percentile(v, 95):.2f}  '
              f'(want ~{target:.1f})')

for key, label in [('kept_blobs', 'blobs kept per token'),
                   ('dropped_blobs', 'blobs dropped as rim'),
                   ('glyph_blobs', 'blobs treated as the digit')]:
    v = np.array(stats[key])
    if len(v):
        print(f'  {label}: median {np.median(v):.0f}  max {v.max():.0f}  '
              f'zero on {(v == 0).sum()}')
