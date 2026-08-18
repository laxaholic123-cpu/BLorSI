/**
 * CatanRollHeatMap
 *
 * A compact horizontal strip showing how often each 2D6 outcome (2–12)
 * has rolled relative to its fair probability.
 *
 * Each chip shows:
 *   • The number (bold)
 *   • A tiny roll count
 *   • Background tinted hot (teal) / cold (slate) / neutral based on
 *     actual vs expected frequency, using the shared chart palette so this
 *     agrees with RollFrequencyChart
 *   • An amber border ring when that number is in any player's settlement
 *     position (so players can see at a glance if their spots are hitting)
 *
 * The 7 is always shown in red — it moves the robber and produces nothing, so it
 * is not on the hot/cold scale at all.
 * Below HEAT_MIN_SAMPLE rolls every chip stays neutral: early in a game the
 * ratios swing wildly and mean nothing.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { useColors } from '@/hooks/useColors';
import { CATAN_PROBS } from '@/services/catanStats';
import {
  SETTLEMENT_RING_COLOR,
  classifyRollTemperature,
  sevenChipColors,
  temperatureChipColors,
} from '@/constants/chartPalette';

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Background and text colours for a chip. Thresholds and palette both come from
 * the shared module, so this cannot drift away from the frequency chart.
 */
function chipColors(
  n: number,
  count: number,
  totalRolls: number,
  colors: ReturnType<typeof useColors>,
): { bg: string; text: string } {
  if (n === 7) return sevenChipColors(count, colors);

  const expected = (CATAN_PROBS[n] ?? 0) * totalRolls;
  const temperature = classifyRollTemperature(count, expected, totalRolls);
  return temperatureChipColors(temperature, colors);
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
              isSettlement && { borderColor: SETTLEMENT_RING_COLOR, borderWidth: 1.5 },
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
