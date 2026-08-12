/**
 * Live Statistics Screen — accessible as a modal from the active game.
 * Shows full computed stats for the ongoing session.
 */

import React, { useMemo } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useGame } from '@/context/GameContext';
import { computeAllStats } from '@/services/stats';
import { RollFrequencyChart } from '@/components/RollFrequencyChart';

export default function StatsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeSession, rollEvents } = useGame();
  const webTop = Platform.OS === 'web' ? 67 : 0;

  const stats = useMemo(
    () => (activeSession ? computeAllStats(activeSession, rollEvents) : null),
    [activeSession, rollEvents],
  );

  if (!activeSession || !stats) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
          No active game
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold', fontSize: 15 }}>
            Go back
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isD20 = activeSession.diceMode === 'D20';
  const is2D6 = activeSession.diceMode === '2D6';
  const isMultiplayer = stats.playerSummaries.length > 1;
  const maxCount = Math.max(...stats.frequencies.map(f => f.count), 1);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Header ── */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + webTop + 12,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          Live Stats
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} hitSlop={8}>
          <Ionicons name="close" size={24} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Small-sample warning */}
        {stats.isSmallSample && (
          <View style={[styles.warningBanner, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Ionicons name="information-circle-outline" size={15} color={colors.mutedForeground} />
            <Text style={[styles.warningText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {stats.totalRolls} of {stats.smallSampleThreshold} rolls —{' '}
              statistics will become meaningful with more data.
            </Text>
          </View>
        )}

        {/* ── Overview ── */}
        <SectionLabel text="OVERVIEW" colors={colors} />
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.statRow}>
            <StatBox label="Rolls" value={String(stats.totalRolls)} colors={colors} />
            <StatBox label="Mean" value={stats.mean !== null ? stats.mean.toFixed(2) : '—'} colors={colors} />
            <StatBox label="Expected" value={stats.expectedMean.toFixed(1)} colors={colors} />
            <StatBox label="Median" value={stats.median !== null ? stats.median.toFixed(1) : '—'} colors={colors} />
          </View>
          {stats.mode.length > 0 && (
            <InfoRow label="Most rolled" value={stats.mode.join(', ')} colors={colors} primary />
          )}
          {stats.leastCommon.length > 0 && (
            <InfoRow label="Least rolled" value={stats.leastCommon.join(', ')} colors={colors} />
          )}
        </View>

        {/* ── Distribution ── */}
        <SectionLabel text="DISTRIBUTION (vs expected)" colors={colors} />
        <RollFrequencyChart frequencies={stats.frequencies} totalRolls={stats.totalRolls} />
        {!stats.isSmallSample && (
          <View style={styles.chartLegend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#1ABC9C' }]} />
              <Text style={[styles.legendLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                above expected
              </Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#5C7A9C' }]} />
              <Text style={[styles.legendLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                below expected
              </Text>
            </View>
          </View>
        )}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 8 }]}>
          {/* Column headers */}
          <View style={[styles.freqHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.freqColVal, styles.colHdr, { color: colors.mutedForeground }]}>VAL</Text>
            <View style={styles.freqColBar} />
            <Text style={[styles.freqColNum, styles.colHdr, { color: colors.mutedForeground }]}>GOT</Text>
            <Text style={[styles.freqColNum, styles.colHdr, { color: colors.mutedForeground }]}>EXP</Text>
            <Text style={[styles.freqColDev, styles.colHdr, { color: colors.mutedForeground }]}>±%</Text>
          </View>
          {stats.frequencies.map((f, idx) => {
            const isAbove = f.deviation > 0.5;
            const isBelow = f.deviation < -0.5;
            const barColor = isAbove ? '#1ABC9C' : isBelow ? '#5C7A9C' : colors.mutedForeground;
            const devColor = isAbove ? '#1ABC9C' : isBelow ? '#5C7A9C' : colors.mutedForeground;
            const barPct = stats.totalRolls > 0 ? f.count / maxCount : 0;
            const isLast = idx === stats.frequencies.length - 1;
            return (
              <View
                key={f.value}
                style={[
                  styles.freqRow,
                  { borderBottomColor: colors.border, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth },
                ]}
              >
                <Text style={[styles.freqColVal, styles.freqText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  {f.value}
                </Text>
                <View style={styles.freqColBar}>
                  <View style={[styles.barTrack, { backgroundColor: colors.muted }]}>
                    <View style={[styles.barFill, { width: `${barPct * 100}%` as `${number}%`, backgroundColor: barColor, opacity: 0.85 }]} />
                  </View>
                </View>
                <Text style={[styles.freqColNum, styles.freqText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  {f.count}
                </Text>
                <Text style={[styles.freqColNum, styles.freqText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  {f.expectedCount.toFixed(1)}
                </Text>
                <Text style={[styles.freqColDev, styles.freqText, { color: devColor, fontFamily: 'Inter_500Medium' }]}>
                  {f.deviationPct === 0 ? '—' : `${f.deviation > 0 ? '+' : ''}${f.deviationPct.toFixed(0)}%`}
                </Text>
              </View>
            );
          })}
        </View>

        {/* ── Streaks & gaps ── */}
        {(stats.longestStreak ?? stats.longestGap) && (
          <>
            <SectionLabel text="STREAKS & GAPS" colors={colors} />
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {stats.longestStreak && (
                <View style={styles.eventRow}>
                  <Ionicons name="flame-outline" size={15} color={colors.primary} />
                  <Text style={[styles.eventText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
                    Longest streak:{' '}
                    <Text style={{ fontFamily: 'Inter_700Bold', color: colors.primary }}>
                      {stats.longestStreak.value}
                    </Text>{' '}
                    rolled {stats.longestStreak.length}× in a row
                  </Text>
                </View>
              )}
              {stats.longestStreak && stats.longestGap && (
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
              )}
              {stats.longestGap && (
                <View style={styles.eventRow}>
                  <Ionicons name="hourglass-outline" size={15} color={colors.mutedForeground} />
                  <Text style={[styles.eventText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
                    Longest drought:{' '}
                    <Text style={{ fontFamily: 'Inter_700Bold' }}>{stats.longestGap.value}</Text> absent for{' '}
                    {stats.longestGap.longestGap} rolls
                  </Text>
                </View>
              )}
            </View>
          </>
        )}

        {/* ── D20 crits / fumbles ── */}
        {isD20 && stats.totalRolls > 0 && (
          <>
            <SectionLabel text="CRITS & FUMBLES" colors={colors} />
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.statRow}>
                <StatBox label="Nat 20s" value={String(stats.nat20Count)} colors={colors} highlight />
                <StatBox label="Nat 1s" value={String(stats.nat1Count)} colors={colors} />
              </View>
            </View>
          </>
        )}

        {/* ── 2D6 doubles ── */}
        {is2D6 && stats.doublesCount > 0 && (
          <>
            <SectionLabel text="DOUBLES" colors={colors} />
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.statRow}>
                <StatBox label="Doubles" value={String(stats.doublesCount)} colors={colors} highlight />
              </View>
            </View>
          </>
        )}

        {/* ── Player breakdown ── */}
        {isMultiplayer && (
          <>
            <SectionLabel text="PLAYER BREAKDOWN" colors={colors} />
            {stats.playerSummaries.map(ps => (
              <View
                key={ps.playerId}
                style={[styles.card, styles.playerCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text style={[styles.playerName, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                  {ps.displayName}
                </Text>
                <View style={styles.statRow}>
                  <StatBox label="Rolls" value={String(ps.rollCount)} colors={colors} />
                  <StatBox label="Avg" value={ps.mean !== null ? ps.mean.toFixed(2) : '—'} colors={colors} />
                  <StatBox label="Median" value={ps.median !== null ? ps.median.toFixed(1) : '—'} colors={colors} />
                </View>
                {ps.longestStreak && (
                  <Text style={[styles.playerNote, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                    Streak: {ps.longestStreak.value} × {ps.longestStreak.length}
                  </Text>
                )}
                {(isD20 && (ps.nat1Count > 0 || ps.nat20Count > 0)) && (
                  <Text style={[styles.playerNote, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                    Nat 20s: {ps.nat20Count} · Nat 1s: {ps.nat1Count}
                  </Text>
                )}
              </View>
            ))}
          </>
        )}

        {/* ── Verdict preview ── */}
        <SectionLabel text="CURRENT VERDICT" colors={colors} />
        <View style={[styles.verdictCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Text style={[styles.verdictHeadline, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            {stats.verdictHeadline}
          </Text>
          <Text style={[styles.verdictBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {stats.isSmallSample
              ? `${stats.smallSampleThreshold - stats.totalRolls} more rolls needed for a final verdict.`
              : stats.verdictExplanation}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type Colors = ReturnType<typeof useColors>;

function SectionLabel({ text, colors }: { text: string; colors: Colors }) {
  return (
    <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
      {text}
    </Text>
  );
}

function StatBox({
  label,
  value,
  highlight,
  colors,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  colors: Colors;
}) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statBoxValue, { color: highlight ? colors.primary : colors.foreground, fontFamily: 'Inter_700Bold' }]}>
        {value}
      </Text>
      <Text style={[styles.statBoxLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        {label}
      </Text>
    </View>
  );
}

function InfoRow({
  label,
  value,
  primary,
  colors,
}: {
  label: string;
  value: string;
  primary?: boolean;
  colors: Colors;
}) {
  return (
    <View style={[styles.infoRow, { borderTopColor: colors.border }]}>
      <Text style={[styles.infoLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        {label}
      </Text>
      <Text
        style={[
          styles.infoValue,
          { color: primary ? colors.primary : colors.foreground, fontFamily: 'Inter_600SemiBold' },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  bodyText: { fontSize: 16 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18 },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  scroll: { paddingHorizontal: 16, paddingTop: 8 },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 1.2,
    marginTop: 20,
    marginBottom: 8,
  },

  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
  },
  warningText: { flex: 1, fontSize: 13, lineHeight: 18 },

  card: { borderRadius: 12, borderWidth: 1, overflow: 'hidden', marginBottom: 4 },
  playerCard: { marginBottom: 10 },

  statRow: { flexDirection: 'row', paddingVertical: 14 },
  statBox: { flex: 1, alignItems: 'center', gap: 3 },
  statBoxValue: { fontSize: 22 },
  statBoxLabel: { fontSize: 11 },

  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  infoLabel: { fontSize: 13 },
  infoValue: { fontSize: 14 },

  // Distribution legend
  chartLegend: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
    marginBottom: 0,
    paddingHorizontal: 4,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 12 },

  // Frequency table
  freqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  freqRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  freqText: { fontSize: 13 },
  colHdr: { fontSize: 10, letterSpacing: 0.8, fontFamily: 'Inter_500Medium' },
  freqColVal: { width: 32 },
  freqColBar: { flex: 1, marginHorizontal: 8 },
  freqColNum: { width: 44, textAlign: 'right' },
  freqColDev: { width: 46, textAlign: 'right' },
  barTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },

  // Streaks & gaps
  eventRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14 },
  eventText: { flex: 1, fontSize: 14, lineHeight: 20 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14 },

  // Player
  playerName: { fontSize: 15, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  playerNote: { fontSize: 12, paddingHorizontal: 16, paddingBottom: 10, lineHeight: 18 },

  // Verdict
  verdictCard: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 8, marginBottom: 4 },
  verdictHeadline: { fontSize: 17 },
  verdictBody: { fontSize: 13, lineHeight: 20 },
});
