/** A bottom sheet that asks "which player?". Lifted out of app/active-catan.tsx. */

import React from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useColors } from '@/hooks/useColors';
import type { Player } from '@/types/models';

import { styles } from './activeCatanStyles';

interface Props {
  visible: boolean;
  title: string;
  subtitle: string;
  players: readonly Player[];
  onPick: (playerId: string) => void;
  onClose: () => void;
}

export function PlayerPickerModal({ visible, title, subtitle, players, onPick, onClose }: Props) {
  const colors = useColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.robberSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.robberHandle} />
          <Text style={[styles.robberTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            {title}
          </Text>
          <Text style={[styles.robberSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {subtitle}
          </Text>
          {players.map(player => (
            <TouchableOpacity
              key={player.id}
              style={[styles.playerPickerRow, { backgroundColor: colors.muted, borderColor: colors.border }]}
              onPress={() => onPick(player.id)}
              activeOpacity={0.8}
            >
              <View style={[styles.playerPickerDot, { backgroundColor: player.color }]} />
              <Text style={[styles.playerPickerName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                {player.displayName}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.robberActionBtn, { backgroundColor: colors.muted, marginTop: 4 }]}
            onPress={onClose}
          >
            <Text style={[styles.robberActionText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
