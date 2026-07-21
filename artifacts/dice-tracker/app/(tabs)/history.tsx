import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const webTop = Platform.OS === 'web' ? 67 : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + webTop + 20,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Text
          style={[
            styles.title,
            { color: colors.foreground, fontFamily: 'Inter_700Bold' },
          ]}
        >
          History
        </Text>
      </View>

      <View style={styles.emptyState}>
        <View style={[styles.emptyIconWrap, { backgroundColor: colors.card }]}>
          <Ionicons name="time-outline" size={40} color={colors.mutedForeground} />
        </View>
        <Text
          style={[
            styles.emptyTitle,
            { color: colors.foreground, fontFamily: 'Inter_600SemiBold' },
          ]}
        >
          No games yet
        </Text>
        <Text
          style={[
            styles.emptyBody,
            { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
          ]}
        >
          Completed and in-progress games will appear here. Start a game from the Home tab.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  title: { fontSize: 28 },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 12,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 18 },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 22, maxWidth: 280 },
});
