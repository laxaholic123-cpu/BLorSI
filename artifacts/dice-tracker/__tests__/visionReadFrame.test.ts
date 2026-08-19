/**
 * End-to-end frame reading against synthetic boards.
 *
 * This is why the Skia import was split out of pixelBuffer.ts: a PixelBuffer is
 * a plain object, so the whole reader — homography, sampling, classification,
 * the frame gate — runs here with no camera and no device.
 */

import {
  INK_RANGE_REFERENCE,
  boardTransform,
  classifyTokenPresence,
  detectInkRange,
  readFrame,
} from '@/services/vision/readFrame';
import { HEX_CENTERS, terrainSamplePoints } from '@/services/vision/boardGeometry';
import { applyHomography, type Point } from '@/services/vision/homography';
import { screenToImage, type PixelBuffer } from '@/services/vision/pixelBuffer';
import { TERRAIN_REFERENCES } from '@/services/vision/terrainPalette';
import { reconcileBoardFromEvidence, validateBoardComposition } from '@/services/boardConstraints';

const W = 800;
const H = 800;

/**
 * Guide corners, sized so the WHOLE board fits inside the buffer.
 *
 * The corner tiles sit at canonical (+/-1.73, +/-3), but the board extends to
 * about +/-4.26 once the outer hexes' sample rings are included. Placing the
 * corners naively at the edges of the frame pushes hexes 7 and 11 outside the
 * image, and they come back unsampled — which is exactly why the live screen
 * scales its guide by CANONICAL_EXTENT rather than by the corner positions.
 */
const SCALE = 89; // px per canonical unit: 4.26 * 89 ~ 380, comfortably inside 800
const CORNERS: [Point, Point, Point, Point] = [
  { x: 400 - 1.732 * SCALE, y: 400 - 3 * SCALE },
  { x: 400 + 1.732 * SCALE, y: 400 - 3 * SCALE },
  { x: 400 + 1.732 * SCALE, y: 400 + 3 * SCALE },
  { x: 400 - 1.732 * SCALE, y: 400 + 3 * SCALE },
];

/** sRGB for each terrain, round-tripped from the calibrated Lab references. */
const TERRAIN_RGB: Record<string, [number, number, number]> = {
  grain: [179, 143, 63],
  wool: [103, 137, 56],
  lumber: [86, 91, 62],
  brick: [120, 76, 49],
  ore: [144, 145, 145],
  desert: [190, 177, 130],
};

function blankBuffer(fill: [number, number, number] = [10, 10, 10]): PixelBuffer {
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width: W, height: H };
}

/**
 * Surface roughness per terrain, matching TERRAIN_ROUGHNESS.
 *
 * A synthetic board painted in flat colour has NO texture, which starves the
 * reader of a channel it now depends on — and a flat desert is
 * indistinguishable from a flat forest by roughness. Real board art is
 * textured, so the fixture has to be too, or it tests something the app will
 * never see.
 */
const ROUGHNESS: Record<string, number> = {
  lumber: 40, brick: 34, ore: 24, grain: 14, wool: 12, desert: 2,
};

/** Deterministic jitter, so a failing test always fails the same way. */
function noiseAt(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
}

function paint(
  buffer: PixelBuffer,
  cx: number,
  cy: number,
  r: number,
  rgb: [number, number, number],
  roughness = 0,
) {
  const minX = Math.max(0, Math.floor(cx - r));
  const maxX = Math.min(W - 1, Math.ceil(cx + r));
  const minY = Math.max(0, Math.floor(cy - r));
  const maxY = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (Math.hypot(x - cx, y - cy) > r) continue;
      const i = (y * W + x) * 4;
      const j = roughness ? noiseAt(x, y) * roughness : 0;
      buffer.data[i] = Math.max(0, Math.min(255, rgb[0] + j));
      buffer.data[i + 1] = Math.max(0, Math.min(255, rgb[1] + j));
      buffer.data[i + 2] = Math.max(0, Math.min(255, rgb[2] + j));
      buffer.data[i + 3] = 255;
    }
  }
}

