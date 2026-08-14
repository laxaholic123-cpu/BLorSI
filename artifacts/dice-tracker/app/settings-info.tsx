/**
 * Settings Info Modal — static info pages accessible from the Settings screen.
 *
 * Route: /settings-info?type=methodology|catan|privacy|about
 */

import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

type InfoType = 'methodology' | 'catan' | 'privacy' | 'about';

const CONTENT: Record<InfoType, { title: string; sections: Array<{ heading?: string; body: string }> }> = {
  methodology: {
    title: 'Statistical Methodology',
    sections: [
      {
        heading: 'How Verdicts Are Calculated',
        body: 'Skill Check computes a z-score for the mean roll value, comparing your observed average against the theoretical expected mean for the selected die. A z-score measures how many standard deviations your result falls from the expected value under the assumption of a fair die.',
      },
      {
        heading: 'Expected Values',
        body: 'For a standard N-sided die, the expected mean is (N+1)/2 and the expected standard deviation is √((N²-1)/12). For 2D6, the expected mean is 7.0 and the standard deviation is approximately 2.415.',
      },
      {
        heading: 'Verdict Thresholds',
        body: 'Verdicts are assigned based on the mean z-score:\n\n• |z| < 1: statistically normal\n• |z| 1–1.5: mild deviation\n• |z| 1.5–2: notable deviation\n• |z| > 2: significant deviation\n\nIn multiplayer games, the verdict reflects the combined roll distribution rather than any individual player\'s outcome.',
      },
      {
        heading: 'Small Sample Warning',
        body: 'With fewer than 30 rolls, verdicts are marked as preliminary. Statistical tests have low power at small sample sizes — a run of "bad luck" in 10 rolls is entirely expected under a fair die and carries no meaningful information.',
      },
      {
        heading: 'Limitations',
        body: 'Skill Check measures whether the observed roll distribution is consistent with a fair die. It cannot detect intentional cheating (controlled rolls, loaded dice, selective reporting). It also cannot measure or account for skill in games where decisions matter — it only analyzes the dice outcomes, not the choices made from them.',
      },
      {
        heading: 'Streak & Gap Analysis',
        body: 'Streaks count consecutive rolls of the same value. Gaps measure the longest run of rolls without a particular value appearing. Both are descriptive statistics — a streak of 4 is unusual but not extraordinary for a d6 over many rolls.',
      },
    ],
  },
  catan: {
    title: 'Catan Compatibility Notice',
    sections: [
      {
        body: 'This is an independent companion tool and is not affiliated with or endorsed by the publishers or owners of Catan, Catan GmbH, or any official Catan product or license.',
      },
      {
        heading: 'What "Settlement Mode" Tracks',
        body: 'Settlement Mode tracks dice roll frequency and — when settlement exposure is configured — compares actual production to statistically expected production based on the hex numbers each settlement is adjacent to.',
      },
      {
        heading: 'Production Weight',
        body: 'Each settlement has a production weight of 1. City upgrades have a weight of 2. A city on a "6" will produce twice as much weighted production as a settlement on a "6" when a 6 is rolled. City upgrade weights apply only from the turn of the upgrade forward — they are never retroactive.',
      },
      {
        heading: 'The Robber',
        body: 'When Robber Tracking is enabled, rolling a 7 triggers a prompt to log which player was robbed. This is optional. The app can track robber blocks but cannot verify that trades, resource theft, or card plays occurred as reported.',
      },
      {
        heading: 'What This Tool Cannot Measure',
        body: 'Settlement Mode measures dice luck and placement strength relative to the numbers rolled. Ports are recorded as placement context, but only which ports you sit on — not whether you traded through them. It cannot measure trading strategy, development card decisions, road placement, or any other non-dice element of the game. A verdict of "bad luck" reflects the dice, not the quality of play.',
      },
      {
        heading: 'Disclaimer',
        body: '"Catan" is a trademark of Catan GmbH. This tool is not affiliated with or endorsed by Catan GmbH, Asmodee, or any official publisher of Catan products.',
      },
    ],
  },
  privacy: {
    title: 'Privacy Summary',
    sections: [
      {
        heading: 'No Data Leaves Your Device',
        body: 'All game data — sessions, roll events, player names, settings — is stored locally on your device using AsyncStorage. Nothing is sent to any server. There is no user account, no analytics, and no network requests.',
      },
      {
        heading: 'What Is Stored Locally',
        body: '• Game sessions (players, dice mode, start/end times, status)\n• Roll events (value, player, timestamp, source)\n• Catan exposure events (settlement numbers, city upgrades, robber logs)\n• App settings (haptics, sound, theme preferences)\n• Active session ID (to resume games after app restart)',
      },
      {
        heading: 'Sharing',
        body: 'The Share feature generates text or image cards from your local session data and shares them via your device\'s native share sheet. You control what you share and with whom.',
      },
      {
        heading: 'Export & Import',
        body: 'The Export feature creates a JSON file of all your local data. The Import feature reads a previously exported JSON file and adds those sessions to your device. Both operations happen entirely on-device.',
      },
      {
        heading: 'Clear Data',
        body: '"Clear All Local Data" in Settings permanently deletes all locally stored sessions and settings. This cannot be undone. There is no cloud backup.',
      },
      {
        heading: 'Third-Party Packages',
        body: 'Skill Check uses open-source packages listed in its source code. Expo\'s development infrastructure may collect minimal crash diagnostics during development builds; production builds have no such reporting.',
      },
    ],
  },
  about: {
    title: 'About Skill Check',
    sections: [
      {
        heading: 'What It Is',
        body: 'Skill Check is a dice tracking and analysis tool for tabletop games. Record every roll, get statistical verdicts, share results, and settle the eternal question: was it bad luck, or a skill issue?',
      },
      {
        heading: 'Design Philosophy',
        body: 'The verdict language is deliberately honest about what dice statistics can and cannot tell you. Skill Check will never claim to prove cheating, confirm dice are loaded, or measure anything it cannot actually observe. It tells you what the numbers show — nothing more.',
      },
      {
        heading: 'Offline First',
        body: 'All data stays on your device. No account required. No internet connection needed. Your game history is yours.',
      },
      {
        heading: 'Version',
        body: 'v1.0.0 — Phase 5\n\nBuilt with Expo, React Native, and TypeScript.',
      },
    ],
  },
};

export default function SettingsInfoScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { type } = useLocalSearchParams<{ type: string }>();
  const webTop = Platform.OS === 'web' ? 67 : 0;

  const infoType = (type as InfoType) ?? 'about';
  const content = CONTENT[infoType] ?? CONTENT.about;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + webTop + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="close" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]} numberOfLines={1}>
          {content.title}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 48 }]}
        showsVerticalScrollIndicator={false}
      >
        {content.sections.map((section, idx) => (
          <View key={idx} style={styles.section}>
            {section.heading && (
              <Text style={[styles.heading, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                {section.heading}
              </Text>
            )}
            <Text style={[styles.body, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {section.body}
            </Text>
          </View>
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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, flex: 1, textAlign: 'center' },
  scroll: { padding: 24, gap: 24 },
  section: { gap: 8 },
  heading: { fontSize: 15 },
  body: { fontSize: 14, lineHeight: 22 },
});
