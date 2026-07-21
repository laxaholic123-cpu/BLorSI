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

  const handleQuickGame = () => { haptic(); router.push('/new-game/quick-game'); };
  const handleNewGame   = () => { haptic(); router.push('/new-game'); };
  const handleResume    = () => {
    if (!activeSession) return;
    haptic();
    // Route to the correct screen based on game type
    if (activeSession.gameType === 'catan') {
      router.push('/active-catan' as any);
    } else {
      router.push('/active-game');
    }
  };
  const handleHistory   = () => { haptic(); router.navigate('/history'); };

  const sessionLabel = activeSession
    ? (activeSession.customGameName ??
        activeSession.gameType.charAt(0).toUpperCase() + activeSession.gameType.slice(1))
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
        {/* ── In-app wordmark ───────────────────────────────────── */}
        <View style={styles.wordmark}>
          <View style={[styles.wordmarkBadge, { backgroundColor: colors.primary }]}>
            <Text style={[styles.wordmarkCheck, { color: colors.primaryForeground }]}>✓</Text>
          </View>
          <Text style={[styles.wordmarkText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
            SKILL CHECK
          </Text>
        </View>

        {/* ── Branding ──────────────────────────────────────────── */}
        <View style={styles.brand}>
          <Text style={[styles.brandHeading, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            Bad luck or{'\n'}
            <Text style={{ color: colors.primary }}>skill issue?</Text>
          </Text>
          <Text style={[styles.tagline, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Track every roll. Settle every excuse.
          </Text>
        </View>

        {/* ── Actions ───────────────────────────────────────────── */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={handleQuickGame}
            activeOpacity={0.85}
            testID="quick-game-button"
            accessibilityRole="button"
            accessibilityLabel="Quick Game"
            accessibilityHint="Pick a die and number of players then start immediately"
          >
            <View style={styles.btnInner}>
              <View style={styles.btnRow}>
                <Ionicons name="flash" size={20} color={colors.primaryForeground} />
                <Text style={[styles.primaryBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_700Bold' }]}>
                  Quick Game
                </Text>
              </View>
              <Text style={[styles.btnSub, { color: colors.primaryForeground }]}>
                Pick a die, pick players — go
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={handleNewGame}
            activeOpacity={0.85}
            testID="new-game-button"
            accessibilityRole="button"
            accessibilityLabel="New Game"
            accessibilityHint="Set up player names, dice mode, and options before starting"
          >
            <View style={styles.btnInner}>
              <View style={styles.btnRow}>
                <Ionicons name="add-circle-outline" size={20} color={colors.foreground} />
                <Text style={[styles.secondaryBtnText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  New Game
                </Text>
              </View>
              <Text style={[styles.btnSub, { color: colors.mutedForeground }]}>
                Name players, set options & more
              </Text>
            </View>
          </TouchableOpacity>

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
            accessibilityRole="button"
            accessibilityLabel={activeSession ? `Resume: ${sessionLabel ?? 'current game'}` : 'No active game to resume'}
            accessibilityState={{ disabled: !activeSession }}
          >
            <Ionicons
              name="play-circle-outline"
              size={20}
              color={activeSession ? colors.primary : colors.mutedForeground}
            />
            <Text
              style={[
                styles.secondaryBtnText,
                { color: activeSession ? colors.primary : colors.mutedForeground, fontFamily: 'Inter_600SemiBold' },
              ]}
            >
              {sessionLabel ? `Resume: ${sessionLabel}` : 'No Active Game'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.textBtn} onPress={handleHistory} activeOpacity={0.7} testID="history-button" accessibilityRole="button" accessibilityLabel="Game History" accessibilityHint="View all past sessions">
            <Ionicons name="time-outline" size={18} color={colors.mutedForeground} />
            <Text style={[styles.textBtnText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
              Game History
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Sign in ───────────────────────────────────────────── */}
        <View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <TouchableOpacity
            style={styles.signInRow}
            onPress={() => setSignInVisible(true)}
            activeOpacity={0.7}
            testID="sign-in-button"
          >
            <Ionicons name="cloud-outline" size={15} color={colors.mutedForeground} />
            <Text style={[styles.signInText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Sign in to sync across devices
            </Text>
            <Ionicons name="chevron-forward" size={13} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ── Coming-soon modal ─────────────────────────────────── */}
      <Modal visible={signInVisible} transparent animationType="fade" onRequestClose={() => setSignInVisible(false)}>
        <Pressable style={styles.overlay} onPress={() => setSignInVisible(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.modalAccentBar, { backgroundColor: colors.primary }]} />
            <Ionicons name="cloud" size={40} color={colors.primary} style={styles.modalIcon} />
            <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              Cloud Sync Coming Soon
            </Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              User accounts, cloud sync, and cross-device history are planned for a future update.
            </Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              All your games are saved locally and won't be lost.
            </Text>
            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: colors.primary }]}
              onPress={() => setSignInVisible(false)}
            >
              <Text style={[styles.modalBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }]}>
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
  content: { flexGrow: 1, paddingHorizontal: 24 },

  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 36 },
  wordmarkBadge: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  wordmarkCheck: { fontSize: 20, fontWeight: '700', lineHeight: 24 },
  wordmarkText: { fontSize: 13, letterSpacing: 2.5 },

  brand: { marginBottom: 40 },
  brandHeading: { fontSize: 40, lineHeight: 48, letterSpacing: -1 },
  tagline: { fontSize: 15, lineHeight: 22, marginTop: 10 },

  actions: { gap: 12, marginBottom: 32 },
  primaryBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 14 },
  primaryBtnText: { fontSize: 17, letterSpacing: 0.2 },
  secondaryBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 14, borderWidth: 1 },
  secondaryBtnText: { fontSize: 16 },
  btnInner: { alignItems: 'center', gap: 3 },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  btnSub: { fontSize: 12, opacity: 0.7 },
  textBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  textBtnText: { fontSize: 15 },

  divider: { height: 1, marginBottom: 16 },
  signInRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10 },
  signInText: { fontSize: 13, flex: 1, textAlign: 'center' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 380, borderRadius: 20, borderWidth: 1, padding: 28, alignItems: 'center', overflow: 'hidden' },
  modalAccentBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 4 },
  modalIcon: { marginTop: 12, marginBottom: 16 },
  modalTitle: { fontSize: 20, marginBottom: 12, textAlign: 'center' },
  modalBody: { fontSize: 14, lineHeight: 22, textAlign: 'center', marginBottom: 8 },
  modalBtn: { marginTop: 16, paddingVertical: 14, paddingHorizontal: 40, borderRadius: 12 },
  modalBtnText: { fontSize: 16 },
});
