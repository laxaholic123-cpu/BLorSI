/**
 * Unit tests for confining token decoding to the token's circular face.
 *
 * These exist because of a measured failure, not a suspected one. On real
 * captures with hand-marked corners, terrain read 17/19 while tokens read 3/19
 * — same geometry feeding both, so the geometry was fine and the decoder was
 * not. Broken down by terrain the cause was unmistakable:
 *
 *   grain 33%, wool 25%, brick 0%, ore 0%, lumber 0%
 *
 * Zero out of thirty on the three textured terrains. The token crop is a
 * SQUARE taken around a CIRCULAR token, so about 21% of it (1 - pi/4) is the
 * tile underneath. On forest, mountains and hills that scenery thresholds into
 * ink and gets counted as pips and glyphs — the decoder was largely counting
 * trees. Smooth pale terrain contributes little, which is exactly why grain and
 * wool were the only ones that ever worked.
 */

import {
  maskToCircle,
  otsuThreshold,
  otsuThresholdInCircle,
  threshold,
  connectedComponents,
  countHoles,
  type BinaryMask,
} from '../services/vision/binaryOps';

const SIZE = 41;

/**
 * A square gray crop standing in for a real token photo.
 *
 * Values matter here. Real artwork is not uniformly black — it sits BETWEEN
 * the ink and the cream face, which is exactly what makes it dangerous: it
 * lands on the ink side of any cut chosen to separate digits from face. A
 * fixture with only two levels degenerates and proves nothing.
 */
function crop(opts: { artwork: boolean; centreInk?: boolean }): {
  data: Uint8Array;
  width: number;
  height: number;
} {
  const data = new Uint8Array(SIZE * SIZE);
  const c = (SIZE - 1) / 2;
  const faceR = (SIZE / 2) * 0.92;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const inside = (x - c) ** 2 + (y - c) ** 2 <= faceR * faceR;
      let v: number;
      if (inside) {
        v = 228 + ((x * 7 + y * 3) % 9); // cream face, faintly uneven
      } else if (opts.artwork) {
        // Textured scenery: mid-dark, and broken up so it forms several blobs
        // rather than one tidy ring.
        v = (x + y) % 3 === 0 ? 105 : 62;
      } else {
        v = 228;
      }
      // A digit-sized blob of ink in the middle.
      if (opts.centreInk && Math.abs(x - c) <= 3 && Math.abs(y - c) <= 5) v = 24;
      data[y * SIZE + x] = v;
    }
  }
  return { data, width: SIZE, height: SIZE };
}

const inkBlobs = (mask: BinaryMask) => connectedComponents(mask, true).filter(b => b.size >= 3).length;

describe('the old pipeline versus the new one', () => {
  it('stops counting scenery as ink', () => {
    // The old readToken called threshold(crop) with no cut, so Otsu ran over
    // the whole square — artwork included — and landed on a level that swept
    // the scenery in with the digits. Every one of those blobs then became a
    // pip or a glyph.
    const image = crop({ artwork: true, centreInk: true });

    const before = threshold(image); // whole-image Otsu, no circle mask
    const after = maskToCircle(threshold(image, otsuThresholdInCircle(image)));

    expect(inkBlobs(before)).toBeGreaterThan(1);
    // Only the digit survives.
    expect(inkBlobs(after)).toBe(1);
  });

  it('changes nothing when there is no artwork to exclude', () => {
    // A token photographed against a smooth pale tile was already fine, which
    // is why grain and wool were the only terrains that ever read. The fix must
    // not disturb that case.
    const image = crop({ artwork: false, centreInk: true });
    const plain = threshold(image, otsuThresholdInCircle(image));
    expect(inkBlobs(maskToCircle(plain))).toBe(inkBlobs(plain));
  });

  it('does not invent holes from the ring it clears', () => {
    // The cleared ring is background touching all four borders, so it must be
    // excluded from hole counting rather than counted as an enclosed region —
    // holes are one third of how a token is identified.
    const image = crop({ artwork: true, centreInk: true });
    const masked = maskToCircle(threshold(image, otsuThresholdInCircle(image)));
    expect(countHoles(masked)).toBe(0);
  });

  it('preserves the dimensions of the mask it is given', () => {
    const image = crop({ artwork: true });
    const masked = maskToCircle(threshold(image));
    expect(masked.width).toBe(SIZE);
    expect(masked.height).toBe(SIZE);
    expect(masked.data).toHaveLength(SIZE * SIZE);
  });
});

describe('otsuThresholdInCircle', () => {
  it('ignores corner artwork when choosing the cut', () => {
    // Dark corners drag a whole-image Otsu towards splitting artwork from face,
    // rather than ink from face — so the digits stop being found at all.
    const withArt = crop({ artwork: true, centreInk: true });
    const withoutArt = crop({ artwork: false, centreInk: true });

    const circleCut = otsuThresholdInCircle(withArt);
    const cleanCut = otsuThresholdInCircle(withoutArt);
    // The circle-only cut should barely notice the artwork.
    expect(Math.abs(circleCut - cleanCut)).toBeLessThan(10);

    // Whereas the whole-image cut moves substantially.
    const wholeCut = otsuThreshold(withArt);
    expect(Math.abs(wholeCut - cleanCut)).toBeGreaterThan(Math.abs(circleCut - cleanCut));
  });

  it('still returns a usable cut when the circle is degenerate', () => {
    const tiny = { data: new Uint8Array([10, 200, 10, 200]), width: 2, height: 2 };
    const cut = otsuThresholdInCircle(tiny);
    expect(cut).toBeGreaterThanOrEqual(0);
    expect(cut).toBeLessThanOrEqual(255);
  });
});
