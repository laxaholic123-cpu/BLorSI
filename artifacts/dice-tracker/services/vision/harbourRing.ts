/**
 * Where the nine harbours can be, and which of those the photo supports.
 *
 * Finding cream badges in the sea gives 11-22 candidates per photo: the real
 * nine, plus dock timbers, glare, and the pale edge of the frame. Structure
 * sorts them out. The harbour spots are PAINTED on the frame, so only two
 * position sets exist (`framePositionSets`), sharing no position, and
 * `selectFrame` picks between them.
 *
 * HISTORY: this file first searched all 280 rings the coast allows (gaps of 3
 * or 4 summing to 30). That reached 90/90 in even light and fell to 48/90 under
 * a warm cast, and was removed once the frame constraint replaced it. It is in
 * git at efcb629 if an edition with a different frame ever needs it.
 *
 * Pure geometry — no pixels. The detector that produces the scores lives in
 * `harbours.ts`; this file is the part that can be reasoned about and tested
 * on its own.
 */

import { getCoastalEdgesClockwise, STANDARD_PORT_LAYOUT } from '@/services/catanBoard';
import { ROTATION_STEPS, rotatePortLayout } from '@/services/catanPorts';
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

/** Key for a coastal edge, for scoring maps. */
export const edgeKey = (hexIndex: number, edge: number): string => `${hexIndex}:${edge}`;

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
   * structure cannot argue its way out of (see `selectFrame`). Surfacing it lets
   * the UI ask about the single uncertain harbour rather than making the player
   * re-check all nine.
   */
  unsure: RingSlot[];
}

// ─── The frame: positions are PAINTED, not chosen ────────────────────────────

let cachedFrames: number[][] | null = null;

/**
 * Every set of harbour positions the physical frame can present.
 *
 * Reported from a device, after positions came back wrong under golden light:
 * "the location options for the port do not actually change and it is painted
 * on the board ring". Only the TOKENS move. So the legal answers are not the
 * 280 rings the coast allows — they are the frame's own positions, turned
 * however the board happens to sit relative to the photo.
 *
 * Measured, not assumed: the six rotations of STANDARD_PORT_LAYOUT collapse to
 * exactly TWO position sets that share no position at all, and the reference
 * board in all ten captures is one of them (`tools/light_probe.py`). Choosing
 * between two disjoint sets needs almost no evidence — a single correctly found
 * badge decides it.
 */
export function framePositionSets(): number[][] {
  if (cachedFrames) return cachedFrames;
  const seen = new Set<string>();
  const out: number[][] = [];
  for (let r = 0; r < ROTATION_STEPS; r++) {
    const positions = rotatePortLayout([...STANDARD_PORT_LAYOUT], r)
      .map(p => COASTAL_RING.findIndex(s => s.hexIndex === p.hexIndex && s.edge === p.edge))
      .sort((a, b) => a - b);
    const key = positions.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(positions);
  }
  cachedFrames = out;
  return out;
}

/**
 * How far ahead the chosen frame set must be before positions count as read.
 *
 * Evidence is summed per-edge scores, so a clean photo gives roughly nine for
 * the right set against a few for the other (neighbouring convex-corner edges
 * light up at about 0.75). Measured minimum on correct reads across every cast
 * and both white-balance modes: 1.58 without balancing, 5.36 with it. The one
 * wrong read under warm light without balancing had a margin under 0.31. Two
 * sits clear of both, and errs toward asking.
 */
export const MIN_FRAME_MARGIN = 2;

/**
 * The frame position set the evidence supports.
 *
 * `unsure` is ALL nine slots when the margin is too small, never a subset: with
 * two disjoint candidates the question is which set, not which harbour, and a
 * screen that ringed three harbours amber would imply the other six were known.
 */
export function selectFrame(scores: ReadonlyMap<string, number>): RingChoice {
  const byPosition = COASTAL_RING.map(s => scores.get(edgeKey(s.hexIndex, s.edge)) ?? 0);
  const ranked = framePositionSets()
    .map(set => ({ set, total: set.reduce((sum, p) => sum + byPosition[p]!, 0) }))
    .sort((a, b) => b.total - a.total);
  const best = ranked[0]!;
  const margin = Math.max(0, best.total - (ranked[1]?.total ?? 0));
  const slots = best.set.map(p => COASTAL_RING[p]!);
  return {
    slots,
    score: best.total,
    margin,
    unsure: margin < MIN_FRAME_MARGIN ? [...slots] : [],
  };
}
