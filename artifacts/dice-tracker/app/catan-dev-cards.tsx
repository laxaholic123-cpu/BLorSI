/**
 * Development card entry — filled in AFTER the game, not during it.
 *
 * WHY END OF GAME
 * ---------------
 * Which development cards a player holds is hidden information, and the whole
 * point of a victory point card is that nobody knows you have it. Recording
 * draws live on a phone that gets passed around leaks exactly that: anyone
 * watching a player tap "Victory Point" learns something the game intends them
 * not to know. A companion tool must not change the game it is measuring.
 *
 * Nothing is lost by waiting. Dealing without replacement is exchangeable — given
 * how many cards each player drew, the joint distribution of their hands is
 * identical no matter who drew when — so the statistics depend only on the final
 * counts, never on the order. End-of-game entry is also more accurate than live
 * tapping, because played knights sit face up on the table and victory point
 * cards get revealed when the game ends: players are reading their cards rather
 * than remembering them.
 *
 * This tool is not affiliated with or endorsed by the publishers or owners of Catan.
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
import { generateId } from '@/types/models';
import type { CatanDevCardEvent, CatanDevCardType } from '@/types/models';
import {
  DEV_CARD_LABELS,
  DEV_CARD_TYPES,
  DEV_DECK_COMPOSITION,
  DEV_DECK_SIZE,
  countsForPlayer,
} from '@/services/devCards';

type CountsByPlayer = Record<string, Record<CatanDevCardType, number>>;

const emptyCounts = (): Record<CatanDevCardType, number> => ({
  knight: 0,
  victoryPoint: 0,
  roadBuilding: 0,
  yearOfPlenty: 0,
  monopoly: 0,
});

export default function CatanDevCardsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeSession, devCardEvents, persistDevCardEvents } = useGame();
  const { settings } = useSettings();
  const webTop = Platform.OS === 'web' ? 67 : 0;
  const webBottom = Platform.OS === 'web' ? 34 : 0;

  // Seed from anything already recorded so re-opening the screen edits rather
  // than starts over.
  const [counts, setCounts] = useState<CountsByPlayer>(() => {
    const initial: CountsByPlayer = {};
    for (const player of activeSession?.players ?? []) {
      const existing = countsForPlayer(player.id, devCardEvents);
      initial[player.id] = {
        knight: existing.knight,
        victoryPoint: existing.victoryPoint,
        roadBuilding: existing.roadBuilding,
        yearOfPlenty: existing.yearOfPlenty,
        monopoly: existing.monopoly,
      };
    }
    return initial;
  });
  const [isSaving, setIsSaving] = useState(false);

  const haptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    if (settings.hapticsEnabled) void Haptics.impactAsync(style);
  };

  /** Totals drawn per card type across every player. */
  const drawnByType = useMemo(() => {
    const totals = emptyCounts();
    for (const perPlayer of Object.values(counts)) {
      for (const type of DEV_CARD_TYPES) totals[type] += perPlayer[type];
    }
    return totals;
  }, [counts]);

  const totalDrawn = useMemo(
    () => DEV_CARD_TYPES.reduce((sum, type) => sum + drawnByType[type], 0),
    [drawnByType],
  );

  const adjust = (playerId: string, type: CatanDevCardType, delta: number) => {
    // The deck is the hard limit: you cannot draw a fifteenth knight.
    if (delta > 0 && drawnByType[type] >= DEV_DECK_COMPOSITION[type]) {
      haptic(Haptics.ImpactFeedbackStyle.Heavy);
      return;
    }
    haptic();
    setCounts(prev => {
      const forPlayer = prev[playerId] ?? emptyCounts();
      const next = Math.max(0, forPlayer[type] + delta);
      return { ...prev, [playerId]: { ...forPlayer, [type]: next } };
    });
  };

  const handleSave = async () => {
    if (!activeSession || isSaving) return;
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    setIsSaving(true);

    // Rebuild the event log from the entered counts. Order carries no
    // statistical meaning (see the note at the top), so a stable synthetic
    // sequence is enough to keep the log well-formed.
    const events: CatanDevCardEvent[] = [];
    let sequence = 0;
    const timestamp = new Date().toISOString();
    for (const player of activeSession.players) {
      const perPlayer = counts[player.id] ?? emptyCounts();
      for (const type of DEV_CARD_TYPES) {
        for (let i = 0; i < perPlayer[type]; i++) {
          sequence += 1;
          events.push({
            id: generateId(),
            sessionId: activeSession.id,
            playerId: player.id,
            cardType: type,
            turnNumber: 0,
            sequenceNumber: sequence,
            timestamp,
          });
        }
      }
    }

    try {
      await persistDevCardEvents(activeSession.id, events);
      router.back();
    } catch {
      Alert.alert(
        'Could not save',
        'The development cards could not be written to storage. Try again, or skip — the rest of your results are unaffected.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (!activeSession) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          No active game
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + webTop }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="close" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          Development Cards
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + webBottom + 24 }]}>
        <Text style={[styles.intro, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          Now that the game is over, count each player&apos;s cards — played knights are
          face up, and victory points are revealed. Nothing was recorded during play, so
          nobody&apos;s hand was ever on screen.
        </Text>
        <Text style={[styles.deckLine, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
          {totalDrawn} of {DEV_DECK_SIZE} cards drawn
        </Text>

        {activeSession.players.map(player => {
          const perPlayer = counts[player.id] ?? emptyCounts();
          const playerTotal = DEV_CARD_TYPES.reduce((s, t) => s + perPlayer[t], 0);
          return (
            <View
              key={player.id}
              style={[
                styles.playerCard,
                { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: player.color },
              ]}
            >
              <View style={styles.playerHeader}>
                <Text style={[styles.playerName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  {player.displayName}
                </Text>
                <Text style={[styles.playerTotal, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  {playerTotal} card{playerTotal === 1 ? '' : 's'}
                </Text>
              </View>

              {DEV_CARD_TYPES.map(type => {
                const remaining = DEV_DECK_COMPOSITION[type] - drawnByType[type];
                return (
                  <View key={type} style={styles.cardRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cardLabel, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
                        {DEV_CARD_LABELS[type]}
                      </Text>
                      <Text style={[styles.cardRemaining, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                        {remaining} left in deck
                      </Text>
                    </View>
                    <View style={[styles.stepper, { borderColor: colors.border }]}>
                      <TouchableOpacity
                        style={[styles.stepBtn, { opacity: perPlayer[type] <= 0 ? 0.35 : 1 }]}
                        onPress={() => adjust(player.id, type, -1)}
                        disabled={perPlayer[type] <= 0}
                        hitSlop={6}
                      >
                        <Text style={[styles.stepSym, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>−</Text>
                      </TouchableOpacity>
                      <Text style={[styles.stepVal, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                        {perPlayer[type]}
                      </Text>
                      <TouchableOpacity
                        style={[styles.stepBtn, { opacity: remaining <= 0 ? 0.35 : 1 }]}
                        onPress={() => adjust(player.id, type, 1)}
                        disabled={remaining <= 0}
                        hitSlop={6}
                      >
                        <Text style={[styles.stepSym, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          );
        })}

        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: isSaving ? 0.6 : 1 }]}
          onPress={() => void handleSave()}
          disabled={isSaving}
          activeOpacity={0.85}
        >
          <Text style={[styles.saveBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }]}>
            {isSaving ? 'Saving…' : 'Save'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.skipBtn} onPress={() => router.back()}>
          <Text style={[styles.skipBtnText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
            Skip — don&apos;t track cards for this game
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 15 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17 },
  scroll: { padding: 16, gap: 12 },
  intro: { fontSize: 13, lineHeight: 19 },
  deckLine: { fontSize: 12, letterSpacing: 0.3 },
  playerCard: { borderWidth: 1, borderLeftWidth: 4, borderRadius: 12, padding: 12, gap: 4 },
  playerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  playerName: { fontSize: 15 },
  playerTotal: { fontSize: 12 },
  cardRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  cardLabel: { fontSize: 14 },
  cardRemaining: { fontSize: 11 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10 },
  stepBtn: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  stepSym: { fontSize: 18 },
  stepVal: { fontSize: 16, minWidth: 28, textAlign: 'center' },
  saveBtn: { borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  saveBtnText: { fontSize: 16 },
  skipBtn: { paddingVertical: 12, alignItems: 'center' },
  skipBtnText: { fontSize: 13 },
});
