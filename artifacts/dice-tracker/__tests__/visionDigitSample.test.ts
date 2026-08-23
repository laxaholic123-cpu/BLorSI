/**
 * Unit tests for turning a patch of photo into a digit shape.
 *
 * Every case here corresponds to a bug that was actually shipped and measured,
 * because each one failed SILENTLY — the reader carried on and reported a
 * plausible-looking answer, which is why they survived so long:
 *
 *   - The face was located by brightness, so a bright tile won and the sampler
 *     read a guessed centre. Found on 5 of 18 tokens in one capture, 0 of 18 in
 *     another.
 *   - Tile inside the sampled disc thresholds as ink and, being the biggest
 *     blob, gets mistaken for the digit.
 *   - The crop clipped its own token when the token sat off-centre.
 *   - The board sitting near the frame edge dropped tokens indistinguishably
 *     from tokens that could not be read.
 */

import {
  CROP_PADDING,
  locateFaceBySaturation,
  sampleDigit,
} from '../services/vision/digitSample';
import { DIGIT_WORDS, similarity } from '../services/vision/digitShape';
import type { PixelBuffer } from '../services/vision/pixelBuffer';

function blank(width: number, height: number, rgb: [number, number, number]): PixelBuffer {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

function put(buffer: PixelBuffer, x: number, y: number, rgb: [number, number, number]) {
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return;
  const i = (y * buffer.width + x) * 4;
  buffer.data[i] = rgb[0];
  buffer.data[i + 1] = rgb[1];
  buffer.data[i + 2] = rgb[2];
}

function disc(buffer: PixelBuffer, cx: number, cy: number, r: number,
              rgb: [number, number, number]) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) put(buffer, x, y, rgb);
    }
  }
}

function bar(buffer: PixelBuffer, x0: number, y0: number, w: number, h: number,
             rgb: [number, number, number]) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) put(buffer, x, y, rgb);
  }
}

const TILE_GREEN: [number, number, number] = [70, 140, 55];
const TILE_WHEAT: [number, number, number] = [220, 190, 70];   // bright AND saturated
const FACE_CREAM: [number, number, number] = [235, 228, 208];  // bright, unsaturated
const INK_BLACK: [number, number, number] = [30, 28, 26];
const INK_RED: [number, number, number] = [180, 40, 35];

/**
 * A synthetic token: cream face on a tile, a dark mark, and a pip row below it.
 * `offset` moves the token off-centre the way a hand-placed one sits.
 */
function makeToken(options: {
  size: number;
  tile: [number, number, number];
  ink: [number, number, number];
  offsetX?: number;
  offsetY?: number;
  pips?: number;
  markWidth?: number;
}): PixelBuffer {
  const { size, tile, ink, offsetX = 0, offsetY = 0, pips = 3, markWidth = 10 } = options;
  const buffer = blank(size, size, tile);
  const cx = (size - 1) / 2 + offsetX;
  const cy = (size - 1) / 2 + offsetY;
  const faceRadius = (size / 2) / CROP_PADDING;
  disc(buffer, cx, cy, faceRadius, FACE_CREAM);
  // A blocky "digit" above centre, asymmetric so rotation is detectable.
  bar(buffer, Math.round(cx - markWidth / 2), Math.round(cy - faceRadius * 0.55),
      markWidth, Math.round(faceRadius * 0.8), ink);
  bar(buffer, Math.round(cx - markWidth / 2), Math.round(cy - faceRadius * 0.55),
      markWidth * 2, Math.round(faceRadius * 0.2), ink);
  // Pips below it, as they sit on a real token.
  for (let p = 0; p < pips; p++) {
    const px = cx + (p - (pips - 1) / 2) * (faceRadius * 0.16);
    disc(buffer, px, cy + faceRadius * 0.62, Math.max(1.6, faceRadius * 0.05), ink);
  }
  return buffer;
}

