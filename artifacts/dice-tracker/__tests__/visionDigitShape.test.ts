/**
 * Unit tests for matching a token's digit against examples of it.
 *
 * Accuracy is measured on real photos, not here — `tools/digit_match_probe.py`
 * and `tools/port_check.mjs` do that. What these protect is the handful of
 * properties the approach RESTS on, each of which would fail silently:
 *
 *   1. Bit packing round-trips. A shape that unpacks wrong would still match
 *      something, just the wrong thing, and the failure would look like poor
 *      recognition rather than a corrupt library.
 *   2. A turned token still matches. Rotation is the whole reason for polar
 *      sampling, and the 64-bit rotate is done in 32-bit halves where `>>> 32`
 *      is a no-op rather than zero — the exact shape of bug that reads fine and
 *      corrupts every ring.
 *   3. An ambiguous face reports a narrow margin instead of a confident answer.
 *   4. 6 and 9 are never guessed at when the two orientation signals disagree.
 */

import {
  ACCEPT_SCORE,
  DIGIT_CELLS,
  DIGIT_SECTORS,
  DIGIT_WORDS,
  isTrustworthy,
  matchDigit,
  packShape,
  resolveSixNine,
  rotateShape,
  similarity,
  unpackShape,
  type DigitTemplate,
} from '../services/vision/digitShape';
import { TOKEN_TEMPLATES, TEMPLATES_ARE_WELL_FORMED } from '../services/vision/tokenLibrary';

/** A reproducible pseudo-digit: ink over a minority of the grid, as print is. */
function makeCells(seed: number, density = 0.22): boolean[] {
  const cells = new Array<boolean>(DIGIT_CELLS).fill(false);
  let x = seed * 2654435761;
  for (let i = 0; i < DIGIT_CELLS; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    cells[i] = x / 0x7fffffff < density;
  }
  return cells;
}

describe('packing', () => {
  it('round-trips through pack and unpack', () => {
    const cells = makeCells(1);
    const packed = packShape(cells);
    expect(packed.length).toBe(DIGIT_WORDS);
    // Repacking what we unpacked from the same words must be identical.
    expect(Array.from(packShape(cells))).toEqual(Array.from(packed));
  });

  it('sets the bit the generator meant', () => {
    const cells = new Array<boolean>(DIGIT_CELLS).fill(false);
    cells[0] = true;
    // Big-endian within the word, matching tools/emit_library.py.
    expect(packShape(cells)[0]).toBe(0x80000000 >>> 0);

    const last = new Array<boolean>(DIGIT_CELLS).fill(false);
    last[31] = true;
    expect(packShape(last)[0]).toBe(1);
  });

  it('decodes base64 without depending on atob', () => {
    const cells = makeCells(2);
    const packed = packShape(cells);
    // Encode exactly as the generator does, then read it back.
    const bytes: number[] = [];
    for (const word of packed) {
      bytes.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
    }
    const b64 = Buffer.from(Uint8Array.from(bytes)).toString('base64');
    expect(Array.from(unpackShape(b64))).toEqual(Array.from(packed));
  });
});

describe('rotateShape', () => {
  it('returns to the original after a full turn', () => {
    const bits = packShape(makeCells(3));
    expect(Array.from(rotateShape(bits, DIGIT_SECTORS))).toEqual(Array.from(bits));
  });

  it('leaves a zero shift untouched', () => {
    // `>>> 32` is a no-op in JavaScript rather than zero, so the zero case is
    // handled separately. If that ever regresses every ring silently doubles.
    const bits = packShape(makeCells(4));
    expect(Array.from(rotateShape(bits, 0))).toEqual(Array.from(bits));
  });

  it('composes: rotating by a then b equals rotating by a+b', () => {
    const bits = packShape(makeCells(5));
    for (const [a, b] of [[1, 1], [7, 25], [31, 1], [32, 32], [33, 40], [63, 1]]) {
      expect(Array.from(rotateShape(rotateShape(bits, a!), b!)))
        .toEqual(Array.from(rotateShape(bits, a! + b!)));
    }
  });

  it('is exact across the 32-bit word boundary', () => {
    // One bit at sector 0 of ring 0, walked all the way round.
    for (let shift = 0; shift < DIGIT_SECTORS; shift++) {
      const cells = new Array<boolean>(DIGIT_CELLS).fill(false);
      cells[shift] = true;
      const turned = rotateShape(packShape(cells), shift);
      const expected = new Array<boolean>(DIGIT_CELLS).fill(false);
      expected[0] = true;
      expect(Array.from(turned)).toEqual(Array.from(packShape(expected)));
    }
  });

  it('handles negative shifts', () => {
    const bits = packShape(makeCells(6));
    expect(Array.from(rotateShape(rotateShape(bits, -7), 7))).toEqual(Array.from(bits));
  });
});

describe('similarity', () => {
  it('is 1 for identical shapes and 0 for inverted ones', () => {
    const cells = makeCells(7);
    const bits = packShape(cells);
    expect(similarity(bits, bits)).toBe(1);
    expect(similarity(bits, packShape(cells.map(c => !c)))).toBe(0);
  });

  it('refuses mismatched lengths rather than guessing', () => {
    expect(similarity(new Uint32Array(2), new Uint32Array(DIGIT_WORDS))).toBe(0);
  });
});

