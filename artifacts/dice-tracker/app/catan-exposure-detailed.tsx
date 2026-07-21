/**
 * Detailed Exposure Setup — Catan-Compatible Mode.
 *
 * For each player, add settlement/city locations with:
 *   - Hex number (2–12, no 7)
 *   - Resource type (grain, ore, lumber, brick, wool)
 *   - Building type (settlement / city)
 *   - Optional identifier (e.g. "near port", "B4")
 *
 * Creates CatanPlayerExposureEvent records with turnNumber=0
 * before navigating to the active Catan screen.
 */

import React, { useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
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
import { generateId } from '@/types/models';
import type { CatanPlayerExposureEvent, ResourceType } from '@/types/models';

// ─── Constants ────────────────────────────────────────────────────────────────

const CATAN_NUMBERS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
const PIPS: Record<number, number> = { 2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1 };

const RESOURCES: Array<{ type: ResourceType; label: string; color: string; icon: string }> = [
  { type: 'grain',   label: 'Grain',   color: '#F5C542', icon: '🌾' },
  { type: 'ore',     label: 'Ore',     color: '#8B8FA8', icon: '⛏️' },
  { type: 'lumber',  label: 'Lumber',  color: '#5E8B4E', icon: '🌲' },
  { type: 'brick',   label: 'Brick',   color: '#C0613A', icon: '🧱' },
  { type: 'wool',    label: 'Wool',    color: '#A8D5A2', icon: '🐑' },
  { type: 'desert',  label: 'Desert',  color: '#D4C49A', icon: '🏜️' },
];

// ─── Location form state ──────────────────────────────────────────────────────

interface LocationEntry {
  id: string;
  number: number | null;
  resourceType: ResourceType | null;
  isCity: boolean;
  identifier: string;
}

const newLocation = (): LocationEntry => ({
  id: generateId(),
  number: null,
  resourceType: null,
  isCity: false,
  identifier: '',
});

interface PlayerSetup {
  locations: LocationEntry[];
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CatanExposureDetailedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeSession, persistExposureEvents } = useGame();
  const { settings } = useSettings();
  const webTop = Platform.OS === 'web' ? 67 : 0;

  const [playerSetups, setPlayerSetups] = useState<PlayerSetup[]>(() =>
    (activeSession?.players ?? []).map(() => ({ locations: [newLocation()] })),
  );
  const [currentPlayerIdx, setCurrentPlayerIdx] = useState(0);
  const [expandedLocationId, setExpandedLocationId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const haptic = () => {
    if (settings.hapticsEnabled) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  if (!activeSession) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>No active session</Text>
        <TouchableOpacity onPress={() => router.replace('/')}>
          <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Go Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const players = activeSession.players;
  const currentPlayer = players[currentPlayerIdx]!;
  const isLastPlayer = currentPlayerIdx === players.length - 1;
  const currentSetup = playerSetups[currentPlayerIdx] ?? { locations: [newLocation()] };

  const updateLocation = (locId: string, updater: (l: LocationEntry) => LocationEntry) => {
    setPlayerSetups(prev => {
      const next = [...prev];
      const setup = next[currentPlayerIdx]!;
      next[currentPlayerIdx] = {
        ...setup,
        locations: setup.locations.map(l => l.id === locId ? updater(l) : l),
      };
      return next;
    });
  };

  const addLocation = () => {
    haptic();
    const loc = newLocation();
    setPlayerSetups(prev => {
      const next = [...prev];
      next[currentPlayerIdx] = {
        ...next[currentPlayerIdx]!,
        locations: [...next[currentPlayerIdx]!.locations, loc],
      };
      return next;
    });
    setExpandedLocationId(loc.id);
  };

  const removeLocation = (locId: string) => {
    setPlayerSetups(prev => {
      const next = [...prev];
      const locs = next[currentPlayerIdx]!.locations.filter(l => l.id !== locId);
      next[currentPlayerIdx] = {
        ...next[currentPlayerIdx]!,
        locations: locs.length > 0 ? locs : [newLocation()],
      };
      return next;
    });
    if (expandedLocationId === locId) setExpandedLocationId(null);
  };

  const buildExposureEvents = (): CatanPlayerExposureEvent[] => {
    const events: CatanPlayerExposureEvent[] = [];
    for (let pi = 0; pi < players.length; pi++) {
      const player = players[pi]!;
      const setup = playerSetups[pi] ?? { locations: [] };
      for (const loc of setup.locations) {
        if (loc.number === null) continue;
        events.push({
          id: generateId(),
          sessionId: activeSession.id,
          playerId: player.id,
          eventType: 'initialSettlement',
          turnNumber: 0,
          timestamp: new Date().toISOString(),
          affectedNumbers: [loc.number],
          hexIdentifiers: [loc.id, ...(loc.identifier ? [loc.identifier] : [])],
          productionWeight: loc.isCity ? 2 : 1,
          resourceType: loc.resourceType ?? undefined,
          robberBlocked: false,
          notes: loc.identifier || undefined,
        });
      }
    }
    return events;
  };

  const handleFinishPlayer = () => {
    haptic();
    const hasAny = currentSetup.locations.some(l => l.number !== null);
    if (!hasAny) {
      Alert.alert('No locations', 'Add at least one settlement location for this player.');
      return;
    }
    if (isLastPlayer) {
      handleStartGame();
    } else {
      setCurrentPlayerIdx(i => i + 1);
      setExpandedLocationId(null);
    }
  };

  const handleStartGame = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const events = buildExposureEvents();
      await persistExposureEvents(activeSession.id, events);
      router.replace('/active-catan' as any);
    } catch {
      Alert.alert('Error', 'Could not save exposure data. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const renderLocationCard = (loc: LocationEntry, idx: number) => {
    const expanded = expandedLocationId === loc.id;
    const hasData = loc.number !== null;
    const resource = RESOURCES.find(r => r.type === loc.resourceType);

    return (
      <View key={loc.id} style={[styles.locCard, { backgroundColor: colors.card, borderColor: hasData ? colors.primary + '44' : colors.border }]}>
        {/* Collapsed header */}
        <TouchableOpacity
          style={styles.locHeader}
          onPress={() => setExpandedLocationId(expanded ? null : loc.id)}
          activeOpacity={0.8}
        >
          <View style={styles.locHeaderLeft}>
            <Text style={[styles.locTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
              {hasData
                ? `${loc.isCity ? 'City' : 'Settlement'} on ${loc.number}${resource ? ` · ${resource.icon}` : ''}${loc.identifier ? ` · ${loc.identifier}` : ''}`
                : `Location ${idx + 1} — tap to configure`}
            </Text>
          </View>
          <View style={styles.locHeaderRight}>
            <TouchableOpacity onPress={() => removeLocation(loc.id)} hitSlop={8} style={{ marginRight: 8 }}>
              <Ionicons name="trash-outline" size={16} color={colors.destructive} />
            </TouchableOpacity>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedForeground} />
          </View>
        </TouchableOpacity>

        {expanded && (
          <View style={[styles.locBody, { borderTopColor: colors.border }]}>
            {/* Number selector */}
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>HEX NUMBER</Text>
            <View style={styles.numGrid}>
              {CATAN_NUMBERS.map(num => {
                const selected = loc.number === num;
                return (
                  <TouchableOpacity
                    key={num}
                    style={[styles.numBtn, { backgroundColor: selected ? colors.primary : colors.muted, borderColor: selected ? colors.primary : colors.border }]}
                    onPress={() => { haptic(); updateLocation(loc.id, l => ({ ...l, number: num })); }}
                  >
                    <Text style={[styles.numBtnText, { color: selected ? colors.primaryForeground : colors.foreground, fontFamily: 'Inter_700Bold' }]}>{num}</Text>
                    <Text style={[styles.numBtnPips, { color: selected ? colors.primaryForeground : colors.mutedForeground }]}>{'·'.repeat(PIPS[num] ?? 1)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Resource type */}
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginTop: 12 }]}>RESOURCE (OPTIONAL)</Text>
            <View style={styles.resourceGrid}>
              {RESOURCES.map(r => {
                const selected = loc.resourceType === r.type;
                return (
                  <TouchableOpacity
                    key={r.type}
                    style={[styles.resourceBtn, { backgroundColor: selected ? r.color + '44' : colors.muted, borderColor: selected ? r.color : colors.border, borderWidth: selected ? 1.5 : 1 }]}
                    onPress={() => { haptic(); updateLocation(loc.id, l => ({ ...l, resourceType: selected ? null : r.type })); }}
                  >
                    <Text style={styles.resourceIcon}>{r.icon}</Text>
                    <Text style={[styles.resourceLabel, { color: colors.foreground, fontFamily: selected ? 'Inter_600SemiBold' : 'Inter_400Regular' }]}>{r.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Building type */}
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginTop: 12 }]}>BUILDING TYPE</Text>
            <View style={styles.buildingRow}>
              {(['settlement', 'city'] as const).map(type => {
                const isCity = type === 'city';
                const selected = loc.isCity === isCity;
                return (
                  <TouchableOpacity
                    key={type}
                    style={[styles.buildingBtn, { backgroundColor: selected ? colors.primary : colors.muted, borderColor: selected ? colors.primary : colors.border }]}
                    onPress={() => { haptic(); updateLocation(loc.id, l => ({ ...l, isCity })); }}
                  >
                    <Ionicons name={isCity ? 'business-outline' : 'home-outline'} size={18} color={selected ? colors.primaryForeground : colors.mutedForeground} />
                    <Text style={[styles.buildingBtnText, { color: selected ? colors.primaryForeground : colors.foreground, fontFamily: selected ? 'Inter_600SemiBold' : 'Inter_400Regular' }]}>
                      {isCity ? 'City (×2)' : 'Settlement (×1)'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Identifier */}
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginTop: 12 }]}>IDENTIFIER (OPTIONAL)</Text>
            <TextInput
              style={[styles.identifierInput, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
              value={loc.identifier}
              onChangeText={text => updateLocation(loc.id, l => ({ ...l, identifier: text }))}
              placeholder='e.g. "near port", "B4"'
              placeholderTextColor={colors.mutedForeground}
              maxLength={30}
              returnKeyType="done"
            />
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + webTop + 12, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Settlement Setup</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Detailed · Player {currentPlayerIdx + 1} of {players.length}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.skipBtn, { borderColor: colors.border }]}
          onPress={() => Alert.alert('Skip?', 'Stats will be limited without settlement data.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Skip', onPress: handleStartGame },
          ])}
        >
          <Text style={[styles.skipText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>Skip</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        {/* Player indicator */}
        <View style={[styles.playerBadge, { backgroundColor: currentPlayer.color + '22', borderColor: currentPlayer.color }]}>
          <View style={[styles.playerDot, { backgroundColor: currentPlayer.color }]} />
          <Text style={[styles.playerBadgeText, { color: currentPlayer.color, fontFamily: 'Inter_700Bold' }]}>
            {currentPlayer.displayName}
          </Text>
        </View>

        {/* Location cards */}
        {currentSetup.locations.map((loc, idx) => renderLocationCard(loc, idx))}

        {/* Add Location */}
        <TouchableOpacity
          style={[styles.addBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
          onPress={addLocation}
        >
          <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
          <Text style={[styles.addBtnText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
            Add Another Location
          </Text>
        </TouchableOpacity>

        {/* Continue / Start button */}
        <TouchableOpacity
          style={[styles.continueBtn, { backgroundColor: isSaving ? colors.muted : colors.primary, opacity: isSaving ? 0.7 : 1 }]}
          onPress={handleFinishPlayer}
          disabled={isSaving}
          activeOpacity={0.85}
        >
          <Ionicons name={isLastPlayer ? 'play' : 'arrow-forward'} size={20} color={colors.primaryForeground} />
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
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  headerTitle: { fontSize: 18 },
  headerSub: { fontSize: 13, marginTop: 2 },
  skipBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginTop: 4 },
  skipText: { fontSize: 13 },
  scroll: { padding: 16, gap: 12 },

  playerBadge: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1.5 },
  playerDot: { width: 12, height: 12, borderRadius: 6 },
  playerBadgeText: { fontSize: 16 },

  locCard: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  locHeader: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  locHeaderLeft: { flex: 1 },
  locTitle: { fontSize: 14, lineHeight: 20 },
  locHeaderRight: { flexDirection: 'row', alignItems: 'center' },

  locBody: { padding: 14, borderTopWidth: 1, gap: 4 },
  fieldLabel: { fontSize: 10, letterSpacing: 1, marginBottom: 8 },

  numGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  numBtn: { width: 52, height: 52, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  numBtnText: { fontSize: 16 },
  numBtnPips: { fontSize: 8, letterSpacing: 0.5 },

  resourceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  resourceBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
  resourceIcon: { fontSize: 14 },
  resourceLabel: { fontSize: 12 },

  buildingRow: { flexDirection: 'row', gap: 8 },
  buildingBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 10, borderWidth: 1 },
  buildingBtnText: { fontSize: 13 },

  identifierInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },

  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed' },
  addBtnText: { fontSize: 15 },

  continueBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 18, borderRadius: 14, marginTop: 8 },
  continueBtnText: { fontSize: 17 },
});
