/**
 * Turn a patch of photo into a digit shape the matcher can use.
 *
 * Four things here were each found by measurement, and each was worth several
 * points on its own. They are documented because every one of them looks like
 * a detail and none of them is.
 *
 * **1. The crop needs PADDING.** It used to be sized at exactly
 * `TOKEN_RADIUS * scale`, and tokens are dropped onto tiles by hand, so any
 * token sitting off-centre ran off the edge of its own crop — 8 of 18 on the
 * reference capture. A clipped token also drags tile into the sampled disc,
 * which is where problem 3 comes from.
 *
 * **2. Find the face by SATURATION, not brightness.** A gold wheat field is as
 * bright as a cream token. Locating by brightness found the face on 5 of 18
 * tokens in one capture and 0 of 18 in another, then silently fell back to a
 * guessed centre — so for a long time almost every token was being read
 * off-centre while appearing to work. Nothing on a Catan tile is both bright
 * and grey except the token face.
 *
 * **3. Drop the rim crescent.** The tile is darker than the face, so any of it
 * inside the sampled disc thresholds as ink, and being the biggest blob it gets
 * mistaken for the digit while the real digit is demoted to a pip. It arrives
 * from OUTSIDE, so it touches the disc boundary; the digit and pips never do.
 *
 * **4. Centre and scale on the DIGIT, not the face.** Print size, camera
 * distance and face-centring all drop out. Sampling the whole face instead is
 * what made an earlier attempt at this score at chance.
 *
 * Pure: takes a PixelBuffer, so it runs in tests with no camera and no device.
 */

import {
  connectedComponents,
  otsuThresholdInDisc,
  type Component,
  type Disc,
  type GrayImage,
} from '@/services/vision/binaryOps';
import {
  DIGIT_RINGS,
  DIGIT_SECTORS,
  packShape,
  type DigitTemplate,
} from '@/services/vision/digitShape';
import { readPixel, type PixelBuffer } from '@/services/vision/pixelBuffer';

/**
 * How much wider than the token to cut the crop.
 *
 * Enough that a token sitting off-centre on its tile is still whole. 1.45 makes
 * every token complete across all seven reference captures; at 1.0 eight of
 * eighteen were clipped.
 */
export const CROP_PADDING = 1.45;

/** The face fills this much of the crop's half-width, by construction. */
const FACE_FRACTION = 1 / CROP_PADDING;

/** Ink is anything at or below Otsu; blobs reaching past this came from tile. */
const RIM_REACH = 0.99;

/** A pip is smaller than this fraction of the largest blob. */
const PIP_SIZE_CUT = 0.5;

/**
 * Saturation below which a bright pixel counts as token FACE rather than tile.
 *
 * This was 0.30 and the face never passed it. Measured across eight captures,
 * the printed cream sits at 0.33-0.37 saturation — it is warm paper under warm
 * light, not neutral grey — so the predicate excluded the very thing it was
 * meant to find. It passed 1-2.5% of each crop, all of it stray pixels, and
 * `locateFaceBySaturation` returned the centroid of THAT. The disc was landing
 * up to 95px from the token in a 323px crop, and the "tile crescent" that cost
 * so much effort was simply a disc centred on nothing in particular.
 *
 * It still read 15 of 18 tokens, which is why this survived so long: the disc
 * was big enough to catch the digit anyway most of the time. Tokens failed when
 * the misplacement happened to put the digit against the disc edge.
 *
 * At 0.45 the face passes (96% of its pixels) and tiles still do not (they sit
 * at 0.53 median). Measured end to end, this alone took every capture to 18/18
 * sampled, references 111/126 -> 126/126, and coverage 86% -> 94% with
 * precision unchanged at 100%. Anything from 0.40 to 0.55 gives the same, so
 * this sits mid-plateau.
 */
const FACE_MAX_SATURATION = 0.45;

export interface SampledDigit {
  /** Packed polar shape, ready for `matchDigit`. */
  bits: Uint32Array;
  /**
   * Whether the ink is warmer than the face it sits on, or undefined when
   * there was too little of either to judge.
   */
  inkIsRed: boolean | undefined;
  /** 6 or 9 as suggested by where the pips sit, or undefined when unclear. */
  pipsSuggest: number | undefined;
  /** False when the face could not be found and a centred guess was used. */
  faceLocated: boolean;
}

/**
 * Locate the token face within a crop, by looking for what is bright AND grey.
 *
 * The centre window matters: pale tile borders are unsaturated too, but they
 * run off the edge of the crop rather than sitting in the middle of it, so
 * restricting to a disc a little larger than the face keeps them out.
 */
