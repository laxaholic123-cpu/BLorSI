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
  fallbackDisc,
  locateBrightDisc,
  maskToDisc,
  otsuThreshold,
  otsuThresholdInDisc,
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
    const after = maskToDisc(threshold(image, otsuThresholdInDisc(image, fallbackDisc(SIZE))), fallbackDisc(SIZE));

    expect(inkBlobs(before)).toBeGreaterThan(1);
    // Only the digit survives.
    expect(inkBlobs(after)).toBe(1);
  });

  it('changes nothing when there is no artwork to exclude', () => {
    // A token photographed against a smooth pale tile was already fine, which
    // is why grain and wool were the only terrains that ever read. The fix must
    // not disturb that case.
    const image = crop({ artwork: false, centreInk: true });
    const plain = threshold(image, otsuThresholdInDisc(image, fallbackDisc(SIZE)));
    expect(inkBlobs(maskToDisc(plain, fallbackDisc(SIZE)))).toBe(inkBlobs(plain));
  });

  it('does not invent holes from the ring it clears', () => {
    // The cleared ring is background touching all four borders, so it must be
    // excluded from hole counting rather than counted as an enclosed region —
    // holes are one third of how a token is identified.
    const image = crop({ artwork: true, centreInk: true });
    const masked = maskToDisc(threshold(image, otsuThresholdInDisc(image, fallbackDisc(SIZE))), fallbackDisc(SIZE));
    expect(countHoles(masked)).toBe(0);
  });

  it('preserves the dimensions of the mask it is given', () => {
    const image = crop({ artwork: true });
    const masked = maskToDisc(threshold(image), fallbackDisc(SIZE));
    expect(masked.width).toBe(SIZE);
    expect(masked.height).toBe(SIZE);
    expect(masked.data).toHaveLength(SIZE * SIZE);
  });
});

describe('otsuThresholdInDisc', () => {
  it('ignores corner artwork when choosing the cut', () => {
    // Dark corners drag a whole-image Otsu towards splitting artwork from face,
    // rather than ink from face — so the digits stop being found at all.
    const withArt = crop({ artwork: true, centreInk: true });
    const withoutArt = crop({ artwork: false, centreInk: true });

    const circleCut = otsuThresholdInDisc(withArt, fallbackDisc(SIZE));
    const cleanCut = otsuThresholdInDisc(withoutArt, fallbackDisc(SIZE));
    // The circle-only cut should barely notice the artwork.
    expect(Math.abs(circleCut - cleanCut)).toBeLessThan(10);

    // Whereas the whole-image cut moves substantially.
    const wholeCut = otsuThreshold(withArt);
    expect(Math.abs(wholeCut - cleanCut)).toBeGreaterThan(Math.abs(circleCut - cleanCut));
  });

  it('still returns a usable cut when the circle is degenerate', () => {
    const tiny = { data: new Uint8Array([10, 200, 10, 200]), width: 2, height: 2 };
    const cut = otsuThresholdInDisc(tiny, fallbackDisc(2));
    expect(cut).toBeGreaterThanOrEqual(0);
    expect(cut).toBeLessThanOrEqual(255);
  });
});

describe('locateBrightDisc', () => {
  /** A crop with the bright face deliberately off-centre and undersized. */
  function offsetFace(cx: number, cy: number, r: number): {
    data: Uint8Array; width: number; height: number;
  } {
    const data = new Uint8Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const face = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
        data[y * SIZE + x] = face ? 232 : 70; // face on darker tile
      }
    }
    return { data, width: SIZE, height: SIZE };
  }

  it('finds a face that is off-centre and smaller than the crop', () => {
    // The measured reality: the face sits up to half a radius off centre and is
    // about 64% of the assumed radius, because tokens are placed by hand.
    const disc = locateBrightDisc(offsetFace(14, 26, 11));
    expect(disc).not.toBeNull();
    expect(disc!.cx).toBeCloseTo(14, 0);
    expect(disc!.cy).toBeCloseTo(26, 0);
    // Half a pixel over: a rasterised disc of radius 11 spans 23 pixels, so the
    // bounding-box radius is 11.5. Close enough to place the decode.
    expect(Math.abs(disc!.radius - 11)).toBeLessThanOrEqual(1);
  });

  it('refuses when the bright region runs off the crop', () => {
    // A pale tile is bright too. Reporting it as the face would put the decoder
    // somewhere worse than the centred guess — a wrong face beats no face only
    // if it is actually the face.
    const data = new Uint8Array(SIZE * SIZE).fill(230);
    expect(locateBrightDisc({ data, width: SIZE, height: SIZE })).toBeNull();
  });

  it('refuses an oblong bright region', () => {
    const data = new Uint8Array(SIZE * SIZE).fill(60);
    for (let y = 16; y < 24; y++) for (let x = 6; x < 34; x++) data[y * SIZE + x] = 235;
    expect(locateBrightDisc({ data, width: SIZE, height: SIZE })).toBeNull();
  });

  it('falls back to a disc smaller than the crop, not one that fills it', () => {
    // 0.65 is measured, not chosen: assuming the face fills the crop is what
    // made the decoder threshold the tile as ink in the first place.
    const fb = fallbackDisc(SIZE);
    expect(fb.radius).toBeLessThan(SIZE / 2);
    expect(fb.radius / (SIZE / 2)).toBeCloseTo(0.65, 2);
  });

  it('confines the decode to the located face, not the crop centre', () => {
    const image = offsetFace(14, 26, 11);
    const disc = locateBrightDisc(image)!;
    const masked = maskToDisc(threshold(image, otsuThresholdInDisc(image, disc)), disc);
    // Nothing survives outside the located face.
    let outside = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if ((x - disc.cx) ** 2 + (y - disc.cy) ** 2 > disc.radius ** 2 && masked.data[y * SIZE + x]) {
          outside++;
        }
      }
    }
    expect(outside).toBe(0);
  });
});
