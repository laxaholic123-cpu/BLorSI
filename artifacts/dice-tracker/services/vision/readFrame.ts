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
 * Look at a hex's token circle: is there a token, and which one?
 *
 * The has-a-token answer matters even when the number is unreadable — it is the
 * signal that separates the desert from everything else, and it survives blur
 * that would defeat the decode.
 */
function readToken(
  buffer: PixelBuffer,
  h: Matrix3,
  hexIndex: number,
  scale: number,
): TokenObservation {
  const centre = applyHomography(h, HEX_CENTERS[hexIndex]!);
  if (!centre || scale <= 0) return { hasToken: false, costs: {} };

  const radius = TOKEN_RADIUS * scale;
  const size = Math.round(radius * 2);
  if (size < 12) return { hasToken: false, costs: {} }; // too small to read

  const left = centre.x - radius;
  const top = centre.y - radius;
  if (left < 0 || top < 0 || left + size > buffer.width || top + size > buffer.height) {
    return { hasToken: false, costs: {} };
  }

  const gray = cropGray(buffer, left, top, size, size);
  const mask = threshold(gray);

  // Ink on a token is a small fraction of the crop. A crop that is mostly dark
  // is terrain, not a token — no token means the tile is a desert candidate.
  const inkFraction = mask.data.filter(Boolean).length / mask.data.length;
  if (inkFraction < 0.02 || inkFraction > 0.45) {
    return { hasToken: false, costs: {} };
  }

  const minBlob = Math.max(2, Math.round(size * size * 0.0008));
  const components = filterNoise(connectedComponents(mask, true), minBlob);
  if (components.length === 0) return { hasToken: false, costs: {} };

  const { glyphs, pips } = splitGlyphsAndPips(components);
  if (glyphs.length === 0) return { hasToken: true, costs: {} };

  const holeCount = countHoles(mask);
  const reading = decodeToken({
    pipCount: pips.length,
    glyphCount: glyphs.length,
    holeCount,
  });

  if (reading.value === null) return { hasToken: true, costs: {} };

  // A confident decode is cheap for its own value and expensive for the rest;
  // a shaky one barely commits, which lets a later frame or the constraint
  // solver override it without a fight.
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
