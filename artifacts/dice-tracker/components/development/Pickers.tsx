/** The player list and number pad of the build menu. Lifted out of app/catan-development.tsx. */

import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useColors } from '@/hooks/useColors';
import { CATAN_NUMBERS, CATAN_PIPS } from '@/services/catanStats';
import type { Player } from '@/types/models';

import { styles } from './styles';

export function PlayerSelector({
  players, selectedId, onSelect,
}: {
  players: readonly Player[];
  selectedId: string | null;
  /** Null when the selected player is tapped again. */
  onSelect: (playerId: string | null) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.subsection}>
      <Text style={[styles.subLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>SELECT PLAYER</Text>
      {players.map(player => {
        const selected = selectedId === player.id;
        return (
          <TouchableOpacity
            key={player.id}
            style={[styles.playerBtn, {
              backgroundColor: selected ? player.color + '22' : colors.card,
              borderColor: selected ? player.color : colors.border,
            }]}
            onPress={() => onSelect(selected ? null : player.id)}
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
}

export function NumberPicker({
  label, selected, onToggle,
}: {
  label: string;
  selected: readonly number[];
  onToggle: (num: number) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.subsection}>
      <Text style={[styles.subLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>{label}</Text>
      <View style={styles.numGrid}>
        {CATAN_NUMBERS.map(num => {
          const on = selected.includes(num);
          return (
            <TouchableOpacity
              key={num}
              style={[styles.numBtn, {
                backgroundColor: on ? colors.primary : colors.card,
                borderColor: on ? colors.primary : colors.border,
              }]}
              onPress={() => onToggle(num)}
            >
              <Text style={[styles.numBtnValue, { color: on ? colors.primaryForeground : colors.foreground, fontFamily: 'Inter_700Bold' }]}>{num}</Text>
              <Text style={[styles.numBtnPips, { color: on ? colors.primaryForeground : colors.mutedForeground }]}>{'·'.repeat(CATAN_PIPS[num] ?? 1)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
