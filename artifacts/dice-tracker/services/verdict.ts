/**
 * Verdict classification and copy layer for Skill Check.
 *
 * classifyVerdict() — pure classification from numbers, no copy.
 * getVerdictCopy()  — converts a VerdictKey into user-facing headline + explanation.
 *
 * These two layers are intentionally separate so copy can be updated
 * without touching the classification logic (and vice-versa).
 */

import type { VerdictKey } from '@/types/stats';

// ─── Classification ───────────────────────────────────────────────────────────

/**
 * Returns a VerdictKey given the essential statistics.
 * No UI imports; no GameStats type to avoid circular dependencies.
 */
/**
 * Minimum rolls before a shape anomaly is worth calling out. Below this the
 * chi-square percentile is too jumpy to accuse anyone's dice of anything.
 */
const RIGGED_MIN_ROLLS = 60;

/**
 * Percentile of the goodness-of-fit statistic above which the distribution's
 * shape is called out. Deliberately severe: at 99 this fires on 1% of fair
 * sessions, so when it does appear it still means something.
 */
const RIGGED_FIT_PERCENTILE = 99;

export const classifyVerdict = (
  totalRolls: number,
  meanZScore: number | null,
  isSmallSample: boolean,
  isMultiplayer: boolean,
  fitPercentile?: number,
): VerdictKey => {
  if (isSmallSample || totalRolls < 30) return 'too_early';
  if (meanZScore === null) return 'too_early';

  // Checked before the mean, because a distribution can be badly misshapen
  // while its average sits exactly on target — which is the case the mean-based
  // branches below are structurally blind to.
  if (
    typeof fitPercentile === 'number' &&
    totalRolls >= RIGGED_MIN_ROLLS &&
    fitPercentile >= RIGGED_FIT_PERCENTILE
  ) {
    return 'dice_look_rigged';
  }

  const z = meanZScore;

  // Extreme bad luck in a multiplayer game — can't entirely blame luck
  if (z < -2.0 && isMultiplayer) return 'bad_luck_and_skill_issue';
  // Bad luck (below average, statistically significant)
  if (z < -1.0) return 'bad_luck';
  // Suspiciously good rolls
  if (z > 1.5) return 'suspiciously_lucky';

  // Within 0.3 σ — remarkably close to perfect
  if (Math.abs(z) < 0.3) return 'cleared_of_wrongdoing';

  // Fair dice in a multiplayer game — outcomes were down to skill/strategy
  if (Math.abs(z) < 1.0 && isMultiplayer) return 'skill_issue';

  // Fair dice, single-player
  if (Math.abs(z) < 1.0) return 'dice_were_fair';

  return 'mixed_evidence';
};

// ─── Copy layer ───────────────────────────────────────────────────────────────

interface VerdictCopy {
  headline: string;
  explanation: string;
}

const COPY: Record<VerdictKey, VerdictCopy> = {
  too_early: {
    headline: "The jury's still out.",
    explanation:
      'Not enough rolls yet to pass judgment. Statistics need at least 30 rolls before the evidence becomes meaningful. Keep rolling.',
  },
  bad_luck: {
    headline: 'Bad luck. Definitely bad luck.',
    explanation:
      'Rolls were statistically below average. The dice were not on your side tonight — this is a legitimate complaint that holds up to scrutiny.',
  },
  bad_luck_and_skill_issue: {
    headline: 'Bad luck… and a skill issue.',
    explanation:
      'Rolls ran cold AND the competition had fair dice to work with. That is a rough combination. We will give you the bad luck — but the rest is on you.',
  },
  suspiciously_lucky: {
    headline: 'Suspiciously lucky.',
    explanation:
      "Rolls were statistically above average. Are you sure those dice came out of the box today? The numbers are raising an eyebrow.",
  },
  skill_issue: {
    headline: 'Skill issue.',
    explanation:
      'The dice were perfectly fair. Whatever happened out there, the dice cannot be blamed for this one. The verdict is in.',
  },
  dice_were_fair: {
    headline: 'The dice did their job.',
    explanation:
      'Roll distribution was close to expected. The dice held up their end of the bargain. No complaints accepted.',
  },
  cleared_of_wrongdoing: {
    headline: 'The dice have been cleared of all wrongdoing.',
    explanation:
      'Distribution was remarkably close to theoretical probability. The dice are innocent. Completely innocent. The case is closed.',
  },
  mixed_evidence: {
    headline: 'The evidence is mixed.',
    explanation:
      "Some values came up more than expected, others less. The dice lawyer calls this 'within normal variation.' The truth remains elusive.",
  },
  dice_look_rigged: {
    headline: 'These dice are behaving strangely.',
    explanation:
      'The average is one thing — the shape is another. Some values came up far more often than they should have, and others barely showed up at all. Fewer than 1 in 100 fair sessions look like this. Check the dice.',
  },
};

export const getVerdictCopy = (verdict: VerdictKey): VerdictCopy => COPY[verdict];
