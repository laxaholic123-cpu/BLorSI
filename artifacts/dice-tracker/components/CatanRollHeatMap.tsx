/**
 * CatanRollHeatMap
 *
 * A compact horizontal strip showing how often each 2D6 outcome (2–12)
 * has rolled relative to its fair probability.
 *
 * Each chip shows:
 *   • The number (bold)
 *   • A tiny roll count
 *   • Background tinted green (hot) / red (cold) / neutral based on
 *     actual vs expected frequency
 *   • An amber border ring when that number is in any player's settlement
 *     position (so players can see at a glance if their spots are hitting)
 *
 * The 7 is always shown in the standard destructive red.
 * When fewer than 5 rolls have been recorded the chips are all neutral
 * (not enough data to infer hot/cold).
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { useColors } from '@/hooks/useColors';
import { CATAN_PROBS } from '@/services/catanStats';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CatanRollHeatMapProps {
  /** Actual count per rolled value (including 7s) */
  rollCounts: Record<number, number>;
  /** Total non-deleted roll events */
  totalRolls: number;
  /** Numbers covered by at least one player's active settlement/city */
  settlementNumbers: Set<number>;
  colors: ReturnType<typeof useColors>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_NUMBERS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MIN_SAMPLE = 5; // below this, show neutral chips

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns background and text colors for a chip based on its hot/cold status.
 * For 7 always returns the destructive palette.
 */
function chipColors(
  n: number,
  count: number,
  totalRolls: number,
  colors: ReturnType<typeof useColors>,
): { bg: string; text: string } {
  if (n === 7) {
    return {
      bg: count > 0 ? '#EF444430' : colors.muted,
      text: '#EF4444',
    };
  }

  if (totalRolls < MIN_SAMPLE) {
    return { bg: colors.muted, text: colors.mutedForeground };
  }

  const expected = (CATAN_PROBS[n] ?? 0) * totalRolls;
  if (expected === 0) return { bg: colors.muted, text: colors.mutedForeground };

  const ratio = count / expected;

  if (ratio >= 1.5) return { bg: '#22C55E38', text: '#22C55E' };
  if (ratio >= 1.15) return { bg: '#22C55E22', text: '#4ADE80' };
  if (ratio <= 0) return { bg: colors.muted, text: colors.mutedForeground };
  if (ratio <= 0.5) return { bg: '#EF444428', text: '#EF4444' };
  if (ratio <= 0.8) return { bg: '#EF444415', text: '#F87171' };
  return { bg: colors.muted, text: colors.mutedForeground };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CatanRollHeatMap({
  rollCounts,
  totalRolls,
  settlementNumbers,
  colors,
}: CatanRollHeatMapProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[s.strip, { borderTopColor: colors.border }]}
      contentContainerStyle={s.stripContent}
    >
      {ALL_NUMBERS.map(n => {
        const count = rollCounts[n] ?? 0;
        const isSettlement = settlementNumbers.has(n);
        const { bg, text } = chipColors(n, count, totalRolls, colors);
        const hotNum = n === 6 || n === 8;

        return (
          <View
            key={n}
            style={[
              s.chip,
              { backgroundColor: bg },
              isSettlement && { borderColor: '#F59E0B', borderWidth: 1.5 },
              !isSettlement && { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
            ]}
          >
            <Text
              style={[
                s.chipNum,
                { color: text, fontFamily: 'Inter_700Bold' },
                hotNum && { color: text === colors.mutedForeground ? '#D97706' : text },
              ]}
            >
              {n}
            </Text>
            <Text style={[s.chipCount, { color: text, fontFamily: 'Inter_400Regular' }]}>
              {count}×
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  strip: {
    flexShrink: 0,
    flexGrow: 0,
    borderTopWidth: 1,
  },
  stripContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chip: {
    width: 36,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  chipNum: { fontSize: 14 },
  chipCount: { fontSize: 10 },
});
