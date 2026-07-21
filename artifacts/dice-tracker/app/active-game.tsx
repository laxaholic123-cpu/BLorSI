/**
 * Active Game Screen — Phase 2
 *
 * The number-button interface, roll recording, player advancement, undo/correction,
 * and live session display are built in Phase 2.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useGame } from '@/context/GameContext';

export default function ActiveGameScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeSession } = useGame();

  if (!activeSession) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.mutedForeground} />
          <Text style={[styles.errorText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            No active session. Return to Home.
          </Text>
          <TouchableOpacity onPress={() => router.replace('/')} style={[styles.homeButton, { backgroundColor: colors.primary }]}>
            <Text style={[styles.homeButtonText, { color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }]}>
              Go Home
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.center}>
        <Ionicons name="dice-outline" size={56} color={colors.primary} />
        <Text style={[styles.gameName, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          {activeSession.customGameName ?? activeSession.gameType.toUpperCase()}
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          Active game — full roll entry interface coming in Phase 2.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backButton, { borderColor: colors.border }]}
        >
          <Ionicons name="arrow-back" size={18} color={colors.foreground} />
          <Text style={[styles.backText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
            Back to Home
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  gameName: { fontSize: 24 },
  subtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  errorText: { fontSize: 15, textAlign: 'center' },
  homeButton: { paddingHorizontal: 28, paddingVertical: 14, borderRadius: 12, marginTop: 8 },
  homeButtonText: { fontSize: 16 },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, borderWidth: 1, marginTop: 8 },
  backText: { fontSize: 15 },
});
