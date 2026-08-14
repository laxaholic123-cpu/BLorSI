import React, { useState } from 'react';
import {
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
import { DICE_RANGES, PLAYER_COLORS, SCHEMA_VERSION, generateId } from '@/types/models';
import type { DiceMode, GameSession, Player } from '@/types/models';

const MODES: { mode: DiceMode; label: string; sub: string }[] = [
  { mode: 'D4',     label: 'D4',     sub: '1–4'   },
  { mode: 'D6',     label: 'D6',     sub: '1–6'   },
  { mode: 'D8',     label: 'D8',     sub: '1–8'   },
  { mode: 'D10',    label: 'D10',    sub: '1–10'  },
  { mode: 'D12',    label: 'D12',    sub: '1–12'  },
  { mode: 'D20',    label: 'D20',    sub: '1–20'  },
  { mode: '2D6',    label: '2D6',    sub: '2–12'  },
];

export default function QuickGameScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { startSession } = useGame();
  const { settings } = useSettings();

  // Guard against legacy stored values (e.g. 'custom') that are no longer valid
  const [diceMode, setDiceMode] = useState<DiceMode>(() =>
    (settings.defaultDiceMode as string) === 'custom' ? '2D6' : settings.defaultDiceMode
  );
  const [playerCount, setPlayerCount] = useState(() =>
    Math.min(Math.max(1, settings.defaultPlayerCount), 8)
  );
  const [isStarting, setIsStarting] = useState(false);

  const webTop = Platform.OS === 'web' ? 67 : 0;
  const webBottom = Platform.OS === 'web' ? 34 : 0;

  const haptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    if (settings.hapticsEnabled) void Haptics.impactAsync(style);
  };

  const handleStart = async () => {
    if (isStarting) return;
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    setIsStarting(true);
    try {
      const players: Player[] = Array.from({ length: playerCount }, (_, i) => ({
        id: generateId(),
        displayName: `Player ${i + 1}`,
        color: PLAYER_COLORS[i] ?? PLAYER_COLORS[0],
        seatNumber: i + 1,
        createdAt: new Date().toISOString(),
      }));

      const session: GameSession = {
        id: generateId(),
        gameType: 'general',
        diceMode,
        minimumRoll: DICE_RANGES[diceMode].min,
        maximumRoll: DICE_RANGES[diceMode].max,
        players,
        currentPlayerIndex: 0,
        autoAdvancePlayer: playerCount > 1,
        startedAt: new Date().toISOString(),
        status: 'active',
        winnerPlayerId: undefined,
        settings: {
          recordIndividualDice: diceMode === '2D6',
          trackWinner: false,
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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + webTop + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} hitSlop={8} testID="close-quick-game">
          <Ionicons name="close" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          Quick Game
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + webBottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Dice mode */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
            DICE MODE
          </Text>
          <View style={styles.modeGrid}>
            {MODES.map(m => {
              const selected = diceMode === m.mode;
              return (
                <TouchableOpacity
                  key={m.mode}
                  style={[
                    styles.modeTile,
                    {
                      backgroundColor: selected ? colors.primary : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => { haptic(); setDiceMode(m.mode); }}
                  activeOpacity={0.8}
                  testID={`quick-mode-${m.mode}`}
                >
                  <Text style={[styles.modeTileLabel, { color: selected ? colors.primaryForeground : colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                    {m.label}
                  </Text>
                  <Text style={[styles.modeTileSub, { color: selected ? colors.primaryForeground : colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                    {m.sub}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Player count */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
            PLAYERS
          </Text>
          <View style={[styles.stepperRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.stepperBtn, { opacity: playerCount <= 1 ? 0.35 : 1 }]}
              onPress={() => { haptic(); setPlayerCount(c => Math.max(1, c - 1)); }}
              disabled={playerCount <= 1}
            >
              <Text style={[styles.stepperSym, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>−</Text>
            </TouchableOpacity>
            <View style={styles.stepperCenter}>
              <Text style={[styles.stepperCount, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                {playerCount}
              </Text>
              <Text style={[styles.stepperSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                {playerCount === 1 ? 'player' : 'players'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.stepperBtn, { opacity: playerCount >= 8 ? 0.35 : 1 }]}
              onPress={() => { haptic(); setPlayerCount(c => Math.min(8, c + 1)); }}
              disabled={playerCount >= 8}
            >
              <Text style={[styles.stepperSym, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>+</Text>
            </TouchableOpacity>
          </View>
          {playerCount > 1 && (
            <Text style={[styles.autoAdvanceNote, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Players will auto-advance after each roll
            </Text>
          )}
        </View>

        {/* Start button */}
        <TouchableOpacity
          style={[styles.startBtn, { backgroundColor: isStarting ? colors.accent : colors.primary }]}
          onPress={handleStart}
          disabled={isStarting}
          activeOpacity={0.85}
          testID="quick-start-button"
        >
          <Ionicons name="flash" size={22} color="#FFFFFF" />
          <Text style={[styles.startBtnText, { color: '#FFFFFF', fontFamily: 'Inter_700Bold' }]}>
            {isStarting ? 'Starting…' : 'Start Game'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1 },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, textAlign: 'center' },
  headerSpacer: { width: 36 },

  scroll: { padding: 24, gap: 0 },
  section: { marginBottom: 32 },
  sectionLabel: { fontSize: 11, letterSpacing: 1.2, marginBottom: 12 },

  modeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  modeTile: { width: '30%', borderWidth: 1, borderRadius: 14, paddingVertical: 16, alignItems: 'center', gap: 4 },
  modeTileLabel: { fontSize: 18 },
  modeTileSub: { fontSize: 12 },

  stepperRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  stepperBtn: { width: 64, height: 72, alignItems: 'center', justifyContent: 'center' },
  stepperSym: { fontSize: 28 },
  stepperCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stepperCount: { fontSize: 32 },
  stepperSub: { fontSize: 13, marginTop: 2 },
  autoAdvanceNote: { fontSize: 13, marginTop: 10, textAlign: 'center' },

  startBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 20, borderRadius: 16 },
  startBtnText: { fontSize: 18 },
});
