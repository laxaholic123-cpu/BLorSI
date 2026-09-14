/**
 * Take the colour of the light out of the photo, using the number tokens.
 *
 * Reported from a device: under golden light hitting the board, tiles read
 * wrong and the harbours read wrong. The existing correction,
 * `illuminationGains`, fits LIGHTNESS only and leaves colour alone — so a warm
 * cast went straight through to every classifier. Measured on the ten reference
 * captures with a simulated warm cast (`tools/light_probe.py`): harbour
 * positions fell from 90/90 to 48/90 under a mild cast, and number tokens from
 * 126/126 to 37/126 (`tools/light_read_check.mjs`).
 *
 * THE TOKENS ARE THE WHITE REFERENCE. Every number token is the same printed
 * cream, there are eighteen of them spread across the board, and each one sits
 * under exactly the light that falls on its own tile. So the correction is
 * LOCAL: a sunbeam across one side of the board is taken out on that side and
 * left alone on the other. A single global white balance cannot do that, and a
 * sunbeam or a lamp to one side is the realistic case — light the same colour
 * everywhere mostly cancels anyway, because the terrain classifier compares
 * tiles with each other.
 *
 * Token presence is decided on the uncorrected pixels, by ink contrast, which a
 * colour cast barely moves. The desert has no token and is skipped rather than
 * mistaken for a very yellow one.
 */

import { HEX_CENTERS } from '@/services/vision/boardGeometry';
import { applyHomography, type Matrix3, type Point } from '@/services/vision/homography';
import type { PixelBuffer } from '@/services/vision/pixelBuffer';
import {
  boardTransform,
  classifyTokenPresence,
  detectInkRange,
} from '@/services/vision/readFrame';

/** One token's measured white: where it is, and the gain that neutralises it. */
export interface FaceWhite {
  x: number;
  y: number;
  gain: [number, number, number];
}

/** Radius sampled around a hex centre, in hex radii — inside the token face. */
const FACE_RADIUS = 0.3;

/**
 * Fewer usable faces than this and there is nothing trustworthy to correct
 * from; the photo is returned untouched rather than bent by a bad fit.
 */
export const MIN_FACES = 6;

/** A gain outside this range is a bad sample, not a light. */
const GAIN_MIN = 0.5;
const GAIN_MAX = 2;

const clampGain = (g: number) => Math.min(GAIN_MAX, Math.max(GAIN_MIN, g));

/** Sample points across a token face, in canonical offsets from the centre. */
const FACE_OFFSETS: Point[] = (() => {
  const out: Point[] = [];
  for (let i = 0; i < 11; i++) {
    for (let j = 0; j < 11; j++) {
      const x = -FACE_RADIUS + (2 * FACE_RADIUS * i) / 10;
      const y = -FACE_RADIUS + (2 * FACE_RADIUS * j) / 10;
      if (x * x + y * y <= FACE_RADIUS * FACE_RADIUS) out.push({ x, y });
    }
  }
  return out;
})();

/**
 * The white of every token face that is actually there.
 *
 * Uses the BRIGHT quarter of each face's pixels: the face is cream and the
 * digit is ink, and the ink is exactly what must not be averaged into a white.
 */
export function tokenFaceWhites(
  buf: PixelBuffer,
  toImage: Matrix3,
  hasToken: readonly (boolean | undefined)[],
): FaceWhite[] {
  const out: FaceWhite[] = [];
  HEX_CENTERS.forEach((centre, i) => {
    if (!hasToken[i]) return;
    const px: [number, number, number][] = [];
    for (const o of FACE_OFFSETS) {
      const p = applyHomography(toImage, { x: centre.x + o.x, y: centre.y + o.y });
      if (!p) continue;
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) continue;
      const k = (y * buf.width + x) * 4;
      px.push([buf.data[k]!, buf.data[k + 1]!, buf.data[k + 2]!]);
    }
    if (px.length < 12) return;
    px.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
    const top = px.slice(Math.floor(px.length * 0.75));
    let r = 0, g = 0, b = 0;
    for (const [pr, pg, pb] of top) { r += pr; g += pg; b += pb; }
    r = Math.max(1, r / top.length);
    g = Math.max(1, g / top.length);
    b = Math.max(1, b / top.length);
    const grey = (r + g + b) / 3;
    const at = applyHomography(toImage, centre);
    if (!at) return;
    out.push({ x: at.x, y: at.y, gain: [clampGain(grey / r), clampGain(grey / g), clampGain(grey / b)] });
  });
  return out;
}

