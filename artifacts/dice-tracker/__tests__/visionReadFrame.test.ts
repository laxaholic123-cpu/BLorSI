/**
 * End-to-end frame reading against synthetic boards.
 *
 * This is why the Skia import was split out of pixelBuffer.ts: a PixelBuffer is
 * a plain object, so the whole reader — homography, sampling, classification,
 * the frame gate — runs here with no camera and no device.
 */

import { boardTransform, readFrame } from '@/services/vision/readFrame';
import { HEX_CENTERS, terrainSamplePoints } from '@/services/vision/boardGeometry';
import { applyHomography, type Point } from '@/services/vision/homography';
import type { PixelBuffer } from '@/services/vision/pixelBuffer';
import { TERRAIN_REFERENCES } from '@/services/vision/terrainPalette';
import { reconcileBoardFromEvidence, validateBoardComposition } from '@/services/boardConstraints';

const W = 800;
const H = 800;

/**
 * Guide corners, sized so the WHOLE board fits inside the buffer.
 *
 * The corner tiles sit at canonical (+/-1.73, +/-3), but the board extends to
 * about +/-4.26 once the outer hexes' sample rings are included. Placing the
 * corners naively at the edges of the frame pushes hexes 7 and 11 outside the
 * image, and they come back unsampled — which is exactly why the live screen
 * scales its guide by CANONICAL_EXTENT rather than by the corner positions.
 */
const SCALE = 89; // px per canonical unit: 4.26 * 89 ~ 380, comfortably inside 800
const CORNERS: [Point, Point, Point, Point] = [
  { x: 400 - 1.732 * SCALE, y: 400 - 3 * SCALE },
  { x: 400 + 1.732 * SCALE, y: 400 - 3 * SCALE },
  { x: 400 + 1.732 * SCALE, y: 400 + 3 * SCALE },
  { x: 400 - 1.732 * SCALE, y: 400 + 3 * SCALE },
];

/** sRGB for each terrain, round-tripped from the calibrated Lab references. */
const TERRAIN_RGB: Record<string, [number, number, number]> = {
  grain: [179, 143, 63],
  wool: [103, 137, 56],
  lumber: [86, 91, 62],
  brick: [120, 76, 49],
  ore: [144, 145, 145],
  desert: [190, 177, 130],
};

function blankBuffer(fill: [number, number, number] = [10, 10, 10]): PixelBuffer {
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width: W, height: H };
}

function paint(buffer: PixelBuffer, cx: number, cy: number, r: number, rgb: [number, number, number]) {
  const minX = Math.max(0, Math.floor(cx - r));
  const maxX = Math.min(W - 1, Math.ceil(cx + r));
  const minY = Math.max(0, Math.floor(cy - r));
  const maxY = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (Math.hypot(x - cx, y - cy) > r) continue;
      const i = (y * W + x) * 4;
      buffer.data[i] = rgb[0];
      buffer.data[i + 1] = rgb[1];
      buffer.data[i + 2] = rgb[2];
      buffer.data[i + 3] = 255;
    }
  }
}

/** Paint a board whose tiles match the given layout, at the sample positions. */
function paintBoard(layout: string[]): PixelBuffer {
  const buffer = blankBuffer();
  const h = boardTransform(CORNERS)!;
  layout.forEach((terrain, i) => {
    const rgb = TERRAIN_RGB[terrain]!;
    for (const p of terrainSamplePoints(i)) {
      const mapped = applyHomography(h, p);
      if (!mapped) continue;
      paint(buffer, mapped.x, mapped.y, 6, rgb);
    }
  });
  return buffer;
}

const LEGAL_LAYOUT = [
  'desert', 'grain', 'grain', 'grain', 'grain',
  'lumber', 'lumber', 'lumber', 'lumber',
  'wool', 'wool', 'wool', 'wool',
  'ore', 'ore', 'ore',
  'brick', 'brick', 'brick',
];

