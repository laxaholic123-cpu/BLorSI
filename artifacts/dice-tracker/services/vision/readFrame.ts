/**
 * Read one frame of a board into evidence.
 *
 * Pure — takes a plain PixelBuffer, so the whole reader can be exercised in
 * tests against synthetic images with no camera and no device.
 *
 * This is the join between the pieces: homography places the hexes, colour
 * sampling classifies terrain, the token crop decides whether a tile carries a
 * number and which one, and the result is per-hex COSTS rather than answers.
 * Costs are what let several frames accumulate (evidenceMerge) and what let the
 * constraint solver overrule any individual reading (boardConstraints).
 *
 * Nothing here decides what a tile IS. It only reports what it saw and how
 * strongly. That separation is why a bad frame degrades the board slightly
 * instead of corrupting it.
 */

import type { HexEvidence } from '@/services/boardConstraints';
import { HEX_CENTERS, TOKEN_RADIUS, terrainSamplePoints } from '@/services/vision/boardGeometry';
import { CORNER_HEX_CENTERS } from '@/services/vision/boardGeometry';
import {
  applyHomography,
  solveHomography,
  type Matrix3,
  type Point,
} from '@/services/vision/homography';
import { cropGray, readPixel, type PixelBuffer } from '@/services/vision/pixelBuffer';
import {
  connectedComponents,
  countHoles,
  filterNoise,
  splitGlyphsAndPips,
  threshold,
} from '@/services/vision/binaryOps';
import { decodeToken } from '@/services/vision/tokenDecode';
import {
  medianLab,
  rgbToLab,
  terrainCosts,
  type Lab,
} from '@/services/vision/terrainPalette';
import { shouldMergeFrame, type FrameAssessment } from '@/services/vision/frameQuality';

export interface FrameReading {
  /** Per-hex evidence, ready to merge. Empty when the frame was rejected. */
  evidence: HexEvidence[];
  /** Median colour sampled at each hex, for diagnostics and the frame gate. */
  samples: (Lab | null)[];
  assessment: FrameAssessment;
}

export interface ReadFrameOptions {
  /**
   * Hexes to attempt token reading on. Token decoding costs far more than
   * colour sampling — a connected-component pass per tile against a handful of
   * pixel reads — so a live loop passes only the hexes it still needs, and lets
   * colour run on all nineteen every frame.
   *
   * Undefined means all of them.
   */
  decodeTokensFor?: readonly number[];
}

/** Where the board sits in the image, given the four guide corners. */
export function boardTransform(
  guideCorners: readonly [Point, Point, Point, Point],
): Matrix3 | null {
  return solveHomography(CORNER_HEX_CENTERS, guideCorners);
}

/** Pixels per canonical hex-radius, used to size the token crop. */
function pixelScale(h: Matrix3): number {
  const a = applyHomography(h, HEX_CENTERS[7]!);
  const b = applyHomography(h, HEX_CENTERS[11]!);
  if (!a || !b) return 0;
  const canonicalGap = HEX_CENTERS[11]!.x - HEX_CENTERS[7]!.x;
  return Math.hypot(b.x - a.x, b.y - a.y) / canonicalGap;
}

/** Median terrain colour for one hex, or null when it lies outside the frame. */
function sampleHexColour(
  buffer: PixelBuffer,
  h: Matrix3,
  hexIndex: number,
): Lab | null {
  const samples: Lab[] = [];
  let inside = 0;
  const points = terrainSamplePoints(hexIndex);
  for (const p of points) {
    const mapped = applyHomography(h, p);
    if (!mapped) continue;
    if (mapped.x < 0 || mapped.y < 0 || mapped.x >= buffer.width || mapped.y >= buffer.height) {
      continue;
    }
    inside += 1;
    const { r, g, b } = readPixel(buffer, mapped.x, mapped.y);
    samples.push(rgbToLab(r, g, b));
  }
  // Require most of the ring to be in frame. A hex clipped by the edge would
  // otherwise be classified from the sliver that happened to land inside.
  if (points.length === 0 || inside < points.length * 0.6) return null;
  return medianLab(samples);
}

export interface TokenObservation {
  hasToken: boolean;
  costs: Partial<Record<number, number>>;
}

/**
 * Luminance range below which a tile is considered BLANK — no token.
 *
 * Measured on a reference board: the desert reads 0.11, the next-lowest tile
 * reads 0.22, and everything else 0.32 or more. A 2x margin on a single
 * measurement, so the threshold sits comfortably between.
 */
export const INK_RANGE_THRESHOLD = 0.2;

/**
 * Does this hex carry a number token?
 *
 * Looks for INK, not for the token's shape or its pale face.
 *
 * An earlier version tested "is the centre bright and desaturated" and failed
 * badly — because the desert IS bright and desaturated, so the test could not
 * distinguish the one tile it existed to find. Detecting the printed circle by
 * shape would work but needs real circle-finding.
 *
 * Printed digits and pips are what actually separate them: every token has dark
 * ink on a pale face, giving a wide spread of luminance, while a blank tile —
 * however pale, textured or glared — has no concentrated dark marks and stays
 * comparatively flat. Measuring the SPREAD rather than the level also makes this
 * immune to exposure: a token in shadow and a token under glare both show a
 * large range, and shifting both ends by the same amount changes nothing.
 */
