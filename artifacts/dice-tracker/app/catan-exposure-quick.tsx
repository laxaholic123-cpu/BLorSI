/**
 * Quick Exposure Setup — Catan-Compatible Mode.
 *
 * For each player in order:
 *   - They tap numbers 2–12 (no 7) to indicate which hex numbers each
 *     settlement is adjacent to. Each tap increments the exposure count.
 *   - "Add Settlement" groups current numbers into one building and starts
 *     a fresh one.
 *   - "Done" finalises the player and moves to the next, or starts the game.
 *
 * All data is stored as CatanPlayerExposureEvents (turnNumber=0) via the
 * GameContext before navigating to the active Catan screen.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
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
import { useGame } from '@/context/GameContext';
import { useSettings } from '@/context/SettingsContext';
import { generateId } from '@/types/models';
import type { CatanPlayerExposureEvent, PortType } from '@/types/models';
import {
  describePort,
  hexesForIntersectionId,
  portForIntersection,
} from '@/services/catanBoard';
import { CatanHexGrid } from '@/components/CatanHexGrid';
import { loadActiveBoard, type ActiveBoard } from '@/services/storage';

// Settlement numbers (2D6, no 7)
const CATAN_NUMBERS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];

// Probability pips for display guidance
const PIPS: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1,
};

/** Port options offered per settlement. An intersection serves at most one. */
const PORT_OPTIONS: { value: PortType; label: string }[] = [
  { value: 'generic', label: '3:1' },
  { value: 'grain', label: '2:1 grain' },
  { value: 'ore', label: '2:1 ore' },
  { value: 'lumber', label: '2:1 lumber' },
  { value: 'brick', label: '2:1 brick' },
  { value: 'wool', label: '2:1 wool' },
];

interface Settlement {
  locationId: string;
  numbers: number[]; // up to 3 hex numbers for this settlement
  /** Port this settlement sits on, if any. Trade only — never production. */
  port?: PortType;
  /**
   * Placed by tapping the board, so `locationId` is a real corner id.
   *
   * Load-bearing for one edge case: a corner touching only the desert yields
   * NO numbers, but it is still a settlement someone owns. Without this flag it
   * would be invisible on the board, impossible to remove, and every further
   * tap would append another copy.
   */
  fromBoard?: boolean;
}

interface PlayerSetup {
  settlements: Settlement[];
}

function emptySettlement(): Settlement {
  return { locationId: generateId(), numbers: [] };
}

