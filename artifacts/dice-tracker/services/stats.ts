/**
 * Statistics service for Skill Check.
 *
 * All functions are pure — no side effects, no storage calls, no UI imports.
 * Callers pass in a GameSession and RollEvent[] and receive a GameStats object.
 */

import type { DiceMode, GameSession, Player, RollEvent } from '@/types/models';
import type {
  FrequencyEntry,
  GameStats,
  GapInfo,
  PlayerStatSummary,
  StreakInfo,
} from '@/types/stats';
import { classifyVerdict, getVerdictCopy } from '@/services/verdict';
import { simulateFitPercentile } from '@/services/luckEngine';

// ─── Expected probability tables ─────────────────────────────────────────────

/**
 * Exact 2D6 probability for each sum.
 * Counts of ways to reach each value out of 36 total outcomes.
 */
export const TWO_D6_PROBS: Record<number, number> = {
  2: 1 / 36,
  3: 2 / 36,
  4: 3 / 36,
  5: 4 / 36,
  6: 5 / 36,
  7: 6 / 36,
  8: 5 / 36,
  9: 4 / 36,
  10: 3 / 36,
  11: 2 / 36,
  12: 1 / 36,
};

/**
 * Returns the theoretical probability of each value in [min, max].
 * 2D6 uses the exact distribution; all other modes are uniform.
 */
export const getExpectedProbabilities = (
  mode: DiceMode,
  min: number,
  max: number,
): Record<number, number> => {
  if (mode === '2D6') return { ...TWO_D6_PROBS };
  const n = max - min + 1;
  const prob = 1 / n;
  const result: Record<number, number> = {};
  for (let v = min; v <= max; v++) result[v] = prob;
  return result;
};

/** Theoretical mean for the given dice mode. */
export const getExpectedMean = (mode: DiceMode, min: number, max: number): number => {
  if (mode === '2D6') return 7;
  return (min + max) / 2;
};

/**
 * Theoretical population standard deviation for the given dice mode.
 * - 2D6: sqrt(35/6) ≈ 2.415  (sum of two independent D6 variances)
 * - Uniform [min, max]: sqrt((n²−1)/12) where n = max − min + 1
 */
export const getExpectedStdDev = (mode: DiceMode, min: number, max: number): number => {
  if (mode === '2D6') return Math.sqrt(35 / 6);
  const n = max - min + 1;
  return Math.sqrt((n * n - 1) / 12);
};

// ─── Descriptive statistics ───────────────────────────────────────────────────

export const getMean = (values: number[]): number | null => {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
};

export const getMedian = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
};

export const getFrequencyMap = (values: number[]): Record<number, number> => {
  const map: Record<number, number> = {};
  for (const v of values) map[v] = (map[v] ?? 0) + 1;
  return map;
};

export const computeFrequencies = (
  values: number[],
  min: number,
  max: number,
  probs: Record<number, number>,
): FrequencyEntry[] => {
  const freqMap = getFrequencyMap(values);
  const total = values.length;
  const entries: FrequencyEntry[] = [];
  for (let v = min; v <= max; v++) {
    const count = freqMap[v] ?? 0;
    const prob = probs[v] ?? 0;
    const expectedCount = prob * total;
    const deviation = count - expectedCount;
    const deviationPct = expectedCount > 0 ? (deviation / expectedCount) * 100 : 0;
    entries.push({ value: v, count, probability: prob, expectedCount, deviation, deviationPct });
  }
  return entries;
};

/** Returns the value(s) with the highest roll count. */
export const getMode = (entries: FrequencyEntry[]): number[] => {
  if (entries.length === 0) return [];
  const maxCount = Math.max(...entries.map(e => e.count));
  if (maxCount === 0) return [];
  return entries.filter(e => e.count === maxCount).map(e => e.value);
};

/** Returns the value(s) that were rolled least (only among values that appeared). */
export const getLeastCommon = (entries: FrequencyEntry[]): number[] => {
  const rolled = entries.filter(e => e.count > 0);
  if (rolled.length === 0) return [];
  const minCount = Math.min(...rolled.map(e => e.count));
  return rolled.filter(e => e.count === minCount).map(e => e.value);
};