export function locateFaceBySaturation(
  buffer: PixelBuffer,
  left: number,
  top: number,
  size: number,
): Disc | null {
  const centre = (size - 1) / 2;
  const reach = (size / 2) * FACE_FRACTION * 1.05;
  const reachSquared = reach * reach;

  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - centre;
      const dy = y - centre;
      if (dx * dx + dy * dy > reachSquared) continue;
      const { r, g, b } = readPixel(buffer, left + x, top + y);
      const max = Math.max(r, g, b);
      if (max <= 127) continue;
      const min = Math.min(r, g, b);
      if ((max - min) / max >= FACE_MAX_SATURATION) continue;
      sumX += x;
      sumY += y;
      count++;
    }
  }
  if (count < 60) return null;
  return {
    cx: sumX / count,
    cy: sumY / count,
    radius: (size / 2) * FACE_FRACTION,
  };
}

/** The centred guess used when the face cannot be found. */
function fallbackFace(size: number): Disc {
  return { cx: (size - 1) / 2, cy: (size - 1) / 2, radius: (size / 2) * FACE_FRACTION };
}

/** Does a component reach past `limit` from the disc centre? */
function reachesBeyond(c: Component, cx: number, cy: number, limit: number): boolean {
  const corners: Array<[number, number]> = [
    [c.minX, c.minY],
    [c.maxX, c.minY],
    [c.minX, c.maxY],
    [c.maxX, c.maxY],
  ];
  let far = 0;
  for (const [x, y] of corners) {
    const d = Math.hypot(x - cx, y - cy);
    if (d > far) far = d;
  }
  return far > limit;
}

/**
 * Is the ink warmer than the paper it sits on?
 *
 * Absolute colour is useless under a warm lamp — the face is printed cream and
 * is already warm — so the question is relative, in the same way the terrain
 * classifier ranks tiles against each other rather than against fixed colours.
 * Undefined when there is too little of either to judge, because an absent
 * signal must leave the reading alone rather than become a coin flip.
 */
function measureInkWarmth(
  buffer: PixelBuffer,
  left: number,
  top: number,
  size: number,
  ink: boolean[],
  inside: boolean[],
): boolean | undefined {
  let inkR = 0, inkG = 0, inkB = 0, inkN = 0;
  let faceR = 0, faceG = 0, faceB = 0, faceN = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!inside[i]) continue;
      const { r, g, b } = readPixel(buffer, left + x, top + y);
      if (ink[i]) {
        inkR += r; inkG += g; inkB += b; inkN++;
      } else {
        faceR += r; faceG += g; faceB += b; faceN++;
      }
    }
  }
  if (inkN < 12 || faceN < 12) return undefined;
  const warmth = (r: number, g: number, b: number, n: number) =>
    r / n - (g / n + b / n) / 2;
  // Generous margin: a false "red" pushes a token towards 6 or 8, and being
  // wrong here is worse than staying silent.
  return warmth(inkR, inkG, inkB, inkN) - warmth(faceR, faceG, faceB, faceN) > 18;
}

/**
 * Which way up is the token, judged by where the pips sit?
 *
 * The pip row is below the digit in the token's own frame, always, so the
 * direction from the digit to the pips is "down". Once that is known, a 6 and a
 * 9 separate: the numeral's ink is heavier on the far side of its own bounding
 * box for one and the near side for the other.
 *
 * This uses only WHERE the pips are. It never counts them — the count is a
 * function of the value and so is already known (`PIPS_BY_VALUE`), and trying
 * to READ it is exactly what put blob counting at half and kept it there.
 */
function pipOrientation(
  digitPixels: Array<[number, number]>,
  pips: Component[],
  dcx: number,
  dcy: number,
  reach: number,
): number | undefined {
  if (pips.length === 0 || digitPixels.length === 0) return undefined;

  let weight = 0;
  let px = 0;
  let py = 0;
  for (const p of pips) {
    px += p.cx * p.size;
    py += p.cy * p.size;
    weight += p.size;
  }
  if (weight <= 0) return undefined;
  px /= weight;
  py /= weight;

  const vx = px - dcx;
  const vy = py - dcy;
  const length = Math.hypot(vx, vy);
  // Too close to the digit's own centre to be a direction rather than noise.
  if (length <= reach * 0.25) return undefined;
  const dx = vx / length;
  const dy = vy / length;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of digitPixels) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const bx = (minX + maxX) / 2;
  const by = (minY + maxY) / 2;

  let projection = 0;
  for (const [x, y] of digitPixels) {
    projection += (x - bx) * dx + (y - by) * dy;
  }
  // A 6 carries its loop at the bottom, a 9 at the top.
  return projection > 0 ? 6 : 9;
}

/**
 * Sample one token into a digit shape, plus the two signals that settle 6 vs 9.
 *
 * `left`/`top`/`size` describe a crop already cut with `CROP_PADDING` around
 * the hex centre. Returns null when there is no usable digit in it — a
 * glare-blown face, a finger, a token that is not there.
 */
