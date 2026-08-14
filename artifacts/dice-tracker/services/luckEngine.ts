/**
 * Monte Carlo luck engine.
 *
 * All functions are pure and deterministic given a seed — no side effects, no
 * storage calls, no UI imports.
 *
 * WHY SIMULATION RATHER THAN A FIXED THRESHOLD
 * --------------------------------------------
 * The verdict layer used to ask "did production deviate from expectation by
 * more than 15%?". Whether 15% is remarkable depends entirely on how many rolls
 * were recorded and how much exposure the player had. For a typical six-hex
 * player, 15% is roughly 1.1σ over a 40-roll game but 1.8σ over a 100-roll one —
 * so the app was most willing to shout "unlucky!" exactly when it had the least
 * evidence, and flagged a quarter of all players in short games on fair dice.
 *
 * Simulating instead answers the question the app actually asks: hold the
 * player's placements fixed, re-roll the dice ten thousand times, and see where
 * their real result lands. That produces a percentile — small-sample-exact, no
 * normal approximation, and directly reportable to the player ("you were in the
 * 4th percentile") instead of a threshold nobody can interpret.
 */

// ─── Seeded PRNG ──────────────────────────────────────────────────────────────

/**
 * mulberry32 — small, fast, and good enough for simulation. Seeded so that a
 * verdict is reproducible: the same game always yields the same percentile, and
 * tests can assert exact numbers.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One fair 2D6 roll, returning 2–12. */
export function rollTwoD6(rng: () => number): number {
  return 2 + ((rng() * 6) | 0) + ((rng() * 6) | 0);
}

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface SimOptions {
  /** Simulated games to run. More = smoother percentile, linearly slower. */
  iterations?: number;
  /** Seed for reproducibility. */
  seed?: number;
}

export interface PercentileResult {
  /**
   * Where the observed value falls in the simulated distribution, 0–100.
   * Ties are split (mid-rank), so a perfectly average result reports ~50.
   */
  percentile: number;
  /** Mean of the simulated distribution. */
  simMean: number;
  /** Standard deviation of the simulated distribution. */
  simStdDev: number;
  iterations: number;
}

export const DEFAULT_ITERATIONS = 10_000;
export const DEFAULT_SEED = 0x5eed;

// ─── Percentile helper ────────────────────────────────────────────────────────

/**
 * Mid-rank percentile of `actual` within `samples`.
 * Ties contribute half their mass, so a discrete distribution with a heavy mode
 * does not push an average result to 0 or 100.
 */
export function percentileOf(actual: number, samples: ArrayLike<number>): number {
  const n = samples.length;
  if (n === 0) return 50;
  let below = 0;
  let equal = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i]!;
    if (s < actual) below++;
    else if (s === actual) equal++;
  }
  return ((below + equal / 2) / n) * 100;
}

function summarise(samples: Float64Array, actual: number): PercentileResult {
  const n = samples.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += samples[i]!;
  const mean = n > 0 ? sum / n : 0;
  let sqSum = 0;
  for (let i = 0; i < n; i++) {
    const d = samples[i]! - mean;
    sqSum += d * d;
  }
  return {
    percentile: percentileOf(actual, samples),
    simMean: mean,
    simStdDev: n > 0 ? Math.sqrt(sqSum / n) : 0,
    iterations: n,
  };
}

// ─── Catan production luck ────────────────────────────────────────────────────

/**
 * A per-roll lookup of the production weight a player would have collected for
 * each possible 2D6 value, given the buildings and robber blocks in force on
 * that turn. Index 0 and 1 are unused padding so the array can be indexed
 * directly by dice value.
 */
export type RollWeightTable = ReadonlyArray<ReadonlyArray<number>>;

/**
 * Percentile of a player's actual production against fair dice, holding their
 * placements and the robber timeline fixed.
 *
 * Low percentile = the dice underdelivered on the numbers they were on.
 * This is the "luck" half of the app's title; the placements that generated the
 * weight table are the "skill" half.
 */
