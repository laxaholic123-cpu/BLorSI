/**
 * Harbour evidence that builds up across shots, the way tiles already do.
 *
 * Tiles and numbers have always merged across deliberate shots
 * (`evidenceMerge.ts`): glare and shadow move when the phone moves, so a second
 * look reads what the first one lost, and costs add up so agreement compounds.
 * Harbours did not. Each shot re-read them from scratch and the LAST shot won,
 * so a second photo taken to fix two tiles could quietly make the harbours
 * worse. This gives them the same property as everything else on the board:
 * looking again never loses what an earlier look saw.
 *
 * Two kinds of evidence, merged differently because they mean different things:
 *
 *   - EDGE SCORES are detection strengths on the thirty coastal edges. They are
 *     SUMMED, like tile costs, so the frame set two shots agree on pulls ahead,
 *     and a shot that found nothing on an edge adds nothing to it.
 *   - CARD FEATURES describe what each harbour picture looks like. They are
 *     AVERAGED per edge over the shots that actually measured that card, so a
 *     glare-washed card in one photo is outvoted rather than added, and a card
 *     one shot declined to describe contributes nothing instead of a zero.
 *
 * Pure: no pixels, no React Native.
 */

import { edgeKey, selectFrame, type RingChoice } from '@/services/vision/harbourRing';
import { assignTypes } from '@/services/vision/harbourTypes';
import type { HarbourReading } from '@/services/vision/harbours';
import type { PortType } from '@/types/models';

export interface HarbourEvidence {
  /** Summed detection strength per coastal edge, keyed by `edgeKey`. */
  edgeScores: Record<string, number>;
  /** Summed card feature vectors per edge. */
  featureSums: Record<string, number[]>;
  /** How many shots measured each card, for the average. */
  featureCounts: Record<string, number>;
  /** Shots folded in. */
  shots: number;
}

export function emptyHarbourEvidence(): HarbourEvidence {
  return { edgeScores: {}, featureSums: {}, featureCounts: {}, shots: 0 };
}

/** One shot's harbour reading, as evidence that can be merged. */
export function evidenceFromReading(
  reading: Pick<HarbourReading, 'edgeScores' | 'slots' | 'features'>,
): HarbourEvidence {
  const edgeScores: Record<string, number> = {};
  for (const [key, score] of reading.edgeScores) edgeScores[key] = score;

  const featureSums: Record<string, number[]> = {};
  const featureCounts: Record<string, number> = {};
  reading.slots.forEach((slot, i) => {
    const f = reading.features[i];
    if (!f) return;
    const key = edgeKey(slot.hexIndex, slot.edge);
    featureSums[key] = [...f];
    featureCounts[key] = 1;
  });

  return { edgeScores, featureSums, featureCounts, shots: 1 };
}

/** Fold one shot into what earlier shots saw. Neither input is modified. */
export function mergeHarbourEvidence(a: HarbourEvidence, b: HarbourEvidence): HarbourEvidence {
  const edgeScores: Record<string, number> = { ...a.edgeScores };
  for (const [key, score] of Object.entries(b.edgeScores)) {
    edgeScores[key] = (edgeScores[key] ?? 0) + score;
  }

  const featureSums: Record<string, number[]> = {};
  for (const [key, sum] of Object.entries(a.featureSums)) featureSums[key] = [...sum];
  const featureCounts: Record<string, number> = { ...a.featureCounts };
  for (const [key, sum] of Object.entries(b.featureSums)) {
    const existing = featureSums[key];
    featureSums[key] = existing ? existing.map((v, k) => v + (sum[k] ?? 0)) : [...sum];
    featureCounts[key] = (featureCounts[key] ?? 0) + (b.featureCounts[key] ?? 0);
  }

  return { edgeScores, featureSums, featureCounts, shots: a.shots + b.shots };
}

export interface ResolvedHarbours extends RingChoice {
  /** What each harbour trades, parallel to `slots`. */
  types: PortType[];
  typeMargin: number;
}

/**
 * The harbours all the shots so far support.
 *
 * Positions come from `selectFrame` over the summed edge scores, so two shots
 * that were each too weak to confirm the frame on their own can confirm it
 * together. Types come from the averaged card features of whichever frame
 * positions won.
 *
 * Null before any shot has been folded in.
 */
export function resolveHarbours(evidence: HarbourEvidence): ResolvedHarbours | null {
  if (evidence.shots === 0) return null;
  const choice = selectFrame(new Map(Object.entries(evidence.edgeScores)));
  const features = choice.slots.map(slot => {
    const key = edgeKey(slot.hexIndex, slot.edge);
    const n = evidence.featureCounts[key] ?? 0;
    const sum = evidence.featureSums[key];
    return n > 0 && sum ? sum.map(v => v / n) : null;
  });
  const assigned = assignTypes(features);
  return { ...choice, types: assigned.types, typeMargin: assigned.margin };
}
