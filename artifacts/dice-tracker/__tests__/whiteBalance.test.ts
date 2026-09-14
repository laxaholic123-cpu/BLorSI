/**
 * White balance from the number tokens.
 *
 * Measured on the real captures (tools/light_read_check.mjs): under a warm cast
 * numbers fell from 126/126 to 37/126 and a strong cast got every frame
 * rejected; balancing brought them back to 126/126 and 124/126 with no loss in
 * even light. These tests pin the properties that result rests on, using
 * synthetic pixels so they run anywhere.
 */

import { CORNER_HEX_CENTERS, HEX_CENTERS } from '@/services/vision/boardGeometry';
import { solveHomography, type Point } from '@/services/vision/homography';
import type { PixelBuffer } from '@/services/vision/pixelBuffer';
import {
  MIN_FACES,
  balanceBuffer,
  tokenFaceWhites,
  type FaceWhite,
} from '@/services/vision/whiteBalance';

const fill = (w: number, h: number, colour: (x: number, y: number) => [number, number, number]): PixelBuffer => {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = colour(x, y);
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
};

const px = (buf: PixelBuffer, x: number, y: number) => {
  const i = (y * buf.width + x) * 4;
  return [buf.data[i]!, buf.data[i + 1]!, buf.data[i + 2]!];
};

/** The gain that makes a colour neutral grey, as tokenFaceWhites computes it. */
const neutralising = ([r, g, b]: number[]): [number, number, number] => {
  const grey = (r! + g! + b!) / 3;
  return [grey / r!, grey / g!, grey / b!];
};

const spread = (c: number[]) => Math.max(...c) - Math.min(...c);

describe('balanceBuffer', () => {
  it('leaves the photo alone when there are too few tokens to trust', () => {
    // A correction built from a handful of samples is worse than none.
    const buf = fill(40, 40, () => [230, 200, 150]);
    const whites: FaceWhite[] = Array.from({ length: MIN_FACES - 1 }, (_, i) => ({
      x: i * 5, y: 10, gain: [0.8, 1, 1.4],
    }));
    expect(balanceBuffer(buf, whites)).toBe(buf);
  });

  it('neutralises a cast that is the same everywhere', () => {
    const warm = [230, 200, 150];
    const buf = fill(120, 90, () => warm as [number, number, number]);
    const whites: FaceWhite[] = [[10, 10], [60, 10], [110, 10], [10, 80], [60, 80], [110, 80]]
      .map(([x, y]) => ({ x: x!, y: y!, gain: neutralising(warm) }));
    const out = balanceBuffer(buf, whites);
    expect(spread(px(out, 60, 45))).toBeLessThanOrEqual(2);
  });

  it('corrects a cast on ONE SIDE and leaves the other side alone', () => {
    /*
      The case that matters: a sunbeam or a lamp to one side. A global white
      balance would push the unlit side blue to fix the lit one. Local tokens
      under local light take out only what is there.
    */
    const warm = [230, 200, 150];
    const neutral = [200, 200, 200];
    const W = 400, H = 100;
    const buf = fill(W, H, x => (x < W / 2 ? warm : neutral) as [number, number, number]);
    const whites: FaceWhite[] = [
      { x: 20, y: 20, gain: neutralising(warm) }, { x: 60, y: 80, gain: neutralising(warm) },
      { x: 100, y: 20, gain: neutralising(warm) },
      { x: 300, y: 20, gain: [1, 1, 1] }, { x: 340, y: 80, gain: [1, 1, 1] },
      { x: 380, y: 20, gain: [1, 1, 1] },
    ];
    const out = balanceBuffer(buf, whites);
    // Well inside each side, away from the blend in the middle.
    expect(spread(px(out, 30, 50))).toBeLessThanOrEqual(12);
    expect(spread(px(out, 370, 50))).toBeLessThanOrEqual(12);
    // And the unlit side has not been dragged blue by the lit one.
    const right = px(out, 370, 50);
    expect(Math.abs(right[2]! - 200)).toBeLessThanOrEqual(12);
  });

  it('keeps the photo the same size and opaque', () => {
    const buf = fill(64, 48, () => [180, 160, 120]);
    const whites: FaceWhite[] = Array.from({ length: MIN_FACES }, (_, i) => ({
      x: 5 + i * 9, y: 24, gain: [1, 1.05, 1.3],
    }));
    const out = balanceBuffer(buf, whites);
    expect(out.width).toBe(64);
    expect(out.height).toBe(48);
    expect(out.data[3]).toBe(255);
  });
});

describe('tokenFaceWhites', () => {
  // A board laid out flat in a 900x800 image, one canonical unit = 60px.
  const toPx = (p: Point): Point => ({ x: 450 + p.x * 60, y: 400 + p.y * 60 });
  const toImage = solveHomography(CORNER_HEX_CENTERS, CORNER_HEX_CENTERS.map(toPx) as unknown as
    readonly [Point, Point, Point, Point])!;

  it('reads a white from every hex that has a token, and skips the rest', () => {
    const buf = fill(900, 800, () => [235, 220, 185]);
    const hasToken = HEX_CENTERS.map((_, i) => i !== 9);
    expect(tokenFaceWhites(buf, toImage, hasToken)).toHaveLength(18);
  });

  it('produces gains that turn the token cream neutral', () => {
    const cream = [235, 220, 185];
    const buf = fill(900, 800, () => cream as [number, number, number]);
    const whites = tokenFaceWhites(buf, toImage, HEX_CENTERS.map(() => true));
    for (const w of whites) {
      const corrected = cream.map((c, k) => c * w.gain[k]!);
      expect(spread(corrected)).toBeLessThan(1);
    }
  });

  it('uses the FACE, not the ink printed on it', () => {
    // Dark digit pixels in the middle of every token must not tint the white.
    const cream = [235, 220, 185];
    const buf = fill(900, 800, (x, y) => {
      for (const c of HEX_CENTERS) {
        const p = toPx(c);
        if (Math.abs(x - p.x) < 5 && Math.abs(y - p.y) < 8) return [40, 30, 90];
      }
      return cream as [number, number, number];
    });
    const whites = tokenFaceWhites(buf, toImage, HEX_CENTERS.map(() => true));
    const expected = neutralising(cream);
    for (const w of whites) {
      for (let k = 0; k < 3; k++) expect(w.gain[k]).toBeCloseTo(expected[k]!, 2);
    }
  });

  it('clamps an absurd sample instead of inventing a light', () => {
    const buf = fill(900, 800, () => [255, 8, 8]);
    for (const w of tokenFaceWhites(buf, toImage, HEX_CENTERS.map(() => true))) {
      for (const g of w.gain) {
        expect(g).toBeGreaterThanOrEqual(0.5);
        expect(g).toBeLessThanOrEqual(2);
      }
    }
  });
});