/** Paint a board whose tiles match the given layout, at the sample positions. */
function paintBoard(layout: string[]): PixelBuffer {
  const buffer = blankBuffer();
  const h = boardTransform(CORNERS)!;
  layout.forEach((terrain, i) => {
    const rgb = TERRAIN_RGB[terrain]!;
    for (const p of terrainSamplePoints(i, 36)) {
      const mapped = applyHomography(h, p);
      if (!mapped) continue;
      paint(buffer, mapped.x, mapped.y, 9, rgb, ROUGHNESS[terrain] ?? 0);
    }
  });
  return buffer;
}

const LEGAL_LAYOUT = [
  'desert', 'grain', 'grain', 'grain', 'grain',
  'lumber', 'lumber', 'lumber', 'lumber',
  'wool', 'wool', 'wool', 'wool',
  'ore', 'ore', 'ore',
  'brick', 'brick', 'brick',
];

describe('boardTransform', () => {
  it('maps the four corner tiles onto the guide corners', () => {
    const h = boardTransform(CORNERS)!;
    expect(h).not.toBeNull();
    [0, 2, 18, 16].forEach((hexIndex, i) => {
      const p = applyHomography(h, HEX_CENTERS[hexIndex]!)!;
      expect(p.x).toBeCloseTo(CORNERS[i]!.x, 4);
      expect(p.y).toBeCloseTo(CORNERS[i]!.y, 4);
    });
  });

  it('returns null for a degenerate guide', () => {
    const collapsed: [Point, Point, Point, Point] = [
      { x: 10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 },
    ];
    expect(boardTransform(collapsed)).toBeNull();
  });
});

describe('readFrame', () => {
  it('reads a painted board and classifies every tile', () => {
    const buffer = paintBoard(LEGAL_LAYOUT);
    const reading = readFrame(buffer, CORNERS);

    expect(reading.assessment.usable).toBe(true);
    expect(reading.evidence).toHaveLength(19);
    expect(reading.samples.filter(Boolean)).toHaveLength(19);

    // Every tile's own terrain should be its cheapest option.
    reading.evidence.forEach((ev, i) => {
      const costs = ev.resourceCost as Record<string, number>;
      const cheapest = Object.entries(costs).sort((a, b) => a[1] - b[1])[0]?.[0];
      expect(cheapest).toBe(LEGAL_LAYOUT[i]);
    });
  });

  it('feeds the constraint solver a legal board', () => {
    const reading = readFrame(paintBoard(LEGAL_LAYOUT), CORNERS);
    const { hexes } = reconcileBoardFromEvidence(reading.evidence);
    expect(validateBoardComposition(hexes)).toEqual([]);
  });

  it('recovers the exact layout it was shown', () => {
    const reading = readFrame(paintBoard(LEGAL_LAYOUT), CORNERS);
    const { hexes } = reconcileBoardFromEvidence(reading.evidence);
    hexes.forEach((hex, i) => {
      expect(hex.resource).toBe(LEGAL_LAYOUT[i]);
    });
  });

  it('rejects a frame pointed at nothing', () => {
    const reading = readFrame(blankBuffer([30, 30, 30]), CORNERS);
    expect(reading.assessment.usable).toBe(false);
    expect(reading.evidence).toHaveLength(0);
  });

  it('rejects a uniform surface filling the guide', () => {
    // A table, not a board — every quality signal passes and it is still wrong.
    const reading = readFrame(paintBoard(new Array(19).fill('wool')), CORNERS);
    expect(reading.assessment.usable).toBe(false);
    expect(reading.assessment.reason).toMatch(/point the camera/i);
  });

  it('reports a reason even when it declines', () => {
    // The reason is shown live under the viewfinder.
    for (const buffer of [blankBuffer(), paintBoard(new Array(19).fill('ore'))]) {
      expect(readFrame(buffer, CORNERS).assessment.reason.length).toBeGreaterThan(0);
    }
  });

  it('declines gracefully on a degenerate guide', () => {
    const collapsed: [Point, Point, Point, Point] = [
      { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 },
    ];
    const reading = readFrame(paintBoard(LEGAL_LAYOUT), collapsed);
    expect(reading.evidence).toHaveLength(0);
    expect(reading.assessment.usable).toBe(false);
  });

  it('skips the expensive DECODE, but always checks token presence', () => {
    // Presence is one cheap pass and it is what identifies the desert, so it is
    // never skipped. Decoding the number is the costly part, and the live loop
    // only pays for it on tiles that still need it.
    const buffer = paintBoard(LEGAL_LAYOUT);
    const reading = readFrame(buffer, CORNERS, { decodeTokensFor: [0, 1] });
    expect(reading.evidence[5]!.tokenCost).toEqual({});
    expect(reading.evidence.every(e => e.hasToken !== undefined)).toBe(true);
  });

  it('still samples colour for every hex when tokens are skipped', () => {
    const reading = readFrame(paintBoard(LEGAL_LAYOUT), CORNERS, { decodeTokensFor: [] });
    reading.evidence.forEach(ev => {
      expect(Object.keys(ev.resourceCost).length).toBeGreaterThan(0);
    });
  });
});

