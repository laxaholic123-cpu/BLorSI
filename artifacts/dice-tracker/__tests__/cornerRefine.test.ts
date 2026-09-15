/**
 * Automatic corner placement, on a synthetic board whose true corners are known
 * exactly.
 *
 * The accuracy that matters was measured on real captures
 * (tools/corner_refine_check.mjs: corners 0.32 -> 0.08 hex radii off from a
 * medium guide error, numbers 98.7%). These pin the properties it rests on, so
 * a change to the search or the score cannot quietly undo them.
 */

import { CORNER_HEX_CENTERS, HEX_CENTERS, hexOutline } from '@/services/vision/boardGeometry';
import type { Point } from '@/services/vision/homography';
import type { PixelBuffer } from '@/services/vision/pixelBuffer';
import {
  DEFAULT_REFINE,
  refineCorners,
  scoreCorners,
  type Corners,
  type RefineOptions,
} from '@/services/vision/cornerRefine';

const W = 600;
const H = 560;
const SCALE = 40;
const toPx = (p: Point): Point => ({ x: 300 + p.x * SCALE, y: 280 + p.y * SCALE });

/** Blue sea with nineteen green tiles laid exactly on the ideal grid. */
function syntheticBoard(): PixelBuffer {
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = 40; data[i * 4 + 1] = 100; data[i * 4 + 2] = 190; data[i * 4 + 3] = 255;
  }
  HEX_CENTERS.forEach((_c, index) => {
    const poly = hexOutline(index).map(toPx);
    const xs = poly.map(p => p.x);
    const ys = poly.map(p => p.y);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        // Convex polygon: inside when on the same side of every edge.
        let sign = 0;
        let inside = true;
        for (let k = 0; k < poly.length; k++) {
          const a = poly[k]!;
          const b = poly[(k + 1) % poly.length]!;
          const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
          if (cross !== 0) {
            if (sign === 0) sign = Math.sign(cross);
            else if (Math.sign(cross) !== sign) { inside = false; break; }
          }
        }
        if (!inside || x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = (y * W + x) * 4;
        data[i] = 90; data[i + 1] = 150; data[i + 2] = 60;
      }
    }
  });
  return { data, width: W, height: H };
}

/** Synthetic tiles have no gaps between them, so the real-board stretch does not apply. */
const IDEAL: RefineOptions = { ...DEFAULT_REFINE, coastScale: 1 };

const truth = CORNER_HEX_CENTERS.map(toPx) as unknown as Corners;
const error = (a: Corners) =>
  a.reduce((s, p, i) => s + Math.hypot(p.x - truth[i]!.x, p.y - truth[i]!.y), 0) / 4 / SCALE;

const shift = (c: Corners, dx: number, dy: number, grow = 1): Corners => {
  const cx = c.reduce((s, p) => s + p.x, 0) / 4;
  const cy = c.reduce((s, p) => s + p.y, 0) / 4;
  return c.map(p => ({
    x: cx + (p.x - cx) * grow + dx * SCALE,
    y: cy + (p.y - cy) * grow + dy * SCALE,
  })) as Corners;
};

describe('scoreCorners', () => {
  const board = syntheticBoard();

  it('scores the true corners above corners that are off the board', () => {
    const atTruth = scoreCorners(board, truth, IDEAL)!.total;
    for (const off of [shift(truth, 0.3, 0), shift(truth, 0, -0.3), shift(truth, 0, 0, 1.08)]) {
      expect(atTruth).toBeGreaterThan(scoreCorners(board, off, IDEAL)!.total);
    }
  });

  it('does not reward a board mostly out of the photo', () => {
    // Sampling only the half that fits must not look like a good fit.
    const offFrame = shift(truth, 9, 0);
    expect(scoreCorners(board, offFrame, IDEAL)!.coast).toBeLessThanOrEqual(0);
  });
});

describe('refineCorners', () => {
  const board = syntheticBoard();

  it('pulls a guide-like error back onto the board', () => {
    const seed = shift(truth, 0.3, -0.2, 1.04);
    expect(error(seed)).toBeGreaterThan(0.25);
    const got = refineCorners(board, seed, IDEAL);
    expect(error(got.corners)).toBeLessThan(0.1);
  });

  it('leaves corners that are already right where they are', () => {
    const got = refineCorners(board, truth, IDEAL);
    expect(error(got.corners)).toBeLessThan(0.05);
  });

  it('stays bounded on a photo with no board in it', () => {
    const blank: PixelBuffer = { data: new Uint8Array(W * H * 4).fill(128), width: W, height: H };
    const got = refineCorners(blank, truth, IDEAL);
    expect(Number.isFinite(got.movedRadii)).toBe(true);
    expect(got.evals).toBeLessThan(2000);
  });
});
