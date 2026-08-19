/**
 * Token reading without OCR.
 *
 * The binary primitives are tested against hand-drawn bitmaps so hole counting
 * is verified on real glyph topology rather than on assumptions: an 8 genuinely
 * has two enclosed regions, a 5 genuinely has none.
 */

import {
  connectedComponents,
  countHoles,
  filterNoise,
  otsuThreshold,
  splitGlyphsAndPips,
  threshold,
  type BinaryMask,
} from '@/services/vision/binaryOps';
import {
  PIPS_BY_VALUE,
  TOKEN_SIGNATURES,
  decodeToken,
} from '@/services/vision/tokenDecode';

// ─── Bitmap helpers ───────────────────────────────────────────────────────────

/** Build a mask from ASCII art: X is ink, anything else is background. */
function maskFrom(rows: string[]): BinaryMask {
  const height = rows.length;
  const width = rows[0]!.length;
  const data: boolean[] = [];
  for (const row of rows) {
    for (let x = 0; x < width; x++) data.push(row[x] === 'X');
  }
  return { data, width, height };
}

// Digits drawn with a one-pixel background margin, so the outside world is a
// single border-touching region and enclosed loops are unambiguous.
const DIGIT_8 = [
  '.......',
  '.XXXXX.',
  '.X...X.',
  '.XXXXX.',
  '.X...X.',
  '.XXXXX.',
  '.......',
];
const DIGIT_5 = [
  '.......',
  '.XXXXX.',
  '.X.....',
  '.XXXXX.',
  '.....X.',
  '.XXXXX.',
  '.......',
];
const DIGIT_6 = [
  '.......',
  '.XXXXX.',
  '.X.....',
  '.XXXXX.',
  '.X...X.',
  '.XXXXX.',
  '.......',
];
const DIGIT_9 = [
  '.......',
  '.XXXXX.',
  '.X...X.',
  '.XXXXX.',
  '.....X.',
  '.XXXXX.',
  '.......',
];
const DIGIT_0 = [
  '.......',
  '.XXXXX.',
  '.X...X.',
  '.X...X.',
  '.X...X.',
  '.XXXXX.',
  '.......',
];

describe('countHoles — glyph topology', () => {
  it('finds two enclosed regions in an 8', () => {
    expect(countHoles(maskFrom(DIGIT_8))).toBe(2);
  });

  it('finds one in a 6, a 9 and a 0', () => {
    expect(countHoles(maskFrom(DIGIT_6))).toBe(1);
    expect(countHoles(maskFrom(DIGIT_9))).toBe(1);
    expect(countHoles(maskFrom(DIGIT_0))).toBe(1);
  });

  it('finds none in a 5', () => {
    expect(countHoles(maskFrom(DIGIT_5))).toBe(0);
  });

  it('is rotation invariant — a rotated 6 still has one hole', () => {
    // Tokens sit at every orientation on a real board; several in the reference
    // photos read upside-down. Topology does not care.
    const rotated = DIGIT_6.map(r => [...r].reverse().join('')).reverse();
    expect(countHoles(maskFrom(rotated))).toBe(1);
  });

  it('does not count the outside world as a hole', () => {
    expect(countHoles(maskFrom(['...', '.X.', '...']))).toBe(0);
  });
});

describe('connectedComponents', () => {
  it('finds separate blobs', () => {
    const mask = maskFrom([
      'X..X',
      'X..X',
      '....',
      'XX..',
    ]);
    expect(connectedComponents(mask)).toHaveLength(3);
  });

  it('uses 4-connectivity, so diagonals are separate', () => {
    const mask = maskFrom([
      'X.',
      '.X',
    ]);
    expect(connectedComponents(mask)).toHaveLength(2);
  });

  it('reports bounds and centroid', () => {
    const mask = maskFrom([
      '....',
      '.XX.',
      '.XX.',
      '....',
    ]);
    const [c] = connectedComponents(mask);
    expect(c!.size).toBe(4);
    expect(c!.minX).toBe(1);
    expect(c!.maxX).toBe(2);
    expect(c!.cx).toBeCloseTo(1.5);
    expect(c!.cy).toBeCloseTo(1.5);
  });

  it('handles a large connected region without overflowing the stack', () => {
    // Iterative flood fill on purpose — a recursive one dies here, and this
    // runs on a phone.
    const width = 120;
    const height = 120;
    const mask: BinaryMask = {
      data: new Array<boolean>(width * height).fill(true),
      width,
      height,
    };
    expect(connectedComponents(mask)).toHaveLength(1);
  });

  it('returns nothing for a blank image', () => {
    expect(connectedComponents(maskFrom(['...', '...']))).toHaveLength(0);
  });
});

describe('threshold', () => {
  it('separates a clearly bimodal image', () => {
    const data = [10, 10, 10, 240, 240, 240];
    const mask = threshold({ data, width: 3, height: 2 });
    expect(mask.data).toEqual([true, true, true, false, false, false]);
  });

  it('picks a cut that separates the two modes', () => {
    // Otsu returns the last level of the BACKGROUND class, so for populations
    // at exactly 20 and 220 the answer is 20 — and `<= 20` is the correct
    // split. Assert the separation rather than the cut value.
    const data = new Array(50).fill(20).concat(new Array(50).fill(220));
    const cut = otsuThreshold({ data, width: 10, height: 10 });
    expect(cut).toBeGreaterThanOrEqual(20);
    expect(cut).toBeLessThan(220);

    const mask = threshold({ data, width: 10, height: 10 }, cut);
    expect(mask.data.slice(0, 50).every(v => v)).toBe(true);
    expect(mask.data.slice(50).every(v => !v)).toBe(true);
  });

  it('adapts the cut to exposure rather than using a fixed level', () => {
    // The reference photos range from warm indoor light to direct glare. A dark
    // crop and a bright crop of the same token must both separate.
    const dark = new Array(50).fill(5).concat(new Array(50).fill(90));
    const bright = new Array(50).fill(150).concat(new Array(50).fill(250));
    expect(otsuThreshold({ data: dark, width: 10, height: 10 })).toBeLessThan(90);
    expect(otsuThreshold({ data: bright, width: 10, height: 10 })).toBeGreaterThan(90);
  });

  it('honours an explicit threshold', () => {
    const data = [100, 200];
    expect(threshold({ data, width: 2, height: 1 }, 150).data).toEqual([true, false]);
  });
});

