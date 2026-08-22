/**
 * Unit tests for mapping recognised text onto hexes.
 *
 * The risk here is not that OCR misreads a digit — that shows up as a wrong
 * number a player can see and correct. The risk is the geometry silently
 * assigning a correctly-read number to the wrong tile, which looks completely
 * plausible and poisons every luck figure downstream. That is the failure mode
 * this file exists to pin.
 */

import {
  mapOcrToHexes,
  parseTokenText,
  disambiguateWithInk,
  unrotatePoint,
  rotatedSize,
  mergeRotatedTexts,
  VALID_TOKENS,
  type OcrText,
} from '../services/vision/ocrTokens';
import { HEX_CENTERS, CORNER_HEX_CENTERS } from '../services/vision/boardGeometry';
import { solveHomography, applyHomography, type Point } from '../services/vision/homography';

/**
 * Put the canonical board into a unit square, as a photo of it would.
 *
 * Built by solving the same homography the reader uses, so a token placed at a
 * hex centre here lands exactly where the reader would look for it.
 */
function unitSquareCorners(): [Point, Point, Point, Point] {
  const xs = HEX_CENTERS.map(p => p.x);
  const ys = HEX_CENTERS.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 0.12;
  const toUnit = (p: Point): Point => ({
    x: pad + ((p.x - minX) / (maxX - minX)) * (1 - 2 * pad),
    y: pad + ((p.y - minY) / (maxY - minY)) * (1 - 2 * pad),
  });
  return (CORNER_HEX_CENTERS as unknown as Point[]).map(toUnit) as [Point, Point, Point, Point];
}

const CORNERS = unitSquareCorners();

/** Where hex `i` lands in that normalised image. */
function hexAt(i: number): Point {
  const h = solveHomography(CORNER_HEX_CENTERS as unknown as readonly [Point, Point, Point, Point], CORNERS)!;
  return applyHomography(h, HEX_CENTERS[i]!)!;
}

const at = (i: number, text: string): OcrText => {
  const p = hexAt(i);
  return { text, cx: p.x, cy: p.y };
};

describe('parseTokenText', () => {
  it('accepts every value the deck contains', () => {
    for (const v of VALID_TOKENS) expect(parseTokenText(String(v))).toBe(v);
  });

  it('rejects 7, which has no token', () => {
    expect(parseTokenText('7')).toBeNull();
  });

  it('rejects harbour ratios', () => {
    // A board is covered in "2:1" and "3:1". Generous parsing would turn those
    // into 2s and 3s scattered around the coast.
    expect(parseTokenText('2:1')).toBeNull();
    expect(parseTokenText('3:1')).toBeNull();
    expect(parseTokenText('2 : 1')).toBeNull();
  });

  it('rejects anything that is not a bare number', () => {
    for (const junk of ['', ' ', 'S', '1O', '10a', '112', '-4', '4.5']) {
      expect(parseTokenText(junk)).toBeNull();
    }
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseTokenText('  11 ')).toBe(11);
  });
});

