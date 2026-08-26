/**
 * Choosing the ink threshold inside the token's disc, not across the whole crop.
 *
 * A square crop of a round token always contains tile artwork in its corners,
 * and that artwork sits BETWEEN the ink and the cream face in brightness. A
 * whole-image Otsu therefore splits artwork from face rather than ink from
 * face, and the digits stop being found at all. Restricting the histogram to
 * the disc is what makes the cut mean "ink".
 */

import {
  otsuThreshold,
  otsuThresholdInDisc,
  type Disc,
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

/** Any disc will do here; the point is that it EXCLUDES the corners. */
const DISC: Disc = { cx: (SIZE - 1) / 2, cy: (SIZE - 1) / 2, radius: (SIZE / 2) * 0.65 };

describe('otsuThresholdInDisc', () => {
  it('ignores corner artwork when choosing the cut', () => {
    // Dark corners drag a whole-image Otsu towards splitting artwork from face,
    // rather than ink from face — so the digits stop being found at all.
    const withArt = crop({ artwork: true, centreInk: true });
    const withoutArt = crop({ artwork: false, centreInk: true });

    const circleCut = otsuThresholdInDisc(withArt, DISC);
    const cleanCut = otsuThresholdInDisc(withoutArt, DISC);
    // The circle-only cut should barely notice the artwork.
    expect(Math.abs(circleCut - cleanCut)).toBeLessThan(10);

    // Whereas the whole-image cut moves substantially.
    const wholeCut = otsuThreshold(withArt);
    expect(Math.abs(wholeCut - cleanCut)).toBeGreaterThan(Math.abs(circleCut - cleanCut));
  });

  it('still returns a usable cut when the circle is degenerate', () => {
    const tiny = { data: new Uint8Array([10, 200, 10, 200]), width: 2, height: 2 };
    const cut = otsuThresholdInDisc(tiny, { cx: 0.5, cy: 0.5, radius: 1 });
    expect(cut).toBeGreaterThanOrEqual(0);
    expect(cut).toBeLessThanOrEqual(255);
  });
});
