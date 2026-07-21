/**
 * Catan-Compatible Mode verdict logic.
 *
 * Language is deliberately cautious — the tool measures dice luck and
 * placement exposure, not unobserved strategy, trading, or card play.
 *
 * This is an independent companion tool and is not affiliated with or
 * endorsed by the publishers or owners of Catan.
 */

import type {
  CatanExposureLuck,
  CatanFinalOutcome,
  CatanPlacementRating,
  CatanPlayerProductionStats,
  CatanRollLuck,
  CatanVerdictFindings,
  SevenFrequency,
} from '@/types/catanStats';

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** 
 * Expected placement strength for a "standard" initial 2-settlement Catan setup
 * (two intersections, each touching 3 average hexes).
 * Rough baseline: 10 pips / 36 ≈ 0.278 per settlement × 2 ≈ 0.556.
 */
const PLACEMENT_WEAK_THRESHOLD = 0.40;
const PLACEMENT_STRONG_THRESHOLD = 0.70;

/** Significant production luck deviation threshold (as fraction of expected) */
const LUCK_THRESHOLD = 0.15;

/** Seven frequency thresholds (as fraction of total rolls) */
const SEVEN_LOW_THRESHOLD = 0.11;  // < 11% → low
const SEVEN_HIGH_THRESHOLD = 0.22; // > 22% → high

// ─── Dimension classifiers ────────────────────────────────────────────────────

export function classifySevenFrequency(sevenCount: number, totalRolls: number): SevenFrequency {
  if (totalRolls === 0) return 'expected';
  const rate = sevenCount / totalRolls;
  if (rate < SEVEN_LOW_THRESHOLD) return 'low';
  if (rate > SEVEN_HIGH_THRESHOLD) return 'high';
  return 'expected';
}

export function classifyRollLuck(playerStats: CatanPlayerProductionStats[]): CatanRollLuck {
  if (playerStats.length === 0) return 'neutral';
  const totalActual = playerStats.reduce((s, p) => s + p.totalActualProduction, 0);
  const totalExpected = playerStats.reduce((s, p) => s + p.totalExpectedProduction, 0);
  if (totalExpected <= 0) return 'neutral';
  const deviation = (totalActual - totalExpected) / totalExpected;
  if (deviation < -LUCK_THRESHOLD) return 'unlucky';
  if (deviation > LUCK_THRESHOLD) return 'lucky';
  return 'neutral';
}

export function classifyExposureLuck(stats: CatanPlayerProductionStats): CatanExposureLuck {
  if (stats.totalExpectedProduction <= 0) return 'average';
  const pct = stats.productionLuckPct;
  if (pct < -15) return 'poor';
  if (pct > 15) return 'strong';
  return 'average';
}

export function classifyPlacementRating(stats: CatanPlayerProductionStats): CatanPlacementRating {
  const strength = stats.placementStrength;
  if (strength < PLACEMENT_WEAK_THRESHOLD) return 'weak';
  if (strength > PLACEMENT_STRONG_THRESHOLD) return 'strong';
  return 'average';
}

export function classifyFinalOutcome(
  rollLuck: CatanRollLuck,
  exposureLucks: CatanExposureLuck[],
  placementRatings: CatanPlacementRating[],
  isSmallSample: boolean,
): CatanFinalOutcome {
  if (isSmallSample) return 'too_early';

  const avgExposure: Record<CatanExposureLuck, number> = { poor: 0, average: 1, strong: 2 };
  const avgPlacement: Record<CatanPlacementRating, number> = { weak: 0, average: 1, strong: 2 };
  const exposureScore =
    exposureLucks.reduce((s, e) => s + avgExposure[e], 0) / Math.max(1, exposureLucks.length);
  const placementScore =
    placementRatings.reduce((s, p) => s + avgPlacement[p], 0) / Math.max(1, placementRatings.length);

  if (rollLuck === 'lucky' && exposureScore >= 1.5) return 'lucky_dice_lucky_exposure';
  if (rollLuck === 'unlucky' && exposureScore <= 0.5) return 'bad_dice_bad_exposure';
  if (placementScore >= 1.5 && rollLuck !== 'lucky') return 'strong_placement_poor_luck';
  if (placementScore <= 0.5 && rollLuck === 'lucky') return 'weak_placement_lucky_dice';
  if (rollLuck === 'neutral' && exposureScore >= 0.8 && exposureScore <= 1.2) return 'dice_were_fair';
  return 'mixed_evidence';
}

