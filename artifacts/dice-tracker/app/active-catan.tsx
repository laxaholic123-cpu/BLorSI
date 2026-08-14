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
  Alert,
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
import { confirmEndGame } from '@/services/endGame';
import { generateId } from '@/types/models';
import type {
  CatanDevCardEvent,
  CatanDevCardType,
  CatanPlayerExposureEvent,
} from '@/types/models';
import {
  DEV_CARD_LABELS,
  DEV_CARD_TYPES,
  DEV_DECK_COMPOSITION,
  DEV_DECK_SIZE,
} from '@/services/devCards';
import { getLinkedBuildingEventCount } from '@/services/editSettlements';
import {
  computePlayerProductionStats,
  getActiveRobberBlockedNumbers,
  getBuildingStatesAtTurn,
  CATAN_PROBS,
} from '@/services/catanStats';
import { CATAN_SMALL_SAMPLE_THRESHOLD } from '@/types/catanStats';
import { CatanProductionLeaderboard } from '@/components/CatanProductionLeaderboard';
import { CatanRollHeatMap } from '@/components/CatanRollHeatMap';

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
    setRollEvents,
    exposureEvents,
    devCardEvents,
    persistRollEvents,
    persistExposureEvents,
    persistDevCardEvents,
    updateSession,
    loadActiveGame,
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
  const [showEditSettlementspicker, setShowEditSettlementspicker] = useState(false);
  const [devCardPickerOpen, setDevCardPickerOpen] = useState(false);
  // Heat map starts hidden so the dice pad is always immediately visible
  const [showHeatMap, setShowHeatMap] = useState(false);

  const webTop = Platform.OS === 'web' ? 67 : 0;
  const webBottom = Platform.OS === 'web' ? 34 : 0;

  // ── Derived state ────────────────────────────────────────────────────────────
  const activeEvents = useMemo(() => rollEvents.filter(e => !e.deletedAt), [rollEvents]);
  // Live deck tally, so the picker can grey out a card type already exhausted.
  const devCardCounts = useMemo(() => {
    const counts: Partial<Record<CatanDevCardType, number>> = {};
    for (const event of devCardEvents) {
      if (event.deletedAt) continue;
      counts[event.cardType] = (counts[event.cardType] ?? 0) + 1;
    }
    return counts;
  }, [devCardEvents]);
  const devCardsRemaining = useMemo(
    () => Math.max(0, DEV_DECK_SIZE - devCardEvents.filter(e => !e.deletedAt).length),
    [devCardEvents],
  );
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

  // ── Live dashboard data ───────────────────────────────────────────────────────

  /** Per-value roll frequency for the heat map */
  const rollCounts = useMemo<Record<number, number>>(() => {
    const counts: Record<number, number> = {};
    for (const e of activeEvents) counts[e.value] = (counts[e.value] ?? 0) + 1;
    return counts;
  }, [activeEvents]);

  /**
   * Numbers covered by any player's CURRENTLY ACTIVE settlement or city.
   * Uses getBuildingStatesAtTurn so that buildingRemoved and manualCorrection
   * events are respected — a number is only highlighted if a building is
   * still present there, not just historically placed.
   */
  const settlementNumbers = useMemo<Set<number>>(() => {
    if (!activeSession) return new Set<number>();
    const nums = new Set<number>();
    for (const player of activeSession.players) {
      const buildings = getBuildingStatesAtTurn(player.id, 99999, exposureEvents);
      for (const bldg of buildings) {
        for (const n of bldg.affectedNumbers) nums.add(n);
      }
    }
    return nums;
  }, [activeSession, exposureEvents]);

  /** Per-player production stats — null when no exposure events recorded yet */
  const playerProductionStats = useMemo(
    () =>
      activeSession && exposureEvents.length > 0
        ? activeSession.players.map(p =>
            computePlayerProductionStats(p, rollEvents, exposureEvents),
          )
        : null,
    [activeSession, rollEvents, exposureEvents],
  );

  /** playerId → currently blocked numbers */
  const activeRobberBlocks = useMemo<Map<string, number[]>>(() => {
    const map = new Map<string, number[]>();
    if (!activeSession) return map;
    for (const player of activeSession.players) {
      const blocked = getActiveRobberBlockedNumbers(player.id, 99999, exposureEvents);
      if (blocked.length > 0) map.set(player.id, blocked);
    }
    return map;
  }, [activeSession, exposureEvents]);

  const isSmallSample = totalRolls < CATAN_SMALL_SAMPLE_THRESHOLD;

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

    // Step 1: Persist the roll. If this fails, the roll was never saved — roll back.
    try {
      await persistRollEvents(activeSession.id, newEvents);
    } catch {
      setRollEvents(rollEvents);
      setLastPressedValue(null);
      return;
    }

    // Step 2: Roll is safely in storage. Advance the player. If this fails, the roll
    // stays recorded; reload from storage to reconcile memory with persisted state.
    if (activeSession.autoAdvancePlayer && activeSession.players.length > 1) {
      const nextIdx = getNextPlayerIndex(activeSession.currentPlayerIndex, activeSession.players.length);
      try {
        await updateSession({ ...activeSession, currentPlayerIndex: nextIdx });
      } catch {
        await loadActiveGame().catch(() => undefined);
      }
    }

    // Show robber prompt on 7 (roll is safe regardless of player-advance outcome)
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

    // Step 1: Persist the undo. If this fails, the undo was never saved — roll back.
    try {
      await persistRollEvents(activeSession.id, newEvents);
    } catch {
      setRollEvents(rollEvents);
      return;
    }

    // Step 2: Undo is safely in storage. Revert the player index. If this fails,
    // the undo stays recorded; reload from storage to reconcile memory.
    if (undoneEvent && activeSession.autoAdvancePlayer && activeSession.players.length > 1) {
      const undonePlayerIdx = activeSession.players.findIndex(p => p.id === undoneEvent.playerId);
      if (undonePlayerIdx !== -1) {
        try {
          await updateSession({ ...activeSession, currentPlayerIndex: undonePlayerIdx });
        } catch {
          await loadActiveGame().catch(() => undefined);
        }
      }
    }
    setLastPressedValue(null);
  };

  const handlePrevPlayer = async () => {
    if (!activeSession || !isMultiPlayer) return;
    haptic();
    setLastPressedValue(null);
    try {
      await updateSession({ ...activeSession, currentPlayerIndex: getPrevPlayerIndex(activeSession.currentPlayerIndex, activeSession.players.length) });
    } catch {
      // Reload from storage to reconcile in-memory state with what was actually persisted
      await loadActiveGame().catch(() => undefined);
    }
  };

  const handleNextPlayer = async () => {
    if (!activeSession || !isMultiPlayer) return;
    haptic();
    setLastPressedValue(null);
    try {
      await updateSession({ ...activeSession, currentPlayerIndex: getNextPlayerIndex(activeSession.currentPlayerIndex, activeSession.players.length) });
    } catch {
      // Reload from storage to reconcile in-memory state with what was actually persisted
      await loadActiveGame().catch(() => undefined);
    }
  };

  const handleEndGame = () => {
    haptic(Haptics.ImpactFeedbackStyle.Heavy);
    setShowEndConfirm(true);
  };

  const handleEditSettlements = (playerId: string) => {
    haptic();
    setShowEditSettlementspicker(false);

    // Guard: block the edit if the player has city upgrades, building removals,
    // or manual corrections on top of their initial settlement positions.
    // Editing in that state would leave those events referencing a now-deleted
    // location, producing phantom buildings in the production statistics.
    const linkedCount = getLinkedBuildingEventCount(exposureEvents, playerId);
    if (linkedCount > 0) {
      const player = activeSession?.players.find(p => p.id === playerId);
      const name = player?.displayName ?? 'This player';
      Alert.alert(
        'Cannot Edit Settlements',
        `${name} has ${linkedCount} building upgrade${linkedCount !== 1 ? 's' : ''} or correction${linkedCount !== 1 ? 's' : ''} on their starting positions. Remove those changes from the build menu first, then edit their starting spots.`,
        [{ text: 'OK' }],
      );
      return;
    }

    router.push((`/catan-board-scan?editPlayerId=${encodeURIComponent(playerId)}`) as any);
  };

  const handleEditSettlementsPress = () => {
    if (!activeSession) return;
    haptic();
    if (activeSession.players.length === 1 && activeSession.players[0]) {
      handleEditSettlements(activeSession.players[0].id);
    } else {
      setShowEditSettlementspicker(true);
    }
  };

  const handleEndConfirm = async () => {
    if (!activeSession) return;
    setShowEndConfirm(false);
    playDoneSound(settings.soundEnabled);
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
    await updateSession({
      ...activeSession,
      players: activeSession.players.map((p, i) =>
        i === activeSession.currentPlayerIndex ? { ...p, displayName: trimmed } : p,
      ),
    });
  };

  // ── Development card handlers ─────────────────────────────────────────────────

  const handleRecordDevCard = async (cardType: CatanDevCardType) => {
    if (!activeSession) return;
    haptic();
    const nextSequence = devCardEvents.reduce((max, e) => Math.max(max, e.sequenceNumber), 0) + 1;
    const event: CatanDevCardEvent = {
      id: generateId(),
      sessionId: activeSession.id,
      playerId: activeSession.players[activeSession.currentPlayerIndex]?.id ?? '',
      cardType,
      turnNumber,
      sequenceNumber: nextSequence,
      timestamp: new Date().toISOString(),
    };
    setDevCardPickerOpen(false);
    try {
      await persistDevCardEvents(activeSession.id, [...devCardEvents, event]);
    } catch {
      Alert.alert(
        'Draw not saved',
        'The card was recorded for this session but could not be written to storage. Deck luck may be incomplete.',
      );
    }
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
      {/*
        Layout contract:
          • ScrollView (flex:1) holds the decorative/informational top content:
            header, player banner, last-roll stats, live dashboard.
            On small screens this area can scroll to reach dashboard details
            without displacing the dice pad.
          • The dice pad (gridWrapper), build row, and controls bar sit BELOW
            the ScrollView and are NEVER scrolled away — they're always reachable.
      */}
      <ScrollView
        style={styles.topScroll}
        contentContainerStyle={styles.topScrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
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

      {/* ── Live production leaderboard ───────────────────────────────────────── */}
      <CatanProductionLeaderboard
        players={activeSession.players}
        playerStats={playerProductionStats}
        activeRobberBlocks={activeRobberBlocks}
        currentPlayerIndex={activeSession.currentPlayerIndex}
        isSmallSample={isSmallSample}
        colors={colors}
        onToggleHeatMap={() => setShowHeatMap(v => !v)}
        showHeatMap={showHeatMap}
      />

      {/* ── Roll heat map ──────────────────────────────────────────────────────── */}
      {showHeatMap && (
        <CatanRollHeatMap
          rollCounts={rollCounts}
          totalRolls={totalRolls}
          settlementNumbers={settlementNumbers}
          colors={colors}
        />
      )}
      </ScrollView>

      {/* ── Catan number grid ──────────────────────────────────────────────────── */}
      {/* NOTE: gridWrapper intentionally has NO flex:1 — the ScrollView above   */}
      {/* takes flex:1 and the grid sits at a fixed natural height below it.      */}
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
        {activeSession.settings.catanDevCardTracking && (
          <TouchableOpacity
            style={[styles.buildPill, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setDevCardPickerOpen(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="albums-outline" size={14} color={colors.primary} />
            <Text style={[styles.buildPillText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
              Dev Card
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.buildPill, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push('/catan-development' as any)}
          activeOpacity={0.8}
        >
          <Ionicons name="ellipsis-horizontal-circle-outline" size={14} color={colors.mutedForeground} />
          <Text style={[styles.buildPillText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>More…</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.buildPill, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={handleEditSettlementsPress}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Edit settlement positions"
        >
          <Ionicons name="map-outline" size={14} color={colors.mutedForeground} />
          <Text style={[styles.buildPillText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>Edit Settlements</Text>
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

      {/* ── Edit Settlements player picker ─────────────────────────────────────── */}
      <Modal
        visible={showEditSettlementspicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEditSettlementspicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.robberSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.robberHandle} />
            <Text style={[styles.robberTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              Edit Settlements
            </Text>
            <Text style={[styles.robberSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Which player's positions need correcting?
            </Text>
            {activeSession?.players.map(player => (
              <TouchableOpacity
                key={player.id}
                style={[styles.playerPickerRow, { backgroundColor: colors.muted, borderColor: colors.border }]}
                onPress={() => handleEditSettlements(player.id)}
                activeOpacity={0.8}
              >
                <View style={[styles.playerPickerDot, { backgroundColor: player.color }]} />
                <Text style={[styles.playerPickerName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  {player.displayName}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.robberActionBtn, { backgroundColor: colors.muted, marginTop: 4 }]}
              onPress={() => setShowEditSettlementspicker(false)}
            >
              <Text style={[styles.robberActionText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Development card draw ───────────────────────────────────────────────── */}
      <Modal
        visible={devCardPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setDevCardPickerOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.robberSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.robberHandle} />
            <Text style={[styles.robberTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              Development Card
            </Text>
            <Text style={[styles.robberSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {currentPlayer ? `What did ${currentPlayer.displayName} draw?` : 'What was drawn?'}
              {` ${devCardsRemaining} left in the deck.`}
            </Text>
            {DEV_CARD_TYPES.map(type => {
              const drawn = devCardCounts[type] ?? 0;
              const inDeck = DEV_DECK_COMPOSITION[type];
              const exhausted = drawn >= inDeck;
              return (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.playerPickerRow,
                    { backgroundColor: colors.muted, borderColor: colors.border, opacity: exhausted ? 0.4 : 1 },
                  ]}
                  onPress={() => void handleRecordDevCard(type)}
                  disabled={exhausted}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.playerPickerName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                    {DEV_CARD_LABELS[type]}
                  </Text>
                  <Text style={[styles.robberSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginBottom: 0 }]}>
                    {inDeck - drawn}/{inDeck}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[styles.robberActionBtn, { backgroundColor: colors.muted, marginTop: 4 }]}
              onPress={() => setDevCardPickerOpen(false)}
            >
              <Text style={[styles.robberActionText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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

  // The scrollable top content area — holds header, player banner, stats, dashboard.
  // This takes the remaining vertical space above the fixed dice pad.
  topScroll: { flex: 1 },
  topScrollContent: { paddingBottom: 8 },
  // The dice pad is OUTSIDE the scroll view so it is always visible and reachable.
  gridWrapper: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, gap: 10 },

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

  // Edit settlements player picker
  playerPickerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: 1 },
  playerPickerDot: { width: 14, height: 14, borderRadius: 7, flexShrink: 0 },
  playerPickerName: { flex: 1, fontSize: 16 },
});
