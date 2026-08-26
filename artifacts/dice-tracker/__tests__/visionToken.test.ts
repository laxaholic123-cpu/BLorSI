/**
 * Connected-component labelling.
 *
 * The one binary primitive the reader still uses. `digitSample` leans on it to
 * separate a numeral from the tile crescent around it, so "which pixels form
 * one blob" has to be exactly right — a blob wrongly joined to its neighbour is
 * how a digit gets discarded along with the scenery it touched.
 *
 * Tested against hand-drawn bitmaps rather than photos, because the question is
 * topological and a photo would only add noise to it.
 */

import {
  connectedComponents,
  type BinaryMask,
} from '@/services/vision/binaryOps';

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