describe('splitGlyphsAndPips', () => {
  it('separates digits from the smaller pips below them', () => {
    const components = [
      { size: 100, minX: 0, minY: 0, maxX: 9, maxY: 9, cx: 5, cy: 5 },
      { size: 90, minX: 10, minY: 0, maxX: 19, maxY: 9, cx: 15, cy: 5 },
      { size: 8, minX: 4, minY: 12, maxX: 6, maxY: 14, cx: 5, cy: 13 },
      { size: 7, minX: 8, minY: 12, maxX: 10, maxY: 14, cx: 9, cy: 13 },
    ];
    const { glyphs, pips } = splitGlyphsAndPips(components);
    expect(glyphs).toHaveLength(2);
    expect(pips).toHaveLength(2);
  });

  it('splits on area, not position, so rotation does not matter', () => {
    // Pips above the digits (upside-down token) must still read as pips.
    const components = [
      { size: 8, minX: 4, minY: 0, maxX: 6, maxY: 2, cx: 5, cy: 1 },
      { size: 100, minX: 0, minY: 5, maxX: 9, maxY: 14, cx: 5, cy: 10 },
    ];
    const { glyphs, pips } = splitGlyphsAndPips(components);
    expect(glyphs).toHaveLength(1);
    expect(pips).toHaveLength(1);
  });

  it('handles an empty crop', () => {
    expect(splitGlyphsAndPips([])).toEqual({ glyphs: [], pips: [] });
  });

  it('drops speckle below the noise floor', () => {
    const components = [
      { size: 100, minX: 0, minY: 0, maxX: 9, maxY: 9, cx: 5, cy: 5 },
      { size: 1, minX: 20, minY: 20, maxX: 20, maxY: 20, cx: 20, cy: 20 },
    ];
    expect(filterNoise(components, 3)).toHaveLength(1);
  });
});

describe('decodeToken', () => {
  it('decodes every token from its own signature', () => {
    for (const s of TOKEN_SIGNATURES) {
      const reading = decodeToken({
        pipCount: s.pips,
        glyphCount: s.glyphs,
        holeCount: s.holes,
        isRed: s.red,
      });
      expect(reading.value).toBe(s.value);
      expect(reading.confidence).toBe('high');
    }
  });

  it('assigns a unique signature to every token', () => {
    // The whole method rests on this. If two tokens shared a triple, no amount
    // of measurement could tell them apart.
    const keys = TOKEN_SIGNATURES.map(s => `${s.pips}-${s.glyphs}-${s.holes}`);
    expect(new Set(keys).size).toBe(TOKEN_SIGNATURES.length);
  });

  it('separates 6 from 9 by pip count, which rotation cannot change', () => {
    expect(PIPS_BY_VALUE[6]).toBe(5);
    expect(PIPS_BY_VALUE[9]).toBe(4);
    expect(decodeToken({ pipCount: 5, glyphCount: 1, holeCount: 1 }).value).toBe(6);
    expect(decodeToken({ pipCount: 4, glyphCount: 1, holeCount: 1 }).value).toBe(9);
  });

  it('separates 6 from 8 by hole count', () => {
    expect(decodeToken({ pipCount: 5, glyphCount: 1, holeCount: 1 }).value).toBe(6);
    expect(decodeToken({ pipCount: 5, glyphCount: 1, holeCount: 2 }).value).toBe(8);
  });

  it('separates 2 from 12 by glyph count', () => {
    expect(decodeToken({ pipCount: 1, glyphCount: 1, holeCount: 0 }).value).toBe(2);
    expect(decodeToken({ pipCount: 1, glyphCount: 2, holeCount: 0 }).value).toBe(12);
  });

  it('never decodes a 7 — there is no 7 token', () => {
    expect(TOKEN_SIGNATURES.some(s => s.value === 7)).toBe(false);
  });

  it('rejects an impossible pip count', () => {
    const reading = decodeToken({ pipCount: 9, glyphCount: 1, holeCount: 0 });
    expect(reading.value).toBeNull();
    expect(reading.note).toMatch(/pips/i);
  });

  it('still decodes when a filled-in loop loses the hole count', () => {
    // Blur and glare fill loops; pips are large and survive.
    const reading = decodeToken({ pipCount: 1, glyphCount: 1, holeCount: 3 });
    expect(reading.value).toBe(2);
    expect(reading.confidence).toBe('low');
  });

  it('flags a decode whose ink colour disagrees', () => {
    // Counts say 8, but 8 is printed red — a black one means something is off.
    const reading = decodeToken({ pipCount: 5, glyphCount: 1, holeCount: 2, isRed: false });
    expect(reading.value).toBe(8);
    expect(reading.confidence).toBe('low');
    expect(reading.note).toMatch(/colour/i);
  });

  it('declines rather than guesses when 6 and 8 cannot be separated', () => {
    // Both are red with five pips and one glyph; without the hole count there
    // is genuinely nothing left to decide on.
    const reading = decodeToken({ pipCount: 5, glyphCount: 1, holeCount: 7, isRed: true });
    expect(reading.value).toBeNull();
    expect(reading.confidence).toBe('low');
  });
});
