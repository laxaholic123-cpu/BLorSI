import React, { useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
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
import { DiceGrid } from '@/components/DiceGrid';
import {
  getNextPlayerIndex,
  getPrevPlayerIndex,
  recordRoll,
  undoLastRoll,
} from '@/services/rollInput';
import { playDoneSound, playRollSound, playUndoSound } from '@/services/sound';
import { confirmEndGame } from '@/services/endGame';

export default function ActiveGameScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeSession, rollEvents, persistRollEvents, updateSession, endSession } = useGame();
  const { settings } = useSettings();

  const [lastPressedValue, setLastPressedValue] = useState<number | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [showEndConfirm, setShowEndConfirm] = useState(false);

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

  // First word of the player's name, capped at 8 chars — used as the "mine" label
  const playerFirstName = currentPlayer
    ? (currentPlayer.displayName.split(' ')[0] ?? currentPlayer.displayName).slice(0, 8)
    : '';

  // Last 5 rolls for the current player, newest first
  const recentPlayerRolls = useMemo(() => {
    if (!currentPlayer) return [];
    return activeEvents
      .filter(e => e.playerId === currentPlayer.id)
      .slice(-5)
      .reverse();
  }, [activeEvents, currentPlayer]);

  const haptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    if (settings.hapticsEnabled) void Haptics.impactAsync(style);
  };

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleRoll = async (value: number) => {
    if (!activeSession || !currentPlayer) return;
    haptic();
    playRollSound(settings.soundEnabled);
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
    playUndoSound(settings.soundEnabled);

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
    setShowEndConfirm(true);
  };

  const handleEndConfirm = async () => {
    if (!activeSession) return;
    setShowEndConfirm(false);
    playDoneSound(settings.soundEnabled);
    // endSession() is called by the results screen when the user taps Done,
    // so activeSession remains readable while results are displayed.
    await confirmEndGame(activeSession, {
      updateSession,
      navigate: (path) => router.replace(path as any),
    });
  };

  const handleStartEditName = () => {
    if (!currentPlayer) return;
    setEditNameValue(currentPlayer.displayName);
    setIsEditingName(true);
  };

  const handleSaveName = async () => {
    if (!activeSession || !currentPlayer) { setIsEditingName(false); return; }
    const trimmed = editNameValue.trim();
    setIsEditingName(false);
    if (!trimmed || trimmed === currentPlayer.displayName) return;
    const updatedPlayers = activeSession.players.map((p, i) =>
      i === activeSession.currentPlayerIndex ? { ...p, displayName: trimmed } : p,
    );
    await updateSession({ ...activeSession, players: updatedPlayers });
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

        <TouchableOpacity
          style={[styles.endBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={handleEndGame}
          testID="end-game-button"
          accessibilityRole="button"
          accessibilityLabel="End game"
          accessibilityHint="Stops the session and saves results"
        >
          <Text style={[styles.endBtnText, { color: colors.destructive, fontFamily: 'Inter_600SemiBold' }]}>
            End
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Player banner ────────────────────────────────────── */}
      <View style={[styles.playerBanner, { borderLeftColor: currentPlayer?.color ?? colors.primary, backgroundColor: colors.card }]}>
        <View style={styles.playerBannerLeft}>
          {/* Tappable / editable player name */}
          {isEditingName ? (
            <TextInput
              style={[styles.playerNameInput, { color: colors.foreground, fontFamily: 'Inter_700Bold', borderBottomColor: colors.primary }]}
              value={editNameValue}
              onChangeText={setEditNameValue}
              onBlur={handleSaveName}
              onSubmitEditing={handleSaveName}
              autoFocus
              maxLength={24}
              returnKeyType="done"
              testID="player-name-input"
            />
          ) : (
            <TouchableOpacity onPress={handleStartEditName} activeOpacity={0.7} style={styles.playerNameRow}>
              <Text
                style={[styles.playerName, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}
                numberOfLines={1}
              >
                {currentPlayer?.displayName ?? '—'}
              </Text>
              <Ionicons name="pencil-outline" size={13} color={colors.mutedForeground} style={styles.editIcon} />
            </TouchableOpacity>
          )}

          <Text style={[styles.playerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {isMultiPlayer
              ? `${playerRollCount} roll${playerRollCount !== 1 ? 's' : ''} · turn ${turnNumber}`
              : `${totalRolls} roll${totalRolls !== 1 ? 's' : ''} recorded`}
          </Text>

          {/* Recent roll history for this player */}
          {recentPlayerRolls.length > 0 && (
            <View style={styles.rollHistory}>
              {recentPlayerRolls.map((e, i) => (
                <View
                  key={e.id}
                  style={[
                    styles.rollPill,
                    {
                      backgroundColor: i === 0 ? colors.primary + '22' : colors.muted,
                      borderColor: i === 0 ? colors.primary : 'transparent',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.rollPillText,
                      { color: i === 0 ? colors.primary : colors.mutedForeground, fontFamily: 'Inter_600SemiBold' },
                    ]}
                  >
                    {e.value}
                  </Text>
                </View>
              ))}
            </View>
          )}
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
                    width: i === activeSession.currentPlayerIndex ? 14 : 9,
                    height: i === activeSession.currentPlayerIndex ? 14 : 9,
                    borderRadius: i === activeSession.currentPlayerIndex ? 7 : 4.5,
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
              <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>{playerFirstName}</Text>
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
          accessibilityRole="button"
          accessibilityLabel="Undo last roll"
          accessibilityHint="Removes the most recent roll"
          accessibilityState={{ disabled: !canUndo }}
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
          accessibilityRole="button"
          accessibilityLabel="Previous player"
          accessibilityState={{ disabled: !isMultiPlayer }}
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
          accessibilityRole="button"
          accessibilityLabel="Next player"
          accessibilityState={{ disabled: !isMultiPlayer }}
        >
          <Ionicons name="chevron-forward-circle-outline" size={22} color={colors.foreground} />
          <Text style={[styles.controlBtnText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
            Next
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.controlBtn}
          onPress={() => router.push('/stats' as any)}
          testID="stats-button"
          accessibilityRole="button"
          accessibilityLabel="View statistics"
        >
          <Ionicons name="bar-chart-outline" size={22} color={colors.primary} />
          <Text style={[styles.controlBtnText, { color: colors.primary, fontFamily: 'Inter_500Medium' }]}>
            Stats
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── End game confirmation modal ───────────────────────── */}
      <Modal
        visible={showEndConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEndConfirm(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.endConfirmSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.confirmTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              End Game?
            </Text>
            <Text style={[styles.confirmSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {totalRolls} roll{totalRolls !== 1 ? 's' : ''} recorded.{'\n'}Results and statistics will be available.
            </Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: colors.muted, flex: 1 }]}
                onPress={() => setShowEndConfirm(false)}
                accessibilityRole="button"
                accessibilityLabel="Cancel ending game"
              >
                <Text style={[styles.confirmBtnText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: colors.destructive, flex: 1 }]}
                onPress={() => { void handleEndConfirm(); }}
                accessibilityRole="button"
                accessibilityLabel="Confirm end game"
              >
                <Text style={[styles.confirmBtnText, { color: '#FFFFFF', fontFamily: 'Inter_700Bold' }]}>End Game</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  playerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playerName: { fontSize: 20 },
  editIcon: { marginTop: 2 },
  playerNameInput: {
    fontSize: 20,
    borderBottomWidth: 1.5,
    paddingVertical: 2,
    paddingHorizontal: 0,
  },
  playerSub: { fontSize: 13, marginTop: 2 },
  playerDots: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  playerDot: {},

  // Roll history pills
  rollHistory: { flexDirection: 'row', gap: 5, marginTop: 6, flexWrap: 'wrap' },
  rollPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  rollPillText: { fontSize: 13 },

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

  // End confirm modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  endConfirmSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 20, gap: 16 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#555', alignSelf: 'center', marginBottom: 4 },
  confirmTitle: { fontSize: 20, textAlign: 'center' },
  confirmSub: { fontSize: 14, textAlign: 'center' },
  confirmActions: { flexDirection: 'row', gap: 12 },
  confirmBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  confirmBtnText: { fontSize: 16 },

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
