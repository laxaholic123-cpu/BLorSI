/**
 * Results Screen — shown after a game ends.
 *
 * Flow:
 *   1. If trackWinner is on and no winner was recorded, show a winner picker first.
 *   2. Show the full stats report: verdict, session info, distribution, player
 *      summaries, and notable events.
 *   3. "Done" calls endSession() and navigates home.
 *
 * activeSession is still in context because active-game.tsx calls updateSession()
 * (not endSession()) before navigating here. endSession() is called only when the
 * user explicitly taps Done.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
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
import { useGame } from '@/context/GameContext';
import { useSettings } from '@/context/SettingsContext';
import { computeAllStats, formatDuration } from '@/services/stats';
import { computeCatanGameStats } from '@/services/catanStats';
import { describePercentile } from '@/services/luckEngine';
import { describePort } from '@/services/catanBoard';
import { computeDevCardStats, DEV_DECK_SIZE } from '@/services/devCards';
import type { CatanGameStats } from '@/types/catanStats';
import { selectBestShareCard, CARD_METADATA } from '@/services/shareCard';
import { RollFrequencyChart } from '@/components/RollFrequencyChart';

export default function ResultsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeSession, rollEvents, exposureEvents, devCardEvents, updateSession, endSession } = useGame();
  const { settings } = useSettings();
  const webTop = Platform.OS === 'web' ? 67 : 0;

  // Winner selection state
  const [selectedWinnerId, setSelectedWinnerId] = useState<string | null>(
    activeSession?.winnerPlayerId ?? null,
  );
  const [winnerConfirmed, setWinnerConfirmed] = useState(
    !!(activeSession?.winnerPlayerId) ||
    !(activeSession?.settings.trackWinner) ||
    (activeSession?.players.length ?? 0) <= 1,
  );

  // simulate: true — this is the verdict screen, so it gets the real
  // percentile-based statistics rather than the cheap threshold fallback.
  const stats = useMemo(
    () => (activeSession ? computeAllStats(activeSession, rollEvents, { simulate: true }) : null),
    [activeSession, rollEvents],
  );

  const catanStats = useMemo<CatanGameStats | null>(
    () =>
      activeSession?.gameType === 'catan'
        ? computeCatanGameStats(activeSession, rollEvents, exposureEvents, { simulate: true })
        : null,
    [activeSession, rollEvents, exposureEvents],
  );

  const devCardStats = useMemo(
    () =>
      activeSession?.gameType === 'catan' && devCardEvents.length > 0
        ? computeDevCardStats(activeSession.players, devCardEvents, { simulate: true })
        : null,
    [activeSession, devCardEvents],
  );

  // ── Verdict entrance animation ───────────────────────────────────────────────
  // A gentle fade-up when the results screen first renders.
  // Skip entirely when the user has requested reduced motion.
  const verdictOpacity = useRef(
    new Animated.Value(settings.reducedMotion ? 1 : 0),
  ).current;
  const verdictTranslateY = useRef(
    new Animated.Value(settings.reducedMotion ? 0 : 10),
  ).current;

  useEffect(() => {
    if (settings.reducedMotion) return;
    // Small delay lets the scroll view settle before the headline animates in
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(verdictOpacity, {
          toValue: 1,
          duration: 380,
          useNativeDriver: true,
        }),
        Animated.timing(verdictTranslateY, {
          toValue: 0,
          duration: 380,
          useNativeDriver: true,
        }),
      ]).start();
    }, 80);
    return () => clearTimeout(timer);
  // Run only once on mount — animation values are stable refs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── No session guard ─────────────────────────────────────────────────────────
  if (!activeSession || !stats) {
    return (
      <View
        style={[
          styles.container,
          styles.centered,
          { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <Ionicons name="trophy-outline" size={48} color={colors.mutedForeground} />
        <Text style={[styles.bodyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          No results to show
        </Text>
        <TouchableOpacity
          style={[styles.doneBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.replace('/')}
        >
          <Text style={[styles.doneBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }]}>
            Back to Home
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isMultiplayer = activeSession.players.length > 1;
  const isD20 = activeSession.diceMode === 'D20';
  const is2D6 = activeSession.diceMode === '2D6';
  const maxCount = Math.max(...stats.frequencies.map(f => f.count), 1);

  // ── Winner confirmation screen ───────────────────────────────────────────────
  const handleConfirmWinner = async () => {
    if (selectedWinnerId !== null) {
      await updateSession({ ...activeSession, winnerPlayerId: selectedWinnerId });
    }
    setWinnerConfirmed(true);
  };

  if (!winnerConfirmed) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background, paddingTop: insets.top + webTop, paddingBottom: insets.bottom },
        ]}
      >
        <View style={styles.winnerHeader}>
          <Ionicons name="trophy" size={40} color={colors.primary} />
          <Text style={[styles.winnerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            Game Over!
          </Text>
          <Text style={[styles.winnerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Who won? (optional — tap to select)
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.winnerList}
          showsVerticalScrollIndicator={false}
        >
          {activeSession.players.map(player => {
            const selected = selectedWinnerId === player.id;
            return (
              <TouchableOpacity
                key={player.id}
                style={[
                  styles.winnerCard,
                  {
                    backgroundColor: selected ? colors.primary + '22' : colors.card,
                    borderColor: selected ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setSelectedWinnerId(selected ? null : player.id)}
                activeOpacity={0.8}
              >
                <View style={[styles.playerDot, { backgroundColor: player.color }]} />
                <Text
                  style={[
                    styles.winnerCardName,
                    {
                      color: selected ? colors.primary : colors.foreground,
                      fontFamily: selected ? 'Inter_700Bold' : 'Inter_400Regular',
                    },
                  ]}
                >
                  {player.displayName}
                </Text>
                {selected && (
                  <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={[styles.winnerFooter, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.doneBtn, { backgroundColor: colors.primary }]}
            onPress={handleConfirmWinner}
            activeOpacity={0.85}
          >
            <Text style={[styles.doneBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_700Bold' }]}>
              {selectedWinnerId ? 'Record Winner & See Results' : 'Skip — See Results'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Full results view ────────────────────────────────────────────────────────

  const winner = activeSession.winnerPlayerId
    ? activeSession.players.find(p => p.id === activeSession.winnerPlayerId)
    : null;

  const handleDone = async () => {
    await endSession();
    router.replace('/');
  };

  const handleShare = async () => {
    // Capture id before endSession clears activeSession from context
    const sessionId = activeSession.id;
    const hasExposureData = !!(catanStats?.hasExposureData);
    const bestCard = selectBestShareCard(activeSession, hasExposureData);
    await endSession();
    router.push(`/share-card?id=${encodeURIComponent(sessionId)}&cardType=${bestCard}` as any);
  };

  const gameLabel = activeSession.customGameName ?? activeSession.diceMode.toUpperCase();

  // Best share card for this session — used by the inline share preview
  const bestCard = selectBestShareCard(activeSession, !!(catanStats?.hasExposureData));
  const bestCardMeta = CARD_METADATA[bestCard];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + webTop + 16, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Winner banner ── */}
        {winner ? (
          <View style={[styles.winnerBanner, { backgroundColor: colors.primary + '18', borderColor: colors.primary }]}>
            <Ionicons name="trophy" size={28} color={colors.primary} />
            <View style={styles.winnerBannerText}>
              <Text style={[styles.winnerBannerName, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>
                {winner.displayName} wins!
              </Text>
              <Text style={[styles.winnerBannerSub, { color: colors.primary, fontFamily: 'Inter_400Regular', opacity: 0.75 }]}>
                {gameLabel}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.noWinnerHeader}>
            <Ionicons name="trophy-outline" size={32} color={colors.mutedForeground} />
            <Text style={[styles.noWinnerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              {gameLabel} — Game Over
            </Text>
          </View>
        )}

        {/* ── Session info chips ── */}
        <View style={styles.chips}>
          <Chip icon="layers-outline" label={`${stats.totalRolls} rolls`} colors={colors} />
          <Chip icon="people-outline" label={`${activeSession.players.length}P`} colors={colors} />
          <Chip icon="dice-outline" label={activeSession.diceMode} colors={colors} />
          {stats.durationSeconds !== null && (
            <Chip icon="time-outline" label={formatDuration(stats.durationSeconds)} colors={colors} />
          )}
        </View>

        {/* ── Verdict (animated entrance) ── */}
        <Animated.View style={{ opacity: verdictOpacity, transform: [{ translateY: verdictTranslateY }] }}>
          <SectionLabel text="VERDICT" colors={colors} />
          <View style={[styles.verdictCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Text style={[styles.verdictHeadline, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              {stats.verdictHeadline}
            </Text>
            <Text style={[styles.verdictBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {stats.isSmallSample
                ? `Only ${stats.totalRolls} rolls recorded — not enough for a reliable verdict. The dice cannot be judged on this evidence.`
                : stats.verdictExplanation}
            </Text>
            {stats.meanZScore !== null && !stats.isSmallSample && (
              <Text style={[styles.verdictNote, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                Mean: {stats.mean?.toFixed(2)} vs expected {stats.expectedMean.toFixed(1)} (z = {stats.meanZScore.toFixed(2)})
              </Text>
            )}
          </View>

          {/* ── Inline share preview ── */}
          <TouchableOpacity
            style={[styles.sharePreviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push(`/share-card?id=${encodeURIComponent(activeSession.id)}&cardType=${bestCard}` as any)}
            activeOpacity={0.8}
          >
            <View style={styles.sharePreviewLeft}>
              <Ionicons name={bestCardMeta.icon as any} size={18} color={colors.primary} />
              <View style={styles.sharePreviewText}>
                <Text style={[styles.sharePreviewLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  {bestCardMeta.label}
                </Text>
                <Text style={[styles.sharePreviewDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  {bestCardMeta.desc}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.sharePreviewBtn, { backgroundColor: colors.primary }]}
              onPress={handleShare}
              activeOpacity={0.85}
            >
              <Ionicons name="share-social-outline" size={15} color={colors.primaryForeground} />
              <Text style={[styles.sharePreviewBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }]}>
                Share
              </Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </Animated.View>

        {/* ── Distribution ── */}
        <SectionLabel text="DISTRIBUTION vs EXPECTED" colors={colors} />
        <RollFrequencyChart frequencies={stats.frequencies} totalRolls={stats.totalRolls} />
        {!stats.isSmallSample && (
          <View style={styles.chartLegend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#1ABC9C' }]} />
              <Text style={[styles.legendLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                above expected
              </Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#5C7A9C' }]} />
              <Text style={[styles.legendLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                below expected
              </Text>
            </View>
          </View>
        )}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 8 }]}>
          <View style={[styles.freqHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.freqColVal, styles.colHdr, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>VAL</Text>
            <View style={styles.freqColBar} />
            <Text style={[styles.freqColNum, styles.colHdr, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>GOT</Text>
            <Text style={[styles.freqColNum, styles.colHdr, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>EXP</Text>
            <Text style={[styles.freqColDev, styles.colHdr, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>±%</Text>
          </View>
          {stats.frequencies.map((f, idx) => {
            const isAbove = f.deviation > 0.5;
            const isBelow = f.deviation < -0.5;
            const barColor = isAbove ? '#1ABC9C' : isBelow ? '#5C7A9C' : colors.mutedForeground;
            const devColor = isAbove ? '#1ABC9C' : isBelow ? '#5C7A9C' : colors.mutedForeground;
            const barPct = stats.totalRolls > 0 ? f.count / maxCount : 0;
            const isLast = idx === stats.frequencies.length - 1;
            return (
              <View
                key={f.value}
                style={[
                  styles.freqRow,
                  { borderBottomColor: colors.border, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth },
                ]}
              >
                <Text style={[styles.freqColVal, styles.freqText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  {f.value}
                </Text>
                <View style={styles.freqColBar}>
                  <View style={[styles.barTrack, { backgroundColor: colors.muted }]}>
                    <View style={[styles.barFill, { width: `${barPct * 100}%` as `${number}%`, backgroundColor: barColor, opacity: 0.85 }]} />
                  </View>
                </View>
                <Text style={[styles.freqColNum, styles.freqText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  {f.count}
                </Text>
                <Text style={[styles.freqColNum, styles.freqText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  {f.expectedCount.toFixed(1)}
                </Text>
                <Text style={[styles.freqColDev, styles.freqText, { color: devColor, fontFamily: 'Inter_500Medium' }]}>
                  {f.deviationPct === 0 ? '—' : `${f.deviation > 0 ? '+' : ''}${f.deviationPct.toFixed(0)}%`}
                </Text>
              </View>
            );
          })}
        </View>

        {/* ── Player summaries ── */}
        {isMultiplayer && (
          <>
            <SectionLabel text="PLAYER SUMMARIES" colors={colors} />
            {stats.playerSummaries.map(ps => {
              const playerColor =
                activeSession.players.find(p => p.id === ps.playerId)?.color ?? colors.primary;
              return (
                <View
                  key={ps.playerId}
                  style={[
                    styles.card,
                    styles.playerCard,
                    { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: playerColor },
                  ]}
                >
                  <Text style={[styles.playerHeading, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                    {ps.displayName}
                    {ps.playerId === activeSession.winnerPlayerId ? '  🏆' : ''}
                  </Text>
                  <View style={styles.statRow}>
                    <StatBox label="Rolls" value={String(ps.rollCount)} colors={colors} />
                    <StatBox label="Avg" value={ps.mean !== null ? ps.mean.toFixed(2) : '—'} colors={colors} />
                    <StatBox label="Median" value={ps.median !== null ? ps.median.toFixed(1) : '—'} colors={colors} />
                    <StatBox label="Mode" value={ps.mode.slice(0, 2).join('/') || '—'} colors={colors} />
                  </View>
                  {ps.longestStreak && (
                    <Text style={[styles.playerNote, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                      Streak: {ps.longestStreak.value} × {ps.longestStreak.length}
                    </Text>
                  )}
                  {isD20 && (ps.nat1Count > 0 || ps.nat20Count > 0) && (
                    <Text style={[styles.playerNote, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                      Nat 20s: {ps.nat20Count} · Nat 1s: {ps.nat1Count}
                    </Text>
                  )}
                </View>
              );
            })}
          </>
        )}

        {/* ── Notable events ── */}
        {(stats.longestStreak ?? stats.longestGap ?? (isD20 && stats.totalRolls > 0) ?? (is2D6 && stats.doublesCount > 0)) ? (
          <>
            <SectionLabel text="NOTABLE EVENTS" colors={colors} />
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {stats.longestStreak && (
                <View style={styles.eventRow}>
                  <Ionicons name="flame-outline" size={15} color={colors.primary} />
                  <Text style={[styles.eventText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
                    Longest streak:{' '}
                    <Text style={{ fontFamily: 'Inter_700Bold', color: colors.primary }}>
                      {stats.longestStreak.value}
                    </Text>{' '}
                    rolled {stats.longestStreak.length}× in a row
                  </Text>
                </View>
              )}
              {stats.longestGap && (
                <View style={[styles.eventRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                  <Ionicons name="hourglass-outline" size={15} color={colors.mutedForeground} />
                  <Text style={[styles.eventText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
                    Longest drought:{' '}
                    <Text style={{ fontFamily: 'Inter_700Bold' }}>{stats.longestGap.value}</Text> absent for{' '}
                    {stats.longestGap.longestGap} rolls
                  </Text>
                </View>
              )}
              {isD20 && stats.totalRolls > 0 && (
                <View style={[styles.eventRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                  <Ionicons name="star-outline" size={15} color={colors.primary} />
                  <Text style={[styles.eventText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
                    <Text style={{ fontFamily: 'Inter_700Bold', color: colors.primary }}>{stats.nat20Count}</Text> critical{' '}
                    {stats.nat20Count === 1 ? 'hit' : 'hits'},{' '}
                    <Text style={{ fontFamily: 'Inter_700Bold' }}>{stats.nat1Count}</Text> critical{' '}
                    {stats.nat1Count === 1 ? 'fail' : 'fails'}
                  </Text>
                </View>
              )}
              {is2D6 && stats.doublesCount > 0 && (
                <View style={[styles.eventRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                  <Ionicons name="copy-outline" size={15} color={colors.mutedForeground} />
                  <Text style={[styles.eventText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
                    <Text style={{ fontFamily: 'Inter_700Bold' }}>{stats.doublesCount}</Text> doubles rolled
                  </Text>
                </View>
              )}
            </View>
          </>
        ) : null}

        {/* ── Single player overview (if not multiplayer) ── */}
        {!isMultiplayer && (
          <>
            <SectionLabel text="OVERVIEW" colors={colors} />
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.statRow}>
                <StatBox label="Mean" value={stats.mean !== null ? stats.mean.toFixed(2) : '—'} colors={colors} />
                <StatBox label="Median" value={stats.median !== null ? stats.median.toFixed(1) : '—'} colors={colors} />
                <StatBox label="Mode" value={stats.mode.slice(0, 2).join('/') || '—'} colors={colors} />
                <StatBox label="Expected" value={stats.expectedMean.toFixed(1)} colors={colors} />
              </View>
            </View>
          </>
        )}

        {/* ── Catan production analysis ── */}
        {catanStats && catanStats.hasExposureData && (
          <>
            <SectionLabel text="SETTLEMENT PRODUCTION" colors={colors} />

            {/* Seven frequency */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 10 }]}>
              <View style={[styles.eventRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                <Ionicons name="dice-outline" size={15} color={colors.destructive} />
                <Text style={[styles.eventText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
                  <Text style={{ fontFamily: 'Inter_700Bold', color: colors.destructive }}>{catanStats.sevenCount}</Text>
                  {' sevens — expected '}
                  <Text style={{ fontFamily: 'Inter_700Bold' }}>{catanStats.sevenExpected}</Text>
                  {' ('}
                  <Text style={{ fontFamily: 'Inter_600SemiBold', color: catanStats.findings?.sevenFrequency === 'high' ? colors.destructive : catanStats.findings?.sevenFrequency === 'low' ? colors.primary : colors.mutedForeground }}>
                    {catanStats.findings?.sevenFrequency ?? 'expected'} rate
                  </Text>
                  {')'}
                </Text>
              </View>
              {catanStats.isSmallSample && (
                <View style={styles.eventRow}>
                  <Ionicons name="information-circle-outline" size={15} color={colors.mutedForeground} />
                  <Text style={[styles.eventText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                    Small sample ({catanStats.totalRolls} rolls) — production analysis is indicative only.
                  </Text>
                </View>
              )}
            </View>

            {/* Per-player production table */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {/* Header */}
              <View style={[styles.freqHeader, { borderBottomColor: colors.border }]}>
                <Text style={[{ flex: 1 }, styles.colHdr, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>PLAYER</Text>
                <Text style={[{ width: 52, textAlign: 'right' }, styles.colHdr, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>EXP</Text>
                <Text style={[{ width: 52, textAlign: 'right' }, styles.colHdr, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>GOT</Text>
                <Text style={[{ width: 58, textAlign: 'right' }, styles.colHdr, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>LUCK</Text>
              </View>
              {catanStats.playerStats.map((ps, idx) => {
                const player = activeSession.players.find(p => p.id === ps.playerId);
                const isLast = idx === catanStats.playerStats.length - 1;
                const luckPct = Math.round(ps.productionLuckPct);
                // Prefer the simulated percentile over the raw ±%: the same
                // percentage means very different things at 40 rolls and 150,
                // whereas a percentile is comparable across any game length.
                const pctile = ps.productionLuckPercentile;
                const hasPctile = typeof pctile === 'number';
                const luckLabel = hasPctile
                  ? `${Math.round(pctile)}%ile`
                  : luckPct === 0
                    ? '—'
                    : `${luckPct > 0 ? '+' : ''}${luckPct}%`;
                const luckColor = hasPctile
                  ? pctile > 90
                    ? colors.primary
                    : pctile < 10
                      ? colors.destructive
                      : colors.mutedForeground
                  : luckPct > 10
                    ? colors.primary
                    : luckPct < -10
                      ? colors.destructive
                      : colors.mutedForeground;
                return (
                  <View
                    key={ps.playerId}
                    style={[
                      styles.freqRow,
                      { borderBottomColor: colors.border, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth },
                    ]}
                  >
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={[styles.playerDot, { backgroundColor: player?.color ?? colors.primary, width: 8, height: 8, borderRadius: 4 }]} />
                      <Text style={[styles.freqText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', flex: 1 }]} numberOfLines={1}>
                        {ps.displayName}
                        {ps.playerId === activeSession.winnerPlayerId ? ' 🏆' : ''}
                      </Text>
                    </View>
                    <Text style={[{ width: 52, textAlign: 'right' }, styles.freqText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                      {ps.totalExpectedProduction.toFixed(1)}
                    </Text>
                    <Text style={[{ width: 52, textAlign: 'right' }, styles.freqText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                      {ps.totalActualProduction.toFixed(1)}
                    </Text>
                    <Text style={[{ width: 58, textAlign: 'right' }, styles.freqText, { color: luckColor, fontFamily: 'Inter_500Medium' }]}>
                      {luckLabel}
                    </Text>
                  </View>
                );
              })}
            </View>

            {/* Placement strength */}
            {catanStats.playerStats.some(p => p.placementStrength > 0) && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginTop: 14 }]}>
                  PLACEMENT STRENGTH
                </Text>
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {catanStats.playerStats
                    .slice()
                    .sort((a, b) => b.placementStrength - a.placementStrength)
                    .map((ps, idx, arr) => {
                      const player = activeSession.players.find(p => p.id === ps.playerId);
                      const rating = catanStats.findings?.placementRating[ps.playerId] ?? 'average';
                      const ratingColor = rating === 'strong' ? colors.primary : rating === 'weak' ? colors.destructive : colors.mutedForeground;
                      const isLast = idx === arr.length - 1;
                      return (
                        <View
                          key={ps.playerId}
                          style={[
                            styles.freqRow,
                            { borderBottomColor: colors.border, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth },
                          ]}
                        >
                          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <View style={[{ backgroundColor: player?.color ?? colors.primary, width: 8, height: 8, borderRadius: 4 }]} />
                            <Text style={[styles.freqText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', flex: 1 }]} numberOfLines={1}>
                              {ps.displayName}
                              {/* Ports are trade access, not production — shown
                                  beside placement strength rather than folded
                                  into it, because there is no honest exchange
                                  rate between pips and a 2:1 port. */}
                              {ps.portAccess.length > 0
                                ? ` · ${ps.portAccess.map(describePort).join(', ')}`
                                : ''}
                            </Text>
                          </View>
                          <Text style={[styles.freqText, { color: ratingColor, fontFamily: 'Inter_600SemiBold', marginRight: 8 }]}>
                            {rating}
                          </Text>
                          <Text style={[styles.freqText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', width: 52, textAlign: 'right' }]}>
                            {(ps.placementStrength * 36).toFixed(1)} pip/roll
                          </Text>
                        </View>
                      );
                    })}
                </View>
              </>
            )}

            {/* Development card deck luck */}
            {devCardStats && devCardStats.totalDraws > 0 && (
              <>
                <SectionLabel text="DEVELOPMENT CARDS" colors={colors} />
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {devCardStats.playerStats
                    .filter(ds => ds.counts.total > 0)
                    .map((ds, idx, arr) => (
                      <View
                        key={ds.playerId}
                        style={[
                          styles.freqRow,
                          { borderBottomColor: colors.border, borderBottomWidth: idx === arr.length - 1 ? 0 : StyleSheet.hairlineWidth },
                        ]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.freqText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]} numberOfLines={1}>
                            {ds.displayName}
                          </Text>
                          <Text style={[styles.verdictNote, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                            {ds.counts.total} card{ds.counts.total === 1 ? '' : 's'} · {ds.counts.knight} knight
                            {ds.counts.knight === 1 ? '' : 's'} · {ds.counts.victoryPoint} VP
                          </Text>
                          {typeof ds.victoryPointPercentile === 'number' && (
                            <Text style={[styles.verdictNote, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                              Victory points: {describePercentile(ds.victoryPointPercentile)}
                            </Text>
                          )}
                        </View>
                      </View>
                    ))}
                  <Text style={[styles.verdictNote, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 8 }]}>
                    {devCardStats.remainingInDeck} of {DEV_DECK_SIZE} cards left undrawn.
                  </Text>
                </View>
              </>
            )}

            {/* Catan verdict */}
            {catanStats.findings && (
              <>
                <SectionLabel text="SETTLEMENT VERDICT" colors={colors} />
                <View style={[styles.verdictCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                  <Text style={[styles.verdictHeadline, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                    {catanStats.findings.headline}
                  </Text>
                  {catanStats.findings.details.map((detail, i) => (
                    <Text key={i} style={[styles.verdictBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                      {detail}
                    </Text>
                  ))}
                  {/* The actual number behind the label. A percentile is what
                      players can compare between games and argue about. */}
                  {catanStats.playerStats
                    .filter(ps => typeof ps.productionLuckPercentile === 'number')
                    .map(ps => (
                      <Text
                        key={ps.playerId}
                        style={[styles.verdictNote, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 4 }]}
                      >
                        {ps.displayName}: {describePercentile(ps.productionLuckPercentile!)}
                      </Text>
                    ))}
                  <Text style={[styles.verdictNote, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 8 }]}>
                    This is an independent companion tool and is not affiliated with or endorsed by the publishers or owners of Catan.
                  </Text>
                </View>
              </>
            )}
          </>
        )}

        {/* ── Footer actions ── */}
        <View style={[styles.footerRow, { marginTop: 24 }]}>
          <TouchableOpacity
            style={[styles.footerShareBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={handleShare}
            activeOpacity={0.85}
          >
            <Ionicons name="share-social-outline" size={18} color={colors.primary} />
            <Text style={[styles.footerShareBtnText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
              Share
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.doneBtn, styles.footerDoneBtn, { backgroundColor: colors.primary }]}
            onPress={handleDone}
            activeOpacity={0.85}
          >
            <Text style={[styles.doneBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_700Bold' }]}>
              Done
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type Colors = ReturnType<typeof useColors>;

function SectionLabel({ text, colors }: { text: string; colors: Colors }) {
  return (
    <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
      {text}
    </Text>
  );
}

function StatBox({ label, value, colors }: { label: string; value: string; colors: Colors }) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statBoxValue, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{value}</Text>
      <Text style={[styles.statBoxLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{label}</Text>
    </View>
  );
}

function Chip({
  icon,
  label,
  colors,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  colors: Colors;
}) {
  return (
    <View style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Ionicons name={icon} size={13} color={colors.mutedForeground} />
      <Text style={[styles.chipText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
        {label}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 16, flex: 1 },
  bodyText: { fontSize: 16 },

  scroll: { paddingHorizontal: 16 },
  sectionLabel: { fontSize: 11, letterSpacing: 1.2, marginTop: 20, marginBottom: 8 },

  // Winner banner
  winnerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 16,
  },
  winnerBannerText: { flex: 1, gap: 2 },
  winnerBannerName: { fontSize: 22 },
  winnerBannerSub: { fontSize: 13 },

  noWinnerHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  noWinnerTitle: { fontSize: 20, flex: 1 },

  // Chips
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: { fontSize: 12 },

  // Verdict
  verdictCard: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 8, marginBottom: 4 },
  verdictHeadline: { fontSize: 18 },
  verdictBody: { fontSize: 14, lineHeight: 22 },
  verdictNote: { fontSize: 11, opacity: 0.7, marginTop: 4 },

  // Card
  card: { borderRadius: 12, borderWidth: 1, overflow: 'hidden', marginBottom: 4 },
  playerCard: { marginBottom: 10, borderLeftWidth: 4 },

  // Stat boxes
  statRow: { flexDirection: 'row', paddingVertical: 14 },
  statBox: { flex: 1, alignItems: 'center', gap: 3 },
  statBoxValue: { fontSize: 20 },
  statBoxLabel: { fontSize: 11 },

  // Distribution legend
  chartLegend: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
    marginBottom: 0,
    paddingHorizontal: 4,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 12 },

  // Frequency table
  freqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  freqRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  freqText: { fontSize: 13 },
  colHdr: { fontSize: 10, letterSpacing: 0.8 },
  freqColVal: { width: 32 },
  freqColBar: { flex: 1, marginHorizontal: 8 },
  freqColNum: { width: 44, textAlign: 'right' },
  freqColDev: { width: 46, textAlign: 'right' },
  barTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },

  // Player summaries
  playerHeading: { fontSize: 15, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  playerNote: { fontSize: 12, paddingHorizontal: 16, paddingBottom: 10, lineHeight: 18 },

  // Events
  eventRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14 },
  eventText: { flex: 1, fontSize: 14, lineHeight: 20 },

  // Winner picker
  winnerHeader: { alignItems: 'center', gap: 8, paddingTop: 40, paddingBottom: 24, paddingHorizontal: 24 },
  winnerTitle: { fontSize: 28 },
  winnerSub: { fontSize: 14, textAlign: 'center' },
  winnerList: { paddingHorizontal: 20, gap: 10, paddingBottom: 20 },
  winnerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  playerDot: { width: 14, height: 14, borderRadius: 7 },
  winnerCardName: { flex: 1, fontSize: 16 },
  winnerFooter: { padding: 20, borderTopWidth: 1 },

  // Done button
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderRadius: 14,
  },
  doneBtnText: { fontSize: 17 },

  // Footer action row (Share + Done)
  footerRow: { flexDirection: 'row', gap: 10 },
  footerShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1,
  },
  footerShareBtnText: { fontSize: 16 },
  footerDoneBtn: { flex: 1 },

  // Inline share preview card (below verdict)
  sharePreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 10,
    gap: 12,
  },
  sharePreviewLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  sharePreviewText: { flex: 1, gap: 2 },
  sharePreviewLabel: { fontSize: 14 },
  sharePreviewDesc: { fontSize: 12 },
  sharePreviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  sharePreviewBtnText: { fontSize: 13 },
});
