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

import React, { useMemo, useState } from 'react';
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
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useGame } from '@/context/GameContext';
import { useSettings } from '@/context/SettingsContext';
import { getBuildingStatesAtTurn, getActiveRobberBlockedNumbers } from '@/services/catanStats';
import { generateId } from '@/types/models';
import type { CatanPlayerExposureEvent } from '@/types/models';

const CATAN_NUMBERS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
const PIPS: Record<number, number> = { 2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1 };

type ActionType = 'add_settlement' | 'upgrade_city' | 'remove_building' | 'start_robber' | 'end_robber' | 'correct_exposure' | null;

const ACTIONS: Array<{ type: ActionType; label: string; desc: string; icon: string; destructive?: boolean }> = [
  { type: 'add_settlement', label: 'Add Settlement', desc: 'Record a new settlement placed this turn', icon: 'home-outline' },
  { type: 'upgrade_city', label: 'Upgrade to City', desc: 'Doubles production from this turn forward (non-retroactive)', icon: 'business-outline' },
  { type: 'remove_building', label: 'Remove Building', desc: 'Mark a building as no longer producing', icon: 'trash-outline', destructive: true },
  { type: 'start_robber', label: 'Start Robber Block', desc: 'Block production from a number for a player', icon: 'ban-outline', destructive: true },
  { type: 'end_robber', label: 'End Robber Block', desc: 'Remove an active robber block', icon: 'checkmark-circle-outline' },
  { type: 'correct_exposure', label: 'Correct Exposure', desc: "Fix a settlement's numbers", icon: 'create-outline' },
];

export default function CatanDevelopmentScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeSession, rollEvents, exposureEvents, persistExposureEvents } = useGame();
  const { settings } = useSettings();
  const webTop = Platform.OS === 'web' ? 67 : 0;

  const [selectedAction, setSelectedAction] = useState<ActionType>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
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
      const baseEvent = {
        id: generateId(),
        sessionId: activeSession.id,
        playerId: selectedPlayerId,
        turnNumber: currentTurn,
        timestamp: new Date().toISOString(),
        robberBlocked: false,
      };

      if (selectedAction === 'add_settlement') {
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

      if (newEvent) {
        await persistExposureEvents(activeSession.id, [...exposureEvents, newEvent]);
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

  const renderActionForm = () => {
    if (!selectedAction) return null;
    const needsPlayer = true;
    const showPlayerPicker = needsPlayer;
    const showNumberPicker = ['add_settlement', 'start_robber', 'correct_exposure'].includes(selectedAction);
    const showBuildingPicker = ['upgrade_city', 'remove_building', 'correct_exposure'].includes(selectedAction);
    const showRobberEndPicker = selectedAction === 'end_robber';

    return (
      <View style={[styles.actionForm, { backgroundColor: colors.card, borderColor: colors.border }]}>
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
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>SELECT ACTION</Text>

        {ACTIONS.map(action => {
          const selected = selectedAction === action.type;
          return (
            <TouchableOpacity
              key={action.type}
              style={[styles.actionCard, {
                backgroundColor: selected ? colors.primary + '18' : colors.card,
                borderColor: selected ? colors.primary : colors.border,
              }]}
              onPress={() => { haptic(); setSelectedAction(selected ? null : action.type); setSelectedPlayerId(null); setSelectedLocationId(null); setSelectedNumbers([]); }}
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
              <Ionicons
                name={selected ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.mutedForeground}
              />
            </TouchableOpacity>
          );
        })}

        {renderActionForm()}
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

  submitBtn: { paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  submitBtnText: { fontSize: 16 },
});