// ─── Copy ─────────────────────────────────────────────────────────────────────

const OUTCOME_COPY: Record<CatanFinalOutcome, { headline: string; details: string[] }> = {
  too_early: {
    headline: 'The jury is still out.',
    details: [
      'Not enough rolls to draw reliable conclusions.',
      'Keep playing — verdicts become meaningful after 30+ rolls.',
    ],
  },
  dice_were_fair: {
    headline: 'The dice were fair.',
    details: [
      'Roll frequencies matched what the probabilities predicted.',
      'Production closely tracked the expected output given each placement.',
      'Any outcome differences came from sources this tool cannot measure.',
    ],
  },
  lucky_dice_lucky_exposure: {
    headline: 'A charmed game.',
    details: [
      'The dice landed on strong numbers more than the odds suggested.',
      'High-probability numbers were hit above expected rates.',
      'This reflects measurable dice luck — strategy played a separate role.',
    ],
  },
  bad_dice_bad_exposure: {
    headline: 'Nothing went right — at least from what the dice can tell.',
    details: [
      'The dice underperformed across the board.',
      'Low-probability numbers appeared more than expected.',
      'Strategy and trading cannot be measured here — only the rolls and placements.',
    ],
  },
  strong_placement_poor_luck: {
    headline: 'Strong setup, rough dice.',
    details: [
      'The placements were on statistically strong numbers.',
      'The actual rolls, however, underperformed those numbers.',
      'That gap is measurable dice variance — not a strategy failure.',
    ],
  },
  weak_placement_lucky_dice: {
    headline: 'Lucky dice, modest setup.',
    details: [
      'The dice rolled hot, landing on numbers often.',
      'The exposed numbers were below average strength — the dice made up the gap.',
      'This result reflects luck, not a validation of placement strategy.',
    ],
  },
  mixed_evidence: {
    headline: 'A mixed picture.',
    details: [
      'Some numbers overperformed, others underperformed.',
      'Placements ranged from strong to modest across players.',
      'No single clean story emerges from the dice and exposure data alone.',
      'Factors outside this tool\'s scope — strategy, trading, card play — likely mattered.',
    ],
  },
};

// ─── Main classifier ──────────────────────────────────────────────────────────

export function classifyCatanVerdict(
  playerStats: CatanPlayerProductionStats[],
  sevenCount: number,
  totalRolls: number,
  isSmallSample: boolean,
): CatanVerdictFindings {
  const sevenFrequency = classifySevenFrequency(sevenCount, totalRolls);
  const rollLuck = classifyRollLuck(playerStats);

  const exposureLuck: Record<string, CatanExposureLuck> = {};
  const placementRating: Record<string, CatanPlacementRating> = {};

  for (const stats of playerStats) {
    exposureLuck[stats.playerId] = classifyExposureLuck(stats);
    placementRating[stats.playerId] = classifyPlacementRating(stats);
  }

  const finalOutcome = classifyFinalOutcome(
    rollLuck,
    Object.values(exposureLuck),
    Object.values(placementRating),
    isSmallSample,
  );

  const copy = OUTCOME_COPY[finalOutcome];

  return {
    sevenFrequency,
    rollLuck,
    exposureLuck,
    placementRating,
    finalOutcome,
    headline: copy.headline,
    details: copy.details,
  };
}
