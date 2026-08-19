/**
 * Deciding whether a live frame is worth reading.
 *
 * Pure — operates on already-sampled colours, so it is fully unit-testable.
 *
 * WHY THIS EXISTS
 * ---------------
 * Continuous capture turns every frame into evidence, and the merge in
 * evidenceMerge.ts assumes every contribution is honest: costs are summed, so
 * repeated agreement compounds into certainty. That is exactly the behaviour
 * that makes live scanning converge — and exactly what makes a MISALIGNED frame
 * dangerous. If the board drifts out of the guide, samples land on sand borders
 * and table, and merging that reading does not merely waste a frame: it
 * accumulates confident nonsense, and at thirty frames a second it does so
 * faster than a person can react.
 *
 * So the accumulation needs a gate. A frame is only merged when there is good
 * reason to believe the board is where the guide says it is. Rejecting a good
 * frame costs a thirtieth of a second; accepting a bad one corrupts the board.
 * The asymmetry is enormous, so this is deliberately strict.
 */

import type { Lab } from '@/services/vision/terrainPalette';
import { chroma, nearestTerrain, sampleQuality } from '@/services/vision/terrainPalette';

export interface FrameAssessment {
  usable: boolean;
  /** 0–1, how much of the board looked like plausible terrain. */
  coverage: number;
  reason: string;
}

/**
 * Fraction of hexes that must look like terrain before a frame is trusted.
 *
 * Set high because the failure being guarded against is systematic rather than
 * random: when alignment slips, MOST samples go wrong at once, not a scattered
 * few. A frame reading terrain on only half its hexes is not a partly-good
 * frame, it is a misaligned one.
 */
export const MIN_COVERAGE = 0.7;

/** Below this, the image is too dark or too washed out to read anything from. */
export const MIN_MEAN_CHROMA = 12;

/**
 * Judge a frame from the colours sampled at each of the 19 hex positions.
 *
 * `samples[i]` is the median colour at hex i, or null when it could not be
 * sampled (off-screen, for instance).
 */
export function assessFrame(samples: ReadonlyArray<Lab | null>): FrameAssessment {
  const present = samples.filter((s): s is Lab => s !== null);
  if (present.length === 0) {
    return { usable: false, coverage: 0, reason: 'Board not in view' };
  }

  const good: Lab[] = [];
  let tooDark = 0;
  for (const s of present) {
    const quality = sampleQuality(s);
    if (quality === 'good') good.push(s);
    else if (quality === 'too_dark') tooDark += 1;
  }
  const coverage = good.length / samples.length;

  // Darkness is checked BEFORE coverage on purpose. A dark frame also fails the
  // coverage test, but telling someone to realign a board that is already
  // aligned — when what they need is a lamp — sends them in the wrong direction.
  // Diagnose the cause, not the symptom.
  if (tooDark > present.length / 2) {
    return { usable: false, coverage, reason: 'Too dark — more light needed' };
  }

  if (coverage < MIN_COVERAGE) {
    // Either the board is not aligned with the guide, or glare has taken over.
    return {
      usable: false,
      coverage,
      reason: coverage < 0.3 ? 'Line the board up inside the guide' : 'Hold steady',
    };
  }

  const meanChroma = good.reduce((sum, s) => sum + chroma(s), 0) / Math.max(1, good.length);
  if (meanChroma < MIN_MEAN_CHROMA) {
    return { usable: false, coverage, reason: 'Too dark — more light needed' };
  }

  return { usable: true, coverage, reason: 'Reading' };
}

/**
 * Reject a frame whose hexes are suspiciously alike.
 *
 * A real board is a mixture of six terrains, so a frame where nearly every hex
 * classifies the same way is almost certainly pointed at something else — a
 * table, a rug, a closed box — rather than at a board that happens to be
 * uniform. This catches the case where a plausible-looking surface fills the
 * guide and produces confident, entirely wrong readings.
 */
export function looksLikeABoard(samples: ReadonlyArray<Lab | null>): boolean {
  const present = samples.filter((s): s is Lab => s !== null && sampleQuality(s) === 'good');
  if (present.length < 10) return false;

  const counts = new Map<string, number>();
  for (const s of present) {
    const t = nearestTerrain(s).terrain;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }

  // The real board's most common terrain covers 4 of 19 tiles. Allowing up to
  // two thirds leaves plenty of room for misreads while still rejecting a
  // uniform surface.
  const largest = Math.max(...counts.values());
  if (largest / present.length > 0.67) return false;

  // And it should show some variety — a board has at least three terrains
  // visible from any angle.
  return counts.size >= 3;
}

/** Combined gate: only true when a frame should be folded into the evidence. */
export function shouldMergeFrame(samples: ReadonlyArray<Lab | null>): FrameAssessment {
  const assessment = assessFrame(samples);
  if (!assessment.usable) return assessment;
  if (!looksLikeABoard(samples)) {
    return { usable: false, coverage: assessment.coverage, reason: 'Point the camera at the board' };
  }
  return assessment;
}