/** Grid the gain field is solved on before it is stretched over the photo. */
const GRID_W = 64;
const GRID_H = 48;

/**
 * Apply a smooth per-pixel white balance built from the face whites.
 *
 * The gains are blended by inverse distance on a coarse grid and bilinearly
 * interpolated per pixel, so the correction follows a gradient of light without
 * printing a visible seam at any token. The softening term keeps a pixel
 * sitting on a token from being dominated by that one sample.
 */
export function balanceBuffer(buf: PixelBuffer, whites: readonly FaceWhite[]): PixelBuffer {
  if (whites.length < MIN_FACES) return buf;
  const { width, height, data } = buf;
  const soft = (0.05 * width) ** 2;

  const field = new Float32Array(GRID_W * GRID_H * 3);
  for (let gy = 0; gy < GRID_H; gy++) {
    const cy = ((gy + 0.5) * height) / GRID_H;
    for (let gx = 0; gx < GRID_W; gx++) {
      const cx = ((gx + 0.5) * width) / GRID_W;
      let wr = 0, wg = 0, wb = 0, wsum = 0;
      for (const f of whites) {
        const w = 1 / ((f.x - cx) ** 2 + (f.y - cy) ** 2 + soft);
        wr += w * f.gain[0];
        wg += w * f.gain[1];
        wb += w * f.gain[2];
        wsum += w;
      }
      const o = (gy * GRID_W + gx) * 3;
      field[o] = wr / wsum;
      field[o + 1] = wg / wsum;
      field[o + 2] = wb / wsum;
    }
  }

  /*
    The column interpolation weights do not depend on the row, and the row
    weights do not depend on the column, so both are computed once. The first
    version did all of it per pixel and took 782ms on a 3072x4080 frame on a
    desktop, which is too slow to add to a read that already takes seconds on a
    phone.
  */
  const colX0 = new Int32Array(width);
  const colX1 = new Int32Array(width);
  const colT = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const fx = Math.min(GRID_W - 1, Math.max(0, ((x + 0.5) * GRID_W) / width - 0.5));
    const x0 = Math.floor(fx);
    colX0[x] = x0 * 3;
    colX1[x] = Math.min(GRID_W - 1, x0 + 1) * 3;
    colT[x] = fx - x0;
  }

  const row = new Float32Array(GRID_W * 3);
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    const fy = Math.min(GRID_H - 1, Math.max(0, ((y + 0.5) * GRID_H) / height - 0.5));
    const gy = Math.floor(fy);
    const y0 = gy * GRID_W * 3;
    const y1 = Math.min(GRID_H - 1, gy + 1) * GRID_W * 3;
    const ty = fy - gy;
    for (let k = 0; k < GRID_W * 3; k++) {
      row[k] = field[y0 + k]! * (1 - ty) + field[y1 + k]! * ty;
    }
    let i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4) {
      const tx = colT[x]!;
      const p0 = colX0[x]!;
      const p1 = colX1[x]!;
      const r = data[i]! * (row[p0]! * (1 - tx) + row[p1]! * tx) + 0.5;
      const g = data[i + 1]! * (row[p0 + 1]! * (1 - tx) + row[p1 + 1]! * tx) + 0.5;
      const bl = data[i + 2]! * (row[p0 + 2]! * (1 - tx) + row[p1 + 2]! * tx) + 0.5;
      out[i] = r > 255 ? 255 : r | 0;
      out[i + 1] = g > 255 ? 255 : g | 0;
      out[i + 2] = bl > 255 ? 255 : bl | 0;
      out[i + 3] = 255;
    }
  }
  return { data: out, width, height };
}

/**
 * White-balance a board photo from its own tokens, given the tapped corners.
 *
 * Returns the photo unchanged when the board cannot be located or too few
 * tokens are found — a correction built from bad samples is worse than none.
 */
export function balanceForBoard(
  buf: PixelBuffer,
  guideCorners: readonly [Point, Point, Point, Point],
): PixelBuffer {
  const h = boardTransform(guideCorners);
  if (!h) return buf;
  const hasToken = classifyTokenPresence(HEX_CENTERS.map((_, i) => detectInkRange(buf, h, i)));
  return balanceBuffer(buf, tokenFaceWhites(buf, h, hasToken));
}
