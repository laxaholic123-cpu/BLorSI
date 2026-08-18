/**
 * Shared palette and hot/cold classification for every roll-distribution chart.
 *
 * Pure — no React, no UI imports beyond the colour token type.
 *
 * WHY THIS EXISTS
 * ---------------
 * The heat map and the frequency chart each hardcoded their own colours and
 * their own idea of "hot". The heat map painted hot numbers green and cold ones
 * red; the frequency chart painted hot teal and cold slate. Same data, two
 * visual languages, on screens a player flips between — so a number could be
 * green in one place and slate in another within the same session.
 *
 * They also disagreed on what "hot" meant. The frequency chart used an absolute
 * deviation of half a roll, which on eleven outcomes colours almost everything;
 * the heat map used a ratio with a minimum sample. Classification lives here now
 * so the two cannot drift again.
 *
 * Red is deliberately reserved for 7. A 7 is not a hot or cold number — it moves
 * the robber and produces nothing for anybody — so it gets its own colour rather
 * than sitting on the hot/cold scale at all.
 */

import type { useColors } from '@/hooks/useColors';

type ColorTokens = ReturnType<typeof useColors>;

// ─── Palette ──────────────────────────────────────────────────────────────────

/** Rolled more often than its probability predicts. */
export const HOT_COLOR = '#1ABC9C';
/** Milder version of hot, for the inner band. */
export const HOT_COLOR_SOFT = '#4FD1B5';
/** Rolled less often than its probability predicts. */
export const COLD_COLOR = '#5C7A9C';
/** Milder version of cold. */
export const COLD_COLOR_SOFT = '#8AA3BD';
/** The robber. Not part of the hot/cold scale. */
export const SEVEN_COLOR = '#EF4444';
/** Ring around numbers a player has a building on. */
export const SETTLEMENT_RING_COLOR = '#F59E0B';

/** Alpha suffixes for background tints, strongest first. */
const TINT_STRONG = '38';
const TINT_SOFT = '20';

// ─── Classification ───────────────────────────────────────────────────────────

export type RollTemperature = 'hot' | 'warm' | 'neutral' | 'cool' | 'cold' | 'unknown';

/**
 * Below this many rolls, nothing is called hot or cold.
 *
 * Early in a game every number looks extreme — three 8s in the first ten rolls
 * is a ratio of 2.2 and means nothing.
 */
export const HEAT_MIN_SAMPLE = 20;

/**
 * How many standard deviations from expectation before a number is coloured.
 *
 * Standardised, NOT a fixed percentage. A count is binomial, so its standard
 * deviation is sqrt(expected × (1 − p)) — which means the same percentage
 * deviation is ordinary in a short game and remarkable in a long one. At 41
 * rolls the expected count for 6 is 5.7 with an SD of 2.2, so a fixed ±20% band
 * sits at half a standard deviation and lights up almost every number; over 200
 * rolls that same band would be nearly three SDs and would light up none.
 *
 * Colouring on z instead means the chart stays roughly as busy at 40 rolls as it
 * does at 400, and the chips that light up carry the same weight either way.
 * This is the same reasoning as the verdict layer's seven-frequency band — a
 * fixed threshold is not a threshold, it is a function of how long you played.
 */
const Z_STRONG = 2.0;
const Z_MILD = 1.25;

/**
 * Classify a roll count against its expectation.
 *
 * `expected` is p × totalRolls, so the underlying probability is recovered as
 * expected / totalRolls — no extra parameter needed.
 */
export function classifyRollTemperature(
  count: number,
  expected: number,
  totalRolls: number,
): RollTemperature {
  if (totalRolls < HEAT_MIN_SAMPLE) return 'unknown';
  if (expected <= 0) return 'unknown';

  const p = Math.min(1, expected / totalRolls);
  const variance = expected * (1 - p);
  if (variance <= 0) return 'unknown';

  const z = (count - expected) / Math.sqrt(variance);
  if (z >= Z_STRONG) return 'hot';
  if (z >= Z_MILD) return 'warm';
  if (z <= -Z_STRONG) return 'cold';
  if (z <= -Z_MILD) return 'cool';
  return 'neutral';
}

// ─── Colour lookup ────────────────────────────────────────────────────────────

export interface ChipColors {
  bg: string;
  text: string;
}

/** Background and text colour for a chip at a given temperature. */
export function temperatureChipColors(
  temperature: RollTemperature,
  colors: ColorTokens,
): ChipColors {
  switch (temperature) {
    case 'hot':
      return { bg: HOT_COLOR + TINT_STRONG, text: HOT_COLOR };
    case 'warm':
      return { bg: HOT_COLOR + TINT_SOFT, text: HOT_COLOR_SOFT };
    case 'cold':
      return { bg: COLD_COLOR + TINT_STRONG, text: COLD_COLOR };
    case 'cool':
      return { bg: COLD_COLOR + TINT_SOFT, text: COLD_COLOR_SOFT };
    default:
      return { bg: colors.muted, text: colors.mutedForeground };
  }
}

/** Solid colour for a bar or a deviation label. */
export function temperatureAccent(
  temperature: RollTemperature,
  colors: ColorTokens,
): string {
  switch (temperature) {
    case 'hot':
      return HOT_COLOR;
    case 'warm':
      return HOT_COLOR_SOFT;
    case 'cold':
      return COLD_COLOR;
    case 'cool':
      return COLD_COLOR_SOFT;
    default:
      return colors.mutedForeground;
  }
}

/** Chip colours for the 7, which sits outside the hot/cold scale entirely. */
export function sevenChipColors(count: number, colors: ColorTokens): ChipColors {
  return {
    bg: count > 0 ? SEVEN_COLOR + '30' : colors.muted,
    text: SEVEN_COLOR,
  };
}
