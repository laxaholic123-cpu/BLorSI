/**
 * Every roll of the game, newest first, with a way to fix one that was entered
 * wrong.
 *
 * Undo only reaches the LAST roll. A mis-tap noticed three turns later could
 * not be fixed without undoing everything after it, and a wrong roll is not a
 * cosmetic problem here: it feeds straight into who was lucky. The correction
 * logic (`correctRoll`) had existed for a long time with nothing calling it.
 *
 * Self-contained: it owns which row is open and nothing else. The parent passes
 * the rolls and gets back "change roll X to value Y".
 */

import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useColors } from '@/hooks/useColors';
import type { Player, RollEvent } from '@/types/models';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** All roll events; deleted ones are filtered out here. */
  rollEvents: readonly RollEvent[];
  players: readonly Player[];
  minValue: number;
  maxValue: number;
  onCorrect: (eventId: string, newValue: number) => void;
}

export function RollHistoryModal({
  visible, onClose, rollEvents, players, minValue, maxValue, onCorrect,
}: Props) {
  const colors = useColors();
  const [openId, setOpenId] = useState<string | null>(null);

  const rolls = rollEvents
    .filter(r => !r.deletedAt)
    .sort((a, b) => b.sequenceNumber - a.sequenceNumber);
  const values: number[] = [];
  for (let v = minValue; v <= maxValue; v++) values.push(v);

  const close = () => {
    setOpenId(null);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.head}>
            <Text style={[styles.title, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              Rolls
            </Text>
            <TouchableOpacity onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Tap a roll to change what it was. Changing a roll to or from a 7 does not
            move the robber — use the Robber button for that.
          </Text>

          <ScrollView style={styles.list}>
            {rolls.length === 0 && (
              <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                Nothing rolled yet.
              </Text>
            )}
            {rolls.map(r => {
              const player = players.find(p => p.id === r.playerId);
              const open = openId === r.id;
              return (
                <View key={r.id} style={[styles.rowWrap, { borderBottomColor: colors.border }]}>
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => setOpenId(open ? null : r.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Roll of ${r.value} by ${player?.displayName ?? 'a player'}. Tap to change.`}
                  >
                    <View style={[styles.dot, { backgroundColor: player?.color ?? colors.mutedForeground }]} />
                    <Text
                      style={[styles.name, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}
                      numberOfLines={1}
                    >
                      {player?.displayName ?? 'Player'}
                    </Text>
                    <Text style={[styles.turn, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                      round {r.turnNumber}{r.source === 'corrected' ? ' · fixed' : ''}
                    </Text>
                    <Text style={[styles.value, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                      {r.value}
                    </Text>
                    <Ionicons
                      name={open ? 'chevron-up' : 'pencil-outline'}
                      size={16}
                      color={colors.mutedForeground}
                    />
                  </TouchableOpacity>
                  {open && (
                    <View style={styles.picker}>
                      {values.map(v => {
                        const current = v === r.value;
                        return (
                          <TouchableOpacity
                            key={v}
                            disabled={current}
                            onPress={() => {
                              onCorrect(r.id, v);
                              setOpenId(null);
                            }}
                            style={[styles.pick, {
                              backgroundColor: current ? colors.primary : colors.muted,
                              borderColor: current ? colors.primary : colors.border,
                            }]}
                            accessibilityRole="button"
                            accessibilityLabel={`Change to ${v}`}
                          >
                            <Text style={{
                              color: current ? colors.primaryForeground : colors.foreground,
                              fontFamily: 'Inter_600SemiBold',
                              fontSize: 15,
                            }}>
                              {v}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1,
    padding: 20, gap: 10, maxHeight: '80%',
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 20 },
  hint: { fontSize: 13, lineHeight: 18 },
  list: { flexGrow: 0 },
  rowWrap: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { fontSize: 15, flex: 1 },
  turn: { fontSize: 12 },
  value: { fontSize: 18, width: 30, textAlign: 'right' },
  picker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 12 },
  pick: {
    minWidth: 44, height: 44, borderRadius: 10, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8,
  },
});
