/**
 * Results Screen — Phase 3
 *
 * Full results display (verdict, distribution, player accolades, share cards)
 * is built in Phase 3.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export default function ResultsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.content}>
        <Ionicons name="trophy-outline" size={56} color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          Game Results
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          Full results — verdicts, distribution charts, player accolades, and share cards — coming in Phase 3.
        </Text>
        <TouchableOpacity
          onPress={() => router.replace('/')}
          style={[styles.homeButton, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.homeButtonText, { color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }]}>
            Back to Home
          </Text>
        </TouchableOpacity>
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
  title: { fontSize: 24 },
  subtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  homeButton: { paddingHorizontal: 28, paddingVertical: 14, borderRadius: 12, marginTop: 8 },
  homeButtonText: { fontSize: 16 },
});
