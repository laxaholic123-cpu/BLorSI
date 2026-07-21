import React from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

const GAME_MODES = [
  {
    id: 'general',
    title: 'General Dice Game',
    description: 'D4, D6, D8, D10, D12, D20, 2D6 totals, or a custom range. Supports 1–8 players.',
    icon: 'dice-outline' as const,
    route: '/new-game/general',
    badge: null as string | null,
  },
  {
    id: 'catan',
    title: 'Catan-Compatible Mode',
    description:
      'Two-dice resource game with number exposure tracking, robber events, and per-player production analysis.',
    icon: 'grid-outline' as const,
    route: '/new-game/catan',
    badge: 'Independent tool · not affiliated with Catan',
  },
  {
    id: 'custom',
    title: 'Custom Game',
    description: 'Define your own game name, dice range, and player setup.',
    icon: 'construct-outline' as const,
    route: '/new-game/custom',
    badge: null,
  },
];

export default function NewGameIndexScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const webTop = Platform.OS === 'web' ? 67 : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Custom header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + webTop + 16,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.closeButton}
          hitSlop={8}
          testID="close-new-game"
        >
          <Ionicons name="close" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text
          style={[
            styles.headerTitle,
            { color: colors.foreground, fontFamily: 'Inter_700Bold' },
          ]}
        >
          New Game
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text
          style={[
            styles.sectionLabel,
            { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' },
          ]}
        >
          SELECT GAME TYPE
        </Text>

        {GAME_MODES.map((mode) => (
          <TouchableOpacity
            key={mode.id}
            style={[
              styles.modeCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            onPress={() => router.push(mode.route as Parameters<typeof router.push>[0])}
            activeOpacity={0.82}
            testID={`game-mode-${mode.id}`}
          >
            <View
              style={[styles.iconContainer, { backgroundColor: colors.secondary }]}
            >
              <Ionicons name={mode.icon} size={26} color={colors.primary} />
            </View>
            <View style={styles.modeContent}>
              <Text
                style={[
                  styles.modeTitle,
                  { color: colors.foreground, fontFamily: 'Inter_600SemiBold' },
                ]}
              >
                {mode.title}
              </Text>
              <Text
                style={[
                  styles.modeDescription,
                  { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
                ]}
              >
                {mode.description}
              </Text>
              {mode.badge ? (
                <View style={[styles.badge, { backgroundColor: colors.muted }]}>
                  <Text
                    style={[
                      styles.badgeText,
                      { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
                    ]}
                  >
                    {mode.badge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={colors.mutedForeground}
            />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    textAlign: 'center',
  },
  headerSpacer: { width: 36 },
  content: { padding: 20, gap: 14 },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 1.2,
    marginBottom: 4,
    marginLeft: 4,
  },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    gap: 14,
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  modeContent: { flex: 1, gap: 4 },
  modeTitle: { fontSize: 16 },
  modeDescription: { fontSize: 13, lineHeight: 18 },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 4,
  },
  badgeText: { fontSize: 11 },
});
