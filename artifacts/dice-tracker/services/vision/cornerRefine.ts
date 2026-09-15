/**
 * Put the four corner handles on the board automatically.
 *
 * READ THIS BEFORE CHANGING IT. Automatic board geometry failed three times in
 * this repo, and the records are in tools/:
 *
 *   detect_probe.py      whole-photo detection. Decisive finding: ten of twelve
 *                        photos were close-ups with no whole board to find.
 *   hex_detect_probe.py  per-hex colour blobs. Tiles merge through pale borders,
 *                        but "the border lattice itself is crisp".
 *   register.py          optimisation from a rough box: "the score does
 *                        separate, but a five-parameter random search lands in
 *                        bad local minima ... Fixing it would need multi-start,
 *                        coarse-to-fine search, or an edge-based initial
 *                        estimate."
 *
 * Two things have changed since: the capture guide makes the player frame the
 * WHOLE board, and it puts the corners roughly right — the initial estimate
 * register.py lacked. So this REFINES the guide's corners rather than detecting
 * the board, with the multi-start, coarse-to-fine search register.py named.
 *
 * TWO MORE LESSONS, both measured on seven frames (tools/corner_refine_check.mjs):
 *
 * 1. DO NOT SCORE BY TOKEN INK. Tokens are dropped on tiles by hand, off-centre,
 *    while the corners mark hex CENTRES, so an ink score pulls the corners toward
 *    wherever the tokens happened to land — and lightness spread in a disc peaks
 *    when it straddles a token's edge. Starting 0.13 hex radii off, it ended 0.19
 *    off, worse than the guide.
 *
 * 2. THE REAL COASTLINE IS NOT WHERE A PERFECT GRID PUTS IT. Scoring the
 *    tile-to-sea step along all thirty coastal edges converged to the same error
 *    from every starting distance, which is bias, not a search problem. Starting
 *    FROM the hand-marked corners showed it: the lattice stretched 5.0% (4.2 to
 *    6.2), almost purely outward. Real tiles lie with small gaps and the frame
 *    holds them loosely, so the coast sits further out than unit hexes predict.
 *    `coastScale` models that.
 */

import { CORNER_HEX_CENTERS, HEX_CENTERS } from '@/services/vision/boardGeometry';
import { COASTAL_RING } from '@/services/vision/harbourRing';
import { applyHomography, solveHomography, type Point } from '@/services/vision/homography';
import { downscale, type PixelBuffer } from '@/services/vision/pixelBuffer';

export type Corners = [Point, Point, Point, Point];

const APOTHEM = Math.cos(Math.PI / 6);

export interface RefineOptions {
  /** Weight of the coastline contrast term. */
  coastWeight: number;
  /** How far inside and outside the coast each sample pair sits, in hex radii. */
  coastOffset: number;
  /**
   * Where the real coastline sits relative to the ideal lattice, as a scale
   * about the board centre. See lesson 2 in the header: measured 1.050 on one
   * physical board.
   */
  coastScale: number;
  /** Weight of the sea-ring-versus-tiles term. */
  seaWeight: number;
  /** Weight of the token ink term. Biased — see lesson 1 — so off by default. */
  tokenWeight: number;
}

export const DEFAULT_REFINE: RefineOptions = {
  coastWeight: 1,
  coastOffset: 0.1,
  coastScale: 1.05,
  seaWeight: 0,
  tokenWeight: 0,
};

/** Sample offsets inside a token disc. */
const TOKEN_OFFSETS: Point[] = (() => {
  const out: Point[] = [{ x: 0, y: 0 }];
  for (const r of [0.07, 0.14, 0.21, 0.28, 0.34]) {
    for (let k = 0; k < 12; k++) {
      const a = (2 * Math.PI * k) / 12 + r;
      out.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }
  }
  return out;
})();

/** Terrain points: an annulus that clears the token and stays on the tile. */
const LAND_POINTS: Point[] = HEX_CENTERS.flatMap(c =>
  Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k + Math.PI / 6;
    return { x: c.x + 0.62 * Math.cos(a), y: c.y + 0.62 * Math.sin(a) };
  }),
);

/** Water just outside every coastal edge, short of the harbour badges. */
const SEA_POINTS: Point[] = COASTAL_RING.flatMap(slot => {
  const c = HEX_CENTERS[slot.hexIndex]!;
  const th = ((240 + 60 * slot.edge) * Math.PI) / 180;
  const n = { x: Math.cos(th), y: Math.sin(th) };
  return [0.3, 0.5].map(d => ({ x: c.x + n.x * (APOTHEM + d), y: c.y + n.y * (APOTHEM + d) }));
});

const coastCache = new Map<string, { inner: Point; outer: Point }[]>();