export function simulateProductionPercentile(
  perRollWeights: RollWeightTable,
  actualTotal: number,
  opts: SimOptions = {},
): PercentileResult {
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  const rng = makeRng(opts.seed ?? DEFAULT_SEED);
  const rolls = perRollWeights.length;
  const totals = new Float64Array(iterations);

  for (let i = 0; i < iterations; i++) {
    let total = 0;
    for (let s = 0; s < rolls; s++) {
      total += perRollWeights[s]![rollTwoD6(rng)]!;
    }
    totals[i] = total;
  }

  return summarise(totals, actualTotal);
}

// ─── Goodness of fit ──────────────────────────────────────────────────────────

/**
 * Pearson chi-square statistic for observed counts against expected
 * probabilities. Categories with zero probability are skipped.
 */
export function chiSquare(
  observed: ReadonlyArray<number>,
  probs: ReadonlyArray<number>,
  totalRolls: number,
): number {
  let chi2 = 0;
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i]!;
    if (p <= 0) continue;
    const expected = p * totalRolls;
    const diff = (observed[i] ?? 0) - expected;
    chi2 += (diff * diff) / expected;
  }
  return chi2;
}

/**
 * Percentile of the observed chi-square among chi-squares from simulated fair
 * sessions of the same length.
 *
 * A HIGH percentile means the shape of the distribution is unusual — which the
 * mean alone cannot detect. A D20 that alternates 1 and 20 forever has a sample
 * mean of exactly 10.5 and a z-score of 0; only a goodness-of-fit test notices
 * that it never rolls anything else.
 *
 * Simulating rather than using the chi-square CDF keeps this exact at the small
 * sample sizes a board game actually produces, and avoids shipping an incomplete
 * gamma function.
 */
export function simulateFitPercentile(
  observed: ReadonlyArray<number>,
  probs: ReadonlyArray<number>,
  totalRolls: number,
  opts: SimOptions = {},
): PercentileResult {
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  const rng = makeRng(opts.seed ?? DEFAULT_SEED);
  const k = probs.length;

  // Cumulative distribution for categorical sampling.
  const cumulative = new Float64Array(k);
  let running = 0;
  for (let i = 0; i < k; i++) {
    running += probs[i]!;
    cumulative[i] = running;
  }

  const actual = chiSquare(observed, probs, totalRolls);
  const stats = new Float64Array(iterations);
  const counts = new Float64Array(k);

  for (let it = 0; it < iterations; it++) {
    counts.fill(0);
    for (let r = 0; r < totalRolls; r++) {
      const u = rng() * running;
      let idx = k - 1;
      for (let i = 0; i < k; i++) {
        if (u < cumulative[i]!) {
          idx = i;
          break;
        }
      }
      counts[idx]! += 1;
    }
    stats[it] = chiSquare(counts as unknown as number[], probs, totalRolls);
  }

  return summarise(stats, actual);
}

// ─── Percentile → plain language ──────────────────────────────────────────────

export type LuckBand = 'very_unlucky' | 'unlucky' | 'normal' | 'lucky' | 'very_lucky';

/**
 * Bands chosen so that on fair dice roughly 10% of players land in each tail and
 * 2% in each extreme — enough variety to stay entertaining, honest enough that
 * "very unlucky" still means something when it appears.
 */
export function bandForPercentile(percentile: number): LuckBand {
  if (percentile < 2) return 'very_unlucky';
  if (percentile < 10) return 'unlucky';
  if (percentile > 98) return 'very_lucky';
  if (percentile > 90) return 'lucky';
  return 'normal';
}

/** Renders a percentile the way a player would say it out loud. */
export function describePercentile(percentile: number): string {
  const p = Math.round(percentile);
  if (p <= 1) return 'unluckier than 99% of simulated games';
  if (p < 50) return `unluckier than ${100 - p}% of simulated games`;
  if (p === 50) return 'dead average';
  if (p >= 99) return 'luckier than 99% of simulated games';
  return `luckier than ${p}% of simulated games`;
}
