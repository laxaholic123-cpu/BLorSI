/**
 * Combining evidence from several captures of the same board.
 *
 * Pure — no image data, no React Native, fully unit-testable.
 *
 * WHY MULTIPLE CAPTURES
 * ---------------------
 * A single photo of a board is never uniformly good. Glare falls on one corner,
 * the far edge is at a shallower angle and blurs, a hand shadows two tiles. But
 * the bad region MOVES when you move the camera — so a second look from a
 * different position reads exactly the tiles the first one lost.
 *
 * That makes reading a board an evidence-accumulation problem rather than a
 * single-shot recognition problem, and it changes the failure mode completely:
 * instead of "the scan was wrong, start again", the app can say "these four
 * tiles are still unclear, point the camera at that corner". Each capture
 * strictly improves the board — the reader never gets worse by looking again.
 *
 * The evidence model is additive costs per hex, so merging is well defined and
 * a capture that only covers part of the board still contributes everything it
 * saw.
 */

import type { ResourceType } from '@/types/models';
import type { HexEvidence } from '@/services/boardConstraints';
import { BOARD_HEX_COUNT } from '@/services/boardConstraints';

/**
 * How sure the reader is about one hex, 0 (nothing) to 1 (certain).
 *
 * Derived from how much the best candidate beats the runner-up: a tile whose
 * colour sits equally close to two terrains is not confident even if the reader
 * had to pick one, and that is precisely the tile worth re-photographing.
 */
export function hexConfidence(costs: Partial<Record<string, number>>): number {
  const values = Object.values(costs).filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  if (values.length < 2) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const best = sorted[0]!;
  const runnerUp = sorted[1]!;
  if (runnerUp <= 0) return 0;

  // Margin as a fraction of the runner-up. A best of 5 against a runner-up of
  // 25 is decisive; 20 against 22 is a coin toss.
  const margin = (runnerUp - best) / runnerUp;
  return Math.max(0, Math.min(1, margin));
}

/** Combined confidence for a hex across both what it is and what token it holds. */
export function evidenceConfidence(evidence: HexEvidence): number {
  const resource = hexConfidence(evidence.resourceCost);
  const token = hexConfidence(evidence.tokenCost);
  // A hex needs BOTH to be trusted, so take the weaker. The desert is exempt
  // from the token half — it legitimately has none.
  if (evidence.hasToken === false) return resource;
  if (Object.keys(evidence.tokenCost).length === 0) return resource * 0.5;
  return Math.min(resource, token);
}

/**
 * Merge two readings of the same hex.
 *
 * Costs are summed, so agreement between captures compounds — two independent
 * looks that both favour pasture make pasture twice as cheap, while a
 * disagreement leaves both candidates mid-priced and the constraint solver
 * settles it using the rest of the board.
 *
 * Summing rather than averaging is deliberate: it means more looks produce
 * stronger opinions, which is the behaviour that makes re-capture worthwhile.
 * A capture that saw nothing of a hex contributes nothing and cannot dilute
 * what an earlier capture saw clearly.
 */
function mergeCosts<K extends string | number>(
  a: Partial<Record<K, number>>,
  b: Partial<Record<K, number>>,
): Partial<Record<K, number>> {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as K[]);
  if (keys.size === 0) return {};
  const out: Partial<Record<K, number>> = {};
  for (const key of keys) {
    const av = a[key];
    const bv = b[key];
    if (typeof av === 'number' && typeof bv === 'number') out[key] = av + bv;
    else if (typeof av === 'number') out[key] = av;
    else if (typeof bv === 'number') out[key] = bv;
  }
  return out;
}

/**
 * Fold a new capture into the board's accumulated evidence.
 *
 * Both arrays are indexed by hex. A hex the new capture had no opinion about is
 * left exactly as it was.
 */