describe('detectInkRange — finding tokens by their ink', () => {
  const h = boardTransform(CORNERS)!;

  // The token area sampled is TOKEN_RADIUS (0.42) canonical units, which at
  // SCALE px per unit is ~37px. Paint wider than that, or samples spill onto the
  // background and manufacture a range on a tile that is meant to be blank.
  const TOKEN_PX = Math.ceil(0.42 * SCALE) + 4;

  /** Paint a hex's whole token area a flat colour: a blank tile. */
  function paintBlankToken(buffer: PixelBuffer, hexIndex: number, rgb: [number, number, number]) {
    const centre = applyHomography(h, HEX_CENTERS[hexIndex]!)!;
    paint(buffer, centre.x, centre.y, TOKEN_PX, rgb);
  }

  /** Paint a pale disc with dark marks on it: a token. */
  function paintTokenWithInk(buffer: PixelBuffer, hexIndex: number) {
    const centre = applyHomography(h, HEX_CENTERS[hexIndex]!)!;
    paint(buffer, centre.x, centre.y, TOKEN_PX, [232, 224, 198]);
    // Digits occupy much of a real token's face, not a couple of dots.
    const g = Math.round(TOKEN_PX * 0.42);
    paint(buffer, centre.x - g, centre.y - 4, g, [20, 18, 16]);
    paint(buffer, centre.x + g, centre.y - 4, g, [20, 18, 16]);
  }

  it('reads a wide range where there is ink', () => {
    const buffer = paintBoard(LEGAL_LAYOUT);
    paintTokenWithInk(buffer, 5);
    expect(detectInkRange(buffer, h, 5)!).toBeGreaterThan(INK_RANGE_REFERENCE);
  });

  it('reads a narrow range on a blank tile', () => {
    const buffer = paintBoard(LEGAL_LAYOUT);
    paintBlankToken(buffer, 9, [190, 177, 130]);
    expect(detectInkRange(buffer, h, 9)!).toBeLessThan(INK_RANGE_REFERENCE);
  });

  it('is not fooled by a PALE blank tile — the desert', () => {
    // The failure this replaced: a "bright and desaturated centre" test calls
    // the desert a token, because the desert is bright and desaturated.
    const buffer = paintBoard(LEGAL_LAYOUT);
    paintBlankToken(buffer, 9, [214, 205, 172]);
    expect(detectInkRange(buffer, h, 9)!).toBeLessThan(INK_RANGE_REFERENCE);
  });

  it('is not fooled by a DARK blank tile either', () => {
    const buffer = paintBoard(LEGAL_LAYOUT);
    paintBlankToken(buffer, 9, [60, 64, 44]);
    expect(detectInkRange(buffer, h, 9)!).toBeLessThan(INK_RANGE_REFERENCE);
  });

  it('measures spread, not level, so exposure does not matter', () => {
    // A token in shadow and the same token under glare both show ink. Shifting
    // both ends of the range together changes nothing.
    const bright = paintBoard(LEGAL_LAYOUT);
    const centreB = applyHomography(h, HEX_CENTERS[5]!)!;
    const gB = Math.round(TOKEN_PX * 0.42);
    paint(bright, centreB.x, centreB.y, TOKEN_PX, [252, 250, 240]);
    paint(bright, centreB.x - gB, centreB.y, gB, [90, 88, 84]);
    paint(bright, centreB.x + gB, centreB.y, gB, [90, 88, 84]);

    const dim = paintBoard(LEGAL_LAYOUT);
    const centreD = applyHomography(h, HEX_CENTERS[5]!)!;
    const gD = Math.round(TOKEN_PX * 0.42);
    paint(dim, centreD.x, centreD.y, TOKEN_PX, [150, 146, 132]);
    paint(dim, centreD.x - gD, centreD.y, gD, [16, 15, 14]);
    paint(dim, centreD.x + gD, centreD.y, gD, [16, 15, 14]);

    expect(detectInkRange(bright, h, 5)!).toBeGreaterThan(INK_RANGE_REFERENCE);
    expect(detectInkRange(dim, h, 5)!).toBeGreaterThan(INK_RANGE_REFERENCE);
  });

  it('returns null for a hex outside the frame', () => {
    const far: [Point, Point, Point, Point] = [
      { x: 5000, y: 5000 }, { x: 5100, y: 5000 }, { x: 5100, y: 5100 }, { x: 5000, y: 5100 },
    ];
    const other = boardTransform(far)!;
    expect(detectInkRange(paintBoard(LEGAL_LAYOUT), other, 0)).toBeNull();
  });

  it('marks the blank tile as the one without a token', () => {
    const buffer = paintBoard(LEGAL_LAYOUT);
    for (let i = 0; i < 19; i++) {
      if (i === 9) paintBlankToken(buffer, i, [214, 205, 172]);
      else paintTokenWithInk(buffer, i);
    }
    const reading = readFrame(buffer, CORNERS);
    expect(reading.evidence[9]!.hasToken).toBe(false);
    const withTokens = reading.evidence.filter(e => e.hasToken === true);
    expect(withTokens).toHaveLength(18);
  });
});