/** Pairs of points straddling every coastal edge, `offset` either side. */
function coastPairs(offset: number, scale: number): { inner: Point; outer: Point }[] {
  const key = `${offset}:${scale}`;
  const cached = coastCache.get(key);
  if (cached) return cached;
  const pairs = COASTAL_RING.flatMap(slot => {
    const c = HEX_CENTERS[slot.hexIndex]!;
    const th = ((240 + 60 * slot.edge) * Math.PI) / 180;
    const n = { x: Math.cos(th), y: Math.sin(th) };
    const t = { x: -n.y, y: n.x };
    // The board is centred on the origin, so scaling the edge midpoint moves
    // the coast outward uniformly — the shape the measurement found.
    const mid = { x: (c.x + n.x * APOTHEM) * scale, y: (c.y + n.y * APOTHEM) * scale };
    return [-0.36, -0.24, -0.12, 0, 0.12, 0.24, 0.36].map(s => ({
      inner: { x: mid.x + t.x * s - n.x * offset, y: mid.y + t.y * s - n.y * offset },
      outer: { x: mid.x + t.x * s + n.x * offset, y: mid.y + t.y * s + n.y * offset },
    }));
  });
  coastCache.set(key, pairs);
  return pairs;
}

export interface CornerScore {
  /** Mean blueness step across the coastline, outside minus inside, 0-1. */
  coast: number;
  /** Mean blueness of the sea ring minus the tiles, 0-1. */
  sea: number;
  /** Mean ink spread over the 17 strongest token discs. */
  token: number;
  total: number;
}

/** Score a candidate set of corners against the photo. Higher is better. */
export function scoreCorners(
  buf: PixelBuffer,
  corners: Corners,
  opts: RefineOptions = DEFAULT_REFINE,
): CornerScore | null {
  const h = solveHomography(CORNER_HEX_CENTERS, corners);
  if (!h) return null;
  const { width, height, data } = buf;

  const index = (p: Point): number => {
    const m = applyHomography(h, p);
    if (!m) return -1;
    const x = Math.round(m.x);
    const y = Math.round(m.y);
    if (x < 0 || y < 0 || x >= width || y >= height) return -1;
    return (y * width + x) * 4;
  };
  const blue = (i: number) => (data[i + 2]! - (data[i]! + data[i + 1]!) / 2) / 255;

  let coast = 0;
  if (opts.coastWeight > 0) {
    const pairs = coastPairs(opts.coastOffset, opts.coastScale);
    let sum = 0;
    let n = 0;
    for (const pair of pairs) {
      const a = index(pair.inner);
      const b = index(pair.outer);
      if (a < 0 || b < 0) continue;
      sum += blue(b) - blue(a);
      n++;
    }
    // A board half out of frame should not score well by sampling only the
    // half that happens to fit.
    coast = n >= pairs.length / 2 ? sum / n : -1;
  }

  let sea = 0;
  if (opts.seaWeight > 0) {
    const mean = (points: Point[]) => {
      let s = 0;
      let n = 0;
      for (const p of points) {
        const i = index(p);
        if (i < 0) continue;
        s += blue(i);
        n++;
      }
      return n >= points.length / 3 ? s / n : null;
    };
    const seaBlue = mean(SEA_POINTS);
    const landBlue = mean(LAND_POINTS);
    sea = seaBlue !== null && landBlue !== null ? seaBlue - landBlue : 0;
  }

  let token = 0;
  if (opts.tokenWeight > 0) {
    const ranges: number[] = [];
    const values = new Float32Array(TOKEN_OFFSETS.length);
    for (const c of HEX_CENTERS) {
      let n = 0;
      for (const o of TOKEN_OFFSETS) {
        const i = index({ x: c.x + o.x, y: c.y + o.y });
        if (i < 0) continue;
        values[n++] = (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255;
      }
      if (n < TOKEN_OFFSETS.length / 2) {
        ranges.push(0);
        continue;
      }
      const v = values.subarray(0, n).sort();
      ranges.push(v[Math.floor(n * 0.9)]! - v[Math.floor(n * 0.1)]!);
    }
    ranges.sort((a, b) => b - a);
    token = ranges.slice(0, 17).reduce((s, r) => s + r, 0) / 17;
  }

  return {
    coast,
    sea,
    token,
    total: opts.coastWeight * coast + opts.seaWeight * sea + opts.tokenWeight * token,
  };
}

/** Pixels per canonical hex radius, near the middle of the board. */
function pixelsPerRadius(corners: Corners): number {
  const h = solveHomography(CORNER_HEX_CENTERS, corners);
  if (!h) return 0;
  const a = applyHomography(h, { x: 0, y: 0 });
  const b = applyHomography(h, { x: 1, y: 0 });
  return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
}

/** Move, scale and turn a set of corners about their centroid. */
function similarity(seed: Corners, tx: number, ty: number, logS: number, theta: number): Corners {
  const cx = (seed[0].x + seed[1].x + seed[2].x + seed[3].x) / 4;
  const cy = (seed[0].y + seed[1].y + seed[2].y + seed[3].y) / 4;
  const s = Math.exp(logS);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return seed.map(p => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { x: cx + tx + s * (cos * dx - sin * dy), y: cy + ty + s * (sin * dx + cos * dy) };
  }) as Corners;
}