describe('matchDigit', () => {
  const library: DigitTemplate[] = [
    { value: 3, bits: packShape(makeCells(10)) },
    { value: 5, bits: packShape(makeCells(11)) },
    { value: 8, bits: packShape(makeCells(12)) },
  ];

  it('finds the right value when the token is upright', () => {
    const match = matchDigit(library[1]!.bits, library)!;
    expect(match.value).toBe(5);
    expect(match.score).toBe(1);
  });

  it('finds the right value at EVERY rotation', () => {
    // The property the whole approach rests on: tokens are dropped onto tiles
    // at arbitrary angles, and orientation is what defeated OCR entirely.
    for (let shift = 0; shift < DIGIT_SECTORS; shift++) {
      const match = matchDigit(rotateShape(library[2]!.bits, shift), library)!;
      expect(match.value).toBe(8);
      expect(match.score).toBe(1);
    }
  });

  it('reports a wide margin when one value clearly wins', () => {
    const match = matchDigit(library[0]!.bits, library)!;
    expect(match.margin).toBeGreaterThan(0.1);
    expect(isTrustworthy(match)).toBe(true);
  });

  it('reports a narrow margin when two values look alike', () => {
    // The case that matters. A face matching two values almost equally has said
    // nothing, however high the winning score is — and acting on it is how a
    // confident wrong number reaches a player's board.
    const shared = makeCells(20);
    const nearly = [...shared];
    for (let i = 0; i < 20; i++) nearly[i] = !nearly[i];
    const confusable: DigitTemplate[] = [
      { value: 6, bits: packShape(shared) },
      { value: 8, bits: packShape(nearly) },
    ];
    const match = matchDigit(packShape(shared), confusable)!;
    expect(match.score).toBe(1);
    expect(match.margin).toBeLessThan(0.05);
  });

  it('compares the margin against a different VALUE, not another template', () => {
    // Two examples of the same 5 scoring closely says nothing about ambiguity.
    const bits = packShape(makeCells(11));
    const twin = [...makeCells(11)];
    twin[0] = !twin[0];
    const withTwin: DigitTemplate[] = [...library, { value: 5, bits: packShape(twin) }];
    const match = matchDigit(bits, withTwin)!;
    expect(match.value).toBe(5);
    expect(match.margin).toBeGreaterThan(0.1);
  });

  it('returns null rather than inventing a value from an empty library', () => {
    expect(matchDigit(packShape(makeCells(9)), [])).toBeNull();
  });

  it('ignores a malformed template instead of throwing', () => {
    const broken: DigitTemplate[] = [{ value: 4, bits: new Uint32Array(2) }, library[0]!];
    expect(matchDigit(library[0]!.bits, broken)!.value).toBe(3);
  });
});

describe('resolveSixNine', () => {
  it('leaves every other value alone', () => {
    for (const v of [2, 3, 4, 5, 8, 10, 11, 12]) {
      expect(resolveSixNine(v, undefined, undefined)).toBe(v);
      expect(resolveSixNine(v, true, 9)).toBe(v);
    }
  });

  it('lets ink decide when it is the only signal', () => {
    expect(resolveSixNine(9, true, undefined)).toBe(6);
    expect(resolveSixNine(6, false, undefined)).toBe(9);
  });

  it('lets the pips decide when ink cannot judge', () => {
    // Colour-blind, so it survives lighting that defeats the ink test.
    expect(resolveSixNine(9, undefined, 6)).toBe(6);
    expect(resolveSixNine(6, undefined, 9)).toBe(9);
  });

  it('agrees with itself when both signals agree', () => {
    expect(resolveSixNine(9, true, 6)).toBe(6);
    expect(resolveSixNine(6, false, 9)).toBe(9);
  });

  it('declines rather than guessing when the signals disagree', () => {
    // The single most important behaviour in this file. A wrong number is
    // invisible and skews the stats; a declined one costs one tap.
    expect(resolveSixNine(6, true, 9)).toBeNull();
    expect(resolveSixNine(9, false, 6)).toBeNull();
  });

  it('keeps the matched value when neither signal is available', () => {
    expect(resolveSixNine(6, undefined, undefined)).toBe(6);
  });
});

describe('the bundled library', () => {
  it('loads and is well formed', () => {
    expect(TEMPLATES_ARE_WELL_FORMED).toBe(true);
    expect(TOKEN_TEMPLATES.length).toBeGreaterThan(100);
  });

  it('covers every token value in the deck', () => {
    const values = new Set(TOKEN_TEMPLATES.map(t => t.value));
    for (const v of [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]) {
      expect(values.has(v)).toBe(true);
    }
    // 7 has no token, so an example of one means the harvest went wrong.
    expect(values.has(7)).toBe(false);
  });

  it('holds templates with actual ink in them', () => {
    // A library of empty shapes would match everything at a high score and
    // quietly turn the accept threshold into a random number generator.
    for (const t of TOKEN_TEMPLATES) {
      const set = Array.from(t.bits).reduce(
        (n, w) => n + (w.toString(2).match(/1/g)?.length ?? 0), 0);
      expect(set).toBeGreaterThan(20);
      expect(set).toBeLessThan(DIGIT_CELLS - 20);
    }
  });

  it('uses an accept threshold on the measured plateau', () => {
    expect(ACCEPT_SCORE).toBeGreaterThanOrEqual(0.91);
    expect(ACCEPT_SCORE).toBeLessThanOrEqual(0.94);
  });
});