describe('classifyTokenPresence — blank tiles found by comparison, not by a number', () => {
  /** 18 inked tiles and one blank, at whatever overall scale. */
  const board = (blankAt: number, scale: number) =>
    Array.from({ length: 19 }, (_, i) => (i === blankAt ? 0.11 : 0.45) * scale);

  it('finds the single blank tile under good light', () => {
    const p = classifyTokenPresence(board(9, 1));
    expect(p[9]).toBe(false);
    expect(p.filter(v => v === false)).toHaveLength(1);
  });

  it('still finds it when the whole image loses contrast', () => {
    // A fixed 0.20 cut called every tile blank here. Every range shrinks
    // together, so an absolute threshold on a relative quantity collapses.
    const p = classifyTokenPresence(board(9, 0.3));
    expect(p[9]).toBe(false);
    expect(p.filter(v => v === false)).toHaveLength(1);
  });

  it('still finds it when the image is unusually bright', () => {
    const p = classifyTokenPresence(board(4, 2.2));
    expect(p[4]).toBe(false);
    expect(p.filter(v => v === false)).toHaveLength(1);
  });

  it('reports no blank when there is no cliff to find', () => {
    // Every tile inked — the desert is out of frame. Inventing one would be
    // worse than reporting none.
    const p = classifyTokenPresence(new Array(19).fill(0.45));
    expect(p.every(v => v === true)).toBe(true);
  });

  it('does not mistake an ordinary dim tile for a blank one', () => {
    const ranges = new Array(19).fill(0.45);
    ranges[3] = 0.36; // inked, just less contrasty
    const p = classifyTokenPresence(ranges);
    expect(p.filter(v => v === false)).toHaveLength(0);
  });

  it('never calls a whole board blank', () => {
    // The failure the fixed threshold actually produced: 19 of 19 blank.
    for (const scale of [0.1, 0.2, 0.5, 1, 3]) {
      const p = classifyTokenPresence(board(9, scale));
      expect(p.filter(v => v === false).length).toBeLessThanOrEqual(3);
    }
  });

  it('leaves unsampled hexes undefined rather than guessing', () => {
    const ranges: (number | null)[] = board(9, 1);
    ranges[0] = null;
    const p = classifyTokenPresence(ranges);
    expect(p[0]).toBeUndefined();
  });

  it('declines when too few tiles were measured to compare', () => {
    const sparse: (number | null)[] = new Array(19).fill(null);
    sparse[0] = 0.5; sparse[1] = 0.1;
    const p = classifyTokenPresence(sparse);
    expect(p.filter(v => v === false)).toHaveLength(0);
  });
});

