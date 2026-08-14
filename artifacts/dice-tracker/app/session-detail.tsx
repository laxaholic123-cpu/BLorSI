/**
 * Session Detail Screen — read-only view of a completed or active session.
 *
 * Route: /session-detail?id=<sessionId>
 *
 * Shows the same stats as the Results screen but:
 *   - Back navigation available (not end-of-game flow)
 *   - No "Done" button (session stays saved)
 *   - Actions: Share, Duplicate Setup, Delete
 *   - Active sessions show a Resume button instead
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useSettings } from '@/context/SettingsContext';
import {
  deleteSession,
  loadExposureEvents,
  loadRollEvents,
  loadSession,
  savePrefillSession,
} from '@/services/storage';
import { computeAllStats, formatDuration } from '@/services/stats';
import { computeCatanGameStats } from '@/services/catanStats';
import type { CatanPlayerExposureEvent, GameSession, RollEvent } from '@/types/models';
import type { CatanGameStats } from '@/types/catanStats';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '—'; }
}

function gameLabel(session: GameSession): string {
  return session.customGameName ?? (session.gameType === 'catan' ? 'Settlement Mode' : session.diceMode);
}

type Colors = ReturnType<typeof useColors>;

export default function SessionDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  const { id } = useLocalSearchParams<{ id: string }>();
  const webTop = Platform.OS === 'web' ? 67 : 0;

  const [session, setSession] = useState<GameSession | null>(null);
  const [rollEvents, setRollEvents] = useState<RollEvent[]>([]);
  const [exposureEvents, setExposureEvents] = useState<CatanPlayerExposureEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const haptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    if (settings.hapticsEnabled) void Haptics.impactAsync(style);
  };

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      const [s, r, e] = await Promise.all([
        loadSession(id),
        loadRollEvents(id),
        loadExposureEvents(id),
      ]);
      setSession(s);
      setRollEvents(r);
      setExposureEvents(e);
      setLoading(false);
    };
    void load();
  }, [id]);

  // simulate: true — a saved game's verdict must match the one shown on the
  // results screen when it was played, so both take the same statistical path.
  const stats = useMemo(
    () => (session ? computeAllStats(session, rollEvents, { simulate: true }) : null),
    [session, rollEvents],
  );

  const catanStats = useMemo<CatanGameStats | null>(
    () =>
      session?.gameType === 'catan' && exposureEvents.length > 0
        ? computeCatanGameStats(session, rollEvents, exposureEvents, { simulate: true })
        : null,
    [session, rollEvents, exposureEvents],
  );

  if (loading || !session || !stats) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          {loading ? 'Loading…' : 'Session not found'}
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isActive = session.status === 'active';
  const isMultiplayer = session.players.length > 1;
  const isD20 = session.diceMode === 'D20';
  const is2D6 = session.diceMode === '2D6';
  const maxCount = Math.max(...stats.frequencies.map(f => f.count), 1);
  const winner = session.winnerPlayerId
    ? session.players.find(p => p.id === session.winnerPlayerId)
    : null;
  const label = gameLabel(session);

  const activeRolls = rollEvents.filter(r => !r.deletedAt);
  const durationSeconds = session.endedAt
    ? Math.round((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000)
    : null;

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleResume = () => {
    haptic();
    if (session.gameType === 'catan') {
      router.replace('/active-catan' as any);
    } else {
      router.replace('/active-game');
    }
  };

  const handleShare = () => {
    haptic();
    router.push(`/share-card?id=${session.id}` as any);
  };

  const handleShareText = async () => {
    haptic();
    const lines = [
      `🎲 SKILL CHECK — ${label}`,
      `${formatDate(session.startedAt)}`,
      `${activeRolls.length} rolls · ${session.diceMode} · ${durationSeconds ? formatDuration(durationSeconds) : 'in progress'}`,
      '',
      session.players.length > 1 ? `Players: ${session.players.map(p => p.displayName).join(', ')}` : `Player: ${session.players[0]?.displayName ?? '—'}`,
      winner ? `Winner: ${winner.displayName} 🏆` : '',
      '',
      stats.mean !== null ? `Mean: ${stats.mean.toFixed(2)} (expected ${stats.expectedMean.toFixed(1)})` : '',
      stats.mode.length > 0 ? `Most rolled: ${stats.mode.join('/')}` : '',
      stats.leastCommon.length > 0 ? `Rarest: ${stats.leastCommon.join('/')}` : '',
      '',
      `Verdict: ${stats.verdictHeadline}`,
      stats.verdictExplanation,
      '',
      'Track your dice at Skill Check.',
    ].filter(l => l !== null && l !== '').join('\n');
    try {
      await Share.share({ message: lines });
    } catch {}
  };

  const handleDuplicateSetup = async () => {
    haptic();
    Alert.alert(
      'Duplicate Setup?',
      `Start a new game with the same ${session.players.length} player${session.players.length !== 1 ? 's' : ''} and ${session.diceMode} dice?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Duplicate',
          onPress: async () => {
            await savePrefillSession(session);
            router.replace('/new-game' as any);
          },
        },
      ],
    );
  };

  const handleDelete = () => {
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Delete Session?',
      `"${label}" on ${formatDate(session.startedAt)}. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            haptic(Haptics.ImpactFeedbackStyle.Heavy);
            await deleteSession(session.id);
            router.back();
          },
        },
      ],
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + webTop + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]} numberOfLines={1}>
            {label}
          </Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {formatDate(session.startedAt)}
            {isActive ? ' · Active' : ''}
          </Text>
        </View>
        <TouchableOpacity style={styles.shareBtn} onPress={handleShare} hitSlop={8}>
          <Ionicons name="share-outline" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Active session notice */}
        {isActive && (
          <View style={[styles.activeNotice, { backgroundColor: colors.primary + '18', borderColor: colors.primary }]}>
            <View style={[styles.activeDot2, { backgroundColor: colors.primary }]} />
            <Text style={[styles.activeNoticeText, { color: colors.primary, fontFamily: 'Inter_500Medium' }]}>
              This game is in progress — {activeRolls.length} roll{activeRolls.length !== 1 ? 's' : ''} so far
            </Text>
            <TouchableOpacity style={[styles.resumeBtn, { backgroundColor: colors.primary }]} onPress={handleResume}>
              <Text style={[styles.resumeBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_700Bold' }]}>Resume</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Winner banner */}
        {winner && (
          <View style={[styles.winnerBanner, { backgroundColor: colors.primary + '18', borderColor: colors.primary }]}>
            <Ionicons name="trophy" size={24} color={colors.primary} />
            <Text style={[styles.winnerText, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>
              {winner.displayName} wins!
            </Text>
          </View>
        )}

        {/* Session chips */}
        <View style={styles.chips}>
          <Chip icon="layers-outline" label={`${activeRolls.length} rolls`} colors={colors} />
          <Chip icon="people-outline" label={`${session.players.length}P`} colors={colors} />
          <Chip icon="dice-outline" label={session.diceMode} colors={colors} />
          {durationSeconds !== null && (
            <Chip icon="time-outline" label={formatDuration(durationSeconds)} colors={colors} />
          )}
        </View>

        {/* Verdict */}
        <SectionLabel text="VERDICT" colors={colors} />
        <View style={[styles.card, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Text style={[styles.verdictHeadline, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            {stats.verdictHeadline}
          </Text>
          <Text style={[styles.verdictBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {stats.isSmallSample
              ? `Only ${stats.totalRolls} rolls recorded — not enough for a reliable verdict.`
              : stats.verdictExplanation}
          </Text>
        </View>

        {/* Distribution */}
        <SectionLabel text="DISTRIBUTION" colors={colors} />
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, overflow: 'hidden' }]}>
          {stats.frequencies.map((f, idx) => {
            const isAbove = f.deviation > 0.5;
            const isBelow = f.deviation < -0.5;
            const barColor = isAbove ? '#1ABC9C' : isBelow ? '#5C7A9C' : colors.mutedForeground;
            const barPct = stats.totalRolls > 0 ? f.count / maxCount : 0;
            const isLast = idx === stats.frequencies.length - 1;
            return (
              <View key={f.value} style={[styles.freqRow, { borderBottomColor: colors.border, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth }]}>
                <Text style={[styles.freqVal, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{f.value}</Text>
                <View style={styles.freqBarCol}>
                  <View style={[styles.barTrack, { backgroundColor: colors.muted }]}>
                    <View style={[styles.barFill, { width: `${barPct * 100}%` as `${number}%`, backgroundColor: barColor, opacity: 0.85 }]} />
                  </View>
                </View>
                <Text style={[styles.freqCount, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{f.count}</Text>
                <Text style={[styles.freqExp, { color: colors.mutedForeground }]}>{f.expectedCount.toFixed(1)}</Text>
              </View>
            );
          })}
        </View>

        {/* Multiplayer summaries */}
        {isMultiplayer && stats.playerSummaries.length > 0 && (
          <>
            <SectionLabel text="PLAYERS" colors={colors} />
            {stats.playerSummaries.map(ps => {
              const pc = session.players.find(p => p.id === ps.playerId)?.color ?? colors.primary;
              return (
                <View key={ps.playerId} style={[styles.card, styles.playerCard, { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: pc }]}>
                  <Text style={[styles.playerName, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                    {ps.displayName}{ps.playerId === session.winnerPlayerId ? '  🏆' : ''}
                  </Text>
                  <View style={styles.statRow}>
                    <StatBox label="Rolls" value={String(ps.rollCount)} colors={colors} />
                    <StatBox label="Avg" value={ps.mean !== null ? ps.mean.toFixed(2) : '—'} colors={colors} />
                    <StatBox label="Mode" value={ps.mode.slice(0, 2).join('/') || '—'} colors={colors} />
                    {isD20 && <StatBox label="Nat 20s" value={String(ps.nat20Count)} colors={colors} />}
                  </View>
                </View>
              );
            })}
          </>
        )}

        {/* Catan section */}
        {catanStats && catanStats.hasExposureData && (
          <>
            <SectionLabel text="SETTLEMENT PRODUCTION" colors={colors} />
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, overflow: 'hidden' }]}>
              {catanStats.playerStats.map((ps, idx) => {
                const player = session.players.find(p => p.id === ps.playerId);
                const isLast = idx === catanStats.playerStats.length - 1;
                const pct = Math.round(ps.productionLuckPct);
                const pctColor = pct > 10 ? colors.primary : pct < -10 ? colors.destructive : colors.mutedForeground;
                return (
                  <View key={ps.playerId} style={[styles.freqRow, { borderBottomColor: colors.border, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth }]}>
                    <View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: player?.color ?? colors.primary, marginRight: 6 }]} />
                    <Text style={[styles.freqVal, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', width: 80 }]} numberOfLines={1}>{ps.displayName}</Text>
                    <View style={styles.freqBarCol} />
                    <Text style={[styles.freqCount, { color: colors.mutedForeground }]}>{ps.totalExpectedProduction.toFixed(1)}</Text>
                    <Text style={[styles.freqCount, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{ps.totalActualProduction.toFixed(1)}</Text>
                    <Text style={[{ width: 42, textAlign: 'right', fontSize: 12, fontFamily: 'Inter_500Medium', color: pctColor }]}>
                      {pct === 0 ? '—' : `${pct > 0 ? '+' : ''}${pct}%`}
                    </Text>
                  </View>
                );
              })}
            </View>
            {catanStats.findings && (
              <View style={[styles.card, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Text style={[styles.verdictHeadline, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                  {catanStats.findings.headline}
                </Text>
                {catanStats.findings.details.map((d, i) => (
                  <Text key={i} style={[styles.verdictBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{d}</Text>
                ))}
              </View>
            )}
          </>
        )}

        {/* Notable events */}
        {(stats.longestStreak || stats.longestGap || (isD20 && stats.totalRolls > 0) || (is2D6 && stats.doublesCount > 0)) && (
          <>
            <SectionLabel text="NOTABLE EVENTS" colors={colors} />
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {stats.longestStreak && (
                <View style={styles.eventRow}>
                  <Ionicons name="flame-outline" size={15} color={colors.primary} />
                  <Text style={[styles.eventText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
                    Longest streak: <Text style={{ fontFamily: 'Inter_700Bold', color: colors.primary }}>{stats.longestStreak.value}</Text> × {stats.longestStreak.length}
                  </Text>
                </View>
              )}
              {stats.longestGap && (
                <View style={[styles.eventRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                  <Ionicons name="hourglass-outline" size={15} color={colors.mutedForeground} />
                  <Text style={[styles.eventText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
                    Longest drought: <Text style={{ fontFamily: 'Inter_700Bold' }}>{stats.longestGap.value}</Text> absent for {stats.longestGap.longestGap} rolls
                  </Text>
                </View>
              )}
              {isD20 && stats.totalRolls > 0 && (
                <View style={[styles.eventRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                  <Ionicons name="star-outline" size={15} color={colors.primary} />
                  <Text style={[styles.eventText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
                    <Text style={{ fontFamily: 'Inter_700Bold', color: colors.primary }}>{stats.nat20Count}</Text> nat 20s · <Text style={{ fontFamily: 'Inter_700Bold' }}>{stats.nat1Count}</Text> nat 1s
                  </Text>
                </View>
              )}
              {is2D6 && stats.doublesCount > 0 && (
                <View style={[styles.eventRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                  <Ionicons name="copy-outline" size={15} color={colors.mutedForeground} />
                  <Text style={[styles.eventText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
                    <Text style={{ fontFamily: 'Inter_700Bold' }}>{stats.doublesCount}</Text> doubles rolled
                  </Text>
                </View>
              )}
            </View>
          </>
        )}

        {/* Actions */}
        <SectionLabel text="ACTIONS" colors={colors} />
        <View style={[styles.actionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ActionRow icon="share-social-outline" label="Share Results" colors={colors} onPress={handleShare} />
          <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />
          <ActionRow icon="document-text-outline" label="Share as Text" colors={colors} onPress={handleShareText} />
          <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />
          <ActionRow icon="copy-outline" label="Duplicate Setup" colors={colors} onPress={handleDuplicateSetup} />
          <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />
          <ActionRow icon="trash-outline" label="Delete Session" colors={colors} onPress={handleDelete} destructive />
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ text, colors }: { text: string; colors: Colors }) {
  return (
    <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
      {text}
    </Text>
  );
}

function Chip({ icon, label, colors }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; colors: Colors }) {
  return (
    <View style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Ionicons name={icon} size={12} color={colors.mutedForeground} />
      <Text style={[styles.chipText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>{label}</Text>
    </View>
  );
}

function StatBox({ label, value, colors }: { label: string; value: string; colors: Colors }) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statBoxVal, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{value}</Text>
      <Text style={[styles.statBoxLbl, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{label}</Text>
    </View>
  );
}

function ActionRow({ icon, label, colors, onPress, destructive }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; colors: Colors; onPress: () => void; destructive?: boolean }) {
  return (
    <TouchableOpacity style={styles.actionRow} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={20} color={destructive ? colors.destructive : colors.mutedForeground} />
      <Text style={[styles.actionRowText, { color: destructive ? colors.destructive : colors.foreground, fontFamily: 'Inter_400Regular' }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1, gap: 8 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 17 },
  headerSub: { fontSize: 12 },
  shareBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  scroll: { padding: 16, gap: 4 },
  sectionLabel: { fontSize: 11, letterSpacing: 1.2, marginTop: 16, marginBottom: 6 },

  activeNotice: { flexDirection: 'column', padding: 14, borderRadius: 12, borderWidth: 1, gap: 10, marginBottom: 8 },
  activeDot2: { width: 8, height: 8, borderRadius: 4 },
  activeNoticeText: { fontSize: 14 },
  resumeBtn: { paddingVertical: 10, paddingHorizontal: 24, borderRadius: 10, alignSelf: 'flex-start' },
  resumeBtnText: { fontSize: 15 },

  winnerBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  winnerText: { fontSize: 18 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 12 },

  card: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 8, marginBottom: 2 },
  playerCard: { borderLeftWidth: 4, paddingLeft: 12 },
  verdictHeadline: { fontSize: 17 },
  verdictBody: { fontSize: 13, lineHeight: 20 },

  freqRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, gap: 4 },
  freqVal: { width: 28, fontSize: 13 },
  freqBarCol: { flex: 1, marginHorizontal: 8 },
  freqCount: { width: 44, textAlign: 'right', fontSize: 13 },
  freqExp: { width: 44, textAlign: 'right', fontSize: 12 },
  barTrack: { height: 7, borderRadius: 3.5, overflow: 'hidden' },
  barFill: { height: 7, borderRadius: 3.5 },

  playerName: { fontSize: 15, paddingBottom: 2 },
  statRow: { flexDirection: 'row' },
  statBox: { flex: 1, alignItems: 'center', gap: 2 },
  statBoxVal: { fontSize: 18 },
  statBoxLbl: { fontSize: 11 },

  eventRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12 },
  eventText: { flex: 1, fontSize: 13, lineHeight: 19 },

  actionCard: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  actionRowText: { flex: 1, fontSize: 15 },
  actionDivider: { height: 1, marginLeft: 48 },
});
