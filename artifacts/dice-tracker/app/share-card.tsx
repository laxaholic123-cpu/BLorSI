/**
 * Share Card Screen — generates shareable result cards for a completed session.
 *
 * Route: /share-card?id=<sessionId>
 *
 * Five card types:
 *   1. Verdict Card      — verdict headline + explanation + session summary
 *   2. Game Summary Card — overall stats (rolls, mean, mode, duration, players)
 *   3. Player Accolade   — per-player highlight card (streaks, nat 20s, etc.)
 *   4. Rivalry Card      — two-player head-to-head (multiplayer only)
 *   5. Catan Production  — expected vs actual production (Catan only)
 *
 * Cards can be:
 *   - Captured as an image and shared via the native share sheet
 *   - Saved to the camera roll (requires media library permission)
 *   - Copied / shared as a formatted text summary
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { useColors } from '@/hooks/useColors';
import { useSettings } from '@/context/SettingsContext';
import { loadExposureEvents, loadRollEvents, loadSession } from '@/services/storage';
import { computeAllStats, formatDuration } from '@/services/stats';
import { computeCatanGameStats } from '@/services/catanStats';
import type { CatanPlayerExposureEvent, GameSession, RollEvent } from '@/types/models';
import type { CatanGameStats } from '@/types/catanStats';
import { type CardType, CARD_METADATA, isCardType } from '@/services/shareCard';

// ─── Card type list ───────────────────────────────────────────────────────────

const CARD_TYPES: Array<{ type: CardType; label: string; icon: string; desc: string }> = (
  Object.entries(CARD_METADATA) as Array<[CardType, typeof CARD_METADATA[CardType]]>
).map(([type, { label, icon, desc }]) => ({ type, label, icon, desc }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '—'; }
}

function gameLabel(session: GameSession): string {
  return session.customGameName ?? (session.gameType === 'catan' ? 'Settlement Mode' : session.diceMode);
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ShareCardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  const { id, cardType: cardTypeParam } = useLocalSearchParams<{ id: string; cardType?: string }>();
  const webTop = Platform.OS === 'web' ? 67 : 0;

  const [session, setSession] = useState<GameSession | null>(null);
  const [rollEvents, setRollEvents] = useState<RollEvent[]>([]);
  const [exposureEvents, setExposureEvents] = useState<CatanPlayerExposureEvent[]>([]);
  const [loading, setLoading] = useState(true);
  // Pre-select card type from ?cardType= param if it is a valid CardType
  const [selectedCard, setSelectedCard] = useState<CardType>(
    isCardType(cardTypeParam) ? cardTypeParam : 'verdict',
  );
  const [selectedPlayerIdx, setSelectedPlayerIdx] = useState(0);
  const [sharing, setSharing] = useState(false);

  const cardRef = useRef<View>(null);

  const haptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    if (settings.hapticsEnabled) void Haptics.impactAsync(style);
  };

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const [s, r, e] = await Promise.all([loadSession(id), loadRollEvents(id), loadExposureEvents(id)]);
      setSession(s);
      setRollEvents(r);
      setExposureEvents(e);
      setLoading(false);
    })();
  }, [id]);

  const stats = useMemo(
    () => (session ? computeAllStats(session, rollEvents) : null),
    [session, rollEvents],
  );

  const catanStats = useMemo<CatanGameStats | null>(
    () =>
      session?.gameType === 'catan' && exposureEvents.length > 0
        ? computeCatanGameStats(session, rollEvents, exposureEvents)
        : null,
    [session, rollEvents, exposureEvents],
  );

  // Available card types for this session
  const availableCards = useMemo(() => {
    if (!session) return [];
    return CARD_TYPES.filter(c => {
      if (c.type === 'rivalry') return session.players.length === 2;
      if (c.type === 'catan') return session.gameType === 'catan' && !!catanStats?.hasExposureData;
      if (c.type === 'accolade') return session.players.length > 0;
      return true;
    });
  }, [session, catanStats]);

  useEffect(() => {
    // Auto-select first available card when session loads
    if (availableCards.length > 0 && !availableCards.find(c => c.type === selectedCard)) {
      setSelectedCard(availableCards[0]!.type);
    }
  }, [availableCards, selectedCard]);

  // ── Share handlers ──────────────────────────────────────────────────────────

  const captureCard = async (): Promise<string | null> => {
    if (!cardRef.current) return null;
    try {
      const uri = await captureRef(cardRef, { format: 'jpg', quality: 0.92 });
      return uri;
    } catch {
      return null;
    }
  };

  const handleShareImage = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Not available', 'Image sharing is not supported in web preview. Use the text share option.');
      return;
    }
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    setSharing(true);
    try {
      const uri = await captureCard();
      if (!uri) {
        Alert.alert('Could not capture card', 'Try the text share option instead.');
        return;
      }
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', dialogTitle: 'Share your result card' });
      } else {
        Alert.alert('Sharing not available', 'Your device does not support file sharing.');
      }
    } catch {
      Alert.alert('Error', 'Could not share image.');
    } finally {
      setSharing(false);
    }
  };

  const handleSaveImage = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Not available', 'Saving to camera roll is not supported in web preview.');
      return;
    }
    // Lazy-load expo-media-library so the screen doesn't crash in Expo Go,
    // which doesn't bundle this native module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    let MediaLibrary: typeof import('expo-media-library');
    try {
      MediaLibrary = require('expo-media-library');
    } catch {
      Alert.alert(
        'Not available in Expo Go',
        'Saving to Photos requires a development build. Use "Share Image" to save via the share sheet instead.',
      );
      return;
    }
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    setSharing(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow access to Photos to save the card image.');
        return;
      }
      const uri = await captureCard();
      if (!uri) {
        Alert.alert('Could not capture card', 'Try the text share option instead.');
        return;
      }
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('Saved!', 'Card image saved to your Photos.');
    } catch {
      Alert.alert('Error', 'Could not save image.');
    } finally {
      setSharing(false);
    }
  };

  const handleShareText = async () => {
    if (!session || !stats) return;
    haptic();
    const activeRolls = rollEvents.filter(r => !r.deletedAt);
    const durationSeconds = session.endedAt
      ? Math.round((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000)
      : null;
    const winner = session.winnerPlayerId
      ? session.players.find(p => p.id === session.winnerPlayerId)
      : null;

    const lines = [
      `🎲 SKILL CHECK — ${gameLabel(session)}`,
      formatDate(session.startedAt),
      `${activeRolls.length} rolls · ${session.diceMode}${durationSeconds ? ` · ${formatDuration(durationSeconds)}` : ''}`,
      '',
      session.players.length > 1 ? `Players: ${session.players.map(p => p.displayName).join(', ')}` : null,
      winner ? `Winner: ${winner.displayName} 🏆` : null,
      '',
      stats.mean !== null ? `Mean: ${stats.mean.toFixed(2)} (expected ${stats.expectedMean.toFixed(1)})` : null,
      stats.mode.length > 0 ? `Most rolled: ${stats.mode.join('/')}` : null,
      '',
      `✓ ${stats.verdictHeadline}`,
      stats.isSmallSample ? null : stats.verdictExplanation,
      '',
      'Tracked with Skill Check.',
    ].filter((l): l is string => l !== null && l !== '').join('\n');

    try {
      await Share.share({ message: lines });
    } catch {}
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading || !session || !stats) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
          {loading ? 'Loading…' : 'Session not found'}
        </Text>
      </View>
    );
  }

  const canShareImage = Platform.OS !== 'web';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + webTop + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="close" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Share</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        {/* Card type selector */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typePicker}>
          {availableCards.map(card => {
            const selected = card.type === selectedCard;
            return (
              <TouchableOpacity
                key={card.type}
                style={[styles.typePill, {
                  backgroundColor: selected ? colors.primary : colors.card,
                  borderColor: selected ? colors.primary : colors.border,
                }]}
                onPress={() => { haptic(); setSelectedCard(card.type); }}
              >
                <Ionicons name={card.icon as any} size={14} color={selected ? colors.primaryForeground : colors.mutedForeground} />
                <Text style={[styles.typePillText, {
                  color: selected ? colors.primaryForeground : colors.foreground,
                  fontFamily: selected ? 'Inter_600SemiBold' : 'Inter_400Regular',
                }]}>
                  {card.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Player selector for accolade card */}
        {selectedCard === 'accolade' && session.players.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typePicker}>
            {session.players.map((player, idx) => (
              <TouchableOpacity
                key={player.id}
                style={[styles.typePill, {
                  backgroundColor: selectedPlayerIdx === idx ? player.color + 'DD' : colors.card,
                  borderColor: selectedPlayerIdx === idx ? player.color : colors.border,
                }]}
                onPress={() => { haptic(); setSelectedPlayerIdx(idx); }}
              >
                <View style={[styles.playerDot, { backgroundColor: player.color }]} />
                <Text style={[styles.typePillText, { color: colors.foreground, fontFamily: selectedPlayerIdx === idx ? 'Inter_600SemiBold' : 'Inter_400Regular' }]}>
                  {player.displayName}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Card preview */}
        <CardRenderer
          ref={cardRef}
          type={selectedCard}
          session={session}
          rollEvents={rollEvents}
          stats={stats}
          catanStats={catanStats}
          playerIdx={selectedPlayerIdx}
          colors={colors}
        />

        {/* Share actions */}
        <View style={styles.actions}>
          {canShareImage && (
            <>
              <ActionButton
                icon="share-social-outline"
                label={sharing ? 'Preparing…' : 'Share Image'}
                primary
                onPress={handleShareImage}
                disabled={sharing}
                colors={colors}
              />
              <ActionButton
                icon="image-outline"
                label={sharing ? 'Saving…' : 'Save to Photos'}
                onPress={handleSaveImage}
                disabled={sharing}
                colors={colors}
              />
            </>
          )}
          <ActionButton
            icon="document-text-outline"
            label="Share as Text"
            primary={!canShareImage}
            onPress={handleShareText}
            colors={colors}
          />
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Card renderer ────────────────────────────────────────────────────────────

type StatsType = ReturnType<typeof computeAllStats>;

const CardRenderer = React.forwardRef<View, {
  type: CardType;
  session: GameSession;
  rollEvents: RollEvent[];
  stats: StatsType;
  catanStats: CatanGameStats | null;
  playerIdx: number;
  colors: ReturnType<typeof useColors>;
}>(function CardRenderer({ type, session, rollEvents, stats, catanStats, playerIdx, colors }, ref) {
  const activeRolls = rollEvents.filter(r => !r.deletedAt);
  const durationSeconds = session.endedAt
    ? Math.round((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000)
    : null;
  const winner = session.winnerPlayerId
    ? session.players.find(p => p.id === session.winnerPlayerId)
    : null;

  const cardBase = [
    cardStyles.card,
    { backgroundColor: '#0F1923', borderColor: '#1ABC9C22' },
  ];

  return (
    <View ref={ref} collapsable={false} style={cardStyles.wrapper}>
      {type === 'verdict' && (
        <View style={cardBase}>
          <CardHeader session={session} activeRollCount={activeRolls.length} durationSeconds={durationSeconds} />
          <View style={[cardStyles.verdictBox, { borderColor: '#1ABC9C33' }]}>
            <Text style={[cardStyles.verdictHeadline, { color: '#1ABC9C' }]}>
              {stats.verdictHeadline}
            </Text>
            <Text style={cardStyles.verdictBody} numberOfLines={4}>
              {stats.isSmallSample
                ? `Only ${stats.totalRolls} rolls — verdict requires more data.`
                : stats.verdictExplanation}
            </Text>
          </View>
          {stats.mean !== null && (
            <View style={cardStyles.statRow}>
              <MiniStat label="Mean" value={stats.mean.toFixed(2)} accent />
              <MiniStat label="Expected" value={stats.expectedMean.toFixed(1)} />
              <MiniStat label="Rolls" value={String(activeRolls.length)} />
              {stats.meanZScore !== null && <MiniStat label="Z-score" value={stats.meanZScore.toFixed(2)} />}
            </View>
          )}
          <CardFooter winner={winner} />
        </View>
      )}

      {type === 'summary' && (
        <View style={cardBase}>
          <CardHeader session={session} activeRollCount={activeRolls.length} durationSeconds={durationSeconds} />
          <View style={cardStyles.statRow}>
            <MiniStat label="Rolls" value={String(activeRolls.length)} accent />
            <MiniStat label="Mode" value={stats.mode.slice(0, 2).join('/') || '—'} />
            <MiniStat label="Mean" value={stats.mean?.toFixed(1) ?? '—'} />
            <MiniStat label="Players" value={String(session.players.length)} />
          </View>
          {stats.frequencies.slice(0, 8).map(f => {
            const barPct = activeRolls.length > 0 ? f.count / Math.max(...stats.frequencies.map(ff => ff.count), 1) : 0;
            const isHot = f.deviation > 0.5;
            return (
              <View key={f.value} style={cardStyles.freqRow}>
                <Text style={cardStyles.freqVal}>{f.value}</Text>
                <View style={cardStyles.freqBarTrack}>
                  <View style={[cardStyles.freqBarFill, { width: `${barPct * 100}%` as `${number}%`, backgroundColor: isHot ? '#1ABC9C' : '#334' }]} />
                </View>
                <Text style={cardStyles.freqCount}>{f.count}</Text>
              </View>
            );
          })}
          <CardFooter winner={winner} />
        </View>
      )}

      {type === 'accolade' && (() => {
        const player = session.players[playerIdx] ?? session.players[0];
        if (!player) return null;
        const playerSummary = stats.playerSummaries.find(ps => ps.playerId === player.id);
        const isD20 = session.diceMode === 'D20';
        return (
          <View style={[...cardBase, { borderLeftColor: player.color, borderLeftWidth: 4 }]}>
            <CardHeader session={session} activeRollCount={activeRolls.length} durationSeconds={durationSeconds} />
            <View style={[cardStyles.accladeNameRow, { borderColor: player.color + '33' }]}>
              <View style={[cardStyles.playerDotLarge, { backgroundColor: player.color }]} />
              <Text style={[cardStyles.accladeName, { color: player.color }]}>{player.displayName}</Text>
              {player.id === session.winnerPlayerId && <Text style={cardStyles.trophy}>🏆</Text>}
            </View>
            {playerSummary && (
              <View style={cardStyles.statRow}>
                <MiniStat label="Rolls" value={String(playerSummary.rollCount)} accent />
                <MiniStat label="Avg" value={playerSummary.mean?.toFixed(2) ?? '—'} />
                <MiniStat label="Mode" value={playerSummary.mode.slice(0, 2).join('/') || '—'} />
                {isD20 && <MiniStat label="Nat 20s" value={String(playerSummary.nat20Count)} />}
              </View>
            )}
            {playerSummary?.longestStreak && (
              <Text style={cardStyles.notableText}>
                🔥 Rolled {playerSummary.longestStreak.value} × {playerSummary.longestStreak.length} in a row
              </Text>
            )}
            <CardFooter winner={null} />
          </View>
        );
      })()}

      {type === 'rivalry' && session.players.length >= 2 && (() => {
        const [p1, p2] = [session.players[0]!, session.players[1]!];
        const s1 = stats.playerSummaries.find(ps => ps.playerId === p1.id);
        const s2 = stats.playerSummaries.find(ps => ps.playerId === p2.id);
        return (
          <View style={cardBase}>
            <CardHeader session={session} activeRollCount={activeRolls.length} durationSeconds={durationSeconds} />
            <View style={cardStyles.rivalryRow}>
              <View style={cardStyles.rivalryPlayer}>
                <View style={[cardStyles.playerDotLarge, { backgroundColor: p1.color, alignSelf: 'center' }]} />
                <Text style={[cardStyles.rivalryName, { color: p1.color }]} numberOfLines={1}>{p1.displayName}</Text>
                {s1 && (
                  <>
                    <Text style={cardStyles.rivalryBigStat}>{s1.rollCount}</Text>
                    <Text style={cardStyles.rivalryLabel}>rolls</Text>
                    <Text style={cardStyles.rivalryBigStat}>{s1.mean?.toFixed(1) ?? '—'}</Text>
                    <Text style={cardStyles.rivalryLabel}>avg</Text>
                  </>
                )}
                {p1.id === session.winnerPlayerId && <Text style={cardStyles.trophy}>🏆</Text>}
              </View>
              <Text style={cardStyles.rivalryVs}>vs</Text>
              <View style={[cardStyles.rivalryPlayer, { alignItems: 'flex-end' }]}>
                <View style={[cardStyles.playerDotLarge, { backgroundColor: p2.color, alignSelf: 'center' }]} />
                <Text style={[cardStyles.rivalryName, { color: p2.color, textAlign: 'right' }]} numberOfLines={1}>{p2.displayName}</Text>
                {s2 && (
                  <>
                    <Text style={[cardStyles.rivalryBigStat, { textAlign: 'right' }]}>{s2.rollCount}</Text>
                    <Text style={[cardStyles.rivalryLabel, { textAlign: 'right' }]}>rolls</Text>
                    <Text style={[cardStyles.rivalryBigStat, { textAlign: 'right' }]}>{s2.mean?.toFixed(1) ?? '—'}</Text>
                    <Text style={[cardStyles.rivalryLabel, { textAlign: 'right' }]}>avg</Text>
                  </>
                )}
                {p2.id === session.winnerPlayerId && <Text style={[cardStyles.trophy, { textAlign: 'right' }]}>🏆</Text>}
              </View>
            </View>
            <CardFooter winner={null} />
          </View>
        );
      })()}

      {type === 'catan' && catanStats && (
        <View style={cardBase}>
          <CardHeader session={session} activeRollCount={activeRolls.length} durationSeconds={durationSeconds} />
          <View style={cardStyles.tableHeader}>
            <Text style={[cardStyles.tableCell, { flex: 1, color: '#888' }]}>PLAYER</Text>
            <Text style={[cardStyles.tableCell, { width: 50, color: '#888', textAlign: 'right' }]}>EXP</Text>
            <Text style={[cardStyles.tableCell, { width: 50, color: '#888', textAlign: 'right' }]}>GOT</Text>
            <Text style={[cardStyles.tableCell, { width: 48, color: '#888', textAlign: 'right' }]}>±%</Text>
          </View>
          {catanStats.playerStats.map(ps => {
            const player = session.players.find(p => p.id === ps.playerId);
            const pct = Math.round(ps.productionLuckPct);
            const pctColor = pct > 10 ? '#1ABC9C' : pct < -10 ? '#E05C5C' : '#888';
            return (
              <View key={ps.playerId} style={cardStyles.tableRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <View style={[cardStyles.playerDot, { backgroundColor: player?.color ?? '#1ABC9C' }]} />
                  <Text style={[cardStyles.tableCell, { color: '#EEE' }]} numberOfLines={1}>{ps.displayName}</Text>
                </View>
                <Text style={[cardStyles.tableCell, { width: 50, color: '#888', textAlign: 'right' }]}>{ps.totalExpectedProduction.toFixed(1)}</Text>
                <Text style={[cardStyles.tableCell, { width: 50, color: '#EEE', fontFamily: 'Inter_700Bold', textAlign: 'right' }]}>{ps.totalActualProduction.toFixed(1)}</Text>
                <Text style={[cardStyles.tableCell, { width: 48, color: pctColor, textAlign: 'right' }]}>{pct === 0 ? '—' : `${pct > 0 ? '+' : ''}${pct}%`}</Text>
              </View>
            );
          })}
          {catanStats.findings && (
            <Text style={cardStyles.notableText}>{catanStats.findings.headline}</Text>
          )}
          <CardFooter winner={winner} />
        </View>
      )}
    </View>
  );
});

// ─── Card sub-components ──────────────────────────────────────────────────────

function CardHeader({ session, activeRollCount, durationSeconds }: { session: GameSession; activeRollCount: number; durationSeconds: number | null }) {
  return (
    <View style={cardStyles.headerRow}>
      <View style={cardStyles.wordmark}>
        <View style={[cardStyles.wordmarkDot, { backgroundColor: '#1ABC9C' }]}>
          <Text style={cardStyles.wordmarkCheck}>✓</Text>
        </View>
        <Text style={cardStyles.wordmarkText}>SKILL CHECK</Text>
      </View>
      <View style={cardStyles.headerRight}>
        <Text style={cardStyles.headerGame}>{gameLabel(session)}</Text>
        <Text style={cardStyles.headerMeta}>
          {formatDate(session.startedAt)} · {activeRollCount} rolls{durationSeconds ? ` · ${formatDuration(durationSeconds)}` : ''}
        </Text>
      </View>
    </View>
  );
}

function CardFooter({ winner }: { winner: { displayName: string } | null | undefined }) {
  return (
    <View style={cardStyles.footer}>
      {winner && <Text style={[cardStyles.footerText, { color: '#1ABC9C' }]}>🏆 {winner.displayName}</Text>}
      <Text style={cardStyles.footerTagline}>Bad luck or skill issue?</Text>
    </View>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={cardStyles.miniStat}>
      <Text style={[cardStyles.miniStatValue, { color: accent ? '#1ABC9C' : '#EEE' }]}>{value}</Text>
      <Text style={cardStyles.miniStatLabel}>{label}</Text>
    </View>
  );
}

function ActionButton({ icon, label, primary, onPress, disabled, colors }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  primary?: boolean;
  onPress: () => void;
  disabled?: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.actionBtn,
        primary ? { backgroundColor: colors.primary } : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
        disabled && { opacity: 0.55 },
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
    >
      <Ionicons name={icon} size={18} color={primary ? colors.primaryForeground : colors.foreground} />
      <Text style={[styles.actionBtnText, { color: primary ? colors.primaryForeground : colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  headerTitle: { fontSize: 17 },
  scroll: { padding: 16, gap: 16 },
  typePicker: { flexDirection: 'row', gap: 8, paddingHorizontal: 0, paddingBottom: 4 },
  typePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1 },
  typePillText: { fontSize: 13 },
  playerDot: { width: 10, height: 10, borderRadius: 5 },
  actions: { gap: 10 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 15, borderRadius: 12 },
  actionBtnText: { fontSize: 15 },
});

const cardStyles = StyleSheet.create({
  wrapper: { borderRadius: 16, overflow: 'hidden' },
  card: { padding: 20, gap: 14, borderRadius: 16, borderWidth: 1 },

  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wordmarkDot: { width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  wordmarkCheck: { fontSize: 15, color: '#000', fontWeight: '700' },
  wordmarkText: { fontSize: 10, color: '#888', letterSpacing: 1.5, fontFamily: 'Inter_500Medium' },
  headerRight: { flex: 1, alignItems: 'flex-end' },
  headerGame: { fontSize: 12, color: '#CCC', fontFamily: 'Inter_600SemiBold' },
  headerMeta: { fontSize: 10, color: '#666', marginTop: 2 },

  verdictBox: { borderWidth: 1, borderRadius: 10, padding: 14, gap: 6 },
  verdictHeadline: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  verdictBody: { fontSize: 12, color: '#888', lineHeight: 18 },

  statRow: { flexDirection: 'row', gap: 12 },
  miniStat: { flex: 1, alignItems: 'center', gap: 3 },
  miniStatValue: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  miniStatLabel: { fontSize: 10, color: '#666', letterSpacing: 0.5 },

  freqRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  freqVal: { width: 22, fontSize: 12, color: '#AAA', fontFamily: 'Inter_600SemiBold' },
  freqBarTrack: { flex: 1, height: 6, backgroundColor: '#1A2030', borderRadius: 3, overflow: 'hidden' },
  freqBarFill: { height: 6, borderRadius: 3 },
  freqCount: { width: 24, textAlign: 'right', fontSize: 11, color: '#CCC' },

  accladeNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderWidth: 1, borderRadius: 10 },
  accladeName: { fontSize: 20, fontFamily: 'Inter_700Bold', flex: 1 },
  playerDotLarge: { width: 16, height: 16, borderRadius: 8 },
  trophy: { fontSize: 22 },
  notableText: { fontSize: 13, color: '#AAA', fontStyle: 'italic' },

  rivalryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 20 },
  rivalryPlayer: { flex: 1, gap: 4 },
  rivalryName: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  rivalryBigStat: { fontSize: 26, color: '#EEE', fontFamily: 'Inter_700Bold' },
  rivalryLabel: { fontSize: 10, color: '#666' },
  rivalryVs: { fontSize: 18, color: '#444', fontFamily: 'Inter_700Bold', alignSelf: 'center' },

  tableHeader: { flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: '#1E2A36' },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  tableCell: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  playerDot: { width: 8, height: 8, borderRadius: 4 },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  footerText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  footerTagline: { fontSize: 10, color: '#444', fontFamily: 'Inter_400Regular' },
});
