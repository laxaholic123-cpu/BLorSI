import React, { useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useGame } from '@/context/GameContext';
import { useSettings } from '@/context/SettingsContext';
import { useTimer } from '@/hooks/useTimer';
import { DiceGrid } from '@/components/DiceGrid';
import {
  getNextPlayerIndex,
  getPrevPlayerIndex,
  recordRoll,
  undoLastRoll,
} from '@/services/rollInput';

export default function ActiveGameScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeSession, rollEvents, persistRollEvents, updateSession, endSession } = useGame();
  const { settings } = useSettings();
  const elapsed = useTimer(activeSession?.startedAt ?? null);

  const [lastPressedValue, setLastPressedValue] = useState<number | null>(null);

  const webTop = Platform.OS === 'web' ? 67 : 0;
  const webBottom = Platform.OS === 'web' ? 34 : 0;

  // ── Derived state ──────────────────────────────────────────────────────────
  const activeEvents = useMemo(() => rollEvents.filter(e => !e.deletedAt), [rollEvents]);

  const currentPlayer = activeSession
    ? activeSession.players[activeSession.currentPlayerIndex]
    : null;

  const lastEvent = activeEvents.length > 0 ? activeEvents[activeEvents.length - 1] : null;

  const playerRollCount = currentPlayer
    ? activeEvents.filter(e => e.playerId === currentPlayer.id).length
    : 0;

  const totalRolls = activeEvents.length;

  const turnNumber = activeSession && activeSession.players.length > 0
    ? Math.floor(totalRolls / activeSession.players.length) + 1
    : 1;

  const canUndo = activeEvents.length > 0;
  const isMultiPlayer = (activeSession?.players.length ?? 0) > 1;

  const haptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    if (settings.hapticsEnabled) void Haptics.impactAsync(style);
  };

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleRoll = async (value: number) => {
    if (!activeSession || !currentPlayer) return;
    haptic();
    setLastPressedValue(value);

    const newEvents = recordRoll(
      { session: activeSession, playerId: currentPlayer.id, value, source: 'touchscreen' },
      rollEvents,
    );
    await persistRollEvents(activeSession.id, newEvents);

    if (activeSession.autoAdvancePlayer && activeSession.players.length > 1) {
      const nextIdx = getNextPlayerIndex(activeSession.currentPlayerIndex, activeSession.players.length);
      await updateSession({ ...activeSession, currentPlayerIndex: nextIdx });
    }
  };

  const handleUndo = async () => {
    if (!activeSession || !canUndo) return;
    haptic(Haptics.ImpactFeedbackStyle.Medium);

    const { events: newEvents, undoneEvent } = undoLastRoll(rollEvents);
    await persistRollEvents(activeSession.id, newEvents);

    // Revert player index to who rolled that event
    if (undoneEvent && activeSession.autoAdvancePlayer && activeSession.players.length > 1) {
      const undonePlayerIdx = activeSession.players.findIndex(p => p.id === undoneEvent.playerId);
      if (undonePlayerIdx !== -1) {
        await updateSession({ ...activeSession, currentPlayerIndex: undonePlayerIdx });
      }
    }

    setLastPressedValue(null);
  };

  const handlePrevPlayer = async () => {
    if (!activeSession || !isMultiPlayer) return;
    haptic();
    const prevIdx = getPrevPlayerIndex(activeSession.currentPlayerIndex, activeSession.players.length);
    await updateSession({ ...activeSession, currentPlayerIndex: prevIdx });
  };

  const handleNextPlayer = async () => {
    if (!activeSession || !isMultiPlayer) return;
    haptic();
    const nextIdx = getNextPlayerIndex(activeSession.currentPlayerIndex, activeSession.players.length);
    await updateSession({ ...activeSession, currentPlayerIndex: nextIdx });
  };

  const handleEndGame = () => {
    haptic(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert(
      'End Game?',
      `${totalRolls} roll${totalRolls !== 1 ? 's' : ''} recorded. The session will be saved to history.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Game',
          style: 'destructive',
          onPress: async () => {
            if (!activeSession) return;
            const ended = {
              ...activeSession,
              status: 'completed' as const,
              endedAt: new Date().toISOString(),
            };
            await updateSession(ended);
            await endSession();
            router.replace('/results');
          },
        },
      ],
    );
  };

  // ── No session guard ───────────────────────────────────────────────────────

  if (!activeSession) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.mutedForeground} />
        <Text style={[styles.noSessionText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          No active game
        </Text>
        <TouchableOpacity
          style={[styles.goHomeBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.replace('/')}
        >
          <Text style={[styles.goHomeBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }]}>
            Go Home
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Game name label ────────────────────────────────────────────────────────

  const modeLabel = activeSession.diceMode.toUpperCase();
  const gameLabel = activeSession.customGameName
    ? activeSession.customGameName
    : modeLabel;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + webTop,
          paddingBottom: insets.bottom + webBottom,
        },
      ]}
    >
      {/* ── Header ──────────────────────────────────────────── */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <Text
            style={[styles.headerGame, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}
            numberOfLines={1}
          >
            {gameLabel}
          </Text>
          <Text style={[styles.headerMode, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {modeLabel}
          </Text>
        </View>

        <View style={[styles.timerPill, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="time-outline" size={13} color={colors.mutedForeground} />
          <Text style={[styles.timerText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
            {elapsed}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.endBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={handleEndGame}
          testID="end-game-button"
        >
          <Text style={[styles.endBtnText, { color: colors.destructive, fontFamily: 'Inter_600SemiBold' }]}>
            End
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Player banner ────────────────────────────────────── */}
      <View style={[styles.playerBanner, { borderLeftColor: currentPlayer?.color ?? colors.primary, backgroundColor: colors.card }]}>
        <View style={styles.playerBannerLeft}>
          <Text
            style={[styles.playerName, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}
            numberOfLines={1}
          >
            {currentPlayer?.displayName ?? '—'}
          </Text>
          <Text style={[styles.playerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {isMultiPlayer
              ? `${playerRollCount} roll${playerRollCount !== 1 ? 's' : ''} · turn ${turnNumber}`
              : `${totalRolls} roll${totalRolls !== 1 ? 's' : ''} recorded`}
          </Text>
        </View>
        {/* Player position dots for multi-player */}
        {isMultiPlayer && (
          <View style={styles.playerDots}>
            {activeSession.players.map((p, i) => (
              <View
                key={p.id}
                style={[
                  styles.playerDot,
                  {
                    backgroundColor: p.color,
                    opacity: i === activeSession.currentPlayerIndex ? 1 : 0.3,
                    width: i === activeSession.currentPlayerIndex ? 10 : 6,
                    height: i === activeSession.currentPlayerIndex ? 10 : 6,
                    borderRadius: 5,
                  },
                ]}
              />
            ))}
          </View>
        )}
      </View>

      {/* ── Last roll display ────────────────────────────────── */}
      <View style={styles.lastRollRow}>
        <View style={[styles.lastRollCard, { backgroundColor: colors.card, borderColor: lastEvent ? colors.primary : colors.border }]}>
          <Text style={[styles.lastRollValue, { color: lastEvent ? colors.primary : colors.mutedForeground, fontFamily: 'Inter_700Bold' }]}>
            {lastEvent ? lastEvent.value : '—'}
          </Text>
        </View>
        <View style={styles.statsColumn}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{totalRolls}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>total</Text>
          </View>
          {isMultiPlayer && (
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{playerRollCount}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>mine</Text>
            </View>
          )}
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{turnNumber}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>turn</Text>
          </View>
        </View>
      </View>

      {/* ── Dice grid ────────────────────────────────────────── */}
      <View style={styles.gridWrapper}>
        <DiceGrid
          diceMode={activeSession.diceMode}
          customMin={activeSession.minimumRoll}
          customMax={activeSession.maximumRoll}
          onValuePress={handleRoll}
          lastPressedValue={lastPressedValue}
        />
      </View>

      {/* ── Controls bar ─────────────────────────────────────── */}
      <View style={[styles.controls, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.controlBtn, { opacity: canUndo ? 1 : 0.35 }]}
          onPress={handleUndo}
          disabled={!canUndo}
          testID="undo-button"
        >
          <Ionicons name="arrow-undo" size={22} color={canUndo ? colors.primary : colors.mutedForeground} />
          <Text style={[styles.controlBtnText, { color: canUndo ? colors.primary : colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
            Undo
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlBtn, { opacity: isMultiPlayer ? 1 : 0.2 }]}
          onPress={handlePrevPlayer}
          disabled={!isMultiPlayer}
          testID="prev-player-button"
        >
          <Ionicons name="chevron-back-circle-outline" size={22} color={colors.foreground} />
          <Text style={[styles.controlBtnText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
            Prev
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlBtn, { opacity: isMultiPlayer ? 1 : 0.2 }]}
          onPress={handleNextPlayer}
          disabled={!isMultiPlayer}
          testID="next-player-button"
        >
          <Ionicons name="chevron-forward-circle-outline" size={22} color={colors.foreground} />
          <Text style={[styles.controlBtnText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
            Next
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlBtn, { opacity: 0.35 }]}
          disabled
          testID="stats-button"
        >
          <Ionicons name="bar-chart-outline" size={22} color={colors.mutedForeground} />
          <Text style={[styles.controlBtnText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
            Stats
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  noSessionText: { fontSize: 16 },
  goHomeBtn: { paddingHorizontal: 28, paddingVertical: 13, borderRadius: 12 },
  goHomeBtnText: { fontSize: 16 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 10,
  },
  headerLeft: { flex: 1, gap: 1 },
  headerGame: { fontSize: 16 },
  headerMode: { fontSize: 12 },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  timerText: { fontSize: 13 },
  endBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  endBtnText: { fontSize: 14 },

  // Player banner
  playerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderLeftWidth: 4,
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 10,
    gap: 12,
  },
  playerBannerLeft: { flex: 1 },
  playerName: { fontSize: 20 },
  playerSub: { fontSize: 13, marginTop: 2 },
  playerDots: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
  playerDot: {},

  // Last roll
  lastRollRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
  },
  lastRollCard: {
    width: 100,
    height: 90,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastRollValue: { fontSize: 46 },
  statsColumn: { flex: 1, flexDirection: 'row', gap: 16 },
  statItem: { alignItems: 'center', gap: 2 },
  statValue: { fontSize: 22 },
  statLabel: { fontSize: 12 },

  // Grid
  gridWrapper: { flex: 1, paddingHorizontal: 12, paddingVertical: 8 },

  // Controls
  controls: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 8,
    paddingBottom: 4,
  },
  controlBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 3,
  },
  controlBtnText: { fontSize: 11 },
});