export function sampleDigit(
  buffer: PixelBuffer,
  left: number,
  top: number,
  size: number,
): SampledDigit | null {
  if (size < 24) return null;

  const located = locateFaceBySaturation(buffer, left, top, size);
  const faceLocated = located !== null;
  const face = located ?? fallbackFace(size);
  // Pull inside the printed rim, which thresholds as ink along with the digits.
  const digitDisc: Disc = { ...face, radius: face.radius * 0.9 };

  const gray: GrayImage = { data: new Uint8Array(size * size), width: size, height: size };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const { r, g, b } = readPixel(buffer, left + x, top + y);
      (gray.data as Uint8Array)[y * size + x] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
  }

  const cut = otsuThresholdInDisc(gray, digitDisc);
  const digitRadiusSquared = digitDisc.radius * digitDisc.radius;
  // Pips sit nearer the rim than the digit, so they need their own wider disc —
  // the digit's disc is deliberately tight and throws them away.
  const pipRadius = face.radius * 0.98;
  const pipRadiusSquared = pipRadius * pipRadius;

  const insideDigit = new Array<boolean>(size * size).fill(false);
  const inkDigit = new Array<boolean>(size * size).fill(false);
  const inkPip = new Array<boolean>(size * size).fill(false);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = x - digitDisc.cx;
      const dy = y - digitDisc.cy;
      const d2 = dx * dx + dy * dy;
      const isInk = (gray.data[i]! & 0xff) <= cut;
      if (d2 <= digitRadiusSquared) {
        insideDigit[i] = true;
        inkDigit[i] = isInk;
      }
      if (d2 <= pipRadiusSquared) inkPip[i] = isInk;
    }
  }

  const minBlob = Math.max(2, Math.round(size * size * 0.0008));
  const digitBlobs = connectedComponents({ data: inkDigit, width: size, height: size }, true)
    .filter(c => c.size >= minBlob)
    .filter(c => !reachesBeyond(c, digitDisc.cx, digitDisc.cy, digitDisc.radius * RIM_REACH));
  if (digitBlobs.length === 0) return null;

  let largest = 0;
  for (const c of digitBlobs) if (c.size > largest) largest = c.size;
  const glyphs = digitBlobs.filter(c => c.size >= largest * PIP_SIZE_CUT);
  if (glyphs.length === 0) return null;

  // Rebuild a mask holding only the numeral.
  const digitOnly = new Array<boolean>(size * size).fill(false);
  const digitPixels: Array<[number, number]> = [];
  for (const c of glyphs) {
    for (let y = c.minY; y <= c.maxY; y++) {
      for (let x = c.minX; x <= c.maxX; x++) {
        const i = y * size + x;
        if (!inkDigit[i] || digitOnly[i]) continue;
        digitOnly[i] = true;
        digitPixels.push([x, y]);
      }
    }
  }
  if (digitPixels.length < 30) return null;

  let sumX = 0;
  let sumY = 0;
  for (const [x, y] of digitPixels) {
    sumX += x;
    sumY += y;
  }
  const dcx = sumX / digitPixels.length;
  const dcy = sumY / digitPixels.length;
  let reach = 0;
  for (const [x, y] of digitPixels) {
    const d = Math.hypot(x - dcx, y - dcy);
    if (d > reach) reach = d;
  }
  if (reach < 4) return null;

  // Pips: the small blobs, from the wider disc, clear of the numeral itself. A
  // smaller floor than the digit uses, because they are small and the digit's
  // floor was discarding them on more than half the tokens.
  const pipFloor = Math.max(2, Math.round(size * size * 0.0004));
  const pips = connectedComponents({ data: inkPip, width: size, height: size }, true)
    .filter(c => c.size >= pipFloor && c.size < largest * PIP_SIZE_CUT)
    .filter(c => !reachesBeyond(c, face.cx, face.cy, pipRadius * RIM_REACH))
    .filter(c => Math.hypot(c.cx - dcx, c.cy - dcy) >= reach * 0.35);

  const cells = new Array<boolean>(DIGIT_RINGS * DIGIT_SECTORS).fill(false);
  for (let ring = 0; ring < DIGIT_RINGS; ring++) {
    const rr = reach * ((ring + 0.5) / DIGIT_RINGS);
    for (let sector = 0; sector < DIGIT_SECTORS; sector++) {
      const theta = (2 * Math.PI * sector) / DIGIT_SECTORS;
      const x = Math.round(dcx + rr * Math.cos(theta));
      const y = Math.round(dcy + rr * Math.sin(theta));
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      cells[ring * DIGIT_SECTORS + sector] = digitOnly[y * size + x]!;
    }
  }

  return {
    bits: packShape(cells),
    inkIsRed: measureInkWarmth(buffer, left, top, size, digitOnly, insideDigit),
    pipsSuggest: pipOrientation(digitPixels, pips, dcx, dcy, reach),
    faceLocated,
  };
}

/** Build a template from a sampled digit, for a learned library. */
export function templateFrom(value: number, sample: SampledDigit): DigitTemplate {
  return { value, bits: sample.bits };
}
