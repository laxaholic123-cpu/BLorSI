/**
 * History Screen — lists all saved sessions (most recent first).
 *
 * - Completed sessions: tap to open read-only session detail
 * - Active sessions: tap to resume the game
 * - Long-press or swipe-reveal → delete (with confirmation)
 * - Filter tabs: All / Completed / Active
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useSettings } from '@/context/SettingsContext';
import { useGame } from '@/context/GameContext';
import { deleteSession, loadAllSessions, loadRollEvents } from '@/services/storage';
import type { GameSession } from '@/types/models';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionRow extends GameSession {
  rollCount: number;
  durationSeconds: number | null;
}

type Filter = 'all' | 'completed' | 'active';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function gameLabel(session: GameSession): string {
  if (session.customGameName) return session.customGameName;
  const gt = session.gameType;
  if (gt === 'catan') return 'Settlement Mode';
  if (gt === 'custom') return 'Custom';
  return session.diceMode;
}

function verdictShort(session: GameSession): string | null {
  return session.finalVerdict ?? null;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  const { activeSession } = useGame();
  const webTop = Platform.OS === 'web' ? 67 : 0;

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [expandedDeleteId, setExpandedDeleteId] = useState<string | null>(null);

  const haptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    if (settings.hapticsEnabled) void Haptics.impactAsync(style);
  };

  const loadSessions = useCallback(async () => {
    const all = await loadAllSessions();
    const rows = await Promise.all(
      all.map(async (session): Promise<SessionRow> => {
        const rolls = await loadRollEvents(session.id);
        const activeRolls = rolls.filter(r => !r.deletedAt);
        const rollCount = activeRolls.length;
        let durationSeconds: number | null = null;
        if (session.startedAt) {
          const end = session.endedAt ? new Date(session.endedAt) : new Date();
          const start = new Date(session.startedAt);
          durationSeconds = Math.round((end.getTime() - start.getTime()) / 1000);
        }
        return { ...session, rollCount, durationSeconds };
      }),
    );
    setSessions(rows);
  }, []);

  useEffect(() => {
    void loadSessions().finally(() => setLoading(false));
  }, [loadSessions]);

  // Refresh when screen comes back into focus (e.g. after deleting or completing a game)
  useFocusEffect(
    useCallback(() => {
      void loadSessions();
    }, [loadSessions]),
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadSessions();
    setRefreshing(false);
  };

  const handleDelete = (session: SessionRow) => {
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Delete Session?',
      `"${gameLabel(session)}" on ${formatDate(session.startedAt)} with ${session.rollCount} roll${session.rollCount !== 1 ? 's' : ''}. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setExpandedDeleteId(null) },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            haptic(Haptics.ImpactFeedbackStyle.Heavy);
            await deleteSession(session.id);
            setSessions(prev => prev.filter(s => s.id !== session.id));
            setExpandedDeleteId(null);
          },
        },
      ],
    );
  };

  const handleTap = (session: SessionRow) => {
    if (expandedDeleteId === session.id) {
      setExpandedDeleteId(null);
      return;
    }
    haptic();
    if (session.status === 'active') {
      // Resume active session
      if (activeSession?.id === session.id) {
        if (session.gameType === 'catan') {
          router.push('/active-catan' as any);
        } else {
          router.push('/active-game');
        }
      } else {
        Alert.alert(
          'Different Active Game',
          'You have a different game in progress. Finish or abandon it before resuming this one.',
        );
      }
    } else {
      // Open session detail
      router.push(`/session-detail?id=${session.id}` as any);
    }
  };

  const filtered = useMemo(() => {
    if (filter === 'completed') return sessions.filter(s => s.status === 'completed');
    if (filter === 'active') return sessions.filter(s => s.status === 'active');
    return sessions;
  }, [sessions, filter]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + webTop + 20, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>History</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {/* Filter tabs */}
      {sessions.length > 0 && (
        <View style={[styles.filterRow, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
          {(['all', 'completed', 'active'] as const).map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.filterBtn, filter === f && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
              onPress={() => { haptic(); setFilter(f); }}
            >
              <Text style={[styles.filterBtnText, {
                color: filter === f ? colors.primary : colors.mutedForeground,
                fontFamily: filter === f ? 'Inter_600SemiBold' : 'Inter_400Regular',
              }]}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Content */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : sessions.length === 0 ? (
        <EmptyState colors={colors} />
      ) : filtered.length === 0 ? (
        <View style={styles.centered}>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            No {filter} sessions
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 80 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
        >
          {filtered.map(session => (
            <SessionCard
              key={session.id}
              session={session}
              colors={colors}
              expanded={expandedDeleteId === session.id}
              onTap={() => handleTap(session)}
              onLongPress={() => { haptic(Haptics.ImpactFeedbackStyle.Medium); setExpandedDeleteId(session.id); }}
              onDelete={() => handleDelete(session)}
              onCollapse={() => setExpandedDeleteId(null)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Session Card ──────────────────────────────────────────────────────────────

function SessionCard({
  session, colors, expanded, onTap, onLongPress, onDelete, onCollapse,
}: {
  session: SessionRow;
  colors: ReturnType<typeof useColors>;
  expanded: boolean;
  onTap: () => void;
  onLongPress: () => void;
  onDelete: () => void;
  onCollapse: () => void;
}) {
  const isActive = session.status === 'active';
  const winner = session.winnerPlayerId
    ? session.players.find(p => p.id === session.winnerPlayerId)
    : null;
  const label = gameLabel(session);
  const verdict = verdictShort(session);
  const maxDots = 6;
  const dots = session.players.slice(0, maxDots);

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: isActive ? colors.primary : colors.border,
          borderLeftColor: isActive ? colors.primary : colors.border,
        },
      ]}
      onPress={onTap}
      onLongPress={onLongPress}
      activeOpacity={0.85}
      delayLongPress={400}
    >
      {/* Status badge */}
      {isActive && (
        <View style={[styles.activeBadge, { backgroundColor: colors.primary + '22' }]}>
          <View style={[styles.activeDot, { backgroundColor: colors.primary }]} />
          <Text style={[styles.activeBadgeText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>Active</Text>
        </View>
      )}

      <View style={styles.cardMain}>
        {/* Left: info */}
        <View style={styles.cardLeft}>
          <Text style={[styles.cardLabel, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]} numberOfLines={1}>
            {label}
          </Text>
          <Text style={[styles.cardDate, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {formatDate(session.startedAt)}
            {session.durationSeconds ? ` · ${formatDuration(session.durationSeconds)}` : ''}
          </Text>
          {/* Players */}
          <View style={styles.playerRow}>
            {dots.map((p, i) => (
              <View key={p.id} style={[styles.playerDot, { backgroundColor: p.color, zIndex: maxDots - i }]} />
            ))}
            {session.players.length > 0 && (
              <Text style={[styles.playerNames, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
                {session.players.map(p => p.displayName).join(', ')}
              </Text>
            )}
          </View>
          {/* Verdict or winner */}
          {winner && (
            <Text style={[styles.cardWinner, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]} numberOfLines={1}>
              🏆 {winner.displayName}
            </Text>
          )}
          {verdict && !winner && (
            <Text style={[styles.cardVerdict, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
              {verdict}
            </Text>
          )}
        </View>

        {/* Right: stats */}
        <View style={styles.cardRight}>
          <Text style={[styles.statNum, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{session.rollCount}</Text>
          <Text style={[styles.statLbl, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>rolls</Text>
          <View style={[styles.modeBadge, { backgroundColor: colors.muted }]}>
            <Text style={[styles.modeText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>{session.diceMode}</Text>
          </View>
          <Ionicons
            name={isActive ? 'play-circle' : 'chevron-forward'}
            size={18}
            color={isActive ? colors.primary : colors.mutedForeground}
          />
        </View>
      </View>

      {/* Expanded delete actions */}
      {expanded && (
        <View style={[styles.expandedActions, { borderTopColor: colors.border }]}>
          <TouchableOpacity style={styles.expandedBtn} onPress={onCollapse}>
            <Text style={[styles.expandedBtnText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.expandedBtn, { backgroundColor: colors.destructive + '18' }]}
            onPress={onDelete}
          >
            <Ionicons name="trash-outline" size={15} color={colors.destructive} />
            <Text style={[styles.expandedBtnText, { color: colors.destructive, fontFamily: 'Inter_600SemiBold' }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ colors }: { colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIconWrap, { backgroundColor: colors.card }]}>
        <Ionicons name="time-outline" size={40} color={colors.mutedForeground} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
        No games yet
      </Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        Completed and in-progress games will appear here. Start a game from the Home tab.
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: { paddingHorizontal: 24, paddingBottom: 16, borderBottomWidth: 1 },
  title: { fontSize: 28 },
  subtitle: { fontSize: 13, marginTop: 2 },

  filterRow: { flexDirection: 'row', borderBottomWidth: 1 },
  filterBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  filterBtnText: { fontSize: 14 },

  list: { padding: 14, gap: 10 },

  card: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 0,
  },
  activeDot: { width: 7, height: 7, borderRadius: 3.5 },
  activeBadgeText: { fontSize: 12 },

  cardMain: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  cardLeft: { flex: 1, gap: 4 },
  cardLabel: { fontSize: 16 },
  cardDate: { fontSize: 12 },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  playerDot: { width: 12, height: 12, borderRadius: 6, marginRight: 2 },
  playerNames: { fontSize: 12, flex: 1 },
  cardWinner: { fontSize: 13, marginTop: 2 },
  cardVerdict: { fontSize: 12, marginTop: 2, fontStyle: 'italic' },

  cardRight: { alignItems: 'center', gap: 3, flexShrink: 0 },
  statNum: { fontSize: 22 },
  statLbl: { fontSize: 11 },
  modeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginTop: 4 },
  modeText: { fontSize: 11 },

  expandedActions: { flexDirection: 'row', borderTopWidth: 1, overflow: 'hidden' },
  expandedBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  expandedBtnText: { fontSize: 14 },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyIconWrap: { width: 80, height: 80, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emptyTitle: { fontSize: 18 },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 22, maxWidth: 280 },
});