describe('boardTransform', () => {
  it('maps the four corner tiles onto the guide corners', () => {
    const h = boardTransform(CORNERS)!;
    expect(h).not.toBeNull();
    [0, 2, 18, 16].forEach((hexIndex, i) => {
      const p = applyHomography(h, HEX_CENTERS[hexIndex]!)!;
      expect(p.x).toBeCloseTo(CORNERS[i]!.x, 4);
      expect(p.y).toBeCloseTo(CORNERS[i]!.y, 4);
    });
  });

  it('returns null for a degenerate guide', () => {
    const collapsed: [Point, Point, Point, Point] = [
      { x: 10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 },
    ];
    expect(boardTransform(collapsed)).toBeNull();
  });
});

describe('readFrame', () => {
  it('reads a painted board and classifies every tile', () => {
    const buffer = paintBoard(LEGAL_LAYOUT);
    const reading = readFrame(buffer, CORNERS);

    expect(reading.assessment.usable).toBe(true);
    expect(reading.evidence).toHaveLength(19);
    expect(reading.samples.filter(Boolean)).toHaveLength(19);

    // Every tile's own terrain should be its cheapest option.
    reading.evidence.forEach((ev, i) => {
      const costs = ev.resourceCost as Record<string, number>;
      const cheapest = Object.entries(costs).sort((a, b) => a[1] - b[1])[0]?.[0];
      expect(cheapest).toBe(LEGAL_LAYOUT[i]);
    });
  });

  it('feeds the constraint solver a legal board', () => {
    const reading = readFrame(paintBoard(LEGAL_LAYOUT), CORNERS);
    const { hexes } = reconcileBoardFromEvidence(reading.evidence);
    expect(validateBoardComposition(hexes)).toEqual([]);
  });

  it('recovers the exact layout it was shown', () => {
    const reading = readFrame(paintBoard(LEGAL_LAYOUT), CORNERS);
    const { hexes } = reconcileBoardFromEvidence(reading.evidence);
    hexes.forEach((hex, i) => {
      expect(hex.resource).toBe(LEGAL_LAYOUT[i]);
    });
  });

  it('rejects a frame pointed at nothing', () => {
    const reading = readFrame(blankBuffer([30, 30, 30]), CORNERS);
    expect(reading.assessment.usable).toBe(false);
    expect(reading.evidence).toHaveLength(0);
  });

  it('rejects a uniform surface filling the guide', () => {
    // A table, not a board — every quality signal passes and it is still wrong.
    const reading = readFrame(paintBoard(new Array(19).fill('wool')), CORNERS);
    expect(reading.assessment.usable).toBe(false);
    expect(reading.assessment.reason).toMatch(/point the camera/i);
  });

  it('reports a reason even when it declines', () => {
    // The reason is shown live under the viewfinder.
    for (const buffer of [blankBuffer(), paintBoard(new Array(19).fill('ore'))]) {
      expect(readFrame(buffer, CORNERS).assessment.reason.length).toBeGreaterThan(0);
    }
  });

  it('declines gracefully on a degenerate guide', () => {
    const collapsed: [Point, Point, Point, Point] = [
      { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 },
    ];
    const reading = readFrame(paintBoard(LEGAL_LAYOUT), collapsed);
    expect(reading.evidence).toHaveLength(0);
    expect(reading.assessment.usable).toBe(false);
  });

  it('skips token decoding for hexes the caller did not ask about', () => {
    // The live loop only pays for tokens on tiles that still need them.
    const buffer = paintBoard(LEGAL_LAYOUT);
    const reading = readFrame(buffer, CORNERS, { decodeTokensFor: [0, 1] });
    expect(reading.evidence[5]!.hasToken).toBeUndefined();
    expect(reading.evidence[5]!.tokenCost).toEqual({});
    // The ones it was asked about were looked at, even if nothing was found.
    expect(reading.evidence[0]!.hasToken).toBeDefined();
  });

  it('still samples colour for every hex when tokens are skipped', () => {
    const reading = readFrame(paintBoard(LEGAL_LAYOUT), CORNERS, { decodeTokensFor: [] });
    reading.evidence.forEach(ev => {
      expect(Object.keys(ev.resourceCost).length).toBeGreaterThan(0);
    });
  });
});
