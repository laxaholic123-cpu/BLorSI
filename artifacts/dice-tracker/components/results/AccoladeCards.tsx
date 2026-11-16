/**
 * "THE TABLE": one accolade card per player. Opening a card shows the answers
 * to the end-of-game questions (the one that accolade raises first) and the
 * whole ranking behind the badge.
 *
 * Lifted out of app/results.tsx; owns only which card is open.
 */

import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { useColors } from '@/hooks/useColors';
import type { Accolade } from '@/services/catanAccolades';
import { orderForAccolade, type AnsweredQuestion } from '@/services/gameQuestions';
import type { Player } from '@/types/models';

import { SectionLabel } from './bits';
import { styles } from './styles';

interface Props {
  accolades: readonly Accolade[];
  players: readonly Player[];
  answers: ReadonlyMap<string, AnsweredQuestion[]>;
}

export function AccoladeCards({ accolades, players, answers }: Props) {
  const colors = useColors();
  const [openAccolade, setOpenAccolade] = useState<string | null>(null);
  if (accolades.length === 0) return null;
  return (
    <>
      <SectionLabel text="THE TABLE" colors={colors} />
      <View style={{ gap: 8 }}>
        {accolades.map(a => {
          const player = players.find(p => p.id === a.playerId);
          const tint = player?.color ?? colors.primary;
          return (
            <TouchableOpacity
              key={a.playerId}
              activeOpacity={0.85}
              onPress={() => setOpenAccolade(prev => (prev === a.playerId ? null : a.playerId))}
              accessibilityRole="button"
              accessibilityLabel={`${a.title}. ${a.detail} Tap for the full table.`}
              style={[styles.accoladeCard, {
                backgroundColor: colors.muted,
                borderColor: colors.border,
                borderLeftColor: tint,
              }]}
            >
              <View style={styles.accoladeHead}>
                <View style={[styles.accoladeDot, { backgroundColor: tint }]} />
                <Text style={[styles.accoladeName, {
                  color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
                  {player?.displayName ?? 'Player'}
                </Text>
                <Text style={[styles.accoladeRank, {
                  color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  {a.rank}/{a.outOf}
                </Text>
              </View>
              <Text style={[styles.accoladeTitle, {
                color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                {a.title}
              </Text>
              <Text style={[styles.accoladeDetail, {
                color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                {a.detail}
              </Text>

              {/* The whole table on this axis, so the badge can be
                  checked rather than taken on faith. A rank with no
                  way to see the other places is a horoscope with a
                  number in it. */}
              {openAccolade === a.playerId ? (
                <View style={styles.accoladeBreakdown}>
                  {orderForAccolade(a.kind, answers.get(a.playerId) ?? []).map(q => (
                    <View key={q.key} style={styles.questionBlock}>
                      <Text style={[styles.questionText, {
                        color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
                        {q.question}
                      </Text>
                      <Text style={[styles.answerText, {
                        color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
                        {q.answer}
                      </Text>
                    </View>
                  ))}
                  {a.breakdown.map(row => (
                    <View key={row.displayName + row.rank} style={styles.exposureRow}>
                      <Text style={[styles.exposureNum, {
                        color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                        {row.rank}
                      </Text>
                      <Text
                        style={[styles.exposureWeight, {
                          color: row.isYou ? colors.foreground : colors.mutedForeground,
                          fontFamily: row.isYou ? 'Inter_700Bold' : 'Inter_400Regular',
                        }]}
                        numberOfLines={1}
                      >
                        {row.displayName}
                      </Text>
                      <Text style={[styles.exposureCount, {
                        color: row.isYou ? colors.foreground : colors.mutedForeground,
                        fontFamily: 'Inter_500Medium',
                      }]}>
                        {Number.isInteger(row.value) ? row.value : row.value.toFixed(2)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={[styles.verdictNote, {
                  color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  Tap for the whole table and questions about your game
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </>
  );
}