/**
 * Compass search: try each parameter up and down, keep any improvement, halve
 * the steps when nothing improves. No gradients, bounded evaluations.
 */
function patternSearch(
  start: number[],
  steps: number[],
  minSteps: number[],
  f: (p: number[]) => number,
  maxEvals: number,
): { params: number[]; value: number; evals: number } {
  let p = [...start];
  let best = f(p);
  let step = [...steps];
  let evals = 1;
  while (evals < maxEvals && step.some((s, i) => s > minSteps[i]!)) {
    let improved = false;
    for (let i = 0; i < p.length && evals < maxEvals; i++) {
      if (step[i]! <= minSteps[i]!) continue;
      for (const dir of [1, -1]) {
        const q = [...p];
        q[i] = q[i]! + dir * step[i]!;
        const v = f(q);
        evals++;
        if (v > best) {
          best = v;
          p = q;
          improved = true;
          break;
        }
      }
    }
    if (!improved) step = step.map(s => s / 2);
  }
  return { params: p, value: best, evals };
}

export interface CornerRefinement {
  corners: Corners;
  score: CornerScore;
  /** Score at the seed, for judging how much the refinement found. */
  seedScore: CornerScore;
  /** Mean distance the corners moved from the seed, in hex radii. */
  movedRadii: number;
  evals: number;
}

const COARSE_MAX = 640;
const FINE_MAX = 1280;

/**
 * Refine rough corners (from the capture guide) onto the actual board.
 *
 * `seed` and the result are in pixels of `buffer`.
 */
export function refineCorners(
  buffer: PixelBuffer,
  seed: Corners,
  opts: RefineOptions = DEFAULT_REFINE,
): CornerRefinement {
  const scaleFor = (maxDim: number) =>
    Math.max(1, Math.round(Math.max(buffer.width, buffer.height) / maxDim));
  const toBuf = (c: Corners, f: number) => c.map(p => ({ x: p.x / f, y: p.y / f })) as Corners;
  const fromBuf = (c: Corners, f: number) => c.map(p => ({ x: p.x * f, y: p.y * f })) as Corners;
  const value = (buf: PixelBuffer, c: Corners) => scoreCorners(buf, c, opts)?.total ?? -Infinity;

  // ── Coarse: position, size and turn, from several nearby starts ──────────
  const fc = scaleFor(COARSE_MAX);
  const coarse = downscale(buffer, fc);
  const seedC = toBuf(seed, fc);
  const r = pixelsPerRadius(seedC);
  let evals = 0;
  let bestCoarse = { corners: seedC, value: value(coarse, seedC) };
  const starts: [number, number][] = [[0, 0], [0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]];
  for (const [sx, sy] of starts) {
    const run = patternSearch(
      [sx * r, sy * r, 0, 0],
      [0.25 * r, 0.25 * r, 0.05, 0.05],
      [0.03 * r, 0.03 * r, 0.005, 0.005],
      p => value(coarse, similarity(seedC, p[0]!, p[1]!, p[2]!, p[3]!)),
      160,
    );
    evals += run.evals;
    if (run.value > bestCoarse.value) {
      const q = run.params;
      bestCoarse = { corners: similarity(seedC, q[0]!, q[1]!, q[2]!, q[3]!), value: run.value };
    }
  }

  // ── Fine: each corner on its own, which absorbs a tilted phone ───────────
  const ff = scaleFor(FINE_MAX);
  const fine = ff === fc ? coarse : downscale(buffer, ff);
  const startF = toBuf(fromBuf(bestCoarse.corners, fc), ff);
  const rf = pixelsPerRadius(startF);
  const flat = startF.flatMap(p => [p.x, p.y]);
  const unflat = (v: number[]) =>
    [0, 1, 2, 3].map(i => ({ x: v[2 * i]!, y: v[2 * i + 1]! })) as Corners;
  const fineRun = patternSearch(
    flat,
    flat.map(() => 0.1 * rf),
    flat.map(() => 0.01 * rf),
    v => value(fine, unflat(v)),
    400,
  );
  evals += fineRun.evals;

  const empty: CornerScore = { coast: 0, sea: 0, token: 0, total: 0 };
  const corners = fromBuf(unflat(fineRun.params), ff);
  const score = scoreCorners(fine, unflat(fineRun.params), opts) ?? empty;
  const seedScore = scoreCorners(fine, toBuf(seed, ff), opts) ?? empty;
  const rFull = pixelsPerRadius(corners) || 1;
  const movedRadii =
    corners.reduce((s, p, i) => s + Math.hypot(p.x - seed[i]!.x, p.y - seed[i]!.y), 0) / 4 / rFull;

  return { corners, score, seedScore, movedRadii, evals };
}
