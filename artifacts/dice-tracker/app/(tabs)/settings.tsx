import React from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useSettings } from '@/context/SettingsContext';

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useSettings();
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
          Settings
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 48 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Preferences */}
        <SectionLabel label="PREFERENCES" colors={colors} />
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingsRow
            label="Haptic Feedback"
            icon="phone-portrait-outline"
            colors={colors}
            right={
              <Switch
                value={settings.hapticsEnabled}
                onValueChange={(val) => void updateSettings({ hapticsEnabled: val })}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#ffffff"
                testID="haptics-toggle"
              />
            }
          />
          <Divider colors={colors} />
          <SettingsRow
            label="Sound Effects"
            icon="volume-medium-outline"
            colors={colors}
            right={
              <Switch
                value={settings.soundEnabled}
                onValueChange={(val) => void updateSettings({ soundEnabled: val })}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#ffffff"
                testID="sound-toggle"
              />
            }
          />
          <Divider colors={colors} />
          <SettingsRow
            label="Reduce Motion"
            icon="accessibility-outline"
            colors={colors}
            right={
              <Switch
                value={settings.reducedMotion}
                onValueChange={(val) => void updateSettings({ reducedMotion: val })}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#ffffff"
                testID="reduced-motion-toggle"
              />
            }
          />
        </View>

        {/* Information */}
        <SectionLabel label="INFORMATION" colors={colors} />
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingsRow
            label="Statistical Methodology"
            icon="bar-chart-outline"
            colors={colors}
            right={<Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />}
          />
          <Divider colors={colors} />
          <SettingsRow
            label="Catan Compatibility Notice"
            icon="information-circle-outline"
            colors={colors}
            right={<Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />}
          />
          <Divider colors={colors} />
          <SettingsRow
            label="Privacy Summary"
            icon="shield-checkmark-outline"
            colors={colors}
            right={<Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />}
          />
        </View>

        {/* Data */}
        <SectionLabel label="DATA" colors={colors} />
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingsRow
            label="Export Local Data"
            icon="download-outline"
            colors={colors}
            right={<Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />}
          />
          <Divider colors={colors} />
          <SettingsRow
            label="Import Backup"
            icon="cloud-upload-outline"
            colors={colors}
            right={<Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />}
          />
          <Divider colors={colors} />
          <SettingsRow
            label="Clear All Local Data"
            icon="trash-outline"
            colors={colors}
            iconColor={colors.destructive}
            labelColor={colors.destructive}
            right={<Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />}
          />
        </View>

        <Text
          style={[
            styles.version,
            { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
          ]}
        >
          Bad Luck or Skill Issue? · v1.0.0{'\n'}
          All game data is stored locally on your device.
        </Text>
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

type Colors = ReturnType<typeof useColors>;

function SectionLabel({ label, colors }: { label: string; colors: Colors }) {
  return (
    <Text
      style={[
        settingsStyles.sectionLabel,
        { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' },
      ]}
    >
      {label}
    </Text>
  );
}

interface RowProps {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  colors: Colors;
  right?: React.ReactNode;
  iconColor?: string;
  labelColor?: string;
}

function SettingsRow({ label, icon, colors, right, iconColor, labelColor }: RowProps) {
  return (
    <View style={settingsStyles.row}>
      <Ionicons name={icon} size={20} color={iconColor ?? colors.mutedForeground} />
      <Text
        style={[
          settingsStyles.rowLabel,
          { color: labelColor ?? colors.foreground, fontFamily: 'Inter_400Regular' },
        ]}
      >
        {label}
      </Text>
      {right}
    </View>
  );
}

function Divider({ colors }: { colors: Colors }) {
  return <View style={[settingsStyles.divider, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 24, paddingBottom: 16, borderBottomWidth: 1 },
  title: { fontSize: 28 },
  content: { padding: 20, gap: 16 },
  section: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  version: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 8,
  },
});

const settingsStyles = StyleSheet.create({
  sectionLabel: { fontSize: 11, letterSpacing: 1.2, marginLeft: 4, marginBottom: -8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  rowLabel: { flex: 1, fontSize: 15 },
  divider: { height: 1, marginLeft: 48 },
});
