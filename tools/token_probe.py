"""Look at what the token decoder actually sees.

Terrain now reads 19/19 on a good capture while tokens read 5/19, with glyph
counting near chance and every two-digit token wrong. That is no longer a
geometry problem — the same homography feeds both — and it is no longer the
tile artwork either, since masking the crop to the token's circle moved
textured terrain from 0/30 to 2/10 and then stopped helping.

So this dumps the thing nobody has looked at: the 19 token crops, and the
binary mask the decoder derives from each. It reproduces the app's pipeline
step for step (readFrame.readToken -> binaryOps) so what comes out here is what
the phone saw, not an approximation of it.

Usage:
    python tools/token_probe.py <photo> --corners x0,y0 x1,y1 x2,y2 x3,y3

The four corners are NORMALISED 0-1, in TL TR BR BL order — exactly the
"corners" array from a diagnostic export, so they can be pasted straight in.

Writes tools/captures/token_probe.png: a contact sheet of every token, its
mask, and the pip/glyph/hole counts the decoder would derive.
"""
import argparse
import sys

sys.path.insert(0, 'tools')
import numpy as np
from PIL import Image, ImageDraw

from fit_probe import CAN, CORNERS, homography, apply_h

# Matches TOKEN_RADIUS in services/vision/boardGeometry.ts.
TOKEN_RADIUS = 0.42
# Matches the inset used by maskToCircle in services/vision/binaryOps.ts.
CIRCLE_INSET = 0.92


def otsu(values):
    """Same between-class-variance search as binaryOps.otsuThreshold."""
    hist = np.bincount(values.astype(np.uint8).ravel(), minlength=256).astype(np.float64)
    total = hist.sum()
    if total == 0:
        return 0
    sum_all = (np.arange(256) * hist).sum()
    sum_bg = 0.0
    w_bg = 0.0
    best, best_var = 0, -1.0
    for t in range(256):
        w_bg += hist[t]
        if w_bg == 0:
            continue
        w_fg = total - w_bg
        if w_fg == 0:
            break
        sum_bg += t * hist[t]
        mean_bg = sum_bg / w_bg
        mean_fg = (sum_all - sum_bg) / w_fg
        between = w_bg * w_fg * (mean_bg - mean_fg) ** 2
        if between > best_var:
            best_var, best = between, t
    return best


def components(mask, target=True):
    """4-connected labelling, mirroring binaryOps.connectedComponents."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out = []
    for y in range(h):
        for x in range(w):
            if seen[y, x] or mask[y, x] != target:
                continue
            stack = [(y, x)]
            seen[y, x] = True
            pix = []
            while stack:
                cy, cx = stack.pop()
                pix.append((cy, cx))
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] and mask[ny, nx] == target:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            ys = [p[0] for p in pix]
            xs = [p[1] for p in pix]
            out.append({'size': len(pix), 'minx': min(xs), 'maxx': max(xs),
                        'miny': min(ys), 'maxy': max(ys)})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('photo')
    ap.add_argument('--corners', nargs=4, required=True,
                    help='normalised x,y for TL TR BR BL (paste from a diagnostic export)')
    ap.add_argument('--maxdim', type=int, default=1536,
                    help='matches the app buffer width; the harnesses default to 900')
    args = ap.parse_args()

    im = Image.open(args.photo).convert('RGB')
    im.thumbnail((args.maxdim, args.maxdim))
    rgb = np.asarray(im).astype(np.float32) / 255.0
    H_, W_ = rgb.shape[:2]
    print(f'image: {W_}x{H_}')

    pts = []
    for c in args.corners:
        x, y = (float(v) for v in c.split(','))
        pts.append((x * W_, y * H_))
    print('corners (px):', [(round(x), round(y)) for x, y in pts])

    Hm = homography(CAN[CORNERS], np.array(pts, float))

    # Pixels per canonical hex-radius, as readFrame.pixelScale computes it.
    a = apply_h(Hm, np.array([CAN[7]]))[0]
    b = apply_h(Hm, np.array([CAN[11]]))[0]
    scale = np.hypot(*(b - a)) / (CAN[11][0] - CAN[7][0])
    radius = TOKEN_RADIUS * scale
    size = int(round(radius * 2))
    print(f'scale: {scale:.1f} px per hex-radius | token crop: {size}x{size} px')

    lum = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]) * 255.0

    cell = size + 8
    sheet = Image.new('RGB', (cell * 19, cell * 2 + 26), (18, 18, 18))
    draw = ImageDraw.Draw(sheet)

    print('\nhex | pips glyphs holes | blob sizes')
    for i in range(19):
        centre = apply_h(Hm, np.array([CAN[i]]))[0]
        left, top = int(round(centre[0] - radius)), int(round(centre[1] - radius))
        if left < 0 or top < 0 or left + size > W_ or top + size > H_:
            print(f'{i:3d} | OUT OF FRAME')
            continue

        crop = lum[top:top + size, left:left + size]

        yy, xx = np.mgrid[0:size, 0:size]
        c = (size - 1) / 2.0
        inside = (xx - c) ** 2 + (yy - c) ** 2 <= ((size / 2) * CIRCLE_INSET) ** 2

        cut = otsu(crop[inside])
        mask = (crop <= cut) & inside

        comps = [k for k in components(mask, True)
                 if k['size'] >= max(2, round(size * size * 0.0008))]
        # binaryOps.splitGlyphsAndPips separates on area, largest-gap style.
        sizes = sorted((k['size'] for k in comps), reverse=True)
        glyphs = [s for s in sizes if s >= (sizes[0] * 0.35 if sizes else 0)]
        pips = [s for s in sizes if s < (sizes[0] * 0.35 if sizes else 0)]
        holes = sum(1 for k in components(mask, False)
                    if k['minx'] > 0 and k['miny'] > 0
                    and k['maxx'] < size - 1 and k['maxy'] < size - 1)
        print(f'{i:3d} | {len(pips):4d} {len(glyphs):6d} {holes:5d} | {sizes[:8]}')

        sheet.paste(Image.fromarray(crop.astype(np.uint8)).convert('RGB'), (cell * i + 4, 4))
        vis = np.zeros((size, size, 3), np.uint8)
        vis[mask] = (255, 255, 255)
        vis[inside & ~mask] = (40, 40, 60)
        sheet.paste(Image.fromarray(vis), (cell * i + 4, cell + 4))
        draw.text((cell * i + 6, cell * 2 + 6), str(i), fill=(200, 200, 200))

    out = 'tools/captures/token_probe.png'
    sheet.save(out)
    print(f'\nwrote {out}  (top row: crops, bottom row: what the decoder thresholds)')


if __name__ == '__main__':
    main()
