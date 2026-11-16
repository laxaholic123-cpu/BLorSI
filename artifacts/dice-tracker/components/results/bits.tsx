/** Small presentational pieces shared by the results sections. */

import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { useColors } from '@/hooks/useColors';

import { styles } from './styles';

type Colors = ReturnType<typeof useColors>;

export function SectionLabel({ text, colors }: { text: string; colors: Colors }) {
  return (
    <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
      {text}
    </Text>
  );
}

export function StatBox({ label, value, colors }: { label: string; value: string; colors: Colors }) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statBoxValue, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{value}</Text>
      <Text style={[styles.statBoxLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{label}</Text>
    </View>
  );
}

export function Chip({
  icon,
  label,
  colors,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  colors: Colors;
}) {
  return (
    <View style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Ionicons name={icon} size={13} color={colors.mutedForeground} />
      <Text style={[styles.chipText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
        {label}
      </Text>
    </View>
  );
}
