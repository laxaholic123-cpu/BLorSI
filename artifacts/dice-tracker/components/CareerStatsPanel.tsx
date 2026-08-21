/**
 * CareerStatsPanel
 *
 * Collapsible career overview section shown at the top of the History tab.
 * Renders:
 *   • Summary card: total sessions / rolls / Catan games
 *   • Number performance: per-number Catan lifetime luck% (luckiest → unluckiest)
 *   • Head-to-head: records for recurring player pairs
 *
 * Collapsed by default; the header row is always visible as a tap target.
 * Shows a nudge when fewer than CAREER_MIN_SESSIONS sessions exist.
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { useColors } from '@/hooks/useColors';
import type {
  CareerStats,
  NumberCareerStat,
  HeadToHeadRecord,
} from '@/services/careerStats';
import { CAREER_MIN_SESSIONS } from '@/services/careerStats';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CareerStatsPanelProps {
  /** null = not yet loaded; 'loading' = load in progress; 'error' = load failed (tap to retry) */
  stats: CareerStats | 'loading' | 'error' | null;
  expanded: boolean;
  onToggle: () => void;
  colors: ReturnType<typeof useColors>;
}

// ─── Colour helpers ───────────────────────────────────────────────────────────

function luckColor(pct: number, colors: ReturnType<typeof useColors>): string {
  if (pct >= 15) return '#22C55E';
  if (pct >= 5) return '#4ADE80';
  if (pct <= -15) return '#EF4444';
  if (pct <= -5) return '#F87171';
  return colors.mutedForeground;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NumberRow({
  stat,
  maxAbsPct,
  colors,
}: {
  stat: NumberCareerStat;
  maxAbsPct: number;
  colors: ReturnType<typeof useColors>;
}) {
  const pct = stat.luckPct;
  const col = luckColor(pct, colors);
  const isHot = pct > 0;
  // Bar width as fraction of max deviation (capped at 1)
  const fraction = maxAbsPct > 0 ? Math.min(Math.abs(pct) / maxAbsPct, 1) : 0;

  return (
    <View style={s.numRow}>
      {/* Number chip */}
      <View style={[s.numChip, { backgroundColor: colors.muted }]}>
        <Text style={[s.numChipText, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          {stat.number}
        </Text>
      </View>

      {/* Performance bar */}
      <View style={s.barTrack}>
        {/* Neutral midpoint marker */}
        <View style={[s.barMid, { backgroundColor: colors.border }]} />
        {/* Luck bar — grows right (hot) or left (cold) from center */}
        {fraction > 0 && (
          <View
            style={[
              s.barFill,
              {
                width: `${Math.round(fraction * 48)}%`,
                backgroundColor: col + '55',
                [isHot ? 'left' : 'right']: '50%',
              },
            ]}
          />
        )}
      </View>

      {/* Percentage label */}
      <Text
        style={[
          s.numPct,
          {
            color: col,
            fontFamily: 'Inter_700Bold',
            textAlign: 'right',
          },
        ]}
      >
        {pct >= 0 ? '+' : ''}{Math.round(pct)}%
      </Text>

      {/* Session count */}
      <Text style={[s.numSessions, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        {stat.sessionCount}g
      </Text>
    </View>
  );
}

function HeadToHeadRow({
  rec,
  colors,
}: {
  rec: HeadToHeadRecord;
  colors: ReturnType<typeof useColors>;
}) {
  const leaderName = rec.avgLuckDiffA >= 0 ? rec.nameA : rec.nameB;
  const leaderAdv = Math.abs(rec.avgLuckDiffA);
  const hasLeader = leaderAdv > 5;

  return (
    <View style={[s.h2hRow, { borderTopColor: colors.border }]}>
      <Text style={[s.h2hNames, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
        {capitalize(rec.nameA)} vs {capitalize(rec.nameB)}
      </Text>
      <View style={s.h2hRight}>
        <Text style={[s.h2hRecord, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          {rec.winsA}–{rec.winsB}{rec.ties > 0 ? `–${rec.ties}` : ''}
        </Text>
        {hasLeader && (
          <Text style={[s.h2hLeader, { color: '#22C55E', fontFamily: 'Inter_500Medium' }]}>
            {capitalize(leaderName)} +{Math.round(leaderAdv)}%
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CareerStatsPanel({ stats, expanded, onToggle, colors }: CareerStatsPanelProps) {
  const isLoading = stats === 'loading';

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header — always visible */}
      <TouchableOpacity
        style={[s.header, { borderBottomColor: colors.border, borderBottomWidth: expanded ? 1 : 0 }]}
        onPress={onToggle}
        activeOpacity={0.75}
      >
        <View style={s.headerLeft}>
          <Ionicons name="trending-up" size={16} color={colors.primary} />
          <Text style={[s.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            Career
          </Text>
          {!isLoading && stats !== null && stats !== 'error' && (
            <Text style={[s.headerSubtitle, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {stats.summary.totalSessions} sessions · {stats.summary.totalRolls} rolls
            </Text>
          )}
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.mutedForeground}
        />
      </TouchableOpacity>

      {/* Body — only when expanded */}
      {expanded && (
        <>
          {isLoading ? (
            <View style={s.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[s.loadingText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                Computing career stats…
              </Text>
            </View>
          ) : stats === 'error' ? (
            <TouchableOpacity style={s.nudgeRow} onPress={onToggle} activeOpacity={0.75}>
              <Ionicons name="alert-circle-outline" size={18} color="#EF4444" />
              <Text style={[s.nudgeText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                Couldn't load career stats. Tap to try again.
              </Text>
            </TouchableOpacity>
          ) : stats === null || !stats.summary.hasEnoughData ? (
            <View style={s.nudgeRow}>
              <Ionicons name="time-outline" size={18} color={colors.mutedForeground} />
              <Text style={[s.nudgeText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                Play {CAREER_MIN_SESSIONS - (stats?.summary.totalSessions ?? 0)} more game
                {CAREER_MIN_SESSIONS - (stats?.summary.totalSessions ?? 0) !== 1 ? 's' : ''} to
                see career trends.
              </Text>
            </View>
          ) : (
            <>
              {/* Summary stat pills */}
              <View style={s.summaryRow}>
                <StatPill
                  value={String(stats.summary.totalSessions)}
                  label="sessions"
                  colors={colors}
                />
                <StatPill
                  value={String(stats.summary.totalRolls)}
                  label="rolls"
                  colors={colors}
                />
                {stats.summary.boardModeSessions > 0 && (
                  <StatPill
                    value={String(stats.summary.boardModeSessions)}
                    label="Catan"
                    colors={colors}
                  />
                )}
              </View>

              {/* Number performance */}
              {stats.numberStats && stats.numberStats.length > 0 && (
                <View style={[s.section, { borderTopColor: colors.border }]}>
                  <Text style={[s.sectionTitle, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
                    NUMBER PERFORMANCE
                  </Text>
                  <NumberPerformanceList stats={stats.numberStats} colors={colors} />
                </View>
              )}

              {/* Head-to-head */}
              {stats.headToHead.length > 0 && (
                <View style={[s.section, { borderTopColor: colors.border }]}>
                  <Text style={[s.sectionTitle, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
                    HEAD TO HEAD
                  </Text>
                  {stats.headToHead.slice(0, 5).map(rec => (
                    <HeadToHeadRow
                      key={`${rec.nameA}|||${rec.nameB}`}
                      rec={rec}
                      colors={colors}
                    />
                  ))}
                </View>
              )}
            </>
          )}
        </>
      )}
    </View>
  );
}

// ─── Helper sub-components ────────────────────────────────────────────────────

function StatPill({
  value,
  label,
  colors,
}: {
  value: string;
  label: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[s.pill, { backgroundColor: colors.muted }]}>
      <Text style={[s.pillValue, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
        {value}
      </Text>
      <Text style={[s.pillLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        {label}
      </Text>
    </View>
  );
}

function NumberPerformanceList({
  stats,
  colors,
}: {
  stats: NumberCareerStat[];
  colors: ReturnType<typeof useColors>;
}) {
  // Show top 3 and bottom 3, collapsing middle if > 6 entries
  const show = stats.length <= 6
    ? stats
    : [...stats.slice(0, 3), ...stats.slice(-3)];

  const maxAbsPct = Math.max(...stats.map(s => Math.abs(s.luckPct)), 1);

  return (
    <View style={s.numList}>
      {show.map((stat, i) => {
        const hasDivider = stats.length > 6 && i === 2;
        return (
          <React.Fragment key={stat.number}>
            {hasDivider && (
              <Text style={[s.moreNumbers, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                · · ·
              </Text>
            )}
            <NumberRow stat={stat} maxAbsPct={maxAbsPct} colors={colors} />
          </React.Fragment>
        );
      })}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  card: {
    marginHorizontal: 14,
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  headerTitle: { fontSize: 16 },
  headerSubtitle: { fontSize: 12 },

  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  loadingText: { fontSize: 13 },

  nudgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  nudgeText: { fontSize: 13, flex: 1, lineHeight: 20 },

  summaryRow: { flexDirection: 'row', gap: 8, padding: 12, flexWrap: 'wrap' },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, alignItems: 'center', minWidth: 68 },
  pillValue: { fontSize: 18 },
  pillLabel: { fontSize: 11, marginTop: 2 },

  section: { borderTopWidth: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  sectionTitle: { fontSize: 10, letterSpacing: 0.7, marginBottom: 4 },

  numList: { gap: 6 },
  numRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  numChip: {
    width: 28, height: 28, borderRadius: 7,
    alignItems: 'center', justifyContent: 'center',
  },
  numChipText: { fontSize: 13 },

  barTrack: {
    flex: 1, height: 6, borderRadius: 3,
    backgroundColor: 'transparent',
    position: 'relative',
    overflow: 'hidden',
  },
  barMid: {
    position: 'absolute',
    left: '50%',
    top: 0, bottom: 0,
    width: 1,
  },
  barFill: {
    position: 'absolute',
    top: 0, bottom: 0,
    borderRadius: 3,
    minWidth: 3,
  },

  numPct: { fontSize: 12, minWidth: 44 },
  numSessions: { fontSize: 10, minWidth: 22 },

  moreNumbers: { textAlign: 'center', fontSize: 12, paddingVertical: 2 },

  h2hRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  h2hNames: { fontSize: 14, flex: 1 },
  h2hRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  h2hRecord: { fontSize: 13 },
  h2hLeader: { fontSize: 12 },
});