export function detectInkRange(
  buffer: PixelBuffer,
  h: Matrix3,
  hexIndex: number,
): number | null {
  const centre = HEX_CENTERS[hexIndex];
  if (!centre) return null;

  const values: number[] = [];
  // Dense enough that the digits cannot be missed between spokes. Sampling
  // sparsely near the centre reads only the token's blank face and reports a
  // range of zero on a tile that plainly has ink on it.
  for (let r = 0; r < TOKEN_RADIUS; r += 0.025) {
    const steps = Math.max(8, Math.round(r * 90));
    for (let k = 0; k < steps; k++) {
      const theta = (2 * Math.PI * k) / steps;
      const mapped = applyHomography(h, {
        x: centre.x + r * Math.cos(theta),
        y: centre.y + r * Math.sin(theta),
      });
      if (!mapped) continue;
      if (mapped.x < 0 || mapped.y < 0 || mapped.x >= buffer.width || mapped.y >= buffer.height) {
        continue;
      }
      const { r: pr, g: pg, b: pb } = readPixel(buffer, mapped.x, mapped.y);
      values.push((0.2126 * pr + 0.7152 * pg + 0.0722 * pb) / 255);
    }
  }
  if (values.length < 20) return null;

  // Percentiles rather than min/max, so one specular pixel or one dark speck
  // cannot manufacture a range on a blank tile.
  values.sort((a, b) => a - b);
  const at = (q: number) => values[Math.min(values.length - 1, Math.floor(q * values.length))]!;
  return at(0.9) - at(0.1);
}

/**
 * Look at a hex's token: is one there, and which number is it?
 *
 * Presence is answered first and separately, because it survives conditions that
 * defeat the decode — and it is the signal that identifies the desert, which is
 * the tile colour alone is worst at.
 */
function readToken(
  buffer: PixelBuffer,
  h: Matrix3,
  hexIndex: number,
  scale: number,
): TokenObservation {
  const inkRange = detectInkRange(buffer, h, hexIndex);
  if (inkRange === null) return { hasToken: false, costs: {} };
  const hasToken = inkRange >= INK_RANGE_THRESHOLD;
  if (!hasToken) return { hasToken: false, costs: {} };

  const centre = applyHomography(h, HEX_CENTERS[hexIndex]!);
  if (!centre || scale <= 0) return { hasToken: true, costs: {} };

  const radius = TOKEN_RADIUS * scale;
  const size = Math.round(radius * 2);
  if (size < 12) return { hasToken: true, costs: {} };

  const left = centre.x - radius;
  const top = centre.y - radius;
  if (left < 0 || top < 0 || left + size > buffer.width || top + size > buffer.height) {
    return { hasToken: true, costs: {} };
  }

  const mask = threshold(cropGray(buffer, left, top, size, size));
  const minBlob = Math.max(2, Math.round(size * size * 0.0008));
  const components = filterNoise(connectedComponents(mask, true), minBlob);
  if (components.length === 0) return { hasToken: true, costs: {} };

  const { glyphs, pips } = splitGlyphsAndPips(components);
  if (glyphs.length === 0) return { hasToken: true, costs: {} };

  const reading = decodeToken({
    pipCount: pips.length,
    glyphCount: glyphs.length,
    holeCount: countHoles(mask),
  });
  if (reading.value === null) return { hasToken: true, costs: {} };

  const commit = reading.confidence === 'high' ? 2 : 8;
  const costs: Partial<Record<number, number>> = {};
  for (const n of [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]) {
    costs[n] = n === reading.value ? 0 : commit;
  }
  return { hasToken: true, costs };
}

/**
 * Read a whole frame.
 *
 * Returns evidence only when the frame passes the merge gate — a rejected frame
 * still reports its samples and the reason, so the UI can tell the player what
 * to change, but contributes nothing to the board.
 */
export function readFrame(
  buffer: PixelBuffer,
  guideCorners: readonly [Point, Point, Point, Point],
  options: ReadFrameOptions = {},
): FrameReading {
  const h = boardTransform(guideCorners);
  if (!h) {
    return {
      evidence: [],
      samples: new Array(HEX_CENTERS.length).fill(null),
      assessment: { usable: false, coverage: 0, reason: 'Board not in view' },
    };
  }

  const samples = HEX_CENTERS.map((_, i) => sampleHexColour(buffer, h, i));
  const assessment = shouldMergeFrame(samples);
  if (!assessment.usable) return { evidence: [], samples, assessment };

  const scale = pixelScale(h);
  const wanted = options.decodeTokensFor
    ? new Set(options.decodeTokensFor)
    : null;

  const evidence: HexEvidence[] = samples.map((sample, index) => {
    const resourceCost = sample ? terrainCosts(sample) : {};
    if (!wanted || wanted.has(index)) {
      const token = readToken(buffer, h, index, scale);
      return { index, resourceCost, tokenCost: token.costs, hasToken: token.hasToken };
    }
    return { index, resourceCost, tokenCost: {} };
  });

  return { evidence, samples, assessment };
}
