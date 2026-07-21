/**
 * Statistics types for Skill Check.
 *
 * These are the output shapes of services/stats.ts. All types are
 * plain data — no UI or React Native imports allowed here.
 */

// ─── Verdict ──────────────────────────────────────────────────────────────────

export type VerdictKey =
  | 'too_early'
  | 'bad_luck'
  | 'dice_were_fair'
  | 'suspiciously_lucky'
  | 'skill_issue'
  | 'bad_luck_and_skill_issue'
  | 'cleared_of_wrongdoing'
  | 'mixed_evidence';

// ─── Frequency table ─────────────────────────────────────────────────────────

export interface FrequencyEntry {
  value: number;
  count: number;
  /** Theoretical probability of this value (0–1) */
  probability: number;
  /** probability × totalRolls */
  expectedCount: number;
  /** count − expectedCount */
  deviation: number;
  /** (deviation / max(1, expectedCount)) × 100 */
  deviationPct: number;
}

// ─── Streak & gap ─────────────────────────────────────────────────────────────

export interface StreakInfo {
  value: number;
  length: number;
}

export interface GapInfo {
  /** The value that went quiet */
  value: number;
  /** Longest run of rolls without this value appearing */
  longestGap: number;
}

// ─── Per-player summary ───────────────────────────────────────────────────────

export interface PlayerStatSummary {
  playerId: string;
  displayName: string;
  rollCount: number;
  mean: number | null;
  median: number | null;
  /** Most common value(s) for this player */
  mode: number[];
  min: number | null;
  max: number | null;
  /** D20 only */
  nat1Count: number;
  /** D20 only */
  nat20Count: number;
  /** 2D6 only — requires individualDiceValues to be set on events */
  doublesCount: number;
  longestStreak: StreakInfo | null;
}

// ─── Full stats output ────────────────────────────────────────────────────────

export interface GameStats {
  totalRolls: number;
  mean: number | null;
  median: number | null;
  /** Most common value(s) overall */
  mode: number[];
  /** Least common rolled value(s) (only values that appeared at least once) */
  leastCommon: number[];
  overallMin: number | null;
  overallMax: number | null;
  /** One entry per possible value in [min, max] */
  frequencies: FrequencyEntry[];
  longestStreak: StreakInfo | null;
  longestGap: GapInfo | null;
  playerSummaries: PlayerStatSummary[];
  /** D20 only — total across all players */
  nat1Count: number;
  /** D20 only — total across all players */
  nat20Count: number;
  /** 2D6 only — total across all players */
  doublesCount: number;
  isSmallSample: boolean;
  smallSampleThreshold: number;
  durationSeconds: number | null;
  expectedMean: number;
  /** z-score of actual mean vs theoretical; null when n < 2 */
  meanZScore: number | null;
  verdict: VerdictKey;
  verdictHeadline: string;
  verdictExplanation: string;
}