export function mergeEvidence(
  accumulated: readonly HexEvidence[],
  incoming: readonly HexEvidence[],
): HexEvidence[] {
  return accumulated.map((existing, i) => {
    const fresh = incoming[i];
    if (!fresh) return existing;
    return {
      index: existing.index,
      resourceCost: mergeCosts<ResourceType>(existing.resourceCost, fresh.resourceCost),
      tokenCost: mergeCosts<number>(existing.tokenCost, fresh.tokenCost),
      // A token seen once is a token. Absence only counts when nothing has ever
      // seen one, because a glare-blanked tile also "has no token".
      hasToken:
        existing.hasToken === true || fresh.hasToken === true
          ? true
          : existing.hasToken === false || fresh.hasToken === false
            ? false
            : undefined,
    };
  });
}

/** Evidence for a board nothing has been read from yet. */
export function emptyEvidence(): HexEvidence[] {
  return Array.from({ length: BOARD_HEX_COUNT }, (_, index) => ({
    index,
    resourceCost: {},
    tokenCost: {},
  }));
}

// ─── Guiding the next capture ─────────────────────────────────────────────────

/** Below this, a hex is worth another look. */
export const CONFIDENCE_THRESHOLD = 0.35;

/**
 * Rough regions of the board, used to tell the player where to point next.
 *
 * Named rather than numbered because "aim at the top-left" is an instruction a
 * person can follow and "hexes 0, 1, 3, 4 are uncertain" is not.
 */
export const BOARD_REGIONS: ReadonlyArray<{ name: string; hexes: readonly number[] }> = [
  { name: 'the top-left', hexes: [0, 1, 3, 4] },
  { name: 'the top-right', hexes: [1, 2, 5, 6] },
  { name: 'the left side', hexes: [3, 7, 8, 12] },
  { name: 'the right side', hexes: [6, 10, 11, 15] },
  { name: 'the middle', hexes: [4, 5, 8, 9, 10, 13, 14] },
  { name: 'the bottom-left', hexes: [12, 13, 16, 17] },
  { name: 'the bottom-right', hexes: [14, 15, 17, 18] },
];

export interface CaptureGuidance {
  /** Hexes still below the confidence threshold. */
  weakHexes: number[];
  /** Whole-board confidence, 0–1, for a progress indicator. */
  overallConfidence: number;
  /** True when every hex is confident enough to stop. */
  isComplete: boolean;
  /** Where to aim next, or null when nothing more is needed. */
  suggestedRegion: string | null;
  /** One line to show the player. */
  message: string;
}

/**
 * Decide whether another capture would help, and where to point the camera.
 *
 * Picks the region containing the most weak hexes rather than naming them
 * individually, because the player is aiming a camera at a table, not selecting
 * tiles from a list.
 */
export function guidanceForEvidence(evidence: readonly HexEvidence[]): CaptureGuidance {
  const confidences = evidence.map(evidenceConfidence);
  const weakHexes = confidences
    .map((c, i) => (c < CONFIDENCE_THRESHOLD ? i : -1))
    .filter(i => i >= 0);

  const overallConfidence =
    confidences.length > 0
      ? confidences.reduce((s, c) => s + c, 0) / confidences.length
      : 0;

  if (weakHexes.length === 0) {
    return {
      weakHexes,
      overallConfidence,
      isComplete: true,
      suggestedRegion: null,
      message: 'Whole board read. Check it over and continue.',
    };
  }

  const weak = new Set(weakHexes);
  let bestRegion: string | null = null;
  let bestCount = 0;
  for (const region of BOARD_REGIONS) {
    const count = region.hexes.filter(h => weak.has(h)).length;
    if (count > bestCount) {
      bestCount = count;
      bestRegion = region.name;
    }
  }

  const plural = weakHexes.length === 1 ? 'tile is' : 'tiles are';
  const message = bestRegion
    ? `${weakHexes.length} ${plural} still unclear — point the camera at ${bestRegion} and shoot again.`
    : `${weakHexes.length} ${plural} still unclear — try another angle.`;

  return { weakHexes, overallConfidence, isComplete: false, suggestedRegion: bestRegion, message };
}
