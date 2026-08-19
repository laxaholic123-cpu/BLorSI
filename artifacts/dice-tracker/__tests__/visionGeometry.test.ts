/**
 * Homography and canonical board geometry.
 *
 * These replace the hardest part of reading a board photo — finding the board —
 * with four tapped points, so they need to be exactly right.
 */

import {
  applyHomography,
  solveHomography,
  type Point,
} from '@/services/vision/homography';
import {
  CORNER_HEX_CENTERS,
  CORNER_HEX_INDICES,
  HEX_CENTERS,
  TERRAIN_SAMPLE_INNER,
  TERRAIN_SAMPLE_OUTER,
  TOKEN_RADIUS,
  axialToCanonical,
  hexOutline,
  terrainSamplePoints,
  tokenBounds,
} from '@/services/vision/boardGeometry';
import { HEX_AXIAL, HEX_COUNT } from '@/services/catanBoard';

const close = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) < tol;
const near = (p: Point, x: number, y: number, tol = 1e-6) =>
  close(p.x, x, tol) && close(p.y, y, tol);

describe('solveHomography', () => {
  const unit: readonly [Point, Point, Point, Point] = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
  ];

  it('recovers the identity when source and destination match', () => {
    const h = solveHomography(unit, unit)!;
    expect(h).not.toBeNull();
    for (const p of unit) {
      expect(near(applyHomography(h, p)!, p.x, p.y)).toBe(true);
    }
  });

  it('recovers a pure scale and translation', () => {
    const dst: readonly [Point, Point, Point, Point] = [
      { x: 100, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 400 }, { x: 100, y: 400 },
    ];
    const h = solveHomography(unit, dst)!;
    expect(near(applyHomography(h, { x: 0.5, y: 0.5 })!, 200, 300, 1e-6)).toBe(true);
  });

  it('maps all four corners exactly under perspective', () => {
    // A trapezoid — the shape a board makes when photographed at an angle,
    // which is every photo in the reference set.
    const dst: readonly [Point, Point, Point, Point] = [
      { x: 120, y: 80 }, { x: 900, y: 140 }, { x: 1010, y: 760 }, { x: 40, y: 700 },
    ];
    const h = solveHomography(unit, dst)!;
    for (let i = 0; i < 4; i++) {
      const mapped = applyHomography(h, unit[i]!)!;
      expect(near(mapped, dst[i]!.x, dst[i]!.y, 1e-6)).toBe(true);
    }
  });

  it('round-trips through the inverse mapping', () => {
    const dst: readonly [Point, Point, Point, Point] = [
      { x: 120, y: 80 }, { x: 900, y: 140 }, { x: 1010, y: 760 }, { x: 40, y: 700 },
    ];
    const forward = solveHomography(unit, dst)!;
    const back = solveHomography(dst, unit)!;
    const probe = { x: 0.37, y: 0.62 };
    const there = applyHomography(forward, probe)!;
    const andBack = applyHomography(back, there)!;
    expect(near(andBack, probe.x, probe.y, 1e-6)).toBe(true);
  });

  it('returns null for collinear points rather than nonsense', () => {
    const collinear: readonly [Point, Point, Point, Point] = [
      { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 },
    ];
    expect(solveHomography(collinear, collinear)).toBeNull();
  });

  it('returns null when points coincide', () => {
    const same: readonly [Point, Point, Point, Point] = [
      { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 },
    ];
    expect(solveHomography(same, same)).toBeNull();
  });
});

