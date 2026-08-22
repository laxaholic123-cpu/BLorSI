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
  it('leaves an unrotated point alone', () => {
    expect(unrotatePoint(0.3, 0.7, 0)).toEqual({ cx: 0.3, cy: 0.7 });
  });

  it('round-trips every quarter turn', () => {
    // The property that matters: whatever the rotation did, undoing it must
    // land back on the original point. A transform that is merely plausible
    // puts numbers on the wrong tiles while looking entirely reasonable.
    const rotate = (cx: number, cy: number, d: 0 | 90 | 180 | 270) => {
      switch (d) {
        case 0: return { cx, cy };
        case 90: return { cx: 1 - cy, cy: cx };
        case 180: return { cx: 1 - cx, cy: 1 - cy };
        case 270: return { cx: cy, cy: 1 - cx };
      }
    };
    for (const d of [0, 90, 180, 270] as const) {
      for (const [x, y] of [[0.1, 0.2], [0.5, 0.5], [0.9, 0.3], [0.25, 0.75]]) {
        const spun = rotate(x, y, d);
        const back = unrotatePoint(spun.cx, spun.cy, d);
        expect(back.cx).toBeCloseTo(x, 10);
        expect(back.cy).toBeCloseTo(y, 10);
      }
    }
  });

  it('keeps the centre fixed under every rotation', () => {
    for (const d of [0, 90, 180, 270] as const) {
      const p = unrotatePoint(0.5, 0.5, d);
      expect(p.cx).toBeCloseTo(0.5, 10);
      expect(p.cy).toBeCloseTo(0.5, 10);
    }
  });

  it('stays inside the unit square', () => {
    for (const d of [0, 90, 180, 270] as const) {
      for (const [x, y] of [[0, 0], [1, 1], [0, 1], [1, 0], [0.33, 0.66]]) {
        const p = unrotatePoint(x, y, d);
        expect(p.cx).toBeGreaterThanOrEqual(0);
        expect(p.cx).toBeLessThanOrEqual(1);
        expect(p.cy).toBeGreaterThanOrEqual(0);
        expect(p.cy).toBeLessThanOrEqual(1);
      }
    }
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