// ─── Streak & gap analysis ────────────────────────────────────────────────────

/** Longest consecutive run of the same value in roll order. */
export const getLongestStreak = (values: number[]): StreakInfo | null => {
  if (values.length === 0) return null;
  let best: StreakInfo = { value: values[0]!, length: 1 };
  let cur: StreakInfo = { value: values[0]!, length: 1 };
  for (let i = 1; i < values.length; i++) {
    if (values[i] === cur.value) {
      cur = { ...cur, length: cur.length + 1 };
      if (cur.length > best.length) best = { ...cur };
    } else {
      cur = { value: values[i]!, length: 1 };
    }
  }
  return best.length >= 2 ? best : null;
};

/**
 * For each possible value in [min, max], find the longest run of consecutive
 * rolls that did NOT produce that value. Returns the worst offender.
 *
 * Only counts droughts that start after the value's first appearance — a value
 * that has never come up yet is reported by getLeastCommon, not here.
 * The run still open at the end of the session DOES count: "I haven't rolled an
 * 8 since turn six" is the whole point of this statistic, and it is always the
 * drought a player is complaining about when the game ends.
 */
export const getLongestGap = (
  values: number[],
  min: number,
  max: number,
): GapInfo | null => {
  if (values.length < 2) return null;
  let best: GapInfo | null = null;
  for (let v = min; v <= max; v++) {
    let longestGap = 0;
    let currentGap = 0;
    let seen = false;
    for (const val of values) {
      if (val === v) {
        if (seen && currentGap > longestGap) longestGap = currentGap;
        currentGap = 0;
        seen = true;
      } else if (seen) {
        currentGap++;
      }
    }
    // Flush the trailing drought — the value appeared, then never came back.
    if (seen && currentGap > longestGap) longestGap = currentGap;
    if (seen && longestGap > 0) {
      if (!best || longestGap > best.longestGap) {
        best = { value: v, longestGap };
      }
    }
  }
  return best;
};

// ─── Z-score ──────────────────────────────────────────────────────────────────

/**
 * Returns the z-score of the sample mean relative to the expected mean.
 * A negative score means rolls were below average; positive means above.
 */
export const getMeanZScore = (
  mean: number,
  mode: DiceMode,
  min: number,
  max: number,
  totalRolls: number,
): number | null => {
  if (totalRolls < 2) return null;
  const expectedMean = getExpectedMean(mode, min, max);
  const stdDev = getExpectedStdDev(mode, min, max);
  const se = stdDev / Math.sqrt(totalRolls);
  if (se === 0) return null;
  return (mean - expectedMean) / se;
};

// ─── Per-player summary ───────────────────────────────────────────────────────

export const getPlayerSummary = (
  events: RollEvent[],
  player: Player,
  mode: DiceMode,
): PlayerStatSummary => {
  const playerEvents = events.filter(e => e.playerId === player.id);
  const values = playerEvents.map(e => e.value);
  const streak = getLongestStreak(values);
  const isD20 = mode === 'D20';
  const is2D6 = mode === '2D6';

  const modeValues: number[] = (() => {
    if (values.length === 0) return [];
    const fm = getFrequencyMap(values);
    const maxC = Math.max(...Object.values(fm));
    return Object.entries(fm)
      .filter(([, c]) => c === maxC)
      .map(([v]) => Number(v))
      .sort((a, b) => a - b);
  })();

  return {
    playerId: player.id,
    displayName: player.displayName,
    rollCount: values.length,
    mean: getMean(values),
    median: getMedian(values),
    mode: modeValues,
    min: values.length > 0 ? Math.min(...values) : null,
    max: values.length > 0 ? Math.max(...values) : null,
    nat1Count: isD20 ? values.filter(v => v === 1).length : 0,
    nat20Count: isD20 ? values.filter(v => v === 20).length : 0,
    doublesCount: is2D6
      ? playerEvents.filter(
          e =>
            e.individualDiceValues?.length === 2 &&
            e.individualDiceValues[0] === e.individualDiceValues[1],
        ).length
      : 0,
    longestStreak: streak,
  };
};