describe('canonical board geometry', () => {
  it('places all 19 hexes', () => {
    expect(HEX_CENTERS).toHaveLength(HEX_COUNT);
  });

  it('puts the centre hex at the origin', () => {
    const centre = HEX_AXIAL.findIndex(a => a.q === 0 && a.r === 0);
    expect(near(HEX_CENTERS[centre]!, 0, 0)).toBe(true);
  });

  it('spaces neighbouring hexes exactly one hex-width apart', () => {
    // Pointy-top hexes are sqrt(3) apart centre-to-centre.
    const a = axialToCanonical(0, 0);
    const b = axialToCanonical(1, 0);
    expect(close(Math.hypot(b.x - a.x, b.y - a.y), Math.sqrt(3))).toBe(true);
  });

  it('arranges the four corner tiles as a rectangle', () => {
    // This is what makes "tap the middle of each corner tile" well-posed.
    const [tl, tr, br, bl] = CORNER_HEX_CENTERS;
    expect(close(tl.y, tr.y)).toBe(true);
    expect(close(bl.y, br.y)).toBe(true);
    expect(close(tl.x, bl.x)).toBe(true);
    expect(close(tr.x, br.x)).toBe(true);
    expect(tl.y).toBeLessThan(bl.y);
    expect(tl.x).toBeLessThan(tr.x);
  });

  it('uses the actual corner tiles of the 3-4-5-4-3 layout', () => {
    expect([...CORNER_HEX_INDICES].sort((a, b) => a - b)).toEqual([0, 2, 16, 18]);
  });

  it('samples terrain in a ring that clears the number token', () => {
    expect(TERRAIN_SAMPLE_INNER).toBeGreaterThan(TOKEN_RADIUS);
    const points = terrainSamplePoints(9);
    const centre = HEX_CENTERS[9]!;
    for (const p of points) {
      const d = Math.hypot(p.x - centre.x, p.y - centre.y);
      expect(d).toBeGreaterThan(TOKEN_RADIUS);
      expect(d).toBeLessThanOrEqual(TERRAIN_SAMPLE_OUTER + 1e-9);
    }
  });

  it('stays inside the tile when sampling terrain', () => {
    // A hex's inscribed radius is sqrt(3)/2 ~ 0.866.
    expect(TERRAIN_SAMPLE_OUTER).toBeLessThan(Math.sqrt(3) / 2);
  });

  it('takes enough terrain samples to survive texture and glare', () => {
    // Board art is textured — trees, furrows, rock faces — so a single pixel
    // is not a measurement.
    expect(terrainSamplePoints(9).length).toBeGreaterThanOrEqual(16);
  });

  it('boxes the token around the hex centre', () => {
    const [tl, br] = tokenBounds(4)!;
    const centre = HEX_CENTERS[4]!;
    expect(close((tl.x + br.x) / 2, centre.x)).toBe(true);
    expect(close((tl.y + br.y) / 2, centre.y)).toBe(true);
  });

  it('returns null for a hex that does not exist', () => {
    expect(tokenBounds(99)).toBeNull();
    expect(terrainSamplePoints(99)).toEqual([]);
  });

  it('draws a regular hexagon outline', () => {
    const outline = hexOutline(9);
    expect(outline).toHaveLength(6);
    for (const v of outline) {
      expect(close(Math.hypot(v.x, v.y), 1, 1e-9)).toBe(true);
    }
  });
});

describe('geometry through a homography', () => {
  it('turns four tapped corners into every hex centre', () => {
    // A realistic angled photo: the board as a trapezoid in a 1500x2000 image.
    const tapped: readonly [Point, Point, Point, Point] = [
      { x: 420, y: 560 }, { x: 1120, y: 640 }, { x: 1180, y: 1500 }, { x: 300, y: 1400 },
    ];
    const h = solveHomography(CORNER_HEX_CENTERS, tapped)!;
    expect(h).not.toBeNull();

    const mapped = HEX_CENTERS.map(c => applyHomography(h, c)!);
    expect(mapped).toHaveLength(19);
    for (const p of mapped) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }

    // The tapped corners come back exactly where they were tapped.
    CORNER_HEX_INDICES.forEach((hexIndex, i) => {
      expect(near(mapped[hexIndex]!, tapped[i]!.x, tapped[i]!.y, 1e-6)).toBe(true);
    });
  });

  it('keeps interior hexes inside the tapped quadrilateral', () => {
    const tapped: readonly [Point, Point, Point, Point] = [
      { x: 400, y: 500 }, { x: 1100, y: 500 }, { x: 1100, y: 1400 }, { x: 400, y: 1400 },
    ];
    const h = solveHomography(CORNER_HEX_CENTERS, tapped)!;
    const centre = applyHomography(h, HEX_CENTERS[9]!)!;
    expect(centre.x).toBeGreaterThan(400);
    expect(centre.x).toBeLessThan(1100);
    expect(centre.y).toBeGreaterThan(500);
    expect(centre.y).toBeLessThan(1400);
  });
});
