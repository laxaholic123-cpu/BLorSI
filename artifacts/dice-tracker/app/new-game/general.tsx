/**
 * General Game Setup — Phase 2
 *
 * Full implementation (player names, colors, dice mode, auto-advance, etc.)
 * is built in Phase 2. This placeholder confirms the route exists.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export default function GeneralGameSetupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingBottom: insets.bottom + 24 },
      ]}
    >
      <View style={styles.content}>
        <Ionicons name="dice-outline" size={56} color={colors.primary} />
        <Text
          style={[
            styles.title,
            { color: colors.foreground, fontFamily: 'Inter_700Bold' },
          ]}
        >
          General Dice Game
        </Text>
        <Text
          style={[
            styles.subtitle,
            { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
          ]}
        >
          Full game setup — player names, colors, dice mode, and more — is coming in Phase 2.
        </Text>
        <View style={[styles.badge, { backgroundColor: colors.muted }]}>
          <Text
            style={[
              styles.badgeText,
              { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' },
            ]}
          >
            Coming in Phase 2
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  title: { fontSize: 22 },
  subtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  badge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 8,
  },
  badgeText: { fontSize: 14 },
});
