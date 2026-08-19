/**
 * Canonical board space — where every hex and token sits on an idealised board.
 *
 * Pure geometry. Combined with a homography (see homography.ts) this turns four
 * tapped points into the pixel location of all 19 hex centres and all 19 number
 * tokens, with no image analysis at all.
 *
 * Units are hex radii: a hex is 1 unit from centre to vertex. The board is
 * centred on the origin, +x right and +y down, matching image coordinates.
 */

import { HEX_AXIAL, HEX_COUNT } from '@/services/catanBoard';
import type { Point } from '@/services/vision/homography';

/** Pointy-top axial → cartesian, in units of hex radius. */
export function axialToCanonical(q: number, r: number): Point {
  return {
    x: Math.sqrt(3) * (q + r / 2),
    y: 1.5 * r,
  };
}

/** Centre of every hex, indexed 0–18, in canonical space. */
export const HEX_CENTERS: readonly Point[] = HEX_AXIAL.map(a => axialToCanonical(a.q, a.r));

/**
 * The four corner tiles, in the order a player would naturally tap them:
 * top-left, top-right, bottom-right, bottom-left.
 *
 * These four centres form a RECTANGLE in canonical space (x = ±√3, y = ±3),
 * which is what makes "tap the middle of each corner tile" a well-posed
 * instruction — any four points of a rectangle determine the perspective.
 */
export const CORNER_HEX_INDICES = [0, 2, 18, 16] as const;

export const CORNER_HEX_CENTERS = CORNER_HEX_INDICES.map(i => HEX_CENTERS[i]!) as unknown as
  readonly [Point, Point, Point, Point];

/**
 * Radius of the number-token circle, as a fraction of the hex radius.
 *
 * Measured off the reference photos: the token is a little under half the
 * hex's inscribed circle. Sampling inside this radius gets token, sampling
 * outside it gets terrain.
 */
export const TOKEN_RADIUS = 0.42;

/**
 * Where to sample terrain colour: an annulus around the hex centre that clears
 * the number token but stays inside the tile.
 *
 * The token sits dead centre, so the naive "sample the middle" reads the cream
 * of the token on every numbered hex — which is why this is an annulus and not
 * a disc.
 */
export const TERRAIN_SAMPLE_INNER = 0.55;
export const TERRAIN_SAMPLE_OUTER = 0.80;

/** Evenly spaced offsets on a circle of the given radius, in canonical units. */
export function ringOffsets(radius: number, count: number): Point[] {
  return Array.from({ length: count }, (_, i) => {
    const theta = (2 * Math.PI * i) / count;
    return { x: radius * Math.cos(theta), y: radius * Math.sin(theta) };
  });
}

/**
 * Canonical sample points for a hex's terrain — two rings in the clear annulus.
 *
 * Multiple samples rather than one because board art is textured (trees, furrows,
 * rock faces) and a single pixel can land on an outlier. The caller takes a
 * median, which is robust to a few samples falling on a tree trunk or a glare
 * highlight.
 */
export function terrainSamplePoints(hexIndex: number, perRing = 12): Point[] {
  const centre = HEX_CENTERS[hexIndex];
  if (!centre) return [];
  const points: Point[] = [];
  for (const radius of [TERRAIN_SAMPLE_INNER, TERRAIN_SAMPLE_OUTER]) {
    for (const offset of ringOffsets(radius, perRing)) {
      points.push({ x: centre.x + offset.x, y: centre.y + offset.y });
    }
  }
  return points;
}

/**
 * Canonical bounding box of a hex's number token, as [topLeft, bottomRight].
 * The caller warps these through the homography to crop the token from the photo.
 */
export function tokenBounds(hexIndex: number): [Point, Point] | null {
  const centre = HEX_CENTERS[hexIndex];
  if (!centre) return null;
  return [
    { x: centre.x - TOKEN_RADIUS, y: centre.y - TOKEN_RADIUS },
    { x: centre.x + TOKEN_RADIUS, y: centre.y + TOKEN_RADIUS },
  ];
}

/** A regular pointy-top hexagon's six vertices, for drawing an overlay. */
export function hexOutline(hexIndex: number): Point[] {
  const centre = HEX_CENTERS[hexIndex];
  if (!centre) return [];
  return Array.from({ length: 6 }, (_, i) => {
    const theta = (Math.PI / 180) * (60 * i - 90);
    return { x: centre.x + Math.cos(theta), y: centre.y + Math.sin(theta) };
  });
}

export { HEX_COUNT };