describe('mapOcrToHexes', () => {
  it('puts each number on the hex it sits over', () => {
    const readings = mapOcrToHexes(
      [at(0, '4'), at(9, '6'), at(18, '9'), at(13, '11')],
      CORNERS,
    );
    expect(readings.map(r => [r.hexIndex, r.value])).toEqual([
      [0, 4], [9, 6], [13, 11], [18, 9],
    ]);
  });

  it('assigns nothing when text sits between tiles', () => {
    // Better to leave a hex unread than to guess: a missing number is visible
    // and correctable, a wrong one is neither.
    const a = hexAt(7);
    const b = hexAt(8);
    const between: OcrText = { text: '5', cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    expect(mapOcrToHexes([between], CORNERS)).toEqual([]);
  });

  it('ignores text well outside the board', () => {
    expect(mapOcrToHexes([{ text: '8', cx: 0.02, cy: 0.02 }], CORNERS)).toEqual([]);
  });

  it('keeps the closer reading when two land on one hex', () => {
    // A recogniser that splits "10" into "1" and "0" leaves a fragment adrift.
    const p = hexAt(4);
    const readings = mapOcrToHexes(
      [
        { text: '10', cx: p.x, cy: p.y },
        { text: '3', cx: p.x + 0.012, cy: p.y + 0.012 },
      ],
      CORNERS,
    );
    expect(readings).toHaveLength(1);
    expect(readings[0]!.value).toBe(10);
  });

  it('drops unparseable text before it can be placed', () => {
    expect(mapOcrToHexes([at(5, '2:1'), at(6, '7')], CORNERS)).toEqual([]);
  });

  it('returns nothing rather than throwing on degenerate corners', () => {
    const same = { x: 0.5, y: 0.5 };
    expect(mapOcrToHexes([at(0, '4')], [same, same, same, same])).toEqual([]);
  });

  it('never reports a hex outside the board', () => {
    const readings = mapOcrToHexes(
      HEX_CENTERS.map((_, i) => at(i, '8')),
      CORNERS,
    );
    for (const r of readings) {
      expect(r.hexIndex).toBeGreaterThanOrEqual(0);
      expect(r.hexIndex).toBeLessThan(19);
    }
  });
});

describe('disambiguateWithInk', () => {
  it('turns a black 6 into a 9 and a red 9 into a 6', () => {
    // The one thing reading the glyph can never settle: upside down, they are
    // the same shape. Colour settles it outright — 6 and 8 are the only red
    // tokens in the deck.
    expect(disambiguateWithInk(6, false)).toBe(9);
    expect(disambiguateWithInk(9, true)).toBe(6);
  });

  it('leaves a correctly coloured reading alone', () => {
    expect(disambiguateWithInk(6, true)).toBe(6);
    expect(disambiguateWithInk(9, false)).toBe(9);
  });

  it('changes nothing when the ink could not be judged', () => {
    // An absent signal must not become a guess.
    expect(disambiguateWithInk(6, undefined)).toBe(6);
    expect(disambiguateWithInk(9, undefined)).toBe(9);
  });

  it('does not touch tokens the ambiguity cannot apply to', () => {
    for (const v of [2, 3, 4, 5, 8, 10, 11, 12]) {
      expect(disambiguateWithInk(v, true)).toBe(v);
      expect(disambiguateWithInk(v, false)).toBe(v);
    }
  });
});

describe('unrotatePoint', () => {
  const SIZE = { width: 400, height: 300 };

  /** Forward transform: where a point lands after turning clockwise. */
  function rotateForward(x: number, y: number, deg: number) {
    const t = (deg * Math.PI) / 180;
    const cos = Math.cos(t), sin = Math.sin(t);
    const out = rotatedSize(SIZE, deg);
    const dx = x - SIZE.width / 2;
    const dy = y - SIZE.height / 2;
    return {
      x: dx * cos - dy * sin + out.width / 2,
      y: dx * sin + dy * cos + out.height / 2,
    };
  }

  it('round-trips at every angle the sweep uses', () => {
    // The property that matters. A transform that is merely plausible puts
    // numbers on the wrong tiles while looking entirely reasonable, and no
    // score sheet would reveal it.
    for (const deg of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const out = rotatedSize(SIZE, deg);
      for (const [x, y] of [[10, 10], [200, 150], [399, 299], [50, 250]]) {
        const spun = rotateForward(x, y, deg);
        const back = unrotatePoint(spun.x, spun.y, deg, out, SIZE);
        expect(back.x).toBeCloseTo(x, 6);
        expect(back.y).toBeCloseTo(y, 6);
      }
    }
  });

  it('keeps the centre at the centre', () => {
    for (const deg of [0, 45, 90, 180, 270, 315]) {
      const out = rotatedSize(SIZE, deg);
      const back = unrotatePoint(out.width / 2, out.height / 2, deg, out, SIZE);
      expect(back.x).toBeCloseTo(SIZE.width / 2, 6);
      expect(back.y).toBeCloseTo(SIZE.height / 2, 6);
    }
  });

  it('is the identity at zero degrees', () => {
    const back = unrotatePoint(123, 45, 0, SIZE, SIZE);
    expect(back.x).toBeCloseTo(123, 10);
    expect(back.y).toBeCloseTo(45, 10);
  });
});

describe('rotatedSize', () => {
  it('swaps the axes on a quarter turn', () => {
    const r = rotatedSize({ width: 400, height: 300 }, 90);
    expect(r.width).toBeCloseTo(300, 6);
    expect(r.height).toBeCloseTo(400, 6);
  });

  it('leaves a half turn the same shape', () => {
    const r = rotatedSize({ width: 400, height: 300 }, 180);
    expect(r.width).toBeCloseTo(400, 6);
    expect(r.height).toBeCloseTo(300, 6);
  });

  it('grows both dimensions on a diagonal turn', () => {
    // This is why the mapping cannot work in normalised space: at 45 degrees
    // the canvas expands and the two frames stop sharing a scale.
    const r = rotatedSize({ width: 100, height: 100 }, 45);
    expect(r.width).toBeCloseTo(Math.SQRT2 * 100, 4);
    expect(r.height).toBeCloseTo(Math.SQRT2 * 100, 4);
  });
});

describe('mergeRotatedTexts', () => {
  it('collapses the same token found in several passes', () => {
    // Four passes over one board must not report four boards.
    const merged = mergeRotatedTexts([
      [{ text: '9', cx: 0.5, cy: 0.5 }],
      [{ text: '9', cx: 0.502, cy: 0.499 }],
      [{ text: '9', cx: 0.5, cy: 0.501 }],
    ]);
    expect(merged).toHaveLength(1);
  });

  it('keeps tokens that are genuinely in different places', () => {
    const merged = mergeRotatedTexts([
      [{ text: '9', cx: 0.2, cy: 0.2 }],
      [{ text: '4', cx: 0.8, cy: 0.8 }],
    ]);
    expect(merged).toHaveLength(2);
  });

  it('prefers the earlier pass, which is the untransformed one', () => {
    const merged = mergeRotatedTexts([
      [{ text: 'first', cx: 0.4, cy: 0.4 }],
      [{ text: 'second', cx: 0.401, cy: 0.4 }],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.text).toBe('first');
  });

  it('handles empty passes without losing the rest', () => {
    // A rotation that fails or finds nothing must not discard the others.
    const merged = mergeRotatedTexts([[], [{ text: '8', cx: 0.3, cy: 0.3 }], []]);
    expect(merged).toHaveLength(1);
  });
});
