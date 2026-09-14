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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useGame } from '@/context/GameContext';
import { useSettings } from '@/context/SettingsContext';
import { useRollFlash } from '@/hooks/useRollFlash';
import {
  getNextPlayerIndex,
  getPrevPlayerIndex,
  recordRoll,
  undoLastRoll,
} from '@/services/rollInput';
import { playDoneSound, playRollSound, playUndoSound } from '@/services/sound';
import { confirmEndGame } from '@/services/endGame';
import { generateId } from '@/types/models';
import type { CatanPlayerExposureEvent } from '@/types/models';
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
import { CatanBoardPanel } from '@/components/CatanBoardPanel';
import { CatanHexGrid } from '@/components/CatanHexGrid';
import { boardStateAtTurn } from '@/services/catanBoardState';
import { currentRobberHex, playersOnHex, robberMoveEvents } from '@/services/catanRobber';
import {
  calloutForLatestRoll,
  rememberCallout,
  type Callout,
  type CalloutKind,
} from '@/services/liveCallouts';
import { loadActiveBoard, type ActiveBoard } from '@/services/storage';

// ─── 2D6 number layout (7 first/center for prominence) ───────────────────────

const CATAN_NUMBERS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];

const PIPS: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1,
};

// ─── Robber prompt state ──────────────────────────────────────────────────────

/**
 * No 'dismissed_this_session' any more.
 *
 * Silencing the prompt for a whole game means the robber never moves again
 * in the record, so its blocks never lift — which is precisely the bug this
 * screen was just fixed for. A single 7 can still be skipped; the next one
 * asks again.
 */
type RobberPromptState = 'idle' | 'showing';

