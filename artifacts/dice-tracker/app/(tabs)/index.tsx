import React, { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useGame } from '@/context/GameContext';
import { useSettings } from '@/context/SettingsContext';

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeSession } = useGame();
  const { settings } = useSettings();
  const [signInVisible, setSignInVisible] = useState(false);

  const webTop = Platform.OS === 'web' ? 67 : 0;
  const webBottom = Platform.OS === 'web' ? 34 : 0;

  const haptic = () => {
    if (settings.hapticsEnabled) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleQuickGame = () => {
    haptic();
    router.push('/new-game');
  };

  const handleNewGame = () => {
    haptic();
    router.push('/new-game');
  };

  const handleResume = () => {
    if (!activeSession) return;
    haptic();
    router.push('/active-game');
  };

  const handleHistory = () => {
    haptic();
    router.navigate('/history');
  };

  const sessionLabel = activeSession
    ? (activeSession.customGameName ?? activeSession.gameType.charAt(0).toUpperCase() + activeSession.gameType.slice(1))
    : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + webTop + 48,
            paddingBottom: insets.bottom + webBottom + 24,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Branding ─────────────────────────────────────────── */}
        <View style={styles.brand}>
          <Text
            style={[
              styles.brandLine1,
              { color: colors.primary, fontFamily: 'Inter_700Bold' },
            ]}
          >
            BAD LUCK
          </Text>
          <Text
            style={[
              styles.brandLine2,
              { color: colors.foreground, fontFamily: 'Inter_700Bold' },
            ]}
          >
            OR SKILL ISSUE?
          </Text>
          <Text
            style={[
              styles.tagline,
              { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
            ]}
          >
            Track every roll. Settle every excuse.
          </Text>
        </View>

        {/* ── Dice pip decoration ──────────────────────────────── */}
        <View style={[styles.pipRow, { borderTopColor: colors.border }]}>
          {[2, 6, 7, 8, 12].map((n) => (
            <View
              key={n}
              style={[styles.pip, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text
                style={[
                  styles.pipText,
                  { color: n === 7 ? colors.primary : colors.mutedForeground, fontFamily: 'Inter_700Bold' },
                ]}
              >
                {n}
              </Text>
            </View>
          ))}
        </View>

        {/* ── Actions ──────────────────────────────────────────── */}
        <View style={styles.actions}>
          {/* Quick Game — primary CTA */}
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={handleQuickGame}
            activeOpacity={0.85}
            testID="quick-game-button"
          >
            <Ionicons name="flash" size={20} color={colors.primaryForeground} />
            <Text
              style={[
                styles.primaryBtnText,
                { color: colors.primaryForeground, fontFamily: 'Inter_700Bold' },
              ]}
            >
              Quick Game
            </Text>
          </TouchableOpacity>

          {/* New Game */}
          <TouchableOpacity
            style={[
              styles.secondaryBtn,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            onPress={handleNewGame}
            activeOpacity={0.85}
            testID="new-game-button"
          >
            <Ionicons name="add-circle-outline" size={20} color={colors.foreground} />
            <Text
              style={[
                styles.secondaryBtnText,
                { color: colors.foreground, fontFamily: 'Inter_600SemiBold' },
              ]}
            >
              New Game
            </Text>
          </TouchableOpacity>

          {/* Resume — disabled when no active session */}
          <TouchableOpacity
            style={[
              styles.secondaryBtn,
              {
                backgroundColor: activeSession ? colors.card : colors.muted,
                borderColor: activeSession ? colors.primary : colors.border,
                opacity: activeSession ? 1 : 0.45,
              },
            ]}
            onPress={handleResume}
            disabled={!activeSession}
            activeOpacity={0.85}
            testID="resume-game-button"
          >
            <Ionicons
              name="play-circle-outline"
              size={20}
              color={activeSession ? colors.primary : colors.mutedForeground}
            />
            <Text
              style={[
                styles.secondaryBtnText,
                {
                  color: activeSession ? colors.primary : colors.mutedForeground,
                  fontFamily: 'Inter_600SemiBold',
                },
              ]}
            >
              {sessionLabel ? `Resume: ${sessionLabel}` : 'No Active Game'}
            </Text>
          </TouchableOpacity>

          {/* History — text-style button */}
          <TouchableOpacity
            style={styles.textBtn}
            onPress={handleHistory}
            activeOpacity={0.7}
            testID="history-button"
          >
            <Ionicons name="time-outline" size={18} color={colors.mutedForeground} />
            <Text
              style={[
                styles.textBtnText,
                { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' },
              ]}
            >
              Game History
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Sign in ──────────────────────────────────────────── */}
        <View style={styles.signIn}>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <TouchableOpacity
            style={styles.signInRow}
            onPress={() => setSignInVisible(true)}
            activeOpacity={0.7}
            testID="sign-in-button"
          >
            <Ionicons name="cloud-outline" size={15} color={colors.mutedForeground} />
            <Text
              style={[
                styles.signInText,
                { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
              ]}
            >
              Sign in to sync across devices
            </Text>
            <Ionicons name="chevron-forward" size={13} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ── Sign-in "Coming Soon" modal ────────────────────────── */}
      <Modal
        visible={signInVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSignInVisible(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setSignInVisible(false)}>
          <Pressable
            style={[
              styles.modalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={[styles.modalAccentBar, { backgroundColor: colors.primary }]} />
            <Ionicons
              name="cloud"
              size={40}
              color={colors.primary}
              style={styles.modalIcon}
            />
            <Text
              style={[
                styles.modalTitle,
                { color: colors.foreground, fontFamily: 'Inter_700Bold' },
              ]}
            >
              Cloud Sync Coming Soon
            </Text>
            <Text
              style={[
                styles.modalBody,
                { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
              ]}
            >
              User accounts, cloud sync, and cross-device history are planned for a future update.
            </Text>
            <Text
              style={[
                styles.modalBody,
                { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
              ]}
            >
              All your games are saved locally and won't be lost.
            </Text>
            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: colors.primary }]}
              onPress={() => setSignInVisible(false)}
            >
              <Text
                style={[
                  styles.modalBtnText,
                  { color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' },
                ]}
              >
                Got it
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24, gap: 0 },

  // Branding
  brand: { marginBottom: 32 },
  brandLine1: { fontSize: 44, lineHeight: 50, letterSpacing: -1.5 },
  brandLine2: { fontSize: 44, lineHeight: 50, letterSpacing: -1.5 },
  tagline: { fontSize: 15, lineHeight: 22, marginTop: 10 },

  // Pip decoration
  pipRow: { flexDirection: 'row', gap: 8, borderTopWidth: 1, paddingTop: 20, marginBottom: 36 },
  pip: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pipText: { fontSize: 17 },

  // Actions
  actions: { gap: 12, marginBottom: 32 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 19,
    borderRadius: 14,
  },
  primaryBtnText: { fontSize: 17, letterSpacing: 0.2 },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 16 },
  textBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  textBtnText: { fontSize: 15 },

  // Sign in
  signIn: { gap: 0 },
  divider: { height: 1, marginBottom: 16 },
  signInRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  signInText: { fontSize: 13, flex: 1, textAlign: 'center' },

  // Modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 20,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
    overflow: 'hidden',
  },
  modalAccentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  modalIcon: { marginTop: 12, marginBottom: 16 },
  modalTitle: { fontSize: 20, marginBottom: 12, textAlign: 'center' },
  modalBody: { fontSize: 14, lineHeight: 22, textAlign: 'center', marginBottom: 8 },
  modalBtn: { marginTop: 16, paddingVertical: 14, paddingHorizontal: 40, borderRadius: 12 },
  modalBtnText: { fontSize: 16 },
});