export default function CatanExposureQuickScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeSession, persistExposureEvents } = useGame();
  const { settings } = useSettings();
  const webTop = Platform.OS === 'web' ? 67 : 0;

  // Per-player setup state — keyed by playerIndex
  const [playerSetups, setPlayerSetups] = useState<PlayerSetup[]>(() =>
    (activeSession?.players ?? []).map(() => ({ settlements: [emptySettlement()] })),
  );
  const [currentPlayerIdx, setCurrentPlayerIdx] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  /**
   * The board this game is on, when it is known exactly (generated boards only).
   * Null for scanned and hand-entered games, which fall back to tapping numbers.
   */
  const [board, setBoard] = useState<ActiveBoard | null>(null);
  const [inputMode, setInputMode] = useState<'board' | 'numbers'>('numbers');

  /**
   * Reload on FOCUS, not on mount — the same trap that made ground truth look
   * unset on the capture screen.
   *
   * The generator writes the board and then navigates here. If this screen is
   * already mounted from an earlier visit, a mount-only effect never re-reads,
   * and the player would tap corners on a board that is no longer the one on
   * the table. That failure is silent and it corrupts exposure, which is the
   * one thing this screen exists to get right.
   */
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadActiveBoard().then(loaded => {
        if (cancelled || !loaded) return;
        setBoard(loaded);
        // Prefer picking off the board when we have one: it removes the
        // transcription step entirely, so exposure becomes exact rather than
        // self-reported. The number pad stays one tap away for anyone whose
        // physical board drifted from the generated one.
        setInputMode('board');
      });
      return () => { cancelled = true; };
    }, []),
  );

  // ─── Board mode ───────────────────────────────────────────────────────────
  //
  // These memos sit ABOVE the `!activeSession` early return on purpose. Placing
  // hooks after a conditional return means the screen calls a different number
  // of them depending on whether the session has hydrated yet — React throws
  // "Rendered more hooks than during the previous render" and the whole screen
  // is replaced by the error boundary. That happens on any cold start where
  // GameContext resolves a tick after mount, which is exactly the path a player
  // takes when reopening the app mid-setup.

  /**
   * Which corner belongs to which player, for marking the grid.
   *
   * Built across every player, not just the current one — a corner someone
   * already took is not available, and showing it is what stops a double
   * placement rather than an error message after the fact.
   */
  const intersectionOwners = useMemo(() => {
    const owners: Record<string, { playerIdx: number; color: string }> = {};
    const roster = activeSession?.players ?? [];
    playerSetups.forEach((setup, pi) => {
      for (const settlement of setup.settlements) {
        // Board-placed settlements count even with no numbers — see `fromBoard`.
        // Number-pad ones are skipped while still empty, because the in-progress
        // one is not a placement yet.
        if (!settlement.fromBoard && settlement.numbers.length === 0) continue;
        owners[settlement.locationId] = {
          playerIdx: pi,
          color: roster[pi]?.color ?? colors.primary,
        };
      }
    });
    return owners;
  }, [playerSetups, activeSession, colors.primary]);

  const intersectionMarks = useMemo(() => {
    const marks: Record<string, string> = {};
    for (const [id, owner] of Object.entries(intersectionOwners)) marks[id] = owner.color;
    return marks;
  }, [intersectionOwners]);


  const haptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    if (settings.hapticsEnabled) void Haptics.impactAsync(style);
  };

  if (!activeSession) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 16 }]}>
          No active session
        </Text>
        <TouchableOpacity onPress={() => router.replace('/')}>
          <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Go Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const players = activeSession.players;
  const currentPlayer = players[currentPlayerIdx];
  const isLastPlayer = currentPlayerIdx === players.length - 1;
  const currentSetup = playerSetups[currentPlayerIdx] ?? { settlements: [emptySettlement()] };
  const activeSettlement = currentSetup.settlements.at(-1) ?? emptySettlement();

  // Update the LAST settlement for the current player
  const updateCurrentSettlement = (updater: (s: Settlement) => Settlement) => {
    setPlayerSetups(prev => {
      const next = [...prev];
      const setup = next[currentPlayerIdx] ?? { settlements: [emptySettlement()] };
      const settlements = [...setup.settlements];
      const lastIdx = settlements.length - 1;
      settlements[lastIdx] = updater(settlements[lastIdx] ?? emptySettlement());
      next[currentPlayerIdx] = { settlements };
      return next;
    });
  };

  /**
   * Tap adds one hex bearing this number. Two of the player's three hexes can
   * legitimately carry the same token — a settlement wedged between two 9s
   * produces twice on a 9 — so numbers are stored as a multiset, not a set.
   * Long-press clears every instance of the number (see clearNumber).
   */
  const addNumber = (num: number) => {
    haptic();
    updateCurrentSettlement(s => {
      if (s.numbers.length >= 3) {
        haptic(Haptics.ImpactFeedbackStyle.Heavy);
        return s; // a settlement intersects at most 3 hexes
      }
      return { ...s, numbers: [...s.numbers, num] };
    });
  };

  const clearNumber = (num: number) => {
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    updateCurrentSettlement(s => ({ ...s, numbers: s.numbers.filter(n => n !== num) }));
  };

  /** Tapping the selected port clears it, so "no port" stays reachable. */
  const togglePort = (port: PortType) => {
    haptic();
    updateCurrentSettlement(s => ({ ...s, port: s.port === port ? undefined : port }));
  };

  const handleAddSettlement = () => {
    haptic();
    if (activeSettlement.numbers.length === 0) {
      Alert.alert('Empty settlement', 'Tap at least one number for this settlement before adding another.');
      return;
    }
    setPlayerSetups(prev => {
      const next = [...prev];
      const setup = next[currentPlayerIdx] ?? { settlements: [] };
      next[currentPlayerIdx] = {
        settlements: [...setup.settlements, emptySettlement()],
      };
      return next;
    });
  };

  const handleRemoveSettlement = (idx: number) => {
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    setPlayerSetups(prev => {
      const next = [...prev];
      const setup = next[currentPlayerIdx] ?? { settlements: [] };
      const filtered = setup.settlements.filter((_, i) => i !== idx);
      next[currentPlayerIdx] = {
        settlements: filtered.length > 0 ? filtered : [emptySettlement()],
      };
      return next;
    });
  };

  // ─── Board mode ───────────────────────────────────────────────────────────

  const boardMode = inputMode === 'board' && board !== null;

  /**
   * Turn a tapped corner into a settlement.
   *
   * Everything is derived from the board: the numbers come from the hexes that
   * actually meet there, and the port from the harbour serving that corner. The
   * desert contributes nothing because its `number` is null. Duplicates are
   * kept — a corner wedged between two 9s really does produce twice on a 9,
   * which is the same multiset rule the number pad follows.
   */
  const handleIntersectionPress = (intersectionId: string) => {
    if (!board) return;

    // The alert is a side effect, so it reads the memo. Harmless if slightly
    // stale: the authoritative check lives inside the updater below, and the
    // worst case here is a missing message, never a wrong settlement.
    const owner = intersectionOwners[intersectionId];
    if (owner && owner.playerIdx !== currentPlayerIdx) {
      haptic(Haptics.ImpactFeedbackStyle.Heavy);
      Alert.alert(
        'Corner taken',
        `${players[owner.playerIdx]?.displayName ?? 'Another player'} already has a settlement there.`,
      );
      return;
    }
    haptic(owner ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);

    const numbers = hexesForIntersectionId(intersectionId)
      .map(h => board.hexes[h]?.number ?? null)
      .filter((n): n is number => n !== null);
    const port = portForIntersection(intersectionId, board.ports);

    /**
     * Place-or-remove decided INSIDE the updater, against current state.
     *
     * Reading ownership from the memo and then setting state is a read-then-
     * write race: two taps landing in one render cycle both see "unoccupied"
     * and both append, leaving two settlements on a corner that shows one
     * mark. The player's exposure is then double-counted with nothing on
     * screen to show it — the same silent-wrong shape as the geometry bugs.
     * Deciding inside the updater makes the second tap see the first.
     */
    setPlayerSetups(prev => {
      const next = [...prev];
      const setup = next[currentPlayerIdx] ?? { settlements: [] };
      const isOccupier = (x: { locationId: string; fromBoard?: boolean; numbers: number[] }) =>
        x.locationId === intersectionId && (x.fromBoard || x.numbers.length > 0);

      // Already this player's? Then this tap removes it.
      if (setup.settlements.some(isOccupier)) {
        next[currentPlayerIdx] = {
          settlements: setup.settlements.filter(x => x.locationId !== intersectionId),
        };
        return next;
      }

      // Taken by someone else in the meantime — leave everything alone.
      const takenByOther = prev.some(
        (other, pi) => pi !== currentPlayerIdx && other.settlements.some(isOccupier),
      );
      if (takenByOther) return prev;

      next[currentPlayerIdx] = {
        settlements: [
          ...setup.settlements,
          { locationId: intersectionId, numbers, fromBoard: true, ...(port ? { port } : {}) },
        ],
      };
      return next;
    });
  };

  const removeSettlementById = (locationId: string) => {
    setPlayerSetups(prev => {
      const next = [...prev];
      const setup = next[currentPlayerIdx] ?? { settlements: [] };
      next[currentPlayerIdx] = {
        settlements: setup.settlements.filter(s => s.locationId !== locationId),
      };
      return next;
    });
  };

  // Build exposure events for ALL players
  const buildAllExposureEvents = (): CatanPlayerExposureEvent[] => {
    const events: CatanPlayerExposureEvent[] = [];
    for (let pi = 0; pi < players.length; pi++) {
      const player = players[pi]!;
      const setup = playerSetups[pi] ?? { settlements: [] };
      for (const settlement of setup.settlements) {
        // Skip only the number-pad placeholder. A board placement with no
        // numbers is a real settlement on a barren corner, and dropping it
        // would lose a building the player actually owns.
        if (!settlement.fromBoard && settlement.numbers.length === 0) continue;
        events.push({
          id: generateId(),
          sessionId: activeSession.id,
          playerId: player.id,
          eventType: 'initialSettlement',
          turnNumber: 0,
          timestamp: new Date().toISOString(),
          affectedNumbers: settlement.numbers,
          hexIdentifiers: [settlement.locationId],
          productionWeight: 1,
          robberBlocked: false,
          ...(settlement.port ? { portAccess: settlement.port } : {}),
        });
      }
    }
    return events;
  };

  const handleFinishPlayer = () => {
    haptic();
    // Validate: at least one non-empty settlement
    const hasAny = currentSetup.settlements.some(
      s => s.fromBoard || s.numbers.length > 0,
    );
    if (!hasAny) {
      Alert.alert('No settlements', 'Add at least one settlement for this player before continuing.');
      return;
    }
    if (isLastPlayer) {
      handleStartGame();
    } else {
      setCurrentPlayerIdx(i => i + 1);
    }
  };

  const handleStartGame = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const events = buildAllExposureEvents();
      await persistExposureEvents(activeSession.id, events);
      router.replace('/active-catan' as any);
    } catch {
      Alert.alert('Error', 'Could not save exposure data. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // In board mode every settlement is complete the moment it is tapped, so
  // there is no trailing in-progress one to exclude.
  const completedSettlements = boardMode
    ? currentSetup.settlements.filter(s => s.fromBoard)
    : currentSetup.settlements.slice(0, -1);

  const removeCompleted = (idx: number, locationId: string) =>
    boardMode ? removeSettlementById(locationId) : handleRemoveSettlement(idx);

  // Summary: all players' completed settlements before this one
  const prevPlayersSummary = playerSetups.slice(0, currentPlayerIdx).map((setup, pi) => ({
    player: players[pi]!,
    settlements: setup.settlements.filter(s => s.numbers.length > 0),
  }));

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + webTop + 12, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            Settlement Setup
          </Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Quick mode · {currentPlayerIdx + 1} of {players.length} players
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.skipBtn, { borderColor: colors.border }]}
          onPress={() => Alert.alert(
            'Skip exposure setup?',
            'Stats will be limited without settlement data.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Skip', onPress: handleStartGame },
            ],
          )}
        >
          <Text style={[styles.skipText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>Skip</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>

        {/* Current player card */}
        <View style={[styles.playerCard, { backgroundColor: colors.card, borderColor: currentPlayer?.color ?? colors.primary, borderLeftColor: currentPlayer?.color ?? colors.primary }]}>
          <View style={[styles.playerDot, { backgroundColor: currentPlayer?.color ?? colors.primary }]} />
          <View>
            <Text style={[styles.playerName, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              {currentPlayer?.displayName ?? `Player ${currentPlayerIdx + 1}`}
            </Text>
            <Text style={[styles.playerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {boardMode
                ? 'Tap each corner where this player has a settlement. Numbers and ports are read straight off the board. Tap one of their settlements again to remove it.'
                : 'Tap the numbers each settlement is adjacent to (up to 3 per settlement). Tap twice if it touches two hexes with the same number; long-press to clear one.'}
            </Text>
          </View>
        </View>

        {/* Board picker — only when the board is known exactly */}
        {boardMode && board && (
          <View style={[styles.section, { borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
              TAP THIS PLAYER'S CORNERS
            </Text>
            <CatanHexGrid
              hexes={board.hexes}
              ports={board.ports}
              showIntersections
              intersectionMarks={intersectionMarks}
              onIntersectionPress={handleIntersectionPress}
            />
          </View>
        )}

        {/* Input mode switch — only offered when there is a board to switch away from */}
        {board && (
          <TouchableOpacity
            style={[styles.addBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={() => {
              haptic();
              setInputMode(m => (m === 'board' ? 'numbers' : 'board'));
            }}
          >
            <Ionicons
              name={boardMode ? 'keypad-outline' : 'grid-outline'}
              size={18}
              color={colors.primary}
            />
            <Text style={[styles.addBtnText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
              {boardMode ? 'Enter numbers by hand instead' : 'Pick off the board instead'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Completed settlements */}
        {completedSettlements.map((s, idx) => (
          <View key={s.locationId} style={[styles.completedSettlement, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.completedLeft}>
              <Text style={[styles.completedLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
                Settlement {idx + 1}
              </Text>
              <View style={styles.numChips}>
                {s.numbers.map((n, i) => (
                  // Keyed by position, not value — the same number can legitimately
                  // appear twice when a settlement touches two hexes with one token.
                  <View key={`${n}-${i}`} style={[styles.numChip, { backgroundColor: colors.primary + '22' }]}>
                    <Text style={[styles.numChipText, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>{n}</Text>
                    <Text style={[styles.numChipPips, { color: colors.primary, fontFamily: 'Inter_400Regular' }]}>{'·'.repeat(PIPS[n] ?? 1)}</Text>
                  </View>
                ))}
                {s.port && (
                  <View style={[styles.numChip, { backgroundColor: colors.mutedForeground + '22' }]}>
                    <Text style={[styles.numChipText, { color: colors.mutedForeground, fontFamily: 'Inter_700Bold' }]}>
                      {describePort(s.port)}
                    </Text>
                  </View>
                )}
              </View>
            </View>
            <TouchableOpacity onPress={() => removeCompleted(idx, s.locationId)} hitSlop={8}>
              <Ionicons name="trash-outline" size={18} color={colors.destructive} />
            </TouchableOpacity>
          </View>
        ))}

        {/* Active settlement builder — number pad path. Hidden in board
            mode, where a corner tap already yields a finished settlement. */}
        {!boardMode && (
          <>
        <View style={[styles.section, { borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
            SETTLEMENT {completedSettlements.length + 1}
            {activeSettlement.numbers.length > 0
              ? ` · ${activeSettlement.numbers.length}/3 numbers`
              : ' · tap hex numbers below'}
          </Text>

          {/* Number grid */}
          <View style={styles.numGrid}>
            {CATAN_NUMBERS.map(num => {
              const count = activeSettlement.numbers.filter(n => n === num).length;
              const selected = count > 0;
              return (
                <TouchableOpacity
                  key={num}
                  style={[
                    styles.numBtn,
                    {
                      backgroundColor: selected ? colors.primary : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => addNumber(num)}
                  onLongPress={() => clearNumber(num)}
                  activeOpacity={0.8}
                >
                  {count > 1 && (
                    <View style={[styles.numBtnCountBadge, { backgroundColor: colors.primaryForeground }]}>
                      <Text style={[styles.numBtnCountText, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>
                        ×{count}
                      </Text>
                    </View>
                  )}
                  <Text style={[styles.numBtnValue, { color: selected ? colors.primaryForeground : colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                    {num}
                  </Text>
                  <Text style={[styles.numBtnPips, { color: selected ? colors.primaryForeground : colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                    {'·'.repeat(PIPS[num] ?? 1)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Port selector — trade rate only, never counted as production */}
          <Text style={[styles.portLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
            ON A PORT? (OPTIONAL)
          </Text>
          <View style={styles.portGrid}>
            {PORT_OPTIONS.map(opt => {
              const selected = activeSettlement.port === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.portBtn,
                    {
                      backgroundColor: selected ? colors.primary : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => togglePort(opt.value)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.portBtnText,
                      {
                        color: selected ? colors.primaryForeground : colors.foreground,
                        fontFamily: 'Inter_600SemiBold',
                      },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Add Settlement button */}
        <TouchableOpacity
          style={[styles.addBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
          onPress={handleAddSettlement}
        >
          <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
          <Text style={[styles.addBtnText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
            Add Another Settlement
          </Text>
        </TouchableOpacity>

          </>
        )}

        {/* Previous players summary */}
        {prevPlayersSummary.length > 0 && (
          <>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>PREVIOUS PLAYERS</Text>
            {prevPlayersSummary.map(({ player, settlements }) => (
              <View key={player.id} style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: player.color }]}>
                <Text style={[styles.summaryPlayerName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  {player.displayName}
                </Text>
                {settlements.map((s, si) => (
                  <View key={s.locationId} style={styles.summarySettlement}>
                    <Text style={[styles.summarySettlementLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                      #{si + 1}:
                    </Text>
                    <Text style={[styles.summarySettlementNums, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                      {s.numbers.join(', ')}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </>
        )}

        {/* Continue / Start button */}
        <TouchableOpacity
          style={[
            styles.continueBtn,
            {
              backgroundColor: isSaving ? colors.muted : colors.primary,
              opacity: isSaving ? 0.7 : 1,
            },
          ]}
          onPress={handleFinishPlayer}
          disabled={isSaving}
          activeOpacity={0.85}
        >
          <Ionicons
            name={isLastPlayer ? 'play' : 'arrow-forward'}
            size={20}
            color={colors.primaryForeground}
          />
          <Text style={[styles.continueBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_700Bold' }]}>
            {isSaving ? 'Starting…' : isLastPlayer ? 'Start Game' : `Next: ${players[currentPlayerIdx + 1]?.displayName ?? ''}`}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 16 },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18 },
  headerSub: { fontSize: 13, marginTop: 2 },
  skipBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginTop: 4 },
  skipText: { fontSize: 13 },

  scroll: { padding: 16, gap: 14 },

  playerCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 4,
  },
  playerDot: { width: 12, height: 12, borderRadius: 6, marginTop: 3, flexShrink: 0 },
  playerName: { fontSize: 17 },
  playerSub: { fontSize: 13, lineHeight: 18, marginTop: 2 },

  completedSettlement: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  completedLeft: { flex: 1 },
  completedLabel: { fontSize: 11, letterSpacing: 0.8, marginBottom: 6 },
  numChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  numChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, alignItems: 'center' },
  numChipText: { fontSize: 15 },
  numChipPips: { fontSize: 9, letterSpacing: 1, marginTop: 1 },

  section: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  sectionLabel: { fontSize: 11, letterSpacing: 0.8 },

  numGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  numBtn: {
    width: 64,
    height: 64,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    position: 'relative',
  },
  numBtnValue: { fontSize: 20 },
  numBtnPips: { fontSize: 10, letterSpacing: 1 },
  numBtnCountBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 20,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numBtnCountText: { fontSize: 11 },
  portLabel: { fontSize: 11, letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  portGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  portBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5 },
  portBtnText: { fontSize: 13 },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  addBtnText: { fontSize: 15 },

  summaryLabel: { fontSize: 11, letterSpacing: 1.2, marginTop: 6 },
  summaryCard: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 4,
    gap: 4,
  },
  summaryPlayerName: { fontSize: 14, marginBottom: 2 },
  summarySettlement: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  summarySettlementLabel: { fontSize: 12 },
  summarySettlementNums: { fontSize: 13 },

  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
    borderRadius: 14,
    marginTop: 8,
  },
  continueBtnText: { fontSize: 17 },
});