export default function ActiveCatanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    activeSession,
    rollEvents,
    setRollEvents,
    exposureEvents,
    persistRollEvents,
    persistExposureEvents,
    updateSession,
    loadActiveGame,
    endSession,
  } = useGame();
  const { settings } = useSettings();

  const { value: lastPressedValue, flash: flashRoll, clear: clearRollFlash } = useRollFlash();
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [robberPromptState, setRobberPromptState] = useState<RobberPromptState>('idle');
  /** Fallback for games with no board: the robber's NUMBER. */
  const [robberHexNumber, setRobberHexNumber] = useState<number | null>(null);
  /** The tile the robber moved to, when the board is known. */
  const [robberHexIndex, setRobberHexIndex] = useState<number | null>(null);
  /** What made the robber move — only the title differs. */
  const [robberTrigger, setRobberTrigger] = useState<'seven' | 'knight'>('seven');
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showEditSettlementspicker, setShowEditSettlementspicker] = useState(false);
  // Heat map starts hidden so the dice pad is always immediately visible
  const [showHeatMap, setShowHeatMap] = useState(false);
  /**
   * The board, and whether it is showing.
   *
   * Hidden by default for the same reason as the heat map: this screen exists
   * to record rolls, and anything above the pad that grows pushes the pad off
   * the bottom — which is exactly how "most of the numbers cannot be tapped"
   * happened. The board is something you OPEN to check against the table.
   */
  const [showBoard, setShowBoard] = useState(false);
  const [board, setBoard] = useState<ActiveBoard | null>(null);
  /** Which callout kinds have fired, and when. See services/liveCallouts. */
  const [calloutSeen, setCalloutSeen] = useState<ReadonlyMap<CalloutKind, number>>(new Map());
  const [callout, setCallout] = useState<Callout | null>(null);

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



  /**
   * The board is read on FOCUS, not on mount.
   *
   * This screen stays mounted underneath the development modal, so a
   * settlement placed there would not appear here until the app restarted if
   * this were a mount-only effect. That has bitten this repo three times; the
   * rule is in CLAUDE.md.
   */
  useFocusEffect(
    React.useCallback(() => {
      if (activeSession) void loadActiveBoard(activeSession.id).then(setBoard);
    }, [activeSession]),
  );

  const boardSnapshot = useMemo(
    () => boardStateAtTurn(
      exposureEvents,
      (activeSession?.players ?? []).map(p => p.id),
    ),
    [exposureEvents, activeSession],
  );

  /**
   * One descriptive callout for the latest roll, or nothing.
   *
   * Keyed on the newest roll's id so it fires once per roll rather than on
   * every render. Everything it can say is a statement of fact — no claim
   * about luck is made anywhere on this screen, because the simulation that
   * would justify one only runs at the end. See services/liveCallouts.
   */
  /** Where the robber is now, so the prompt can say so rather than ask blind. */
  const currentRobberHexIndex = useMemo(
    () => currentRobberHex(exposureEvents),
    [exposureEvents],
  );

  /**
   * Every piece on the board, for the robber prompt.
   *
   * Choosing where the robber goes is a decision about whose production to
   * cut, so the prompt has to show whose pieces are where.
   */
  const robberBoardMarks = useMemo(() => {
    const buildings: Record<string, string> = {};
    const cities: string[] = [];
    const roads: Record<string, string> = {};
    const colourOf = (id: string) =>
      activeSession?.players.find(p => p.id === id)?.color ?? '#888';
    for (const [cornerId, b] of boardSnapshot.buildings) {
      buildings[cornerId] = colourOf(b.playerId);
      if (b.weight >= 2) cities.push(cornerId);
    }
    for (const [edgeId, owner] of boardSnapshot.roads) roads[edgeId] = colourOf(owner);
    return { buildings, cities, roads };
  }, [boardSnapshot, activeSession]);

  /** Plain-language name for a tile, for the robber prompt. */
  const describeHex = useCallback((i: number) => {
    const hex = board?.hexes[i];
    if (!hex) return `tile ${i + 1}`;
    const res = hex.resource ?? 'tile';
    return hex.number ? `${res} ${hex.number}` : `${res}`;
  }, [board]);

  /** Who the pending move would block — shown before it is committed. */
  const robberBlockPreview = useMemo(() => {
    if (robberHexIndex === null || !board) return '';
    const hex = board.hexes[robberHexIndex];
    if (!hex?.number) return `${describeHex(robberHexIndex)} — produces nothing, so this blocks no one.`;
    const names = playersOnHex(robberHexIndex, boardSnapshot)
      .map(id => activeSession?.players.find(p => p.id === id)?.displayName ?? 'someone');
    return names.length === 0
      ? `${describeHex(robberHexIndex)} — nobody is on it.`
      : `${describeHex(robberHexIndex)} — blocks ${names.join(', ')}.`;
  }, [robberHexIndex, board, boardSnapshot, activeSession, describeHex]);

  const latestRollId = activeEvents.at(-1)?.id ?? null;
  useEffect(() => {
    if (!latestRollId || !activeSession) return;
    const next = calloutForLatestRoll({
      rolls: rollEvents,
      snapshot: boardSnapshot,
      blockedByPlayer: activeRobberBlocks,
      nameOf: id =>
        activeSession.players.find(p => p.id === id)?.displayName ?? 'Someone',
      recent: calloutSeen,
    });
    if (next) {
      setCallout(next);
      setCalloutSeen(prev => rememberCallout(prev, next));
    }
    // calloutSeen is deliberately NOT a dependency: including it would re-run
    // this the moment it updates and re-fire the same callout forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestRollId]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleRoll = async (value: number) => {
    if (!activeSession || !currentPlayer) return;
    haptic();
    playRollSound(settings.soundEnabled);
    flashRoll(value);

    const newEvents = recordRoll(
      { session: activeSession, playerId: currentPlayer.id, value, source: 'touchscreen' },
      rollEvents,
    );

    // Step 1: Persist the roll. If this fails, the roll was never saved — roll back.
    try {
      await persistRollEvents(activeSession.id, newEvents);
    } catch {
      setRollEvents(rollEvents);
      clearRollFlash();
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
      true
    ) {
      setRobberHexNumber(null);
      setRobberHexIndex(null);
      setRobberTrigger('seven');
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
    clearRollFlash();
  };

  const handlePrevPlayer = async () => {
    if (!activeSession || !isMultiPlayer) return;
    haptic();
    clearRollFlash();
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
    clearRollFlash();
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
      onPersistError: (message) => Alert.alert('Game not saved as finished', message),
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

  // ── Robber prompt handlers ────────────────────────────────────────────────────

  /**
   * Move the robber to a tile.
   *
   * `robberMoveEvents` returns the ENDS for whatever was blocked before plus
   * the STARTS for whoever the robber now sits on, in one array, so the move
   * cannot be half-applied. That ending step is the whole fix: blocks used to
   * accumulate for the rest of the game.
   */
  const handleRobberMoveToHex = async () => {
    if (!activeSession || robberHexIndex === null || !board) return;
    const hex = board.hexes[robberHexIndex];
    const events = robberMoveEvents({
      sessionId: activeSession.id,
      hexIndex: robberHexIndex,
      hexNumber: hex?.number ?? null,
      turnNumber,
      snapshot: boardSnapshot,
      events: exposureEvents,
    });
    if (events.length > 0) {
      await persistExposureEvents(activeSession.id, [...exposureEvents, ...events]);
    }
    setRobberHexIndex(null);
    setRobberPromptState('idle');
  };

  const handleRobberConfirm = async () => {
    if (!activeSession) return;
    if (board) return handleRobberMoveToHex();
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
    setRobberPromptState('idle');
  };

  const handleRobberSkip = () => {
    setRobberPromptState('idle');
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

      {/* ── The board ──────────────────────────────────────────────────────────
          Only offered when there IS a board — a scanned or hand-entered game
          without one has nothing to draw, and a button that opens an empty
          panel is worse than no button. */}
      {board && (
        <View style={{ gap: 8, marginTop: 10 }}>
          <TouchableOpacity
            style={[styles.boardToggle, { borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={() => { haptic(); setShowBoard(v => !v); }}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={showBoard ? 'Hide the board' : 'Show the board'}
          >
            <Ionicons
              name={showBoard ? 'chevron-up' : 'map-outline'}
              size={16}
              color={colors.mutedForeground}
            />
            <Text style={[styles.boardToggleText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
              {showBoard ? 'Hide the board' : 'Show the board'}
            </Text>
          </TouchableOpacity>
          {showBoard && (
            <CatanBoardPanel
              hexes={board.hexes}
              ports={board.ports}
              events={exposureEvents}
              players={activeSession.players}
              title="WHO IS WHERE"
            />
          )}
        </View>
      )}
      </ScrollView>

      {/* ── Live callout ────────────────────────────────────────────────────────
          Sits OUTSIDE the ScrollView so it is seen without scrolling, and is a
          single line of fixed height so it cannot push the pad off the bottom.
          Anything here that can grow repeats the roll-pad collapse.

          Everything it says is a statement of fact. No claim about luck is made
          on this screen — the simulation that would justify one runs once, at
          the end. See services/liveCallouts. */}
      {callout && (
        <TouchableOpacity
          style={[styles.callout, { backgroundColor: '#F0C24B', borderColor: '#F0C24B' }]}
          onPress={() => { haptic(); setCallout(null); }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`${callout.text}. Tap to dismiss.`}
        >
          <Ionicons name="sparkles" size={17} color="#1A1200" />
          <Text
            style={[styles.calloutText, { color: '#1A1200', fontFamily: 'Inter_700Bold' }]}
            numberOfLines={2}
          >
            {callout.text}
          </Text>
          <Ionicons name="close" size={16} color="#1A1200" />
        </TouchableOpacity>
      )}

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

        {/*
          The dots under each number are its PIPS — how many of the 36 dice
          combinations make it, the same dots printed on the wooden tokens.
          They were unlabelled, and were reported as numbers with "no
          explanation or easy to understand meaning". One line costs nothing
          and removes the guesswork.
        */}
        <Text style={[styles.padLegend, {
          color: colors.mutedForeground, fontFamily: 'Inter_400Regular',
        }]}>
          Dots = ways to roll it, out of 36
        </Text>

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
          onPress={() => {
            /*
              The robber moves on a 7 AND on a knight. Only the 7 had a path,
              so a knight-driven move could not be recorded at all — the block
              stayed on whatever tile the last 7 put it on, for the rest of
              the game.
            */
            haptic();
            setRobberHexIndex(null);
            setRobberTrigger('knight');
            setRobberPromptState('showing');
          }}
          activeOpacity={0.8}
        >
          <Ionicons name="skull-outline" size={14} color={colors.destructive} />
          <Text style={[styles.buildPillText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>Robber</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.buildPill, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push(
            `/catan-development?action=add_settlement${currentPlayer ? `&playerId=${currentPlayer.id}` : ''}` as any)}
          activeOpacity={0.8}
        >
          <Ionicons name="home-outline" size={14} color={colors.primary} />
          <Text style={[styles.buildPillText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>Settlement</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.buildPill, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push(
            `/catan-development?action=build_road${currentPlayer ? `&playerId=${currentPlayer.id}` : ''}` as any)}
          activeOpacity={0.8}
        >
          <Ionicons name="git-branch-outline" size={14} color={colors.primary} />
          <Text style={[styles.buildPillText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>Road</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.buildPill, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push(
            `/catan-development?action=upgrade_city${currentPlayer ? `&playerId=${currentPlayer.id}` : ''}` as any)}
          activeOpacity={0.8}
        >
          <Ionicons name="business-outline" size={14} color={colors.primary} />
          <Text style={[styles.buildPillText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>City</Text>
        </TouchableOpacity>
        {/*
          Development cards, from the game itself.

          The card log was only reachable from the RESULTS screen, after the
          game had ended — reported as "there was no obvious place for a
          development card to be logged". A card is bought or played mid-turn,
          so this is where it gets recorded, next to the other things a player
          does on their turn.
        */}
        <TouchableOpacity
          style={[styles.buildPill, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push('/catan-dev-cards' as any)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Log a development card"
        >
          <Ionicons name="layers-outline" size={14} color={colors.primary} />
          <Text style={[styles.buildPillText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>Dev Card</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.buildPill, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push(
            `/catan-development${currentPlayer ? `?playerId=${currentPlayer.id}` : ''}` as any)}
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
              {robberTrigger === 'knight' ? '⚔️ Knight — Robber Moves' : '🎲 7 Rolled — Robber Moves'}
            </Text>
            <Text style={[styles.robberSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {board
                ? 'Tap the tile the robber moved to.'
                : 'Which number is the robber sitting on? (optional)'}
            </Text>

            {/*
              THE BOARD, when we have one. The robber occupies a TILE — asking
              for a number blocked every hex carrying it, so a player on the
              other 5 lost production the robber never touched. Tapping the
              tile also means the app works out WHO is blocked, from the six
              corners, instead of asking.
            */}
            {board ? (
              <View style={{ width: '100%' }}>
                {/*
                  THE LIVE BOARD, not a blank one. Deciding where the robber
                  goes is a decision about whose production you are cutting, so
                  a board with no pieces on it is the wrong picture entirely —
                  and the robber's CURRENT tile matters most of all, because
                  the move is "from there to here" and you cannot leave it
                  where it is.

                  The current tile is marked amber; the tile you are moving to
                  goes red. Two different colours because they are two
                  different things, and a single highlight made them
                  indistinguishable.
                */}
                <CatanHexGrid
                  hexes={board.hexes}
                  ports={board.ports}
                  selectedIndices={[
                    ...(currentRobberHexIndex !== null && currentRobberHexIndex !== robberHexIndex
                      ? [currentRobberHexIndex] : []),
                    ...(robberHexIndex !== null ? [robberHexIndex] : []),
                  ]}
                  selectionColor={robberHexIndex !== null ? colors.destructive : '#F0C24B'}
                  showIntersections
                  legalIntersections={[]}
                  intersectionMarks={robberBoardMarks.buildings}
                  cityIntersections={robberBoardMarks.cities}
                  showRoads
                  legalRoads={[]}
                  roadMarks={robberBoardMarks.roads}
                  onHexPress={(i: number) => {
                    haptic();
                    setRobberHexIndex(prev => (prev === i ? null : i));
                  }}
                />
                <Text style={[styles.robberSub, {
                  color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 6,
                }]}>
                  {robberHexIndex === null
                    ? currentRobberHexIndex !== null
                      ? `Currently on the ${describeHex(currentRobberHexIndex)}.`
                      : 'Nothing is blocked right now.'
                    : robberBlockPreview}
                </Text>
              </View>
            ) : (
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
            )}

            {/*
              "Don't ask again this game" is GONE.

              It made sense when the robber was optional bookkeeping: the
              prompt asked for a number, most people did not care, and
              silencing it cost only a note. It stopped making sense the moment
              the robber became a real position on the board. Switching it off
              now means blocks never lift for the rest of the game — the exact
              bug that was just fixed, reintroduced by a checkbox — and the
              player who silences it is the one who most believes they are
              being robbed.

              "Not now" still exists for a single 7 nobody wants to log. That
              is a per-roll decision and it leaves the next one askable, which
              is the difference that matters.
            */}

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
  /**
   * Never shrinks. The ScrollView above it has flex:1 and will give way; the
   * roll pad is the one thing on this screen that must always be fully
   * reachable, since the whole screen exists to record a roll.
   */
  gridWrapper: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, gap: 10, flexShrink: 0 },

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

  /**
   * No flex:1. It used to have it, inside a wrapper that deliberately has none
   * — so the grid was told to fill a parent that was sizing itself to the
   * grid. The ten buttons wrap onto two rows; that circularity collapsed it to
   * one, and the build-pill row below drew over the remainder. Reported from a
   * device as "most of the numbers cannot be tapped".
   */
  numGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },

  boardToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderRadius: 10, paddingVertical: 9,
  },
  boardToggleText: { fontSize: 12 },

  /**
   * One line, fixed height. This sits between the scroll area and the roll pad,
   * so anything that can wrap to two lines eats the pad's space.
   */
  /**
   * Reported as "very small and blandly colored, almost did not notice it".
   * Now a solid amber bar with dark text — the only saturated block on a dark
   * screen. Height is capped rather than free, because this sits between the
   * scroll area and the roll pad and anything that can grow eats the pad.
   */
  callout: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, minHeight: 48,
    marginHorizontal: 12, marginBottom: 8,
  },
  calloutText: { flex: 1, fontSize: 14, lineHeight: 18 },
  numBtn: { width: '18%', aspectRatio: 1, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 52 },
  numBtnValue: { fontSize: 20 },
  numBtnPips: { fontSize: 9, letterSpacing: 1 },
  padLegend: { fontSize: 10, textAlign: 'center', marginBottom: 4 },

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
