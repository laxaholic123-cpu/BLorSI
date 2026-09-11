/**
 * The harbour detector, against a synthetic board built to contain the exact
 * things that defeated earlier versions: a tablecloth, island tiles as pale as
 * the badges, and a dock timber floating in open sea.
 *
 * Synthetic rather than photographic because the real captures live outside the
 * app and cannot run in CI. The photographic measurement is
 * `tools/harbour_probe.py` (90/90 harbours, 10/10 boards); this pins the ported
 * logic so it cannot drift away from what that measured.
 */

import { HEX_CENTERS } from '@/services/vision/boardGeometry';
import type { PixelBuffer } from '@/services/vision/pixelBuffer';
import type { Point } from '@/services/vision/homography';
import { badgeCanonical, findBadges, harbourEvidence, readHarbours } from '@/services/vision/harbours';
import { COASTAL_RING, edgeKey } from '@/services/vision/harbourRing';
import { solveHomography } from '@/services/vision/homography';

const TRUTH: [number, number][] = [
  [0, 0], [1, 1], [3, 5], [6, 1], [11, 2], [12, 5], [15, 3], [16, 4], [17, 3],
];

const W = 1100;
const H = 1000;
const SCALE = 70;
const CX = 550;
const CY = 500;

/*
  The first version of this file made the sea fill almost the whole canvas, so
  the "tablecloth" decoy at (40,40) was floating in open water and the detector
  was right to keep it. The board needs a real cloth margin for the enclosure
  test to have anything to reject.
*/
const CLOTH_DECOY: Point = { x: 50, y: 50 };
const CLOTH_DECOY_2: Point = { x: W - 50, y: H - 50 };

const toPx = (p: Point): Point => ({ x: CX + p.x * SCALE, y: CY + p.y * SCALE });

const CLOTH = [225, 222, 215];
const SEA = [50, 110, 190];
const LAND = [90, 140, 70];
const CREAM = [235, 225, 195];

/** A board photo with no harbours on it yet. */
function baseBoard(): PixelBuffer {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cx = (x - CX) / SCALE;
      const cy = (y - CY) / SCALE;
      // Cloth everywhere, sea over the board's footprint. The cloth matters:
      // it is bright and unsaturated, exactly like a badge, and there is far
      // more of it.
      const c = Math.abs(cx) < 6.3 && Math.abs(cy) < 5.7 ? SEA : CLOTH;
      const i = (y * W + x) * 4;
      data[i] = c[0]!; data[i + 1] = c[1]!; data[i + 2] = c[2]!; data[i + 3] = 255;
    }
  }
  // The island. Its tiles are masked out by projection, which is the only
  // reason a pale desert does not read as a harbour.
  for (const centre of HEX_CENTERS) {
    disc(data, toPx(centre), SCALE, LAND);
  }
  return { data, width: W, height: H };
}

function disc(data: Uint8Array, at: Point, r: number, colour: number[]): void {
  for (let y = Math.max(0, Math.floor(at.y - r)); y <= Math.min(H - 1, Math.ceil(at.y + r)); y++) {
    for (let x = Math.max(0, Math.floor(at.x - r)); x <= Math.min(W - 1, Math.ceil(at.x + r)); x++) {
      const dx = x - at.x, dy = y - at.y;
      if (dx * dx + dy * dy > r * r) continue;
      const i = (y * W + x) * 4;
      data[i] = colour[0]!; data[i + 1] = colour[1]!; data[i + 2] = colour[2]!;
    }
  }
}

const CORNERS = [HEX_CENTERS[0]!, HEX_CENTERS[2]!, HEX_CENTERS[18]!, HEX_CENTERS[16]!]
  .map(toPx) as unknown as readonly [Point, Point, Point, Point];

const withHarbours = (extra: Point[] = []): PixelBuffer => {
  const buf = baseBoard();
  for (const [h, e] of TRUTH) disc(buf.data, toPx(badgeCanonical(h, e)), 16, CREAM);
  for (const p of extra) disc(buf.data, toPx(p), 16, CREAM);
  return buf;
};

/**
 * A dock timber in open water, far enough from every real badge to be its own
 * blob, and offset from the predicted spot the way a timber actually is.
 *
 * Chosen by measurement rather than by eye: the predicted positions pair up at
 * convex corners, only 0.216 apart, so an eyeballed decoy merges into a real
 * badge and tests nothing. The first version of this file did exactly that.
 */
const TIMBER: Point = (() => {
  const truth = TRUTH.map(([h, e]) => badgeCanonical(h, e));
  const isTruth = new Set(TRUTH.map(([h, e]) => `${h}:${e}`));
  for (const s of COASTAL_RING) {
    if (isTruth.has(`${s.hexIndex}:${s.edge}`)) continue;
    const q = badgeCanonical(s.hexIndex, s.edge);
    if (truth.every(t => Math.hypot(q.x - t.x, q.y - t.y) > 1)) {
      // Offset, so it scores below a real badge rather than tying with one.
      return { x: q.x + 0.35, y: q.y };
    }
  }
  throw new Error('no isolated coastal edge to put a timber on');
})();

