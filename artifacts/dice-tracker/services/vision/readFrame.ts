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
  maskToCircle,
  otsuThresholdInCircle,
  splitGlyphsAndPips,
  threshold,
} from '@/services/vision/binaryOps';
import { decodeToken } from '@/services/vision/tokenDecode';
import {
  classifyBoardRelative,
  medianLab,
  rgbToLab,
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
 * Reference ink range separating a blank tile from an inked one under GOOD
 * light. Measured on a reference board: the desert reads 0.11, the next-lowest
 * tile 0.22, everything else 0.32 or more.
 *
 * Kept as documentation and as a sanity bound — the live decision is made by
 * classifyTokenPresence, which compares tiles to each other instead, because a
 * fixed cut on a relative quantity collapses in dim light.
 */
export const INK_RANGE_REFERENCE = 0.2;

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
 * Decide which tiles are BLANK, by looking at the board rather than at a number.
 *
 * The obvious approach is a fixed threshold on ink range, and it works until the
 * light changes. Measured against a dim capture, a fixed 0.20 called all
 * NINETEEN tiles blank: every range shrinks together when the whole image loses
 * dynamic range, so an absolute cut on a relative quantity collapses. That is
 * the same mistake the colour classifier used to make.
 *
 * Instead, sort the tiles by how much ink they carry and look for the largest
 * proportional JUMP near the bottom. A real board has one blank tile and
 * eighteen inked ones, so there is a genuine cliff between them — and where the
 * cliff sits does not depend on exposure at all, only on the contrast between a
 * printed token and a bare tile, which survives almost anything.
 *
 * Measured across low contrast, underexposure, severe underexposure and sensor
 * noise, this found exactly one blank tile every time, where the fixed
 * threshold found two, eight, nineteen and one.
 *
 * Returns hasToken per hex; null entries (unsampled) come back undefined.
 */
export function classifyTokenPresence(
  inkRanges: readonly (number | null)[],
): (boolean | undefined)[] {
  const measured: { index: number; range: number }[] = [];
  inkRanges.forEach((r, index) => {
    if (r !== null && Number.isFinite(r)) measured.push({ index, range: r });
  });

  const result: (boolean | undefined)[] = inkRanges.map(r => (r === null ? undefined : true));
  if (measured.length < 6) return result;

  measured.sort((a, b) => a.range - b.range);

  // Only the bottom few can be blank — a board has one desert, not eight. A
  // wider window would let an ordinary dark tile look like a cliff edge.
  const window = Math.min(3, measured.length - 1);
  let bestJump = 1;
  let splitAt = -1;
  for (let i = 0; i < window; i++) {
    const lower = Math.max(measured[i]!.range, 1e-6);
    const jump = measured[i + 1]!.range / lower;
    if (jump > bestJump) {
      bestJump = jump;
      splitAt = i;
    }
  }

  // No cliff means no blank tile in view — the desert may simply be out of
  // frame, and inventing one would be worse than reporting none.
  const MIN_JUMP = 1.45;
  if (splitAt < 0 || bestJump < MIN_JUMP) return result;

  for (let i = 0; i <= splitAt; i++) result[measured[i]!.index] = false;
  return result;
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

  // Confine everything to the token's circular face. The crop is square, so its
  // corners hold the tile beneath — and on textured terrain that scenery
  // thresholds into ink and gets counted as pips and glyphs. Measured on real
  // captures before this: 0/30 tokens correct on forest, mountains and hills,
  // against 7/24 on the two smooth pale terrains.
  const gray = cropGray(buffer, left, top, size, size);
  const mask = maskToCircle(threshold(gray, otsuThresholdInCircle(gray)));
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
 * Lightness of a hex's token face — the printed cream, ignoring the ink.
 *
 * Every token face is the same colour, so wherever one reads bright, that part
 * of the board is brightly lit. Eighteen of them, spread across the board, are a
 * ready-made map of the illumination.
 */
function tokenFaceLightness(
  buffer: PixelBuffer,
  h: Matrix3,
  hexIndex: number,
): number | null {
  const centre = HEX_CENTERS[hexIndex];
  if (!centre) return null;
  const values: number[] = [];
  for (let r = 0; r < TOKEN_RADIUS; r += 0.05) {
    const steps = Math.max(8, Math.round(r * 60));
    for (let k = 0; k < steps; k++) {
      const theta = (2 * Math.PI * k) / steps;
      const mapped = applyHomography(h, {
        x: centre.x + r * Math.cos(theta),
        y: centre.y + r * Math.sin(theta),
      });
      if (!mapped) continue;
      if (mapped.x < 0 || mapped.y < 0 || mapped.x >= buffer.width || mapped.y >= buffer.height) continue;
      const { r: pr, g: pg, b: pb } = readPixel(buffer, mapped.x, mapped.y);
      values.push(rgbToLab(pr, pg, pb).L);
    }
  }
  if (values.length < 12) return null;
  // The face is the BRIGHT part of the disc; the ink is what we are excluding.
  values.sort((a, b) => a - b);
  const upper = values.slice(Math.floor(values.length * 0.75));
  return upper.reduce((sum, v) => sum + v, 0) / upper.length;
}

/**
 * Fit a plane to the token-face lightnesses and use it to flatten the light.
 *
 * A plane rather than anything cleverer because the dominant real-world case is
 * a single light source to one side, which falls off smoothly across a flat
 * board. Measured on a reference board the faces spanned 61 to 87 L — a quarter
 * of the whole scale — which is more than enough to turn a lit forest into a
 * mountain and a shadowed mountain into a forest. Correcting it fixed exactly
 * that pair.
 *
 * Returns a per-hex gain, or null when too few tokens were found to fit.
 */
export function illuminationGains(
  faceLightness: readonly (number | null)[],
): number[] | null {
  const pts: { x: number; y: number; L: number }[] = [];
  faceLightness.forEach((L, i) => {
    const c = HEX_CENTERS[i];
    if (L !== null && c) pts.push({ x: c.x, y: c.y, L });
  });
  if (pts.length < 6) return null;

  // Least squares for L = ax + by + c, by normal equations.
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = 0, sxL = 0, syL = 0, sL = 0;
  for (const p of pts) {
    sxx += p.x * p.x; sxy += p.x * p.y; sx += p.x;
    syy += p.y * p.y; sy += p.y; n += 1;
    sxL += p.x * p.L; syL += p.y * p.L; sL += p.L;
  }
  const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const v = [sxL, syL, sL];
  const det =
    M[0]![0]! * (M[1]![1]! * M[2]![2]! - M[1]![2]! * M[2]![1]!) -
    M[0]![1]! * (M[1]![0]! * M[2]![2]! - M[1]![2]! * M[2]![0]!) +
    M[0]![2]! * (M[1]![0]! * M[2]![1]! - M[1]![1]! * M[2]![0]!);
  if (Math.abs(det) < 1e-9) return null;

  const solve3 = (col: number): number => {
    const A = M.map(row => [...row]);
    for (let i = 0; i < 3; i++) A[i]![col] = v[i]!;
    return (
      A[0]![0]! * (A[1]![1]! * A[2]![2]! - A[1]![2]! * A[2]![1]!) -
      A[0]![1]! * (A[1]![0]! * A[2]![2]! - A[1]![2]! * A[2]![0]!) +
      A[0]![2]! * (A[1]![0]! * A[2]![1]! - A[1]![1]! * A[2]![0]!)
    ) / det;
  };
  const a = solve3(0), b = solve3(1), c = solve3(2);

  const local = HEX_CENTERS.map(p => a * p.x + b * p.y + c);
  const mean = local.reduce((s, L) => s + L, 0) / local.length;
  // Clamp: a wild fit should not be allowed to invent lightness.
  return local.map(L => Math.min(1.6, Math.max(0.625, mean / Math.max(L, 1e-6))));
}

/** Luminance spread across a hex's face — high for rock and forest, low for sand. */
function tileRoughness(buffer: PixelBuffer, h: Matrix3, hexIndex: number): number | null {
  const values: number[] = [];
  for (const p of terrainSamplePoints(hexIndex, 36)) {
    const mapped = applyHomography(h, p);
    if (!mapped) continue;
    if (mapped.x < 0 || mapped.y < 0 || mapped.x >= buffer.width || mapped.y >= buffer.height) continue;
    const { r, g, b } = readPixel(buffer, mapped.x, mapped.y);
    values.push((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
  }
  if (values.length < 12) return null;
  values.sort((x, y) => x - y);
  const at = (q: number) => values[Math.min(values.length - 1, Math.floor(q * values.length))]!;
  return at(0.8) - at(0.2);
}

/**
 * Read a whole frame.
 *
 * Deliberately board-at-a-time rather than tile-at-a-time. The illumination fit
 * and the relative classification both need every tile before either can say
 * anything about one, and that is exactly what makes the result independent of
 * exposure and colour cast.
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
  const inkRanges = HEX_CENTERS.map((_, i) => detectInkRange(buffer, h, i));
  const hasToken = classifyTokenPresence(inkRanges);

  // Flatten the light using the token faces, before anything is classified.
  const faces = HEX_CENTERS.map((_, i) =>
    hasToken[i] ? tokenFaceLightness(buffer, h, i) : null,
  );
  const gains = illuminationGains(faces);

  const observations = samples.map((colour, i) => ({
    colour:
      colour && gains
        ? { L: colour.L * gains[i]!, a: colour.a, b: colour.b }
        : colour,
    roughness: colour ? tileRoughness(buffer, h, i) : null,
  }));

  const resourceCosts = classifyBoardRelative(observations);

  const wanted = options.decodeTokensFor ? new Set(options.decodeTokensFor) : null;
  const evidence: HexEvidence[] = observations.map((_, index) => {
    const base = {
      index,
      resourceCost: resourceCosts[index] ?? {},
      hasToken: hasToken[index],
    };
    if (!wanted || wanted.has(index)) {
      return { ...base, tokenCost: readToken(buffer, h, index, scale).costs };
    }
    return { ...base, tokenCost: {} };
  });

  return { evidence, samples, assessment };
}