describe('locateFaceBySaturation', () => {
  it('finds the face on a saturated tile', () => {
    const size = 120;
    const buffer = makeToken({ size, tile: TILE_GREEN, ink: INK_BLACK });
    const found = locateFaceBySaturation(buffer, 0, 0, size)!;
    expect(found).not.toBeNull();
    // Within a pixel or two, not exact: the ink is excluded from the
    // saturation mask, so the surviving cream pixels pull the centroid away
    // from wherever the digit sits. That bias is inherent and harmless —
    // sampleDigit re-centres on the DIGIT afterwards, and it is the digit's
    // centre, not the face's, that the shape is built around.
    expect(Math.abs(found.cx - (size - 1) / 2)).toBeLessThan(2);
    expect(Math.abs(found.cy - (size - 1) / 2)).toBeLessThan(2);
  });

  it('finds the face on a BRIGHT tile, where brightness alone fails', () => {
    // The measured bug: a gold wheat field is as bright as a cream token, so
    // the brightest blob was the tile and the sampler read a guessed centre.
    // Saturation separates them because the tile is vividly coloured.
    const size = 120;
    const buffer = makeToken({ size, tile: TILE_WHEAT, ink: INK_BLACK });
    const found = locateFaceBySaturation(buffer, 0, 0, size)!;
    expect(found).not.toBeNull();
    expect(found.cx).toBeCloseTo((size - 1) / 2, 0);
  });

  it('follows a token that sits off-centre on its tile', () => {
    const size = 120;
    const buffer = makeToken({ size, tile: TILE_GREEN, ink: INK_BLACK, offsetX: 9, offsetY: -7 });
    const found = locateFaceBySaturation(buffer, 0, 0, size)!;
    expect(found.cx).toBeGreaterThan((size - 1) / 2 + 3);
    expect(found.cy).toBeLessThan((size - 1) / 2 - 2);
  });

  it('reports nothing rather than a guess when there is no face', () => {
    const size = 120;
    expect(locateFaceBySaturation(blank(size, size, TILE_GREEN), 0, 0, size)).toBeNull();
  });
});

describe('sampleDigit', () => {
  it('produces a well-formed shape from a plain token', () => {
    const size = 120;
    const sample = sampleDigit(makeToken({ size, tile: TILE_GREEN, ink: INK_BLACK }), 0, 0, size)!;
    expect(sample).not.toBeNull();
    expect(sample.bits.length).toBe(DIGIT_WORDS);
    expect(sample.faceLocated).toBe(true);
  });

  it('gives the same shape whether or not the token is centred', () => {
    // Scaling and centring on the DIGIT, not the face, is what makes this hold
    // — and it is why matching the whole face scored at chance.
    const size = 120;
    const centred = sampleDigit(
      makeToken({ size, tile: TILE_GREEN, ink: INK_BLACK }), 0, 0, size)!;
    const shifted = sampleDigit(
      makeToken({ size, tile: TILE_GREEN, ink: INK_BLACK, offsetX: 8, offsetY: 6 }), 0, 0, size)!;
    expect(similarity(centred.bits, shifted.bits)).toBeGreaterThan(0.9);
  });

  it('gives the same shape at a different print size', () => {
    const a = sampleDigit(makeToken({ size: 120, tile: TILE_GREEN, ink: INK_BLACK }), 0, 0, 120)!;
    const b = sampleDigit(makeToken({ size: 180, tile: TILE_GREEN, ink: INK_BLACK,
                                     markWidth: 15 }), 0, 0, 180)!;
    expect(similarity(a.bits, b.bits)).toBeGreaterThan(0.85);
  });

  it('is not derailed by a bright surrounding tile', () => {
    const size = 120;
    const green = sampleDigit(makeToken({ size, tile: TILE_GREEN, ink: INK_BLACK }), 0, 0, size)!;
    const wheat = sampleDigit(makeToken({ size, tile: TILE_WHEAT, ink: INK_BLACK }), 0, 0, size)!;
    expect(similarity(green.bits, wheat.bits)).toBeGreaterThan(0.9);
  });

  it('reads red ink as red and black ink as black', () => {
    const size = 120;
    const red = sampleDigit(makeToken({ size, tile: TILE_GREEN, ink: INK_RED }), 0, 0, size)!;
    const black = sampleDigit(makeToken({ size, tile: TILE_GREEN, ink: INK_BLACK }), 0, 0, size)!;
    expect(red.inkIsRed).toBe(true);
    expect(black.inkIsRed).toBe(false);
  });

  it('reads the pips as a direction without counting them', () => {
    // Only WHERE they are is used. The count is a function of the value and is
    // already known, and trying to read it is what sank blob counting — so the
    // direction must survive the pip count changing.
    const size = 140;
    const three = sampleDigit(
      makeToken({ size, tile: TILE_GREEN, ink: INK_BLACK, pips: 3 }), 0, 0, size)!;
    const five = sampleDigit(
      makeToken({ size, tile: TILE_GREEN, ink: INK_BLACK, pips: 5 }), 0, 0, size)!;
    expect(three.pipsSuggest).toBeDefined();
    expect(three.pipsSuggest).toBe(five.pipsSuggest);
  });

  it('returns null on a blank face rather than inventing a digit', () => {
    const size = 120;
    const buffer = blank(size, size, TILE_GREEN);
    disc(buffer, (size - 1) / 2, (size - 1) / 2, (size / 2) / CROP_PADDING, FACE_CREAM);
    expect(sampleDigit(buffer, 0, 0, size)).toBeNull();
  });

  it('refuses a crop too small to carry a digit', () => {
    expect(sampleDigit(blank(16, 16, TILE_GREEN), 0, 0, 16)).toBeNull();
  });
});
