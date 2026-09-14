/**
 * Catan Development Actions Modal.
 *
 * Accessible from the active Catan screen ("Dev" button).
 * Allows adding buildings mid-game without modifying the initial placement.
 *
 * Actions:
 *   - Add Settlement    → new CatanPlayerExposureEvent (type: settlementBuilt, weight: 1)
 *   - Upgrade to City   → new event for an existing location (type: cityUpgrade, weight: 2)
 *   - Remove Building   → new event (type: buildingRemoved, weight: 0)
 *   - Start Robber Block → new robberBlockStarted event for a number
 *   - End Robber Block  → new robberBlockEnded event
 *   - Correct Exposure  → manualCorrection event
 *
 * City upgrades are non-retroactive: weight 2 applies only from this turn forward.
 */

import React, { useMemo, useState, useEffect } from 'react';
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
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useGame } from '@/context/GameContext';
import { useSettings } from '@/context/SettingsContext';
import { getBuildingStatesAtTurn, getActiveRobberBlockedNumbers } from '@/services/catanStats';
import { allRoads, buildProblem, roadEvent, roadsOf } from '@/services/catanRoads';
import { CatanHexGrid } from '@/components/CatanHexGrid';
import { allEdges } from '@/services/catanPlacement';
import {
  boardStateAtTurn,
  legalMidGameCorners,
  midGameSettlementProblem,
  numbersAtCorner,
} from '@/services/catanBoardState';
import { loadActiveBoard, type ActiveBoard } from '@/services/storage';
import { generateId } from '@/types/models';
import type { CatanPlayerExposureEvent } from '@/types/models';

const CATAN_NUMBERS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];

/**
 * How many roads one action may lay.
 *
 * Two, because the Road Building development card gives exactly two and
 * players use it. Not unlimited: the cap is what tells you the rule without
 * reading anything.
 */
const MAX_ROADS_AT_ONCE = 2;
const PIPS: Record<number, number> = { 2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1 };

type ActionType = 'add_settlement' | 'build_road' | 'upgrade_city' | 'remove_building' | 'start_robber' | 'end_robber' | 'correct_exposure' | null;

const ACTIONS: Array<{ type: ActionType; label: string; desc: string; icon: string; destructive?: boolean }> = [
  { type: 'add_settlement', label: 'Add Settlement', desc: 'Record a new settlement placed this turn', icon: 'home-outline' },
  { type: 'build_road', label: 'Build Road', desc: 'Record a road — decides Longest Road', icon: 'git-branch-outline' },
  { type: 'upgrade_city', label: 'Upgrade to City', desc: 'Doubles production from this turn forward (non-retroactive)', icon: 'business-outline' },
  { type: 'remove_building', label: 'Remove Building', desc: 'Mark a building as no longer producing', icon: 'trash-outline', destructive: true },
  { type: 'start_robber', label: 'Start Robber Block', desc: 'Block production from a number for a player', icon: 'ban-outline', destructive: true },
  { type: 'end_robber', label: 'End Robber Block', desc: 'Remove an active robber block', icon: 'checkmark-circle-outline' },
  { type: 'correct_exposure', label: 'Correct Exposure', desc: "Fix a settlement's numbers", icon: 'create-outline' },
];

