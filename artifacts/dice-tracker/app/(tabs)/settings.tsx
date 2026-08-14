/**
 * Settings Screen — full implementation.
 *
 * Sections:
 *   Preferences  — haptics, sound, reduced motion
 *   Game Defaults — default dice mode, player count, auto-advance
 *   Data         — export JSON, import backup, clear all data
 *   Information  — methodology, Catan notice, privacy, about
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as DocumentPicker from 'expo-document-picker';
import { Share } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSettings } from '@/context/SettingsContext';
import { clearAllData, exportAllData, importAllData } from '@/services/storage';
import type { DiceMode } from '@/types/models';

// ─── Dice mode options ────────────────────────────────────────────────────────

const DICE_MODES: DiceMode[] = ['D4', 'D6', 'D8', 'D10', 'D12', 'D20', '2D6'];
const PLAYER_COUNTS = [1, 2, 3, 4, 5, 6];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useSettings();
  const webTop = Platform.OS === 'web' ? 67 : 0;
  const [exportBusy, setExportBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);

  const haptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    if (settings.hapticsEnabled) void Haptics.impactAsync(style);
  };

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleExport = async () => {
    haptic();
    setExportBusy(true);
    try {
      const json = await exportAllData();
      await Share.share({
        message: json,
        title: 'Skill Check — Data Export',
      });
    } catch {
      Alert.alert('Export failed', 'Could not export data. Please try again.');
    } finally {
      setExportBusy(false);
    }
  };

  const handleImport = async () => {
    haptic();
    setImportBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) {
        setImportBusy(false);
        return;
      }
      const asset = result.assets[0]!;
      const response = await fetch(asset.uri);
      const json = await response.text();
      const { imported, skipped, error } = await importAllData(json);
      if (error) {
        Alert.alert('Import failed', error);
      } else {
        const skippedNote = skipped > 0
          ? `\n\n${skipped} session${skipped !== 1 ? 's were' : ' was'} already on this device and left unchanged.`
          : '';
        Alert.alert(
          'Import complete',
          `${imported} session${imported !== 1 ? 's' : ''} imported successfully.${skippedNote}`,
        );
      }
    } catch (err) {
      Alert.alert('Import failed', `Could not read the file: ${String(err)}`);
    } finally {
      setImportBusy(false);
    }
  };

  const handleClearAll = () => {
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Clear All Local Data?',
      'This permanently deletes all sessions, roll history, and settings. There is no undo and no backup unless you exported first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Everything',
          style: 'destructive',
          onPress: async () => {
            haptic(Haptics.ImpactFeedbackStyle.Heavy);
            await clearAllData();
            Alert.alert('Done', 'All local data has been cleared.');
          },
        },
      ],
    );
  };

  const pushInfo = (type: string) => {
    haptic();
    router.push(`/settings-info?type=${type}` as any);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + webTop + 20, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Settings</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Preferences ───────────────────────────────────────────────── */}
        <SectionLabel label="PREFERENCES" colors={colors} />
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingsRow
            label="Haptic Feedback"
            icon="phone-portrait-outline"
            colors={colors}
            right={
              <Switch
                value={settings.hapticsEnabled}
                onValueChange={val => { haptic(); void updateSettings({ hapticsEnabled: val }); }}
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
                onValueChange={val => { haptic(); void updateSettings({ soundEnabled: val }); }}
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
                onValueChange={val => { haptic(); void updateSettings({ reducedMotion: val }); }}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#ffffff"
                testID="reduced-motion-toggle"
              />
            }
          />
        </View>

        {/* ── Game Defaults ─────────────────────────────────────────────── */}
        <SectionLabel label="GAME DEFAULTS" colors={colors} />
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Default dice mode */}
          <View style={settingsStyles.row}>
            <Ionicons name="dice-outline" size={20} color={colors.mutedForeground} />
            <Text style={[settingsStyles.rowLabel, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
              Default Dice
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
              {DICE_MODES.map(mode => (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.pill,
                    {
                      backgroundColor: settings.defaultDiceMode === mode ? colors.primary : colors.muted,
                      borderColor: settings.defaultDiceMode === mode ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => { haptic(); void updateSettings({ defaultDiceMode: mode }); }}
                >
                  <Text style={[styles.pillText, {
                    color: settings.defaultDiceMode === mode ? colors.primaryForeground : colors.mutedForeground,
                    fontFamily: settings.defaultDiceMode === mode ? 'Inter_600SemiBold' : 'Inter_400Regular',
                  }]}>
                    {mode}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <Divider colors={colors} />
          {/* Default player count */}
          <View style={settingsStyles.row}>
            <Ionicons name="people-outline" size={20} color={colors.mutedForeground} />
            <Text style={[settingsStyles.rowLabel, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
              Default Players
            </Text>
            <View style={styles.pillRow}>
              {PLAYER_COUNTS.map(n => (
                <TouchableOpacity
                  key={n}
                  style={[
                    styles.pill,
                    {
                      backgroundColor: settings.defaultPlayerCount === n ? colors.primary : colors.muted,
                      borderColor: settings.defaultPlayerCount === n ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => { haptic(); void updateSettings({ defaultPlayerCount: n }); }}
                >
                  <Text style={[styles.pillText, {
                    color: settings.defaultPlayerCount === n ? colors.primaryForeground : colors.mutedForeground,
                    fontFamily: settings.defaultPlayerCount === n ? 'Inter_600SemiBold' : 'Inter_400Regular',
                  }]}>
                    {n}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <Divider colors={colors} />
          {/* Default auto-advance */}
          <SettingsRow
            label="Auto-Advance Player"
            icon="arrow-forward-circle-outline"
            colors={colors}
            right={
              <Switch
                value={settings.defaultAutoAdvance}
                onValueChange={val => { haptic(); void updateSettings({ defaultAutoAdvance: val }); }}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#ffffff"
              />
            }
          />
        </View>

        {/* ── Data ──────────────────────────────────────────────────────── */}
        <SectionLabel label="DATA" colors={colors} />
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity style={settingsStyles.row} onPress={handleExport} disabled={exportBusy} activeOpacity={0.7}>
            <Ionicons name="download-outline" size={20} color={colors.mutedForeground} />
            <Text style={[settingsStyles.rowLabel, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
              Export Local Data
            </Text>
            {exportBusy
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />}
          </TouchableOpacity>
          <Divider colors={colors} />
          <TouchableOpacity style={settingsStyles.row} onPress={handleImport} disabled={importBusy} activeOpacity={0.7}>
            <Ionicons name="cloud-upload-outline" size={20} color={colors.mutedForeground} />
            <Text style={[settingsStyles.rowLabel, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
              Import Backup
            </Text>
            {importBusy
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />}
          </TouchableOpacity>
          <Divider colors={colors} />
          <TouchableOpacity style={settingsStyles.row} onPress={handleClearAll} activeOpacity={0.7}>
            <Ionicons name="trash-outline" size={20} color={colors.destructive} />
            <Text style={[settingsStyles.rowLabel, { color: colors.destructive, fontFamily: 'Inter_400Regular' }]}>
              Clear All Local Data
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* ── Information ───────────────────────────────────────────────── */}
        <SectionLabel label="INFORMATION" colors={colors} />
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity style={settingsStyles.row} onPress={() => pushInfo('methodology')} activeOpacity={0.7}>
            <Ionicons name="bar-chart-outline" size={20} color={colors.mutedForeground} />
            <Text style={[settingsStyles.rowLabel, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
              Statistical Methodology
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
          <Divider colors={colors} />
          <TouchableOpacity style={settingsStyles.row} onPress={() => pushInfo('catan')} activeOpacity={0.7}>
            <Ionicons name="information-circle-outline" size={20} color={colors.mutedForeground} />
            <Text style={[settingsStyles.rowLabel, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
              Catan Compatibility Notice
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
          <Divider colors={colors} />
          <TouchableOpacity style={settingsStyles.row} onPress={() => pushInfo('privacy')} activeOpacity={0.7}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.mutedForeground} />
            <Text style={[settingsStyles.rowLabel, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
              Privacy Summary
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
          <Divider colors={colors} />
          <TouchableOpacity style={settingsStyles.row} onPress={() => pushInfo('about')} activeOpacity={0.7}>
            <Ionicons name="heart-outline" size={20} color={colors.mutedForeground} />
            <Text style={[settingsStyles.rowLabel, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
              About Skill Check
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.version, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          Skill Check · v1.0.0{'\n'}
          All game data is stored locally on your device.
        </Text>
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type Colors = ReturnType<typeof useColors>;

function SectionLabel({ label, colors }: { label: string; colors: Colors }) {
  return (
    <Text style={[settingsStyles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
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
      <Text style={[settingsStyles.rowLabel, { color: labelColor ?? colors.foreground, fontFamily: 'Inter_400Regular' }]}>
        {label}
      </Text>
      {right}
    </View>
  );
}

function Divider({ colors }: { colors: Colors }) {
  return <View style={[settingsStyles.divider, { backgroundColor: colors.border }]} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 24, paddingBottom: 16, borderBottomWidth: 1 },
  title: { fontSize: 28 },
  content: { padding: 20, gap: 16 },
  section: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  pillRow: { flexDirection: 'row', gap: 6 },
  pill: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  pillText: { fontSize: 12 },
  version: { fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 8 },
});

const settingsStyles = StyleSheet.create({
  sectionLabel: { fontSize: 11, letterSpacing: 1.2, marginLeft: 4, marginBottom: -8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    flexWrap: 'wrap',
  },
  rowLabel: { flex: 1, fontSize: 15, minWidth: 80 },
  divider: { height: 1, marginLeft: 48 },
});