describe('screenToImage — preview crop, not a plain scale', () => {
  // A phone screen is tall and narrow; the sensor is not. The preview fills the
  // screen and crops the overflow, so mapping by simple ratio puts every sample
  // in the wrong place — and nothing errors, the board just reads as nonsense.
  const SCREEN_W = 1080;
  const SCREEN_H = 2400;

  it('is the identity when the aspect ratios already match', () => {
    const p = screenToImage({ x: 540, y: 1200 }, SCREEN_W, SCREEN_H, 1080, 2400);
    expect(p.x).toBeCloseTo(540);
    expect(p.y).toBeCloseTo(1200);
  });

  it('maps the centre to the centre whatever the crop', () => {
    for (const [w, h] of [[4032, 3024], [4000, 2250], [3024, 4032], [1080, 2400]]) {
      const p = screenToImage({ x: SCREEN_W / 2, y: SCREEN_H / 2 }, SCREEN_W, SCREEN_H, w!, h!);
      expect(p.x).toBeCloseTo(w! / 2, 3);
      expect(p.y).toBeCloseTo(h! / 2, 3);
    }
  });

  it('crops the sides when the photo is wider than the screen', () => {
    // 4:3 sensor, 9:20 screen — the photo is far wider, so its full height shows
    // and the sides are trimmed.
    const img = { w: 4032, h: 3024 };
    const topLeft = screenToImage({ x: 0, y: 0 }, SCREEN_W, SCREEN_H, img.w, img.h);
    expect(topLeft.y).toBeCloseTo(0, 3);
    expect(topLeft.x).toBeGreaterThan(0);

    const bottomRight = screenToImage({ x: SCREEN_W, y: SCREEN_H }, SCREEN_W, SCREEN_H, img.w, img.h);
    expect(bottomRight.y).toBeCloseTo(img.h, 3);
    expect(bottomRight.x).toBeLessThan(img.w);

    // The crop is symmetric.
    expect(topLeft.x).toBeCloseTo(img.w - bottomRight.x, 3);
  });

  it('crops top and bottom when the photo is taller than the screen', () => {
    // Worth being precise: a 3:4 PORTRAIT photo is 0.75 wide-to-tall, while a
    // 9:20 screen is 0.45 — so even a portrait photo is RELATIVELY wider and
    // still crops at the sides. Getting top-and-bottom cropping needs an image
    // narrower than the screen, which is unusual but must not break.
    const img = { w: 1000, h: 2600 };
    const topLeft = screenToImage({ x: 0, y: 0 }, SCREEN_W, SCREEN_H, img.w, img.h);
    expect(topLeft.x).toBeCloseTo(0, 3);
    expect(topLeft.y).toBeGreaterThan(0);
  });

  it('crops the sides even for a PORTRAIT photo on a tall screen', () => {
    // The case a phone actually produces, and the one a naive mapping ruins.
    const img = { w: 3024, h: 4032 };
    const topLeft = screenToImage({ x: 0, y: 0 }, SCREEN_W, SCREEN_H, img.w, img.h);
    expect(topLeft.y).toBeCloseTo(0, 3);
    expect(topLeft.x).toBeGreaterThan(100);
  });

  it('never maps outside the image', () => {
    for (const [w, h] of [[4032, 3024], [3024, 4032], [4000, 2250]]) {
      for (const pt of [{ x: 0, y: 0 }, { x: SCREEN_W, y: SCREEN_H }, { x: SCREEN_W / 3, y: SCREEN_H / 4 }]) {
        const p = screenToImage(pt, SCREEN_W, SCREEN_H, w!, h!);
        expect(p.x).toBeGreaterThanOrEqual(-1e-6);
        expect(p.y).toBeGreaterThanOrEqual(-1e-6);
        expect(p.x).toBeLessThanOrEqual(w! + 1e-6);
        expect(p.y).toBeLessThanOrEqual(h! + 1e-6);
      }
    }
  });

  it('differs materially from a naive scale — which is the whole point', () => {
    // If these agreed there would be no bug to fix. On a 4:3 sensor the naive
    // mapping is out by hundreds of pixels near the edges.
    const img = { w: 4032, h: 3024 };
    const correct = screenToImage({ x: 0, y: 0 }, SCREEN_W, SCREEN_H, img.w, img.h);
    const naive = { x: 0, y: 0 };
    expect(Math.abs(correct.x - naive.x)).toBeGreaterThan(100);
  });

  it('degrades safely on nonsense dimensions', () => {
    expect(screenToImage({ x: 5, y: 5 }, 0, 0, 100, 100)).toEqual({ x: 0, y: 0 });
  });
});
