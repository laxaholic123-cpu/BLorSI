/**
 * The accolades, one player at a time, before the numbers.
 *
 * WHY THIS IS A SEPARATE PHASE
 * ----------------------------
 * Every accolade already existed on the results screen, in a list, below a
 * distribution chart and two tables. That is the right place to KEEP them and
 * the wrong place to first SEE them: the moment a game ends, the table is
 * still looking at each other, and the interesting output is a different
 * sentence about each person. A list gets skimmed by whoever is holding the
 * phone; a sequence gets read out.
 *
 * So this runs through the table once, one card per player, and then hands
 * over to the full report. It adds no new claim — every line here is already
 * on the screen behind it — it only changes the order and the pace.
 *
 * Two things it deliberately does not do:
 *
 *   - It never blocks. Skip is always visible and always one tap, because the
 *     person holding the phone may just want the numbers, and a ceremony you
 *     cannot leave stops being a nice moment on the second game.
 *   - It adds no superlative the data does not support. The flair is timing
 *     and colour, not adjectives — the honesty rules in `catanAccolades` and
 *     `exposureReport` still hold, and a rank is still stated as a rank.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useColors } from '@/hooks/useColors';
import type { Accolade } from '@/services/catanAccolades';
import type { PlayerExposureReport } from '@/services/exposureReport';
import { describeExposure } from '@/services/exposureReport';
import type { Player } from '@/types/models';

export interface AccoladeRevealProps {
  accolades: readonly Accolade[];
  players: readonly Player[];
  /** Optional: the one-line exposure summary, shown under the badge. */
  exposure?: readonly PlayerExposureReport[];
  /** Winner gets a crown, when the game tracked one. */
  winnerPlayerId?: string | null;
  reducedMotion?: boolean;
  onDone: () => void;
}

export function AccoladeReveal({
  accolades,
  players,
  exposure,
  winnerPlayerId,
  reducedMotion = false,
  onDone,
}: AccoladeRevealProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);

  const current = accolades[index];
  const player = players.find(p => p.id === current?.playerId);
  const tint = player?.color ?? colors.primary;
  const report = exposure?.find(r => r.playerId === current?.playerId);
  const isLast = index >= accolades.length - 1;

  // One animation pair, restarted per card rather than one per card, so the
  // number of hooks cannot depend on how many players are at the table.
  const opacity = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  const lift = useRef(new Animated.Value(reducedMotion ? 0 : 18)).current;

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(1);
      lift.setValue(0);
      return;
    }
    opacity.setValue(0);
    lift.setValue(18);
    const anim = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      Animated.timing(lift, {
        toValue: 0, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [index, reducedMotion, opacity, lift]);

  if (!current) {
    // Nothing to reveal — hand straight over rather than showing an empty stage.
    return null;
  }

  const advance = () => {
    if (isLast) onDone();
    else setIndex(i => i + 1);
  };

  return (
    <Pressable
      onPress={advance}
      style={[styles.stage, {
        backgroundColor: colors.background,
        paddingTop: insets.top + 12,
        paddingBottom: insets.bottom + 16,
      }]}
      accessibilityRole="button"
      accessibilityLabel={
        `${player?.displayName ?? 'Player'}: ${current.title}. ${current.detail} `
        + `Tap to ${isLast ? 'see the full results' : 'continue'}.`}
    >
      {/* Skip is always here, always one tap. */}
      <View style={styles.topRow}>
        <Text style={[styles.progress, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
          {index + 1} of {accolades.length}
        </Text>
        <Pressable onPress={onDone} hitSlop={12} accessibilityRole="button">
          <Text style={[styles.skip, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
            Skip
          </Text>
        </Pressable>
      </View>

      <Animated.View
        style={[styles.card, {
          opacity,
          transform: [{ translateY: lift }],
          borderColor: tint,
          backgroundColor: colors.card,
        }]}
      >
        <View style={[styles.ribbon, { backgroundColor: tint }]} />

        <View style={styles.nameRow}>
          <View style={[styles.dot, { backgroundColor: tint }]} />
          <Text style={[styles.name, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            {player?.displayName ?? 'Player'}
          </Text>
          {winnerPlayerId && winnerPlayerId === current.playerId && (
            <Ionicons name="trophy" size={18} color="#F0C24B" />
          )}
        </View>

        <Text style={[styles.title, { color: tint, fontFamily: 'Inter_700Bold' }]}>
          {current.title}
        </Text>

        <Text style={[styles.detail, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
          {current.detail}
        </Text>

        <Text style={[styles.rank, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
          {current.rank} of {current.outOf} at the table
        </Text>

        {report && (
          <Text style={[styles.exposure, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {describeExposure(report)}
          </Text>
        )}
      </Animated.View>

      <View style={styles.bottomRow}>
        <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          {isLast ? 'Tap for the full results' : 'Tap for the next player'}
        </Text>
        <View style={styles.pips}>
          {accolades.map((a, i) => (
            <View
              key={a.playerId}
              style={[styles.pip, {
                backgroundColor: i === index ? tint : colors.border,
                width: i === index ? 18 : 6,
              }]}
            />
          ))}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, paddingHorizontal: 20, justifyContent: 'space-between' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progress: { fontSize: 12 },
  skip: { fontSize: 14 },

  card: {
    borderWidth: 1, borderRadius: 18, padding: 22, gap: 10,
    overflow: 'hidden',
  },
  ribbon: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  name: { fontSize: 14, letterSpacing: 0.4, textTransform: 'uppercase' },
  title: { fontSize: 30, lineHeight: 35 },
  detail: { fontSize: 15, lineHeight: 21 },
  rank: { fontSize: 12 },
  exposure: { fontSize: 12, lineHeight: 17, marginTop: 4 },

  bottomRow: { alignItems: 'center', gap: 12 },
  hint: { fontSize: 12 },
  pips: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pip: { height: 6, borderRadius: 3 },
});
