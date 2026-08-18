/**
 * RollFrequencyChart — standalone bar chart for roll-frequency distribution.
 *
 * Renders each die value as a horizontal bar, colour-coded by how its actual
 * count compares to its expected count:
 *   - Teal  → rolled more than expected (hot)
 *   - Slate → rolled less than expected (cold)
 *   - Muted → on target, or too few rolls to say
 *
 * Colours and hot/cold thresholds both come from the shared chart palette, so
 * this agrees with CatanRollHeatMap. They used to disagree twice over: opposite
 * palettes (teal/slate here, green/red there) and different definitions of hot
 * (this chart called half a roll above expected "hot", which on eleven outcomes
 * coloured nearly everything).
 *
 * An expected-count tick mark is drawn on the bar track so players can
 * visually compare actual vs expected at a glance.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import type { FrequencyEntry } from '@/types/stats';

import {
  HOT_COLOR,
  COLD_COLOR,
  classifyRollTemperature,
  temperatureAccent,
} from '@/constants/chartPalette';

interface Props {
  frequencies: FrequencyEntry[];
  totalRolls: number;
}

export function RollFrequencyChart({ frequencies, totalRolls }: Props) {
  const colors = useColors();

  if (totalRolls === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          No rolls recorded yet
        </Text>
      </View>
    );
  }

  const maxCount = Math.max(...frequencies.map(f => f.count), 1);
  // Also need the max expected to position the expected tick correctly
  const maxExpected = Math.max(...frequencies.map(f => f.expectedCount), 1);
  // Use a shared scale so actual bars and expected ticks are on the same axis
  const scale = Math.max(maxCount, maxExpected);

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: HOT_COLOR }]} />
          <Text style={[styles.legendLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            above expected
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: COLD_COLOR }]} />
          <Text style={[styles.legendLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            below expected
          </Text>
        </View>
      </View>

      {/* Bars */}
      {frequencies.map(f => {
        const temperature = classifyRollTemperature(f.count, f.expectedCount, totalRolls);
        const accent = temperatureAccent(temperature, colors);
        const isNeutral = temperature === 'neutral' || temperature === 'unknown';
        const barColor = isNeutral ? colors.mutedForeground + 'AA' : accent;

        const barPct      = f.count        / scale;
        const expectedPct = f.expectedCount / scale;

        const devSign = f.deviation > 0 ? '+' : '';
        const devLabel = f.deviationPct === 0
          ? '—'
          : `${devSign}${f.deviationPct.toFixed(0)}%`;
        const devColor = accent;

        return (
          <View key={f.value} style={styles.row}>
            {/* Die-face value */}
            <Text style={[styles.valueLabel, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              {f.value}
            </Text>

            {/* Bar track */}
            <View style={[styles.track, { backgroundColor: colors.muted }]}>
              {/* Actual bar */}
              <View
                style={[
                  styles.bar,
                  {
                    width: `${barPct * 100}%` as `${number}%`,
                    backgroundColor: barColor,
                  },
                ]}
              />
              {/* Expected tick — thin vertical line at the expected-count position */}
              {expectedPct > 0 && (
                <View
                  style={[
                    styles.expectedTick,
                    {
                      left: `${expectedPct * 100}%` as `${number}%`,
                      backgroundColor: colors.foreground,
                    },
                  ]}
                />
              )}
            </View>

            {/* Count */}
            <Text style={[styles.countLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
              {f.count}
            </Text>

            {/* Deviation % */}
            <Text style={[styles.devLabel, { color: devColor, fontFamily: 'Inter_500Medium' }]}>
              {devLabel}
            </Text>
          </View>
        );
      })}

      {/* Footer note */}
      <Text style={[styles.footerNote, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        Tick mark shows expected count · bars are hot/cold vs. expected
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 14,
    gap: 10,
  },
  empty: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: { fontSize: 13 },

  legend: {
    flexDirection: 'row',
    gap: 14,
    paddingBottom: 4,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendSwatch: { width: 10, height: 10, borderRadius: 3 },
  legendLabel: { fontSize: 11 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  valueLabel: {
    width: 28,
    fontSize: 13,
    textAlign: 'center',
  },
  track: {
    flex: 1,
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
    position: 'relative',
  },
  bar: {
    height: 14,
    borderRadius: 7,
  },
  expectedTick: {
    position: 'absolute',
    top: 2,
    width: 2,
    height: 10,
    borderRadius: 1,
    opacity: 0.55,
    marginLeft: -1,
  },
  countLabel: {
    width: 28,
    textAlign: 'right',
    fontSize: 13,
  },
  devLabel: {
    width: 44,
    textAlign: 'right',
    fontSize: 11,
  },

  footerNote: {
    fontSize: 10,
    paddingTop: 2,
    opacity: 0.7,
  },
});
