/**
 * Catan-Compatible Mode setup screen.
 *
 * DISCLAIMER: This is an independent companion tool and is not affiliated
 * with or endorsed by the publishers or owners of Catan.
 *
 * Flow:
 *   1. Show disclaimer (top of screen)
 *   2. Player count + names + colors (3–6 players)
 *   3. Options: auto-advance, winner tracking, placement tracking, robber tracking
 *   4. Two CTA buttons: Quick Setup / Detailed Setup
 *      → createSession() then navigate to appropriate exposure screen
 */

import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
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
import {
  clearPrefillSession,
  loadPrefillSession,
} from '@/services/storage';
import {
  PLAYER_COLORS,
  SCHEMA_VERSION,
  generateId,
} from '@/types/models';
import type { GameSession, Player } from '@/types/models';

// ─── Disclaimer ───────────────────────────────────────────────────────────────

const DISCLAIMER =
  'This is an independent companion tool and is not affiliated with or endorsed by the publishers or owners of Catan.';

// ─── Defaults ─────────────────────────────────────────────────────────────────

interface PlayerConfig { name: string; color: string }

const defaultConfigs = (): PlayerConfig[] =>
  Array.from({ length: 6 }, (_, i) => ({
    name: `Player ${i + 1}`,
    color: PLAYER_COLORS[i] ?? PLAYER_COLORS[0]!,
  }));

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ text, colors }: { text: string; colors: ReturnType<typeof useColors> }) {
  return (
    <Text style={[sl.label, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
      {text}
    </Text>
  );
}
const sl = StyleSheet.create({ label: { fontSize: 11, letterSpacing: 1.2, marginBottom: 8, marginLeft: 2 } });

function Stepper({
  value, min, max, onDecrement, onIncrement, colors,
}: {
  value: number; min: number; max: number;
  onDecrement: () => void; onIncrement: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[st.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity style={[st.btn, { opacity: value <= min ? 0.35 : 1 }]} onPress={onDecrement} disabled={value <= min}>
        <Text style={[st.sym, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>−</Text>
      </TouchableOpacity>
      <Text style={[st.val, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{value}</Text>
      <TouchableOpacity style={[st.btn, { opacity: value >= max ? 0.35 : 1 }]} onPress={onIncrement} disabled={value >= max}>
        <Text style={[st.sym, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>+</Text>
      </TouchableOpacity>
    </View>
  );
}
const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, alignSelf: 'flex-start' },
  btn: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  sym: { fontSize: 24 },
  val: { fontSize: 22, minWidth: 48, textAlign: 'center' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CatanGameSetupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { startSession } = useGame();
  const { settings } = useSettings();

  // Catan supports 3–6 players; clamp the saved default to that range
  const [playerCount, setPlayerCount] = useState(() => Math.min(Math.max(3, settings.defaultPlayerCount), 6));
  const [playerConfigs, setPlayerConfigs] = useState<PlayerConfig[]>(defaultConfigs);
  const [autoAdvance, setAutoAdvance] = useState(() => settings.defaultAutoAdvance);
  const [trackWinner, setTrackWinner] = useState(true);
  const [trackPlacements, setTrackPlacements] = useState(false);
  const [robberTracking, setRobberTracking] = useState(true);
  const [isStarting, setIsStarting] = useState(false);

  // Consume any saved Catan prefill from "Duplicate Setup" — runs once on mount
  useEffect(() => {
    void (async () => {
      const prefill = await loadPrefillSession();
      if (!prefill || prefill.gameType !== 'catan') return;
      await clearPrefillSession();
      const pc = Math.min(Math.max(3, prefill.players.length), 6);
      setPlayerCount(pc);
      setAutoAdvance(prefill.autoAdvancePlayer);
      if (prefill.settings.trackWinner !== undefined) setTrackWinner(prefill.settings.trackWinner);
      if (prefill.settings.trackPlacements !== undefined) setTrackPlacements(prefill.settings.trackPlacements);
      if (prefill.settings.catanRobberTracking !== undefined) setRobberTracking(prefill.settings.catanRobberTracking);
      setPlayerConfigs(prev => {
        const next = [...prev];
        prefill.players.forEach((player, i) => {
          if (i < next.length) next[i] = { name: player.displayName, color: player.color };
        });
        return next;
      });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const webBottom = Platform.OS === 'web' ? 34 : 0;

  const haptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    if (settings.hapticsEnabled) void Haptics.impactAsync(style);
  };

  const updatePlayerName = (i: number, name: string) =>
    setPlayerConfigs(prev => {
      const next = [...prev];
      next[i] = { ...next[i]!, name };
      return next;
    });

  const cyclePlayerColor = (i: number) => {
    haptic();
    setPlayerConfigs(prev => {
      const next = [...prev];
      const idx = PLAYER_COLORS.indexOf(next[i]!.color);
      next[i] = { ...next[i]!, color: PLAYER_COLORS[(idx + 1) % PLAYER_COLORS.length]! };
      return next;
    });
  };

  const createAndNavigate = async (detailed: boolean) => {
    if (isStarting) return;
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    setIsStarting(true);
    try {
      const players: Player[] = playerConfigs.slice(0, playerCount).map((cfg, i) => ({
        id: generateId(),
        displayName: cfg.name.trim() || `Player ${i + 1}`,
        color: cfg.color,
        seatNumber: i + 1,
        createdAt: new Date().toISOString(),
      }));

      const session: GameSession = {
        id: generateId(),
        gameType: 'catan',
        customGameName: 'Settlement Mode',
        diceMode: '2D6',
        minimumRoll: 2,
        maximumRoll: 12,
        players,
        currentPlayerIndex: 0,
        autoAdvancePlayer: autoAdvance,
        startedAt: new Date().toISOString(),
        status: 'active',
        winnerPlayerId: undefined,
        placements: [],
        settings: {
          recordIndividualDice: true,
          trackWinner,
          trackPlacements,
          catanRobberTracking: robberTracking,
          catanResourceTracking: detailed,
        },
        schemaVersion: SCHEMA_VERSION,
      };

      await startSession(session);
      // Navigate to exposure setup — session is now in context
      if (detailed) {
        router.navigate('/catan-exposure-detailed' as any);
      } else {
        router.navigate('/catan-exposure-quick' as any);
      }
    } catch (err) {
      Alert.alert('Error', 'Could not start game. Please try again.');
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + webBottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Disclaimer ──────────────────────────────────────────────────── */}
        <View style={[styles.disclaimer, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Ionicons name="information-circle-outline" size={14} color={colors.mutedForeground} />
          <Text style={[styles.disclaimerText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {DISCLAIMER}
          </Text>
        </View>

        {/* ── Players ──────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <SectionLabel text="PLAYERS" colors={colors} />
            <Stepper
              value={playerCount}
              min={3}
              max={6}
              onDecrement={() => { haptic(); setPlayerCount(c => Math.max(3, c - 1)); }}
              onIncrement={() => { haptic(); setPlayerCount(c => Math.min(6, c + 1)); }}
              colors={colors}
            />
          </View>
          <View style={styles.playerList}>
            {Array.from({ length: playerCount }, (_, i) => (
              <View key={i} style={[styles.playerRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <TouchableOpacity
                  style={[styles.colorDot, { backgroundColor: playerConfigs[i]!.color }]}
                  onPress={() => cyclePlayerColor(i)}
                  hitSlop={8}
                >
                  <Ionicons name="swap-horizontal" size={11} color="rgba(255,255,255,0.7)" />
                </TouchableOpacity>
                <TextInput
                  style={[styles.playerNameInput, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}
                  value={playerConfigs[i]!.name}
                  onChangeText={name => updatePlayerName(i, name)}
                  placeholder={`Player ${i + 1}`}
                  placeholderTextColor={colors.mutedForeground}
                  returnKeyType="done"
                  maxLength={24}
                  selectTextOnFocus
                />
              </View>
            ))}
          </View>
        </View>

        {/* ── Options ──────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionLabel text="OPTIONS" colors={colors} />
          <View style={[styles.optionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <OptionRow
              title="Auto-advance player"
              desc="Move to the next player after each roll"
              value={autoAdvance}
              onChange={v => { haptic(); setAutoAdvance(v); }}
              colors={colors}
            />
            <OptionDivider colors={colors} />
            <OptionRow
              title="Track winner"
              desc="Record the final game winner"
              value={trackWinner}
              onChange={v => { haptic(); setTrackWinner(v); }}
              colors={colors}
            />
            <OptionDivider colors={colors} />
            <OptionRow
              title="Track placements"
              desc="Record 2nd, 3rd place finishers too"
              value={trackPlacements}
              onChange={v => { haptic(); setTrackPlacements(v); }}
              colors={colors}
            />
            <OptionDivider colors={colors} />
            <OptionRow
              title="Robber prompt on 7"
              desc="Show a quick log prompt whenever a 7 is rolled"
              value={robberTracking}
              onChange={v => { haptic(); setRobberTracking(v); }}
              colors={colors}
            />
          </View>
        </View>

        {/* ── Tracking mode choice ─────────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionLabel text="TRACKING MODE" colors={colors} />

          {/* Quick Setup */}
          <TouchableOpacity
            style={[
              styles.trackCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.primary,
                marginBottom: 10,
                opacity: isStarting ? 0.7 : 1,
              },
            ]}
            onPress={() => createAndNavigate(false)}
            disabled={isStarting}
            activeOpacity={0.85}
          >
            <View style={[styles.trackIcon, { backgroundColor: colors.primary + '20' }]}>
              <Ionicons name="flash-outline" size={28} color={colors.primary} />
            </View>
            <View style={styles.trackContent}>
              <Text style={[styles.trackTitle, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>
                {isStarting ? 'Starting…' : 'Quick Setup'}
              </Text>
              <Text style={[styles.trackDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                Tap numbers per settlement. Fast exposure setup, production tracking, robber log.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.primary} />
          </TouchableOpacity>

          {/* Detailed Setup */}
          <TouchableOpacity
            style={[
              styles.trackCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: isStarting ? 0.7 : 1,
              },
            ]}
            onPress={() => createAndNavigate(true)}
            disabled={isStarting}
            activeOpacity={0.85}
          >
            <View style={[styles.trackIcon, { backgroundColor: colors.muted }]}>
              <Ionicons name="grid-outline" size={28} color={colors.mutedForeground} />
            </View>
            <View style={styles.trackContent}>
              <Text style={[styles.trackTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                Detailed Setup
              </Text>
              <Text style={[styles.trackDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                Add resource types and location identifiers. Best for deep production analysis.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Inline helpers ───────────────────────────────────────────────────────────

function OptionRow({
  title, desc, value, onChange, colors,
}: {
  title: string; desc: string; value: boolean; onChange: (v: boolean) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.optionRow}>
      <View style={styles.optionText}>
        <Text style={[styles.optionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{title}</Text>
        <Text style={[styles.optionDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{desc}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#FFFFFF" />
    </View>
  );
}

function OptionDivider({ colors }: { colors: ReturnType<typeof useColors> }) {
  return <View style={[styles.optionDivider, { backgroundColor: colors.border }]} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: { padding: 20, gap: 0 },
  section: { marginBottom: 28 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },

  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 24,
  },
  disclaimerText: { flex: 1, fontSize: 12, lineHeight: 17 },

  playerList: { gap: 8 },
  playerRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 12 },
  colorDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  playerNameInput: { flex: 1, fontSize: 16, paddingVertical: 4 },

  optionCard: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  optionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontSize: 15 },
  optionDesc: { fontSize: 13, lineHeight: 18 },
  optionDivider: { height: 1, marginHorizontal: 16 },

  trackCard: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 14, borderWidth: 1.5, gap: 14 },
  trackIcon: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  trackContent: { flex: 1, gap: 4 },
  trackTitle: { fontSize: 17 },
  trackDesc: { fontSize: 13, lineHeight: 18 },
});
