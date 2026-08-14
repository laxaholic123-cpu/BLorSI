import React, { useEffect, useState } from 'react';
import {
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
  DICE_RANGES,
  PLAYER_COLORS,
  SCHEMA_VERSION,
  generateId,
} from '@/types/models';
import type { DiceMode, GameSession, Player } from '@/types/models';

// ─── Dice mode options ────────────────────────────────────────────────────────

interface ModeOption {
  mode: DiceMode;
  label: string;
  sub: string;
}

const MODES: ModeOption[] = [
  { mode: 'D4',  label: 'D4',  sub: '1–4'  },
  { mode: 'D6',  label: 'D6',  sub: '1–6'  },
  { mode: 'D8',  label: 'D8',  sub: '1–8'  },
  { mode: 'D10', label: 'D10', sub: '1–10' },
  { mode: 'D12', label: 'D12', sub: '1–12' },
  { mode: 'D20', label: 'D20', sub: '1–20' },
  { mode: '2D6', label: '2D6', sub: '2–12' },
];

// ─── Local helpers ────────────────────────────────────────────────────────────

interface PlayerConfig {
  name: string;
  color: string;
}

const defaultConfigs = (): PlayerConfig[] =>
  Array.from({ length: 8 }, (_, i) => ({
    name: `Player ${i + 1}`,
    color: PLAYER_COLORS[i] ?? PLAYER_COLORS[0],
  }));

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ label, colors }: { label: string; colors: ReturnType<typeof useColors> }) {
  return (
    <Text style={[sh.label, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
      {label}
    </Text>
  );
}
const sh = StyleSheet.create({ label: { fontSize: 11, letterSpacing: 1.2, marginBottom: 8, marginLeft: 2 } });

function Stepper({
  value,
  min,
  max,
  onDecrement,
  onIncrement,
  colors,
}: {
  value: number;
  min: number;
  max: number;
  onDecrement: () => void;
  onIncrement: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[step.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity
        style={[step.btn, { opacity: value <= min ? 0.35 : 1 }]}
        onPress={onDecrement}
        disabled={value <= min}
      >
        <Text style={[step.sym, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>−</Text>
      </TouchableOpacity>
      <Text style={[step.val, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{value}</Text>
      <TouchableOpacity
        style={[step.btn, { opacity: value >= max ? 0.35 : 1 }]}
        onPress={onIncrement}
        disabled={value >= max}
      >
        <Text style={[step.sym, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>+</Text>
      </TouchableOpacity>
    </View>
  );
}
const step = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, alignSelf: 'flex-start' },
  btn: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  sym: { fontSize: 24 },
  val: { fontSize: 22, minWidth: 48, textAlign: 'center' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function GeneralGameSetupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { startSession } = useGame();
  const { settings } = useSettings();

  const [gameName, setGameName] = useState('');
  // Initialise from saved settings; prefill effect below may override
  const [diceMode, setDiceMode] = useState<DiceMode>(() => settings.defaultDiceMode);
  const [playerCount, setPlayerCount] = useState(() => Math.min(Math.max(1, settings.defaultPlayerCount), 8));
  const [playerConfigs, setPlayerConfigs] = useState<PlayerConfig[]>(defaultConfigs);
  const [autoAdvance, setAutoAdvance] = useState(() => settings.defaultAutoAdvance);
  const [trackWinner, setTrackWinner] = useState(true);
  const [isStarting, setIsStarting] = useState(false);

  // Consume any saved prefill from "Duplicate Setup" — runs once on mount
  useEffect(() => {
    void (async () => {
      const prefill = await loadPrefillSession();
      if (!prefill || prefill.gameType === 'catan') return; // Catan prefill handled by catan.tsx
      await clearPrefillSession();
      // Normalise legacy dice modes (e.g. 'custom') that have since been removed
      const legacyDiceModeMap: Record<string, DiceMode> = { custom: '2D6' };
      const prefillMode = prefill.diceMode as string;
      const resolvedMode: DiceMode = legacyDiceModeMap[prefillMode] ?? (prefill.diceMode as DiceMode);
      if (prefill.diceMode) setDiceMode(resolvedMode);
      const pc = Math.min(Math.max(1, prefill.players.length), 8);
      setPlayerCount(pc);
      setAutoAdvance(prefill.autoAdvancePlayer);
      if (prefill.customGameName) setGameName(prefill.customGameName);
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
      next[i] = { ...next[i], name };
      return next;
    });

  const cyclePlayerColor = (i: number) => {
    haptic();
    setPlayerConfigs(prev => {
      const next = [...prev];
      const idx = PLAYER_COLORS.indexOf(next[i].color);
      next[i] = { ...next[i], color: PLAYER_COLORS[(idx + 1) % PLAYER_COLORS.length] };
      return next;
    });
  };

  const handleStart = async () => {
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

      const minRoll = DICE_RANGES[diceMode].min;
      const maxRoll = DICE_RANGES[diceMode].max;

      const session: GameSession = {
        id: generateId(),
        gameType: 'general',
        customGameName: gameName.trim() || undefined,
        diceMode,
        minimumRoll: minRoll,
        maximumRoll: maxRoll,
        players,
        currentPlayerIndex: 0,
        autoAdvancePlayer: autoAdvance,
        startedAt: new Date().toISOString(),
        status: 'active',
        winnerPlayerId: undefined,
        settings: {
          recordIndividualDice: diceMode === '2D6',
          trackWinner,
          catanDevCardTracking: false,
          catanRobberTracking: false,
          catanResourceTracking: false,
        },
        schemaVersion: SCHEMA_VERSION,
      };

      await startSession(session);
      router.navigate('/active-game');
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
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + webBottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Game name ───────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader label="GAME NAME (OPTIONAL)" colors={colors} />
          <TextInput
            style={[
              styles.nameInput,
              { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: 'Inter_400Regular' },
            ]}
            value={gameName}
            onChangeText={setGameName}
            placeholder="e.g. Friday night dice"
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="done"
            maxLength={60}
          />
        </View>

        {/* ── Dice mode ───────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader label="DICE MODE" colors={colors} />
          <View style={styles.modeGrid}>
            {MODES.map(m => {
              const selected = diceMode === m.mode;
              return (
                <TouchableOpacity
                  key={m.mode}
                  style={[
                    styles.modePill,
                    {
                      backgroundColor: selected ? colors.primary : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => { haptic(); setDiceMode(m.mode); }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.modePillLabel, { color: selected ? colors.primaryForeground : colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                    {m.label}
                  </Text>
                  <Text style={[styles.modePillSub, { color: selected ? colors.primaryForeground : colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                    {m.sub}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── Players ─────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <SectionHeader label="PLAYERS" colors={colors} />
            <Stepper
              value={playerCount}
              min={1}
              max={8}
              onDecrement={() => { haptic(); setPlayerCount(c => Math.max(1, c - 1)); }}
              onIncrement={() => { haptic(); setPlayerCount(c => Math.min(8, c + 1)); }}
              colors={colors}
            />
          </View>
          <View style={styles.playerList}>
            {Array.from({ length: playerCount }, (_, i) => (
              <View
                key={i}
                style={[styles.playerRow, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <TouchableOpacity
                  style={[styles.colorDot, { backgroundColor: playerConfigs[i].color }]}
                  onPress={() => cyclePlayerColor(i)}
                  hitSlop={8}
                >
                  <Ionicons name="swap-horizontal" size={11} color="rgba(255,255,255,0.7)" />
                </TouchableOpacity>
                <TextInput
                  style={[styles.playerNameInput, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}
                  value={playerConfigs[i].name}
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

        {/* ── Options ─────────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader label="OPTIONS" colors={colors} />
          <View style={[styles.optionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.optionRow}>
              <View style={styles.optionText}>
                <Text style={[styles.optionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  Auto-advance player
                </Text>
                <Text style={[styles.optionDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  Move to the next player after each roll
                </Text>
              </View>
              <Switch
                value={autoAdvance}
                onValueChange={v => { haptic(); setAutoAdvance(v); }}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#FFFFFF"
              />
            </View>
            <View style={[styles.optionDivider, { backgroundColor: colors.border }]} />
            <View style={styles.optionRow}>
              <View style={styles.optionText}>
                <Text style={[styles.optionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  Track winner
                </Text>
                <Text style={[styles.optionDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  Record the final game winner
                </Text>
              </View>
              <Switch
                value={trackWinner}
                onValueChange={v => { haptic(); setTrackWinner(v); }}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#FFFFFF"
              />
            </View>
          </View>
        </View>

        {/* ── Start button ─────────────────────────────────────── */}
        <TouchableOpacity
          style={[
            styles.startBtn,
            { backgroundColor: isStarting ? colors.accent : colors.primary },
          ]}
          onPress={handleStart}
          disabled={isStarting}
          activeOpacity={0.85}
          testID="start-game-button"
        >
          <Ionicons name="play" size={20} color="#FFFFFF" />
          <Text style={[styles.startBtnText, { color: '#FFFFFF', fontFamily: 'Inter_700Bold' }]}>
            {isStarting ? 'Starting…' : 'Start Game'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, gap: 0 },
  section: { marginBottom: 28 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },

  nameInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16 },

  modeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modePill: { width: '23%', borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center', gap: 2 },
  modePillLabel: { fontSize: 15 },
  modePillSub: { fontSize: 11 },

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

  startBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 19, borderRadius: 14 },
  startBtnText: { fontSize: 17 },
});
