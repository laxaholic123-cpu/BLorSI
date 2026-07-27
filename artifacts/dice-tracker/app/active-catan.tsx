/**
 * Active Catan Game Screen.
 *
 * Key differences from the general active-game screen:
 *   - Dice grid shows 2-12 with 7 as a prominent "robber" button
 *   - After recording a 7: shows a non-blocking robber prompt
 *     (if catanRobberTracking is on and user hasn't disabled it)
 *   - Controls bar: Undo · Prev · Next · Dev · Stats
 *   - "Dev" opens the /catan-development modal for building actions
 *
 * This tool is not affiliated with or endorsed by the publishers or owners of Catan.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useGame } from '@/context/GameContext';
import { useSettings } from '@/context/SettingsContext';
import {
  getNextPlayerIndex,
  getPrevPlayerIndex,
  recordRoll,
  undoLastRoll,
} from '@/services/rollInput';
import { playDoneSound, playRollSound, playUndoSound } from '@/services/sound';
import { generateId } from '@/types/models';
import type { CatanPlayerExposureEvent } from '@/types/models';

// ─── 2D6 number layout (7 first/center for prominence) ───────────────────────

const CATAN_NUMBERS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];

const PIPS: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1,
};

// ─── Robber prompt state ──────────────────────────────────────────────────────

type RobberPromptState = 'idle' | 'showing' | 'dismissed_this_session';

export default function ActiveCatanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    activeSession,
    rollEvents,
    exposureEvents,
    persistRollEvents,
    persistExposureEvents,
    updateSession,
    endSession,
  } = useGame();
  const { settings } = useSettings();

  const [lastPressedValue, setLastPressedValue] = useState<number | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [robberPromptState, setRobberPromptState] = useState<RobberPromptState>('idle');
  const [robberHexNumber, setRobberHexNumber] = useState<number | null>(null);
  const [robberDontAskAgain, setRobberDontAskAgain] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  const webTop = Platform.OS === 'web' ? 67 : 0;
  const webBottom = Platform.OS === 'web' ? 34 : 0;

  // ── Derived state ────────────────────────────────────────────────────────────
  const activeEvents = useMemo(() => rollEvents.filter(e => !e.deletedAt), [rollEvents]);
  const currentPlayer = activeSession?.players[activeSession.currentPlayerIndex] ?? null;
  const lastEvent = activeEvents.at(-1) ?? null;
  const totalRolls = activeEvents.length;
  const playerRollCount = currentPlayer
    ? activeEvents.filter(e => e.playerId === currentPlayer.id).length
    : 0;
  const turnNumber = activeSession && activeSession.players.length > 0
    ? Math.floor(totalRolls / activeSession.players.length) + 1
    : 1;
  const canUndo = activeEvents.length > 0;
  const isMultiPlayer = (activeSession?.players.length ?? 0) > 1;
  const sevenCount = activeEvents.filter(e => e.value === 7).length;
  const playerFirstName = currentPlayer
    ? (currentPlayer.displayName.split(' ')[0] ?? currentPlayer.displayName).slice(0, 8)
    : '';

  const recentPlayerRolls = useMemo(() => {
    if (!currentPlayer) return [];
    return activeEvents.filter(e => e.playerId === currentPlayer.id).slice(-5).reverse();
  }, [activeEvents, currentPlayer]);

  const haptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    if (settings.hapticsEnabled) void Haptics.impactAsync(style);
  };

  // Clear grid highlight whenever the active player changes (auto-advance or manual Prev/Next)
  useEffect(() => {
    setLastPressedValue(null);
  }, [activeSession?.currentPlayerIndex]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

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

    // Show robber prompt on 7
    if (
      value === 7 &&
      activeSession.settings.catanRobberTracking &&
      !robberDontAskAgain &&
      robberPromptState !== 'dismissed_this_session'
    ) {
      setRobberHexNumber(null);
      setRobberPromptState('showing');
    }
  };

  const handleUndo = async () => {
    if (!activeSession || !canUndo) return;
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    playUndoSound(settings.soundEnabled);
    const { events: newEvents, undoneEvent } = undoLastRoll(rollEvents);
    await persistRollEvents(activeSession.id, newEvents);
    if (undoneEvent && activeSession.autoAdvancePlayer && activeSession.players.length > 1) {
      const undonePlayerIdx = activeSession.players.findIndex(p => p.id === undoneEvent.playerId);
      if (undonePlayerIdx !== -1) await updateSession({ ...activeSession, currentPlayerIndex: undonePlayerIdx });
    }
    setLastPressedValue(null);
  };

  const handlePrevPlayer = async () => {
    if (!activeSession || !isMultiPlayer) return;
    haptic();
    setLastPressedValue(null);
    await updateSession({ ...activeSession, currentPlayerIndex: getPrevPlayerIndex(activeSession.currentPlayerIndex, activeSession.players.length) });
  };

  const handleNextPlayer = async () => {
    if (!activeSession || !isMultiPlayer) return;
    haptic();
    setLastPressedValue(null);
    await updateSession({ ...activeSession, currentPlayerIndex: getNextPlayerIndex(activeSession.currentPlayerIndex, activeSession.players.length) });
  };

  const handleEndGame = () => {
    haptic(Haptics.ImpactFeedbackStyle.Heavy);
    setShowEndConfirm(true);
  };

  const handleEndConfirm = async () => {
    if (!activeSession) return;
    setShowEndConfirm(false);
    playDoneSound(settings.soundEnabled);
    try {
      await updateSession({ ...activeSession, status: 'completed', endedAt: new Date().toISOString() });
    } catch {
      // Storage error — navigate anyway so the user is never trapped
    }
    router.replace('/results');
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
    await updateSession({
      ...activeSession,
      players: activeSession.players.map((p, i) =>
        i === activeSession.currentPlayerIndex ? { ...p, displayName: trimmed } : p,
      ),
    });
  };

  // ── Robber prompt handlers ────────────────────────────────────────────────────

  const handleRobberConfirm = async () => {
    if (!activeSession) return;
    if (robberHexNumber !== null) {
      // Derive which players have documented exposure on this hex and block each one.
      // The stats engine resolves blocks per playerId, so a block event must be created
      // for each affected player individually.
      const affectedPlayerIds = new Set<string>();
      for (const event of exposureEvents) {
        if (
          (event.eventType === 'initialSettlement' ||
            event.eventType === 'settlementBuilt' ||
            event.eventType === 'cityUpgrade') &&
          event.affectedNumbers.includes(robberHexNumber)
        ) {
          affectedPlayerIds.add(event.playerId);
        }
      }

      if (affectedPlayerIds.size > 0) {
        const blockEvents: CatanPlayerExposureEvent[] = [...affectedPlayerIds].map(playerId => ({
          id: generateId(),
          sessionId: activeSession.id,
          playerId,
          eventType: 'robberBlockStarted' as const,
          turnNumber,
          timestamp: new Date().toISOString(),
          affectedNumbers: [robberHexNumber],
          hexIdentifiers: ['rblock_' + generateId()],
          productionWeight: 0,
          robberBlocked: true,
        }));
        await persistExposureEvents(activeSession.id, [...exposureEvents, ...blockEvents]);
      }
    }
    if (robberDontAskAgain) setRobberPromptState('dismissed_this_session');
    else setRobberPromptState('idle');
  };

  const handleRobberSkip = () => {
    if (robberDontAskAgain) setRobberPromptState('dismissed_this_session');
    else setRobberPromptState('idle');
  };

  // ── No session guard ─────────────────────────────────────────────────────────

  if (!activeSession) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.mutedForeground} />
        <Text style={[styles.noSessionText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          No active game
        </Text>
        <TouchableOpacity style={[styles.goHomeBtn, { backgroundColor: colors.primary }]} onPress={() => router.replace('/')}>
          <Text style={[styles.goHomeBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }]}>Go Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const gameLabel = activeSession.customGameName ?? 'Settlement Mode';

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + webTop, paddingBottom: insets.bottom + webBottom }]}>
      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <Text style={[styles.headerGame, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]} numberOfLines={1}>
            {gameLabel}
          </Text>
          <Text style={[styles.headerMode, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {sevenCount} sevens · {totalRolls} rolls
          </Text>
        </View>
        <TouchableOpacity style={[styles.endBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={handleEndGame}>
          <Text style={[styles.endBtnText, { color: colors.destructive, fontFamily: 'Inter_600SemiBold' }]}>End</Text>
        </TouchableOpacity>
      </View>

      {/* ── Player banner ──────────────────────────────────────────────────────── */}
      <View style={[styles.playerBanner, { borderLeftColor: currentPlayer?.color ?? colors.primary, backgroundColor: colors.card }]}>
        <View style={styles.playerBannerLeft}>
          {isEditingName ? (
            <TextInput
              style={[styles.playerNameInput, { color: colors.foreground, fontFamily: 'Inter_700Bold', borderBottomColor: colors.primary }]}
              value={editNameValue}
              onChangeText={setEditNameValue}
              onBlur={handleSaveName}
              onSubmitEditing={handleSaveName}
              autoFocus maxLength={24} returnKeyType="done"
            />
          ) : (
            <TouchableOpacity onPress={handleStartEditName} activeOpacity={0.7} style={styles.playerNameRow}>
              <Text style={[styles.playerName, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]} numberOfLines={1}>
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
          {recentPlayerRolls.length > 0 && (
            <View style={styles.rollHistory}>
              {recentPlayerRolls.map((e, i) => (
                <View key={e.id} style={[styles.rollPill, {
                  backgroundColor: e.value === 7
                    ? colors.destructive + '22'
                    : i === 0 ? colors.primary + '22' : colors.muted,
                  borderColor: e.value === 7 ? colors.destructive : i === 0 ? colors.primary : 'transparent',
                }]}>
                  <Text style={[styles.rollPillText, {
                    color: e.value === 7 ? colors.destructive : i === 0 ? colors.primary : colors.mutedForeground,
                    fontFamily: 'Inter_600SemiBold',
                  }]}>
                    {e.value}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
        {isMultiPlayer && (
          <View style={styles.playerDots}>
            {activeSession.players.map((p, i) => (
              <View key={p.id} style={[styles.playerDot, {
                backgroundColor: p.color,
                opacity: i === activeSession.currentPlayerIndex ? 1 : 0.3,
                width: i === activeSession.currentPlayerIndex ? 14 : 9,
                height: i === activeSession.currentPlayerIndex ? 14 : 9,
                borderRadius: i === activeSession.currentPlayerIndex ? 7 : 4.5,
              }]} />
            ))}
          </View>
        )}
      </View>

      {/* ── Last roll display ──────────────────────────────────────────────────── */}
      <View style={styles.lastRollRow}>
        <View style={[styles.lastRollCard, {
          backgroundColor: colors.card,
          borderColor: lastEvent
            ? (lastEvent.value === 7 ? colors.destructive : colors.primary)
            : colors.border,
        }]}>
          <Text style={[styles.lastRollValue, {
            color: lastEvent
              ? (lastEvent.value === 7 ? colors.destructive : colors.primary)
              : colors.mutedForeground,
            fontFamily: 'Inter_700Bold',
          }]}>
            {lastEvent ? lastEvent.value : '—'}
          </Text>
        </View>
        <View style={styles.statsColumn}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{totalRolls}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>total</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.destructive, fontFamily: 'Inter_700Bold' }]}>{sevenCount}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>sevens</Text>
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

      {/* ── Catan number grid ──────────────────────────────────────────────────── */}
      <View style={styles.gridWrapper}>
        {/* 7 button — prominent robber button */}
        <TouchableOpacity
          style={[styles.sevenBtn, {
            backgroundColor: lastPressedValue === 7 ? colors.destructive : colors.card,
            borderColor: colors.destructive,
          }]}
          onPress={() => handleRoll(7)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Roll 7 — Robber"
          accessibilityHint="Records a 7 and triggers the robber prompt"
        >
          <Text style={[styles.sevenBtnNumber, {
            color: lastPressedValue === 7 ? '#FFFFFF' : colors.destructive,
            fontFamily: 'Inter_700Bold',
          }]}>7</Text>
          <Text style={[styles.sevenBtnLabel, {
            color: lastPressedValue === 7 ? 'rgba(255,255,255,0.8)' : colors.destructive,
            fontFamily: 'Inter_500Medium',
          }]}>ROBBER</Text>
        </TouchableOpacity>

        {/* Non-7 number grid */}
        <View style={styles.numGrid}>
          {CATAN_NUMBERS.map(num => {
            const pressed = lastPressedValue === num;
            return (
              <TouchableOpacity
                key={num}
                style={[styles.numBtn, {
                  backgroundColor: pressed ? colors.primary : colors.card,
                  borderColor: pressed ? colors.primary : colors.border,
                }]}
                onPress={() => handleRoll(num)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Roll ${num}`}
                accessibilityHint="Records this as your roll"
              >
                <Text style={[styles.numBtnValue, {
                  color: pressed ? colors.primaryForeground : colors.foreground,
                  fontFamily: 'Inter_700Bold',
                }]}>{num}</Text>
                <Text style={[styles.numBtnPips, {
                  color: pressed ? colors.primaryForeground : colors.mutedForeground,
                  fontFamily: 'Inter_400Regular',
                }]}>{'·'.repeat(PIPS[num] ?? 1)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── Build actions row ──────────────────────────────────────────────────── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.buildRow, { borderTopColor: colors.border, borderBottomColor: colors.border }]}
        contentContainerStyle={styles.buildRowContent}
      >
        <TouchableOpacity
          style={[styles.buildPill, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push('/catan-development?action=add_settlement' as any)}
          activeOpacity={0.8}
        >
          <Ionicons name="home-outline" size={14} color={colors.primary} />
          <Text style={[styles.buildPillText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>Settlement</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.buildPill, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push('/catan-development?action=upgrade_city' as any)}
          activeOpacity={0.8}
        >
          <Ionicons name="business-outline" size={14} color={colors.primary} />
          <Text style={[styles.buildPillText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>City</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.buildPill, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push('/catan-development' as any)}
          activeOpacity={0.8}
        >
          <Ionicons name="ellipsis-horizontal-circle-outline" size={14} color={colors.mutedForeground} />
          <Text style={[styles.buildPillText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>More…</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Controls bar ───────────────────────────────────────────────────────── */}
      <View style={[styles.controls, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity style={[styles.controlBtn, { opacity: canUndo ? 1 : 0.35 }]} onPress={handleUndo} disabled={!canUndo} accessibilityRole="button" accessibilityLabel="Undo last roll" accessibilityState={{ disabled: !canUndo }}>
          <Ionicons name="arrow-undo" size={22} color={canUndo ? colors.primary : colors.mutedForeground} />
          <Text style={[styles.controlBtnText, { color: canUndo ? colors.primary : colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>Undo</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.controlBtn, { opacity: isMultiPlayer ? 1 : 0.2 }]} onPress={handlePrevPlayer} disabled={!isMultiPlayer} accessibilityRole="button" accessibilityLabel="Previous player" accessibilityState={{ disabled: !isMultiPlayer }}>
          <Ionicons name="chevron-back-circle-outline" size={22} color={colors.foreground} />
          <Text style={[styles.controlBtnText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>Prev</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.controlBtn, { opacity: isMultiPlayer ? 1 : 0.2 }]} onPress={handleNextPlayer} disabled={!isMultiPlayer} accessibilityRole="button" accessibilityLabel="Next player" accessibilityState={{ disabled: !isMultiPlayer }}>
          <Ionicons name="chevron-forward-circle-outline" size={22} color={colors.foreground} />
          <Text style={[styles.controlBtnText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>Next</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlBtn} onPress={() => router.push('/stats' as any)} accessibilityRole="button" accessibilityLabel="View statistics">
          <Ionicons name="bar-chart-outline" size={22} color={colors.primary} />
          <Text style={[styles.controlBtnText, { color: colors.primary, fontFamily: 'Inter_500Medium' }]}>Stats</Text>
        </TouchableOpacity>
      </View>

      {/* ── End game confirmation modal ─────────────────────────────────────────── */}
      <Modal
        visible={showEndConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEndConfirm(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.endConfirmSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.robberHandle} />
            <Text style={[styles.robberTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              End Game?
            </Text>
            <Text style={[styles.robberSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {totalRolls} roll{totalRolls !== 1 ? 's' : ''} recorded.{'\n'}Results and statistics will be available.
            </Text>
            <View style={styles.robberActions}>
              <TouchableOpacity
                style={[styles.robberActionBtn, { backgroundColor: colors.muted, flex: 1 }]}
                onPress={() => setShowEndConfirm(false)}
              >
                <Text style={[styles.robberActionText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.robberActionBtn, { backgroundColor: colors.destructive, flex: 1 }]}
                onPress={() => { void handleEndConfirm(); }}
              >
                <Text style={[styles.robberActionText, { color: '#FFFFFF', fontFamily: 'Inter_700Bold' }]}>End Game</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Robber prompt modal ─────────────────────────────────────────────────── */}
      <Modal
        visible={robberPromptState === 'showing'}
        transparent
        animationType="slide"
        onRequestClose={handleRobberSkip}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.robberSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.robberHandle} />
            <Text style={[styles.robberTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              🎲 7 Rolled — Robber Moves
            </Text>
            <Text style={[styles.robberSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Where did the robber go? (optional)
            </Text>
            <View style={styles.robberHexGrid}>
              {CATAN_NUMBERS.map(num => {
                const selected = robberHexNumber === num;
                return (
                  <TouchableOpacity
                    key={num}
                    style={[styles.robberHexBtn, {
                      backgroundColor: selected ? colors.destructive : colors.muted,
                      borderColor: selected ? colors.destructive : colors.border,
                    }]}
                    onPress={() => setRobberHexNumber(selected ? null : num)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.robberHexBtnText, {
                      color: selected ? '#FFFFFF' : colors.foreground,
                      fontFamily: 'Inter_700Bold',
                    }]}>{num}</Text>
                    <Text style={[styles.robberHexBtnPips, {
                      color: selected ? 'rgba(255,255,255,0.7)' : colors.mutedForeground,
                    }]}>{'·'.repeat(PIPS[num] ?? 1)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Don't ask again */}
            <TouchableOpacity
              style={styles.dontAskRow}
              onPress={() => setRobberDontAskAgain(v => !v)}
            >
              <View style={[styles.checkbox, { borderColor: colors.border, backgroundColor: robberDontAskAgain ? colors.primary : 'transparent' }]}>
                {robberDontAskAgain && <Ionicons name="checkmark" size={12} color="#FFFFFF" />}
              </View>
              <Text style={[styles.dontAskText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                Don't ask again this game
              </Text>
            </TouchableOpacity>

            {/* Actions */}
            <View style={styles.robberActions}>
              <TouchableOpacity
                style={[styles.robberActionBtn, { backgroundColor: colors.muted, flex: 1 }]}
                onPress={handleRobberSkip}
              >
                <Text style={[styles.robberActionText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>Not now</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.robberActionBtn, { backgroundColor: colors.primary, flex: 1 }]}
                onPress={handleRobberConfirm}
              >
                <Text style={[styles.robberActionText, { color: colors.primaryForeground, fontFamily: 'Inter_700Bold' }]}>
                  {robberHexNumber !== null ? 'Log Robber' : 'Dismiss'}
                </Text>
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

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, gap: 10 },
  headerLeft: { flex: 1, gap: 1 },
  headerGame: { fontSize: 16 },
  headerMode: { fontSize: 12 },
  endBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  endBtnText: { fontSize: 14 },

  playerBanner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderLeftWidth: 4, marginHorizontal: 12, marginTop: 10, borderRadius: 10, gap: 12 },
  playerBannerLeft: { flex: 1 },
  playerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playerName: { fontSize: 20 },
  editIcon: { marginTop: 2 },
  playerNameInput: { fontSize: 20, borderBottomWidth: 1.5, paddingVertical: 2 },
  playerSub: { fontSize: 13, marginTop: 2 },
  playerDots: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  playerDot: {},
  rollHistory: { flexDirection: 'row', gap: 5, marginTop: 6, flexWrap: 'wrap' },
  rollPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  rollPillText: { fontSize: 13 },

  lastRollRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 12 },
  lastRollCard: { width: 100, height: 90, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  lastRollValue: { fontSize: 46 },
  statsColumn: { flex: 1, flexDirection: 'row', gap: 16 },
  statItem: { alignItems: 'center', gap: 2 },
  statValue: { fontSize: 22 },
  statLabel: { fontSize: 12 },

  gridWrapper: { flex: 1, paddingHorizontal: 12, paddingVertical: 6, gap: 10 },

  sevenBtn: {
    width: '100%',
    height: 52,
    borderRadius: 14,
    borderWidth: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  sevenBtnNumber: { fontSize: 28 },
  sevenBtnLabel: { fontSize: 14, letterSpacing: 1.5 },

  numGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', flex: 1 },
  numBtn: { width: '18%', aspectRatio: 1, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 52 },
  numBtnValue: { fontSize: 20 },
  numBtnPips: { fontSize: 9, letterSpacing: 1 },

  controls: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 8, paddingBottom: 4 },
  controlBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, gap: 3 },
  controlBtnText: { fontSize: 11 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  endConfirmSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 20, gap: 16 },
  robberSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 20, gap: 16, maxHeight: '70%' },
  robberHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#555', alignSelf: 'center', marginBottom: 4 },
  robberTitle: { fontSize: 20, textAlign: 'center' },
  robberSub: { fontSize: 14, textAlign: 'center' },
  // Build row
  buildRow: { borderTopWidth: 1, borderBottomWidth: 1, flexGrow: 0, flexShrink: 0 },
  buildRowContent: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center' },
  buildPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  buildPillText: { fontSize: 13 },

  // Robber hex grid
  robberHexGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  robberHexBtn: { width: 52, height: 52, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', gap: 2 },
  robberHexBtnText: { fontSize: 16 },
  robberHexBtnPips: { fontSize: 8, letterSpacing: 0.5 },

  dontAskRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  dontAskText: { fontSize: 13 },
  robberActions: { flexDirection: 'row', gap: 12 },
  robberActionBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  robberActionText: { fontSize: 16 },
});