export default function CatanDevelopmentScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeSession, rollEvents, exposureEvents, persistExposureEvents, updateSession } =
    useGame();
  const { settings } = useSettings();
  const webTop = Platform.OS === 'web' ? 67 : 0;

  const { action: actionParam, playerId: playerParam } =
    useLocalSearchParams<{ action?: string; playerId?: string }>();

  /**
   * The board, needed only to draw the road picker.
   *
   * Loaded lazily rather than held by the context: every other action on this
   * screen works from numbers alone, and a road is the first thing that needs
   * to know what the island looks like.
   */
  const [board, setBoard] = useState<ActiveBoard | null>(null);
  /**
   * Roads chosen in this one action — usually one, two for Road Building.
   *
   * A list rather than a single id because the dev card lays TWO at once, and
   * the second one is frequently only legal BECAUSE of the first: it connects
   * to the road you just picked. Recording them one at a time would refuse the
   * second half of a perfectly legal move.
   */
  const [selectedRoads, setSelectedRoads] = useState<string[]>([]);
  /**
   * Corner chosen for a new settlement, when the board is known.
   *
   * This is the whole point of the mid-game rework. A settlement used to be
   * recorded as a list of NUMBERS with a random id, so it produced correctly
   * and existed nowhere — it could not be drawn, and its exposure was whatever
   * the player said it was. Tapping a corner derives the numbers instead, and
   * the placement becomes a real board position like the opening ones.
   */
  const [selectedCorner, setSelectedCorner] = useState<string | null>(null);
  useEffect(() => {
    if (activeSession) void loadActiveBoard(activeSession.id).then(setBoard);
  }, [activeSession]);
  const initialAction = (ACTIONS.find(a => a.type === actionParam)?.type ?? null) as ActionType;
  const [selectedAction, setSelectedAction] = useState<ActionType>(initialAction);
  /**
   * Preselected from the caller when the game already knows whose turn it is.
   *
   * Tapping Road on the active screen used to land on a player picker, so the
   * map — the thing you came for — was two taps away and the app was asking a
   * question it could already answer.
   */
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(
    playerParam ?? null,
  );
  // A road chosen for one player is meaningless for another, and a stale
  // selection would be saved against whoever is picked next.
  useEffect(() => {
    setSelectedRoads([]);
    setSelectedCorner(null);
  }, [selectedPlayerId, selectedAction]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
  /** Whether the full action list is expanded under a chosen action. */
  const [showActionList, setShowActionList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const haptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    if (settings.hapticsEnabled) void Haptics.impactAsync(style);
  };

  const activeRolls = useMemo(() => rollEvents.filter(e => !e.deletedAt), [rollEvents]);
  const currentTurn = activeSession
    ? Math.floor(activeRolls.length / Math.max(1, activeSession.players.length)) + 1
    : 1;

  // Buildings for the selected player at current turn
  const selectedPlayerBuildings = useMemo(() => {
    if (!selectedPlayerId) return [];
    return getBuildingStatesAtTurn(selectedPlayerId, currentTurn, exposureEvents);
  }, [selectedPlayerId, currentTurn, exposureEvents]);

  /**
   * The board as it stands, for everybody.
   *
   * Hooks here MUST stay above the `!activeSession` return below — this screen
   * has already been broken once by a hook added after an early return, which
   * changes the hook count between renders and swaps the whole screen for the
   * error boundary. See CLAUDE.md.
   */
  const snapshot = useMemo(
    () => boardStateAtTurn(
      exposureEvents,
      (activeSession?.players ?? []).map(p => p.id),
      currentTurn,
    ),
    [exposureEvents, activeSession, currentTurn],
  );

  /**
   * Every building on the board, and which of them are cities.
   *
   * Shared by BOTH pickers. Choosing a road with the settlements invisible, or
   * a corner with the roads invisible, means judging connectivity against half
   * a board — and the board is the thing the player is checking the app
   * against.
   */
  const buildingMarks = useMemo(() => {
    const marks: Record<string, string> = {};
    for (const [cornerId, b] of snapshot.buildings) {
      marks[cornerId] = activeSession?.players.find(p => p.id === b.playerId)?.color ?? '#888';
    }
    return marks;
  }, [snapshot, activeSession]);

  const cityCorners = useMemo(
    () => [...snapshot.buildings.entries()].filter(([, b]) => b.weight >= 2).map(([id]) => id),
    [snapshot],
  );

  /** Roads on the board, by owner colour — drawn in the corner picker too. */
  const roadMarksAll = useMemo(() => {
    const marks: Record<string, string> = {};
    for (const [edgeId, ownerId] of snapshot.roads) {
      marks[edgeId] = activeSession?.players.find(p => p.id === ownerId)?.color ?? '#888';
    }
    return marks;
  }, [snapshot, activeSession]);

  /** Corners a new settlement could legally take — occupancy and distance. */
  const offeredCorners = useMemo(
    () => (board ? legalMidGameCorners(snapshot, selectedPlayerId ?? undefined) : []),
    [board, snapshot, selectedPlayerId],
  );

  /** What the chosen corner produces, derived from the board rather than typed. */
  const cornerNumbers = useMemo(
    () => (selectedCorner && board
      ? numbersAtCorner(selectedCorner, board.hexes.map(h => h.number ?? null))
      : []),
    [selectedCorner, board],
  );

  // Active robber blocks for selected player
  const activeRobberBlocks = useMemo(() => {
    if (!selectedPlayerId) return [];
    // Get all robberBlockStarted events without a matching robberBlockEnded
    const started = exposureEvents.filter(
      e => e.playerId === selectedPlayerId &&
        e.eventType === 'robberBlockStarted' &&
        e.turnNumber <= currentTurn,
    );
    const ended = new Set(
      exposureEvents
        .filter(e => e.playerId === selectedPlayerId && e.eventType === 'robberBlockEnded')
        .map(e => e.hexIdentifiers?.[0])
        .filter(Boolean),
    );
    return started.filter(e => !ended.has(e.hexIdentifiers?.[0]));
  }, [selectedPlayerId, currentTurn, exposureEvents]);

  if (!activeSession) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>No active game</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const resetForm = () => {
    setSelectedAction(null);
    setSelectedPlayerId(null);
    setSelectedLocationId(null);
    setSelectedNumbers([]);
  };

  const toggleNumber = (num: number) => {
    haptic();
    setSelectedNumbers(prev =>
      prev.includes(num) ? prev.filter(n => n !== num) : [...prev, num],
    );
  };

  const handleSubmit = async () => {
    if (!selectedAction || !selectedPlayerId || isSaving) return;
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    setIsSaving(true);

    try {
      let newEvent: CatanPlayerExposureEvent | null = null;
      /** For actions that write more than one event — Road Building lays two. */
      let extraEvents: CatanPlayerExposureEvent[] = [];
      const baseEvent = {
        id: generateId(),
        sessionId: activeSession.id,
        playerId: selectedPlayerId,
        turnNumber: currentTurn,
        timestamp: new Date().toISOString(),
        robberBlocked: false,
      };

      if (selectedAction === 'add_settlement') {
        /**
         * Two ways in, and they are not equal.
         *
         * A corner tap gives a real board POSITION and derives the numbers
         * from the board, so exposure is exact and the settlement can be
         * drawn. The number pad gives numbers only and a random id — correct
         * for production, invisible on the board. The pad stays because a
         * scanned or hand-entered game may have no board at all, but the
         * corner is preferred whenever one is available.
         */
        if (selectedCorner) {
          const problem = midGameSettlementProblem(
            selectedCorner, snapshot, selectedPlayerId,
          );
          if (problem) {
            Alert.alert(
              'Cannot build there',
              problem === 'occupied'
                ? 'Someone already holds that corner.'
                : problem === 'too_close'
                  ? 'Too close — settlements need a gap of at least one corner.'
                  : problem === 'not_connected'
                    ? 'After the opening, a settlement has to sit on one of your own roads.'
                    : 'That corner cannot be used.',
            );
            return;
          }
          newEvent = {
            ...baseEvent,
            eventType: 'settlementBuilt',
            affectedNumbers: cornerNumbers,
            hexIdentifiers: [selectedCorner],
            productionWeight: 1,
          };
        } else {
          if (selectedNumbers.length === 0) {
            Alert.alert('Select numbers', 'Tap at least one hex number for this settlement.');
            return;
          }
          newEvent = {
            ...baseEvent,
            eventType: 'settlementBuilt',
            affectedNumbers: selectedNumbers,
            hexIdentifiers: [generateId()],
            productionWeight: 1,
          };
        }
      } else if (selectedAction === 'build_road') {
        if (selectedRoads.length === 0) {
          Alert.alert('Select a road', 'Tap one of the highlighted edges.');
          return;
        }
        // One event per road. They are separate pieces on the board and the
        // Longest Road walk reads them individually; bundling two into one
        // event would make a two-road turn indistinguishable from a one-road
        // turn everywhere downstream.
        extraEvents = selectedRoads.map(edgeId => ({
          ...baseEvent,
          id: generateId(),
          eventType: 'roadBuilt' as const,
          hexIdentifiers: [edgeId],
          // A road produces nothing. Both of these must stay empty, or roads
          // would inflate expected production for everyone who builds one.
          affectedNumbers: [],
          productionWeight: 0,
        }));
      } else if (selectedAction === 'upgrade_city') {
        if (!selectedLocationId) {
          Alert.alert('Select building', 'Choose which settlement to upgrade.');
          return;
        }
        const bldg = selectedPlayerBuildings.find(b => b.locationId === selectedLocationId);
        if (!bldg) { Alert.alert('Not found', 'Building not found.'); return; }
        newEvent = {
          ...baseEvent,
          eventType: 'cityUpgrade',
          affectedNumbers: bldg.affectedNumbers,
          hexIdentifiers: [selectedLocationId],
          productionWeight: 2,
        };
      } else if (selectedAction === 'remove_building') {
        if (!selectedLocationId) {
          Alert.alert('Select building', 'Choose which building to remove.');
          return;
        }
        newEvent = {
          ...baseEvent,
          eventType: 'buildingRemoved',
          affectedNumbers: [],
          hexIdentifiers: [selectedLocationId],
          productionWeight: 0,
        };
      } else if (selectedAction === 'start_robber') {
        if (selectedNumbers.length === 0) {
          Alert.alert('Select number', 'Tap the number the robber is blocking.');
          return;
        }
        const blockId = 'rblock_' + generateId();
        newEvent = {
          ...baseEvent,
          eventType: 'robberBlockStarted',
          affectedNumbers: selectedNumbers,
          hexIdentifiers: [blockId],
          productionWeight: 0,
          robberBlocked: true,
        };
      } else if (selectedAction === 'end_robber') {
        if (!selectedLocationId) {
          Alert.alert('Select block', 'Choose which robber block to end.');
          return;
        }
        const block = activeRobberBlocks.find(e => e.hexIdentifiers?.[0] === selectedLocationId);
        if (!block) { Alert.alert('Not found', 'Robber block not found.'); return; }
        newEvent = {
          ...baseEvent,
          eventType: 'robberBlockEnded',
          affectedNumbers: block.affectedNumbers,
          hexIdentifiers: [selectedLocationId],
          productionWeight: 0,
        };
      } else if (selectedAction === 'correct_exposure') {
        if (!selectedLocationId || selectedNumbers.length === 0) {
          Alert.alert('Incomplete', 'Select a building and its corrected numbers.');
          return;
        }
        const bldg = selectedPlayerBuildings.find(b => b.locationId === selectedLocationId);
        newEvent = {
          ...baseEvent,
          eventType: 'manualCorrection',
          affectedNumbers: selectedNumbers,
          hexIdentifiers: [selectedLocationId],
          productionWeight: bldg?.productionWeight ?? 1,
        };
      }

      const written = [...(newEvent ? [newEvent] : []), ...extraEvents];
      if (written.length > 0) {
        await persistExposureEvents(activeSession.id, [...exposureEvents, ...written]);
      }

      /*
        Building makes it that player's turn.

        In the base game you can only build on your own turn, so a build
        recorded for someone is proof it is their turn — reported from a device
        as "whenever a player moves to build, it should automatically assume it
        is their turn". Without this, a player who forgot to tap Next had their
        next ROLL attributed to the previous player, which quietly corrupts both
        players' luck.

        Only on SAVE, not on opening the menu: backing out of a build must not
        move the turn. Only for the three building actions: the robber and
        corrections name the player who is AFFECTED, not the one acting.
      */
      const BUILD_ACTIONS: readonly string[] = ['add_settlement', 'build_road', 'upgrade_city'];
      if (written.length > 0 && BUILD_ACTIONS.includes(selectedAction)) {
        const builderIndex = activeSession.players.findIndex(p => p.id === selectedPlayerId);
        if (builderIndex >= 0 && builderIndex !== activeSession.currentPlayerIndex) {
          try {
            await updateSession({ ...activeSession, currentPlayerIndex: builderIndex });
          } catch {
            // The build itself is already saved. A failed turn change must not
            // undo it or trap the screen open; Next still works.
          }
        }
      }

      resetForm();
      router.back();
    } catch {
      Alert.alert('Error', 'Could not save development action. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const renderPlayerSelector = () => (
    <View style={styles.subsection}>
      <Text style={[styles.subLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>SELECT PLAYER</Text>
      {activeSession.players.map(player => {
        const selected = selectedPlayerId === player.id;
        return (
          <TouchableOpacity
            key={player.id}
            style={[styles.playerBtn, {
              backgroundColor: selected ? player.color + '22' : colors.card,
              borderColor: selected ? player.color : colors.border,
            }]}
            onPress={() => { haptic(); setSelectedPlayerId(selected ? null : player.id); setSelectedLocationId(null); setSelectedNumbers([]); }}
          >
            <View style={[styles.playerDot, { backgroundColor: player.color }]} />
            <Text style={[styles.playerBtnText, { color: colors.foreground, fontFamily: selected ? 'Inter_700Bold' : 'Inter_400Regular' }]}>
              {player.displayName}
            </Text>
            {selected && <Ionicons name="checkmark-circle" size={18} color={player.color} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderNumberPicker = (label = 'SELECT HEX NUMBERS') => (
    <View style={styles.subsection}>
      <Text style={[styles.subLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>{label}</Text>
      <View style={styles.numGrid}>
        {CATAN_NUMBERS.map(num => {
          const selected = selectedNumbers.includes(num);
          return (
            <TouchableOpacity
              key={num}
              style={[styles.numBtn, {
                backgroundColor: selected ? colors.primary : colors.card,
                borderColor: selected ? colors.primary : colors.border,
              }]}
              onPress={() => toggleNumber(num)}
            >
              <Text style={[styles.numBtnValue, { color: selected ? colors.primaryForeground : colors.foreground, fontFamily: 'Inter_700Bold' }]}>{num}</Text>
              <Text style={[styles.numBtnPips, { color: selected ? colors.primaryForeground : colors.mutedForeground }]}>{'·'.repeat(PIPS[num] ?? 1)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const renderBuildingPicker = (label: string) => (
    <View style={styles.subsection}>
      <Text style={[styles.subLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>{label}</Text>
      {selectedPlayerBuildings.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          No buildings found for this player.
        </Text>
      ) : (
        selectedPlayerBuildings.map((bldg, idx) => {
          const selected = selectedLocationId === bldg.locationId;
          return (
            <TouchableOpacity
              key={bldg.locationId}
              style={[styles.buildingBtn, {
                backgroundColor: selected ? colors.primary + '22' : colors.card,
                borderColor: selected ? colors.primary : colors.border,
              }]}
              onPress={() => { haptic(); setSelectedLocationId(selected ? null : bldg.locationId); }}
            >
              <Ionicons
                name={bldg.productionWeight === 2 ? 'business-outline' : 'home-outline'}
                size={16}
                color={selected ? colors.primary : colors.mutedForeground}
              />
              <View style={styles.buildingBtnContent}>
                <Text style={[styles.buildingBtnTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  {bldg.productionWeight === 2 ? 'City' : 'Settlement'} #{idx + 1}
                </Text>
                <Text style={[styles.buildingBtnSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  Numbers: {bldg.affectedNumbers.join(', ')}
                </Text>
              </View>
              {selected && <Ionicons name="checkmark-circle" size={18} color={colors.primary} />}
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );

  const renderRobberBlockPicker = () => (
    <View style={styles.subsection}>
      <Text style={[styles.subLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>SELECT ACTIVE BLOCK TO END</Text>
      {activeRobberBlocks.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          No active robber blocks for this player.
        </Text>
      ) : (
        activeRobberBlocks.map((block, idx) => {
          const blockId = block.hexIdentifiers?.[0] ?? block.id;
          const selected = selectedLocationId === blockId;
          return (
            <TouchableOpacity
              key={blockId}
              style={[styles.buildingBtn, {
                backgroundColor: selected ? colors.primary + '22' : colors.card,
                borderColor: selected ? colors.primary : colors.border,
              }]}
              onPress={() => { haptic(); setSelectedLocationId(selected ? null : blockId); }}
            >
              <Ionicons name="ban-outline" size={16} color={selected ? colors.primary : colors.destructive} />
              <View style={styles.buildingBtnContent}>
                <Text style={[styles.buildingBtnTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  Block #{idx + 1} (turn {block.turnNumber})
                </Text>
                {block.affectedNumbers.length > 0 && (
                  <Text style={[styles.buildingBtnSub, { color: colors.mutedForeground }]}>
                    Blocking: {block.affectedNumbers.join(', ')}
                  </Text>
                )}
              </View>
              {selected && <Ionicons name="checkmark-circle" size={18} color={colors.primary} />}
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );

  /**
   * The road picker: the board, with only edges this player may legally build
   * on offered.
   *
   * Legality is the whole interface here. A road must touch one of the
   * player's own roads or own buildings, and there are 72 edges — offering all
   * of them and complaining afterwards would make the rule something the
   * player discovers by being told off. Showing three tappable edges makes it
   * something they never have to think about.
   */
  const renderRoadPicker = () => {
    if (!board || !selectedPlayerId || !activeSession) return null;

    const mine = roadsOf(exposureEvents, selectedPlayerId);
    const taken = new Set(allRoads(exposureEvents, activeSession.players.map(p => p.id)).keys());
    const myCorners = new Set(
      getBuildingStatesAtTurn(selectedPlayerId, Number.MAX_SAFE_INTEGER, exposureEvents)
        .map(b => b.locationId),
    );
    /*
      The pending picks count as BUILT for the purpose of offering the next
      one. Road Building's second road usually attaches to the first, so
      judging it against the board as it was would hide the obvious move.
    */
    const minePlus = new Set([...mine, ...selectedRoads]);
    const takenPlus = new Set([...taken, ...selectedRoads]);
    const offerable = allEdges()
      .map(e => e.id)
      .filter(id => buildProblem(id, minePlus, myCorners, takenPlus) === null);

    const marks: Record<string, string> = {};
    for (const [edgeId, ownerId] of allRoads(
      exposureEvents, activeSession.players.map(p => p.id))) {
      marks[edgeId] = activeSession.players.find(p => p.id === ownerId)?.color ?? '#888';
    }
    for (const id of selectedRoads) {
      marks[id] =
        activeSession.players.find(p => p.id === selectedPlayerId)?.color ?? colors.primary;
    }

    return (
      <View style={{ gap: 8 }}>
        {/*
          Buildings are drawn here too. Choosing a road with the settlements
          invisible means judging "does this connect to anything of mine"
          against a blank board — the legality filter already knows the answer,
          but the player cannot SEE why an edge is or is not offered, and the
          board is the thing they are checking the app against.
        */}
        <CatanHexGrid
          hexes={board.hexes}
          ports={board.ports}
          showRoads
          legalRoads={[...offerable, ...selectedRoads]}
          roadMarks={marks}
          offerColor={activeSession.players.find(p => p.id === selectedPlayerId)?.color}
          showIntersections
          legalIntersections={[]}
          intersectionMarks={buildingMarks}
          cityIntersections={cityCorners}
          onRoadPress={id => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setSelectedRoads(prev => {
              if (prev.includes(id)) return prev.filter(x => x !== id);
              // Decided inside the updater, not from a memo — two taps in one
              // render cycle would otherwise both see room and both append.
              // Same read-then-write race as the double-placed settlement.
              if (prev.length >= MAX_ROADS_AT_ONCE) return prev;
              return [...prev, id];
            });
          }}
        />
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
          {selectedRoads.length >= MAX_ROADS_AT_ONCE
            ? `${selectedRoads.length} ROADS SELECTED · TAP ONE AGAIN TO REMOVE IT`
            : offerable.length === 0
              ? 'NO LEGAL ROADS — A ROAD MUST TOUCH YOUR OWN ROAD OR BUILDING'
              : selectedRoads.length > 0
                ? `${selectedRoads.length} SELECTED · TAP ANOTHER FOR ROAD BUILDING`
                : `TAP A ROAD · ${offerable.length} LEGAL`}
        </Text>
      </View>
    );
  };

  /**
   * The corner picker: the board, with only legal corners offered.
   *
   * Same reasoning as the road picker — restricting to the legal set is what
   * makes a mis-tap unreachable rather than merely discouraged, which matters
   * more here than anywhere else because a mis-tapped corner does not look
   * like an error. It silently records production the player never had.
   *
   * Existing buildings stay drawn, in their owner's colour, so the picker
   * doubles as the confirmation that the app agrees with the table.
   */
  const renderCornerPicker = () => {
    if (!board || !selectedPlayerId || !activeSession) return null;

    const mine = activeSession.players.find(p => p.id === selectedPlayerId)?.color ?? colors.primary;
    const marks = { ...buildingMarks, ...(selectedCorner ? { [selectedCorner]: mine } : {}) };

    return (
      <View style={{ gap: 8 }}>

        {/*
          "0 LEGAL" on its own reads exactly like a broken app, and it was
          reported as one. It is usually correct and it is usually correct for
          the SAME reason: right after the opening, every corner your roads
          reach is adjacent to one of your own settlements, so the distance
          rule blocks all of them. Measured on a normal four-player opening —
          30 corners free by occupancy and distance, 0 reachable by road.

          Real Catan: you build a road first. So say that, and offer the road.
        */}
        {offeredCorners.length === 0 && (
          <View style={[styles.actionForm, {
            backgroundColor: colors.muted, borderColor: colors.border, gap: 8,
          }]}>
            <Text style={[styles.buildingBtnSub, { color: colors.mutedForeground }]}>
              {roadsOf(exposureEvents, selectedPlayerId).size === 0
                ? 'A settlement has to sit on one of your own roads, and none are recorded for this player yet.'
                : 'Every corner your roads reach is next to one of your own settlements, so the distance rule blocks it. Build a road further out first — this is the normal state right after the opening.'}
            </Text>
            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: colors.border }]}
              onPress={() => { haptic(); setSelectedAction('build_road'); }}
              accessibilityRole="button"
            >
              <Ionicons name="git-branch-outline" size={15} color={colors.foreground} />
              <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>
                Build a road instead
              </Text>
            </TouchableOpacity>
          </View>
        )}
        {/* Roads are drawn but NOT tappable here — showRoads with no
            onRoadPress means the overlay skips them entirely, so they cannot
            steal a corner tap. You need to see your network to judge a
            settlement; you do not need to build on it. */}
        <CatanHexGrid
          hexes={board.hexes}
          ports={board.ports}
          showIntersections
          legalIntersections={offeredCorners}
          intersectionMarks={marks}
          offerColor={mine}
          cityIntersections={cityCorners}
          showRoads
          legalRoads={[]}
          roadMarks={roadMarksAll}
          onIntersectionPress={id => {
            haptic();
            setSelectedCorner(prev => (prev === id ? null : id));
          }}
        />
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
          {selectedCorner
            ? `CORNER SELECTED · PRODUCES ${cornerNumbers.length ? cornerNumbers.join(', ') : 'NOTHING'}`
            : offeredCorners.length === 0
              ? 'NOWHERE LEGAL YET'
              : `TAP A CORNER · ${offeredCorners.length} LEGAL`}
        </Text>
        {selectedCorner ? (
          <Text style={[styles.buildingBtnSub, { color: colors.mutedForeground, textAlign: 'center' }]}>
            Numbers are read from the board, not typed. Tap the corner again to clear it.
          </Text>
        ) : (
          <Text style={[styles.buildingBtnSub, { color: colors.mutedForeground, textAlign: 'center' }]}>
            Or skip this and enter the numbers by hand below.
          </Text>
        )}
      </View>
    );
  };

  /**
   * Pick one of YOUR OWN buildings off the board.
   *
   * Used for upgrading to a city and for removing a building. The list picker
   * below still exists for a game with no board, but "Settlement 2" means
   * counting your own pieces to work out which one that is — when the board is
   * right there and the answer is a tap.
   *
   * Only this player's buildings are offered. Everyone else's stay drawn, in
   * their own colour, because the board should show what is there.
   */
  const renderOwnBuildingBoard = () => {
    if (!board || !selectedPlayerId || !activeSession) return null;
    const mineCorners = [...snapshot.buildings.entries()]
      .filter(([, b]) => b.playerId === selectedPlayerId)
      // Upgrading is settlements only: a city cannot be upgraded again.
      .filter(([, b]) => (selectedAction === 'upgrade_city' ? b.weight < 2 : true))
      .map(([id]) => id);

    const marks = { ...buildingMarks };
    if (selectedLocationId) {
      marks[selectedLocationId] =
        activeSession.players.find(p => p.id === selectedPlayerId)?.color ?? colors.primary;
    }

    return (
      <View style={{ gap: 8 }}>
        <CatanHexGrid
          hexes={board.hexes}
          ports={board.ports}
          showIntersections
          legalIntersections={mineCorners}
          intersectionMarks={marks}
          cityIntersections={cityCorners}
          showRoads
          legalRoads={[]}
          roadMarks={roadMarksAll}
          onIntersectionPress={id => {
            haptic();
            setSelectedLocationId(prev => (prev === id ? null : id));
          }}
        />
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
          {mineCorners.length === 0
            ? (selectedAction === 'upgrade_city'
                ? 'NO SETTLEMENTS LEFT TO UPGRADE'
                : 'NOTHING ON THE BOARD TO REMOVE')
            : selectedAction === 'upgrade_city'
              ? `TAP ONE OF YOUR SETTLEMENTS · ${mineCorners.length}`
              : `TAP THE BUILDING TO REMOVE · ${mineCorners.length}`}
        </Text>
        {selectedLocationId && (
          <Text style={[styles.buildingBtnSub, { color: colors.mutedForeground, textAlign: 'center' }]}>
            Tap it again to clear the selection.
          </Text>
        )}
      </View>
    );
  };

  const renderActionForm = () => {
    if (!selectedAction) return null;
    const needsPlayer = true;
    const showPlayerPicker = needsPlayer;
    /**
     * The number pad is HIDDEN for a settlement once a corner is chosen —
     * having both live at once invites entering numbers that contradict the
     * board, and the corner's numbers are the trustworthy ones.
     */
    const showNumberPicker =
      (selectedAction === 'add_settlement' && !selectedCorner) ||
      ['start_robber', 'correct_exposure'].includes(selectedAction);
    const showBuildingPicker = ['upgrade_city', 'remove_building', 'correct_exposure'].includes(selectedAction);
    const showRobberEndPicker = selectedAction === 'end_robber';

    return (
      <View style={[styles.actionForm, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/*
          THE MAP IS THE FIRST THING ON THE PAGE.

          Reported twice from a device: first "the map should be at the top, not
          the bottom", then, once it was merely near the top, "at the very top
          of the page when they go to a build menu and are instructed to place
          their piece". The build pills on the game screen already name the
          player, so the player list is confirmation, not a step — it goes
          below the board, where it is still one tap away for a correction.

          Upgrading and removing are board actions too: picking "Settlement 2"
          off a list means counting your own pieces, when the answer is a tap.
          The list is kept below, for a game with no board.
        */}
        {selectedPlayerId && selectedAction === 'build_road' && renderRoadPicker()}
        {selectedPlayerId && selectedAction === 'add_settlement' && renderCornerPicker()}
        {selectedPlayerId && ['upgrade_city', 'remove_building'].includes(selectedAction)
          && renderOwnBuildingBoard()}
        {showPlayerPicker && renderPlayerSelector()}
        {selectedPlayerId && showBuildingPicker && renderBuildingPicker(
          selectedAction === 'upgrade_city' ? 'SELECT SETTLEMENT TO UPGRADE' :
          selectedAction === 'remove_building' ? 'SELECT BUILDING TO REMOVE' :
          'SELECT BUILDING TO CORRECT',
        )}
        {selectedPlayerId && showRobberEndPicker && renderRobberBlockPicker()}
        {selectedPlayerId && showNumberPicker && renderNumberPicker(
          selectedAction === 'start_robber' ? 'NUMBER(S) BEING BLOCKED' :
          selectedAction === 'correct_exposure' ? 'CORRECTED NUMBER(S)' :
          'SELECT HEX NUMBERS',
        )}

        <TouchableOpacity
          style={[styles.submitBtn, {
            backgroundColor: isSaving ? colors.muted : colors.primary,
            opacity: isSaving ? 0.7 : 1,
          }]}
          onPress={handleSubmit}
          disabled={isSaving}
          activeOpacity={0.85}
        >
          <Text style={[styles.submitBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_700Bold' }]}>
            {isSaving ? 'Saving…' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + webTop + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} hitSlop={8}>
          <Ionicons name="close" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          Development
        </Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        {/*
          THE FORM FIRST when an action is already chosen.

          This screen used to render all seven action cards and then the form,
          so tapping "Road" on the game screen — which already names the action
          AND the player — landed you on a menu, and the map you came for was
          below seven cards of scrolling. Reported as "we should have buttons
          that just take you directly to the ability to do the building you
          want, not to another menu", and separately as wanting the map at the
          top rather than the bottom.

          The list is still here, under a header that collapses it, because
          changing your mind has to stay possible. It is just no longer the
          first thing between you and the board.
        */}
        {selectedAction ? (
          <>
{renderActionForm()}

            <View style={styles.chosenRow}>
              <Ionicons
                name={(ACTIONS.find(a => a.type === selectedAction)?.icon ?? 'ellipse') as any}
                size={20}
                color={colors.primary}
              />
              <Text style={[styles.chosenTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                {ACTIONS.find(a => a.type === selectedAction)?.label ?? 'Action'}
              </Text>
              <TouchableOpacity
                onPress={() => { haptic(); setShowActionList(v => !v); }}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text style={[styles.changeLink, { color: colors.primary, fontFamily: 'Inter_500Medium' }]}>
                  {showActionList ? 'Hide' : 'Change'}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}

        {(!selectedAction || showActionList) && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
              {selectedAction ? 'OR DO SOMETHING ELSE' : 'SELECT ACTION'}
            </Text>

            {ACTIONS.map(action => {
              const selected = selectedAction === action.type;
              return (
                <TouchableOpacity
                  key={action.type}
                  style={[styles.actionCard, {
                    backgroundColor: selected ? colors.primary + '18' : colors.card,
                    borderColor: selected ? colors.primary : colors.border,
                  }]}
                  onPress={() => {
                    haptic();
                    setSelectedAction(selected ? null : action.type);
                    setSelectedPlayerId(playerParam ?? null);
                    setSelectedLocationId(null);
                    setSelectedNumbers([]);
                    setShowActionList(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={action.icon as any}
                    size={22}
                    color={selected ? colors.primary : action.destructive ? colors.destructive : colors.foreground}
                  />
                  <View style={styles.actionCardContent}>
                    <Text style={[styles.actionCardTitle, { color: selected ? colors.primary : colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                      {action.label}
                    </Text>
                    <Text style={[styles.actionCardDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                      {action.desc}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  headerTitle: { fontSize: 18 },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  scroll: { padding: 16, gap: 10 },
  chosenRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 2 },
  chosenTitle: { fontSize: 17, flex: 1 },
  changeLink: { fontSize: 13 },
  sectionLabel: { fontSize: 11, letterSpacing: 1.2, marginBottom: 4 },

  actionCard: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, borderRadius: 12, borderWidth: 1, gap: 12 },
  actionCardContent: { flex: 1, gap: 2 },
  actionCardTitle: { fontSize: 15 },
  actionCardDesc: { fontSize: 12, lineHeight: 17 },

  actionForm: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 14, marginTop: 4 },

  subsection: { gap: 8 },
  subLabel: { fontSize: 10, letterSpacing: 1 },

  playerBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 6 },
  playerDot: { width: 10, height: 10, borderRadius: 5 },
  playerBtnText: { flex: 1, fontSize: 15 },

  numGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  numBtn: { width: 52, height: 52, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  numBtnValue: { fontSize: 16 },
  numBtnPips: { fontSize: 8, letterSpacing: 0.5 },

  buildingBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 6 },
  buildingBtnContent: { flex: 1 },
  buildingBtnTitle: { fontSize: 14 },
  buildingBtnSub: { fontSize: 12 },

  emptyText: { fontSize: 13, fontStyle: 'italic', paddingVertical: 4 },

  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderRadius: 10, paddingVertical: 10,
  },
  secondaryBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  submitBtn: { paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  submitBtnText: { fontSize: 16 },
});