// ─── Duration ─────────────────────────────────────────────────────────────────

export const getDurationSeconds = (session: GameSession): number | null => {
  if (!session.endedAt) return null;
  const start = new Date(session.startedAt).getTime();
  const end = new Date(session.endedAt).getTime();
  if (isNaN(start) || isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
};

export const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
};

// ─── Main computation ─────────────────────────────────────────────────────────

export const SMALL_SAMPLE_THRESHOLD = 30;

/** Controls the optional Monte Carlo goodness-of-fit pass. */
export interface StatsOptions {
  /**
   * Run the goodness-of-fit simulation and populate fitPercentile. Off by
   * default — it costs ~10k simulated sessions, which is right for a results
   * screen but wasteful for live in-game recomputation on every roll.
   */
  simulate?: boolean;
  iterations?: number;
  seed?: number;
}

export const computeAllStats = (
  session: GameSession,
  events: RollEvent[],
  options: StatsOptions = {},
): GameStats => {
  const activeEvents = events.filter(e => !e.deletedAt);
  const values = activeEvents.map(e => e.value);
  const { diceMode: mode, minimumRoll: min, maximumRoll: max, players } = session;
  const totalRolls = values.length;
  const isD20 = mode === 'D20';
  const is2D6 = mode === '2D6';

  const probs = getExpectedProbabilities(mode, min, max);
  const frequencies = computeFrequencies(values, min, max, probs);
  const mean = getMean(values);
  const median = getMedian(values);
  const modeValues = getMode(frequencies);
  const leastCommon = getLeastCommon(frequencies);
  const longestStreak = getLongestStreak(values);
  const longestGap = getLongestGap(values, min, max);

  const playerSummaries = players.map(p => getPlayerSummary(activeEvents, p, mode));

  const nat1Count = isD20 ? values.filter(v => v === 1).length : 0;
  const nat20Count = isD20 ? values.filter(v => v === 20).length : 0;
  const doublesCount = is2D6
    ? activeEvents.filter(
        e =>
          e.individualDiceValues?.length === 2 &&
          e.individualDiceValues[0] === e.individualDiceValues[1],
      ).length
    : 0;

  const expectedMean = getExpectedMean(mode, min, max);
  const meanZScore =
    mean !== null ? getMeanZScore(mean, mode, min, max, totalRolls) : null;

  const isSmallSample = totalRolls < SMALL_SAMPLE_THRESHOLD;
  const durationSeconds = getDurationSeconds(session);

  // Goodness of fit — catches a distribution whose shape is wrong even when its
  // average is spot on. Opt-in because it simulates 10k sessions.
  let fitPercentile: number | undefined;
  if (options.simulate && totalRolls > 0) {
    const observed = frequencies.map(f => f.count);
    const probList = frequencies.map(f => f.probability);
    fitPercentile = simulateFitPercentile(observed, probList, totalRolls, {
      iterations: options.iterations,
      seed: options.seed,
    }).percentile;
  }

  const verdict = classifyVerdict(
    totalRolls,
    meanZScore,
    isSmallSample,
    players.length > 1,
    fitPercentile,
  );
  const { headline: verdictHeadline, explanation: verdictExplanation } =
    getVerdictCopy(verdict);

  return {
    totalRolls,
    mean,
    median,
    mode: modeValues,
    leastCommon,
    overallMin: values.length > 0 ? Math.min(...values) : null,
    overallMax: values.length > 0 ? Math.max(...values) : null,
    frequencies,
    longestStreak,
    longestGap,
    playerSummaries,
    nat1Count,
    nat20Count,
    doublesCount,
    isSmallSample,
    smallSampleThreshold: SMALL_SAMPLE_THRESHOLD,
    durationSeconds,
    expectedMean,
    meanZScore,
    ...(fitPercentile !== undefined ? { fitPercentile } : {}),
    verdict,
    verdictHeadline,
    verdictExplanation,
  };
};
