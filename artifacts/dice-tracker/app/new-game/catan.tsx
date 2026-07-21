/**
 * Settlement Mode Setup — Phase 4
 *
 * Full implementation is built in Phase 4. This placeholder confirms the route exists.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export default function CatanGameSetupScreen() {
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
        <Ionicons name="grid-outline" size={56} color={colors.primary} />
        <Text
          style={[
            styles.title,
            { color: colors.foreground, fontFamily: 'Inter_700Bold' },
          ]}
        >
          Settlement Mode
        </Text>
        <Text
          style={[
            styles.subtitle,
            { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
          ]}
        >
          Number exposure tracking, robber events, and production analysis — coming in Phase 4.
        </Text>
        <View style={[styles.badge, { backgroundColor: colors.muted }]}>
          <Text
            style={[
              styles.badgeText,
              { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' },
            ]}
          >
            Coming in Phase 4
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
  disclaimer: { fontSize: 11, textAlign: 'center', lineHeight: 16, marginTop: 16, opacity: 0.7 },
});