const keys = (slots: { hexIndex: number; edge: number }[]) =>
  slots.map(s => `${s.hexIndex}:${s.edge}`).sort();
const TRUTH_KEYS = TRUTH.map(([h, e]) => `${h}:${e}`).sort();

describe('badgeCanonical', () => {
  it('puts the badge OUTSIDE the tile, in the sea', () => {
    // The card sits out in the water with its boat, not on the coastline. An
    // earlier version placed it at the edge midpoint and every prediction
    // landed half a hex inside the island.
    for (const [h, e] of TRUTH) {
      const c = HEX_CENTERS[h]!;
      const b = badgeCanonical(h, e);
      expect(Math.hypot(b.x - c.x, b.y - c.y)).toBeGreaterThan(1);
    }
  });
});

describe('findBadges', () => {
  const toImage = solveHomography(
    [HEX_CENTERS[0]!, HEX_CENTERS[2]!, HEX_CENTERS[18]!, HEX_CENTERS[16]!],
    CORNERS,
  )!;
  const toCanonical = solveHomography(
    CORNERS,
    [HEX_CENTERS[0]!, HEX_CENTERS[2]!, HEX_CENTERS[18]!, HEX_CENTERS[16]!],
  )!;

  it('finds all nine, and only nine, on a clean board', () => {
    const found = findBadges(withHarbours(), toImage, toCanonical);
    expect(found).toHaveLength(9);
  });

  it('does not mistake the TABLECLOTH for a harbour', () => {
    /*
      The failure that brightness-only detection could never survive. This
      decoy is cream, badge-sized, and entirely legitimate-looking — it is
      rejected solely because what surrounds it is cloth rather than sea.
    */
    const buf = withHarbours();
    disc(buf.data, CLOTH_DECOY, 16, CREAM);
    disc(buf.data, CLOTH_DECOY_2, 16, CREAM);
    expect(findBadges(buf, toImage, toCanonical)).toHaveLength(9);
  });

  it('finds nothing at all on a board with no harbours', () => {
    expect(findBadges(baseBoard(), toImage, toCanonical)).toHaveLength(0);
  });

  it('does accept a dock timber floating in the sea', () => {
    // Stated so the next reader knows the detector is NOT expected to reject
    // this: it looks exactly like a badge and it is surrounded by water. The
    // ring constraint is what throws it out, one layer up.
    const found = findBadges(withHarbours([TIMBER]), toImage, toCanonical);
    expect(found).toHaveLength(10);
  });
});

describe('harbourEvidence', () => {
  it('scores the true edges at nearly 1', () => {
    const badges = TRUTH.map(([h, e]) => ({ point: badgeCanonical(h, e), area: 800 }));
    const scores = harbourEvidence(badges);
    for (const [h, e] of TRUTH) expect(scores.get(edgeKey(h, e))).toBeCloseTo(1, 5);
  });

  it('is GRADED, not binary — a near miss still scores', () => {
    // The property `selectRing` depends on to break 7-span ties. If this ever
    // becomes a yes/no test, missed harbours stop being recoverable.
    const q = badgeCanonical(0, 0);
    const scores = harbourEvidence([{ point: { x: q.x + 0.4, y: q.y }, area: 800 }]);
    const s = scores.get(edgeKey(0, 0))!;
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

describe('readHarbours', () => {
  it('reads the board end to end, from pixels', () => {
    const got = readHarbours(withHarbours(), CORNERS)!;
    expect(got).not.toBeNull();
    expect(keys(got.slots)).toEqual(TRUTH_KEYS);
    expect(got.unsure).toEqual([]);
    expect(got.margin).toBeGreaterThan(0);
  });

  it('reads it correctly WITH a dock timber and a tablecloth decoy', () => {
    const buf = withHarbours([TIMBER]);
    disc(buf.data, CLOTH_DECOY, 16, CREAM);
    const got = readHarbours(buf, CORNERS)!;
    expect(keys(got.slots)).toEqual(TRUTH_KEYS);
    expect(got.unsure).toEqual([]);
  });

  it('still recovers when a badge is MISSING from the photo', () => {
    // Glare eats one card. Whether the constraint can fill the gap depends on
    // the span around it, so this uses one of the three that is forced.
    const buf = baseBoard();
    for (const [h, e] of TRUTH) {
      if (h === 0 && e === 0) continue;
      disc(buf.data, toPx(badgeCanonical(h, e)), 16, CREAM);
    }
    const got = readHarbours(buf, CORNERS)!;
    expect(keys(got.slots)).toEqual(TRUTH_KEYS);
  });
});
