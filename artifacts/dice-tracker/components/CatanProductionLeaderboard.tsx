/**
 * CatanProductionLeaderboard
 *
 * Compact live production summary shown during an active Catan game.
 * Displays one row per player with:
 *   • Expected vs actual weighted production
 *   • ±% luck indicator (green / neutral / red)
 *   • 🎭 robber block badge when the player is currently blocked
 *
 * Rows are sorted by luck% descending (luckiest at top) so the leaderboard
 * re-orders as the game progresses.
 *
 * When no exposure data exists (settlements not set up), renders a CTA nudge.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Player } from '@/types/models';
import type { CatanPlayerProductionStats } from '@/types/catanStats';
import type { useColors } from '@/hooks/useColors';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CatanProductionLeaderboardProps {
  players: Player[];
  /** null = no exposure data yet */
  playerStats: CatanPlayerProductionStats[] | null;
  /** playerId → blocked numbers (from active robberBlockStarted events) */
  activeRobberBlocks: Map<string, number[]>;
  currentPlayerIndex: number;
  /** If true, show a small-sample caveat on the section header */
  isSmallSample: boolean;
  colors: ReturnType<typeof useColors>;
  /** Called when user taps the heat-map toggle in the header */
  onToggleHeatMap: () => void;
  showHeatMap: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function luckColor(pct: number): string {
  if (pct >= 15) return '#22C55E';
  if (pct >= 5)  return '#4ADE80';
  if (pct <= -15) return '#EF4444';
  if (pct <= -5)  return '#F87171';
  return '#888888';
}

function luckBg(pct: number): string {
  if (pct >= 5) return '#22C55E18';
  if (pct <= -5) return '#EF444418';
  return 'transparent';
}

const ROW_HEIGHT = 34;

// ─── Component ────────────────────────────────────────────────────────────────

export function CatanProductionLeaderboard({
  players,
  playerStats,
  activeRobberBlocks,
  currentPlayerIndex,
  isSmallSample,
  colors,
  onToggleHeatMap,
  showHeatMap,
}: CatanProductionLeaderboardProps) {
  // ── No exposure data — show a nudge to set up settlements ──────────────────
  if (!playerStats) {
    return (
      <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[s.header, { borderBottomColor: colors.border }]}>
          <Text style={[s.headerLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
            LIVE PRODUCTION
          </Text>
          <TouchableOpacity onPress={onToggleHeatMap} style={s.heatMapToggle} hitSlop={8}>
            <Ionicons
              name={showHeatMap ? 'grid' : 'grid-outline'}
              size={15}
              color={showHeatMap ? colors.primary : colors.mutedForeground}
            />
            <Text style={[s.heatMapToggleText, {
              color: showHeatMap ? colors.primary : colors.mutedForeground,
              fontFamily: 'Inter_500Medium',
            }]}>
              Numbers
            </Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={s.noDataRow}
          onPress={() => router.push('/catan-board-scan' as any)}
          activeOpacity={0.8}
        >
          <Ionicons name="map-outline" size={15} color={colors.mutedForeground} />
          <Text style={[s.noDataText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Set up settlements to track live production
          </Text>
          <Ionicons name="chevron-forward" size={13} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>
    );
  }

  // Sort luckiest first
  const sorted = [...playerStats].sort((a, b) => b.productionLuckPct - a.productionLuckPct);
  const maxVisible = 4;

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: colors.border }]}>
        <Text style={[s.headerLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
          LIVE PRODUCTION{isSmallSample ? ' · small sample' : ''}
        </Text>
        <View style={s.headerRight}>
          <Text style={[s.headerHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            EXP · GOT
          </Text>
          <TouchableOpacity onPress={onToggleHeatMap} style={s.heatMapToggle} hitSlop={8}>
            <Ionicons
              name={showHeatMap ? 'grid' : 'grid-outline'}
              size={15}
              color={showHeatMap ? colors.primary : colors.mutedForeground}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Player rows */}
      <ScrollView
        style={{ maxHeight: ROW_HEIGHT * Math.min(players.length, maxVisible) }}
        scrollEnabled={players.length > maxVisible}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        {sorted.map((stat, i) => {
          const player = players.find(p => p.id === stat.playerId);
          if (!player) return null;

          const playerIdx = players.indexOf(player);
          const isCurrent = playerIdx === currentPlayerIndex;
          const robberNums = activeRobberBlocks.get(player.id) ?? [];
          const pct = stat.productionLuckPct;
          const hasRolls = stat.totalExpectedProduction > 0;
          const isLast = i === sorted.length - 1;

          return (
            <View
              key={stat.playerId}
              style={[
                s.row,
                { height: ROW_HEIGHT, borderBottomColor: colors.border },
                isLast && s.rowLast,
                isCurrent && { backgroundColor: colors.primary + '0C' },
              ]}
            >
              {/* Player indicator */}
              <View style={s.playerSection}>
                <View style={[s.playerDot, {
                  backgroundColor: player.color,
                  opacity: isCurrent ? 1 : 0.5,
                  width: isCurrent ? 10 : 8,
                  height: isCurrent ? 10 : 8,
                  borderRadius: isCurrent ? 5 : 4,
                }]} />
                <Text
                  style={[s.playerName, {
                    color: isCurrent ? colors.foreground : colors.mutedForeground,
                    fontFamily: isCurrent ? 'Inter_600SemiBold' : 'Inter_400Regular',
                  }]}
                  numberOfLines={1}
                >
                  {player.displayName}
                </Text>
              </View>

              {/* Stats */}
              <View style={s.statsSection}>
                {hasRolls ? (
                  <>
                    <Text style={[s.prodNumbers, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                      {stat.totalExpectedProduction.toFixed(1)} · {stat.totalActualProduction.toFixed(1)}
                    </Text>
                    <View style={[s.pctBadge, { backgroundColor: luckBg(pct) }]}>
                      <Text style={[s.pctText, { color: luckColor(pct), fontFamily: 'Inter_700Bold' }]}>
                        {pct >= 0 ? '+' : ''}{Math.round(pct)}%
                      </Text>
                    </View>
                  </>
                ) : (
                  <Text style={[s.noRollsText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                    —
                  </Text>
                )}
              </View>

              {/* Robber badge */}
              {robberNums.length > 0 && (
                <View style={s.robberBadge}>
                  <Text style={s.robberIcon}>🎭</Text>
                  <Text style={[s.robberNum, { fontFamily: 'Inter_700Bold' }]}>
                    {robberNums.join(',')}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderBottomWidth: 1,
  },
  headerLabel: { fontSize: 10, letterSpacing: 0.6 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerHint: { fontSize: 10 },
  heatMapToggle: { flexDirection: 'row', alignItems: 'center', gap: 3, padding: 2 },
  heatMapToggleText: { fontSize: 11 },

  // No data state
  noDataRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  noDataText: { flex: 1, fontSize: 13 },

  // Player rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  rowLast: { borderBottomWidth: 0 },

  playerSection: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
  playerDot: {},
  playerName: { fontSize: 13, flex: 1 },

  statsSection: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  prodNumbers: { fontSize: 12 },
  pctBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  pctText: { fontSize: 12 },
  noRollsText: { fontSize: 12 },

  robberBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 },
  robberIcon: { fontSize: 13 },
  robberNum: { fontSize: 12, color: '#EF4444' },
});
