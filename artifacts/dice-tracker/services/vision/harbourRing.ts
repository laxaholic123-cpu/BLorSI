/**
 * The nine harbours form a RING, and that constraint is what makes detection
 * exact rather than approximate.
 *
 * Finding cream badges in the sea gives 11-22 candidates per photo: the real
 * nine, plus dock timbers, glare, and the pale edge of the frame. No amount of
 * tuning the blob detector removed them — measured in `tools/harbour_probe.py`
 * across ten captures.
 *
 * The structure does it instead. Nine harbours sit on a thirty-edge coast
 * spaced 3 or 4 apart, so nine gaps must sum to 30 with each in {3, 4} — which
 * forces exactly six 3s and three 4s. Only 280 legal rings exist. Enumerate
 * them all, score each against the detections, keep the best.
 *
 * A false positive on a dock timber cannot join a ring, because no legal ring
 * has a harbour there AND at the eight real ones. Measured: 90/90 harbours
 * across 10 captures, 10/10 boards exactly right.
 *
 * Pure geometry — no pixels. The detector that produces the scores lives in
 * `harbours.ts`; this file is the part that can be reasoned about and tested
 * on its own.
 */

import { getCoastalEdgesClockwise, PORT_COUNT } from '@/services/catanBoard';
import type { HexEdge } from '@/types/models';

export interface RingSlot {
  hexIndex: number;
  edge: HexEdge;
}

/** The coast, walked clockwise. Thirty edges, in ring order. */
export const COASTAL_RING: readonly RingSlot[] = getCoastalEdgesClockwise().map(e => ({
  hexIndex: e.hexIndex,
  edge: e.edge,
}));

/** Gaps a harbour ring may use. Anything else cannot tile the coast. */
const LEGAL_GAPS = [3, 4] as const;

/** Key for a coastal edge, for scoring maps. */
export const edgeKey = (hexIndex: number, edge: number): string => `${hexIndex}:${edge}`;

let cachedRings: number[][] | null = null;

/**
 * Every legal set of nine positions on the thirty-edge coast.
 *
 * Built once. There are 280 of them, which is small enough that the selector
 * below is exhaustive — and exhaustive matters, because a greedy walk would
 * commit to a strong false positive early and then be unable to close the ring.
 */
export function legalRings(): number[][] {
  if (cachedRings) return cachedRings;
  const n = COASTAL_RING.length;
  const seen = new Set<string>();
  const out: number[][] = [];

  // Choose which of the nine gaps are 4s. Nine gaps summing to 30 with each in
  // {3,4} forces exactly three 4s (30 - 3x9 = 3), so choosing those three
  // enumerates the whole family.
  const combos: number[][] = [];
  for (let a = 0; a < PORT_COUNT; a++) {
    for (let b = a + 1; b < PORT_COUNT; b++) {
      for (let c = b + 1; c < PORT_COUNT; c++) combos.push([a, b, c]);
    }
  }
  for (let start = 0; start < n; start++) {
    for (const fours of combos) {
      const positions: number[] = [];
      let cur = start;
      for (let i = 0; i < PORT_COUNT; i++) {
        positions.push(cur % n);
        cur += fours.includes(i) ? 4 : 3;
      }
      const sorted = [...positions].sort((x, y) => x - y);
      const key = sorted.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(sorted);
    }
  }
  cachedRings = out;
  return out;
}

export interface RingChoice {
  slots: RingSlot[];
  /** Summed detection evidence, for reporting how sure this is. */
  score: number;
  /** How much better than the next-best ring. Zero means nothing was decided. */
  margin: number;
  /**
   * Slots the top-scoring rings DISAGREE about — the ones worth asking about.
   *
   * Usually empty. It fills when a harbour registered no evidence at all and
   * the coast admits two placements for it, which is the one failure mode the
   * structure cannot argue its way out of (see `selectRing`). Surfacing it lets
   * the UI ask about the single uncertain harbour rather than making the player
   * re-check all nine.
   */
  unsure: RingSlot[];
}

/**
 * The best legal ring given per-edge detection evidence.
 *
 * `scores` maps `edgeKey(hex, edge)` to evidence in [0, 1]; missing means none.
 *
 * Feed this DENSE evidence — a graded score for every coastal edge, falling off
 * with distance from the nearest detected badge — not a sparse list of hits.
 * That distinction is load-bearing, and it is measured, not assumed:
 *
 *   Each harbour's neighbours sit 6 or 7 edges apart around it. A span of 6
 *   splits only as 3+3, so the missing harbour's position is forced. A span of
 *   7 splits as 3+4 OR 4+3 — two legal rings, tied, and no amount of structure
 *   separates them. On the reference board six of the nine harbours sit in
 *   7-spans, so a harbour scoring exactly zero is unrecoverable two times out
 *   of three.
 *
 * Graded scores are what stop that happening: a glare-washed badge still scores
 * above the empty edge next to it, and that tiny difference picks the right
 * split. `evidence()` in `tools/harbour_probe.py` scores all thirty edges this
 * way and reached 90/90 harbours across ten captures. A sparse detector that
 * emits only confident hits would throw that away and land back in the tie.
 *
 * The margin over the runner-up is returned because it is the honest measure of
 * how much the photo actually decided — a ring chosen by 0.05 over its
 * neighbour is a coin toss that happened to land, and the UI should say so
 * rather than present it as read.
 */
export function selectRing(scores: ReadonlyMap<string, number>): RingChoice {
  const byPosition = COASTAL_RING.map(s => scores.get(edgeKey(s.hexIndex, s.edge)) ?? 0);
  // Evidence is floating point, so "tied" has to mean "within rounding", not
  // "identical". Exact equality would report a genuine two-way tie as decided.
  const EPS = 1e-9;

  let bestScore = -1;
  let runnerUp = -1;
  let tied: number[][] = [];

  for (const ring of legalRings()) {
    let total = 0;
    for (const p of ring) total += byPosition[p]!;

    if (total > bestScore + EPS) {
      runnerUp = bestScore;
      bestScore = total;
      tied = [ring];
    } else if (total >= bestScore - EPS) {
      // An equal ring is not a runner-up, it is a co-winner: the margin is zero
      // and both are kept so the disagreement can be reported.
      tied.push(ring);
      runnerUp = bestScore;
    } else if (total > runnerUp) {
      runnerUp = total;
    }
  }

  const best = tied[0] ?? [];
  const agreed = new Set(best.filter(p => tied.every(r => r.includes(p))));

  return {
    slots: best.map(p => COASTAL_RING[p]!),
    score: Math.max(0, bestScore),
    margin: Math.max(0, bestScore - Math.max(0, runnerUp)),
    unsure: best.filter(p => !agreed.has(p)).map(p => COASTAL_RING[p]!),
  };
}
