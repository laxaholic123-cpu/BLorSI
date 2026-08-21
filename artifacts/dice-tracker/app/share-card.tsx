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
import { LinearGradient } from 'expo-linear-gradient';
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

// ─── Design tokens ────────────────────────────────────────────────────────────

const CARD_BG_START = '#07111D';
const CARD_BG_END   = '#0D1E2E';
const ACCENT        = '#1ABC9C';
const ACCENT_DIM    = '#127A65';
const TEXT_PRIMARY  = '#F0F4F8';
const TEXT_MUTED    = '#6B8299';
const TEXT_DIM      = '#3A5068';
const BORDER_SUBTLE = '#142030';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '—'; }
}

function gameLabel(session: GameSession): string {
  return session.customGameName ?? (session.gameType === 'catan' ? 'Settlement Mode' : session.diceMode);
}

/** Translucent dot grid decorative overlay */
function DotGrid({ columns = 14, rows = 5, color = ACCENT }: { columns?: number; rows?: number; color?: string }) {
  const dots = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      dots.push(
        <View
          key={`${r}-${c}`}
          style={{
            width: 2,
            height: 2,
            borderRadius: 1,
            backgroundColor: color,
            opacity: 0.12,
            margin: 5,
          }}
        />,
      );
    }
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', position: 'absolute', right: 0, top: 0, width: columns * 12, overflow: 'hidden' }} pointerEvents="none">
      {dots}
    </View>
  );
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

  // simulate: true — the percentile is the most shareable thing on the card
  // ("3rd percentile" beats "poor"), and it must agree with the results screen.
  const stats = useMemo(
    () => (session ? computeAllStats(session, rollEvents, { simulate: true }) : null),
    [session, rollEvents],
  );

  const catanStats = useMemo<CatanGameStats | null>(
    () =>
      session?.gameType === 'catan' && exposureEvents.length > 0
        ? computeCatanGameStats(session, rollEvents, exposureEvents, { simulate: true })
        : null,
    [session, rollEvents, exposureEvents],
  );

  const availableCards = useMemo(() => {
    if (!session) return [];
    return CARD_TYPES.filter(c => {
      if (c.type === 'rivalry') return session.players.length === 2;
      if (c.type === 'production') return session.gameType === 'catan' && !!catanStats?.hasExposureData;
      if (c.type === 'accolade') return session.players.length > 0;
      return true;
    });
  }, [session, catanStats]);

  useEffect(() => {
    if (availableCards.length > 0 && !availableCards.find(c => c.type === selectedCard)) {
      setSelectedCard(availableCards[0]!.type);
    }
  }, [availableCards, selectedCard]);

  // ── Share handlers ──────────────────────────────────────────────────────────

  const captureCard = async (): Promise<string | null> => {
    if (!cardRef.current) return null;
    try {
      const uri = await captureRef(cardRef, { format: 'jpg', quality: 0.95 });
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
      if (!uri) { Alert.alert('Could not capture card', 'Try the text share option instead.'); return; }
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
      if (status !== 'granted') { Alert.alert('Permission needed', 'Allow access to Photos to save the card image.'); return; }
      const uri = await captureCard();
      if (!uri) { Alert.alert('Could not capture card', 'Try the text share option instead.'); return; }
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

    try { await Share.share({ message: lines }); } catch {}
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
}>(function CardRenderer({ type, session, rollEvents, stats, catanStats, playerIdx }, ref) {
  const activeRolls = rollEvents.filter(r => !r.deletedAt);
  const durationSeconds = session.endedAt
    ? Math.round((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000)
    : null;
  const winner = session.winnerPlayerId
    ? session.players.find(p => p.id === session.winnerPlayerId)
    : null;

  return (
    <View ref={ref} collapsable={false} style={cardStyles.wrapper}>
      {/* ── Verdict ─────────────────────────────────────────────────────── */}
      {type === 'verdict' && (
        <LinearGradient
          colors={[CARD_BG_START, CARD_BG_END, '#0A1E30']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[cardStyles.card, cardStyles.verdictCard]}
        >
          <DotGrid columns={12} rows={6} color={ACCENT} />

          <CardHeader session={session} activeRollCount={activeRolls.length} durationSeconds={durationSeconds} />

          {/* Verdict hero */}
          <View style={cardStyles.verdictHero}>
            <View style={cardStyles.verdictIconBadge}>
              <Text style={cardStyles.verdictIconText}>⚄</Text>
            </View>
            <Text style={cardStyles.verdictHeadlineLarge} numberOfLines={2}>
              {stats.verdictHeadline}
            </Text>
            {!stats.isSmallSample && (
              <Text style={cardStyles.verdictBodyText} numberOfLines={3}>
                {stats.verdictExplanation}
              </Text>
            )}
            {stats.isSmallSample && (
              <View style={cardStyles.smallSamplePill}>
                <Text style={cardStyles.smallSampleText}>Only {stats.totalRolls} rolls — more data needed</Text>
              </View>
            )}
          </View>

          {/* Stats strip */}
          {stats.mean !== null && (
            <View style={cardStyles.statStrip}>
              <StatChip label="Mean" value={stats.mean.toFixed(2)} accent />
              <View style={cardStyles.statDivider} />
              <StatChip label="Expected" value={stats.expectedMean.toFixed(1)} />
              <View style={cardStyles.statDivider} />
              <StatChip label="Rolls" value={String(activeRolls.length)} />
              {stats.meanZScore !== null && (
                <>
                  <View style={cardStyles.statDivider} />
                  <StatChip label="Z-score" value={stats.meanZScore.toFixed(2)} />
                </>
              )}
            </View>
          )}

          <CardFooter winner={winner} />
        </LinearGradient>
      )}

      {/* ── Summary ─────────────────────────────────────────────────────── */}
      {type === 'summary' && (
        <LinearGradient
          colors={[CARD_BG_START, CARD_BG_END]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={cardStyles.card}
        >
          <CardHeader session={session} activeRollCount={activeRolls.length} durationSeconds={durationSeconds} />

          <View style={cardStyles.statStrip}>
            <StatChip label="Rolls" value={String(activeRolls.length)} accent />
            <View style={cardStyles.statDivider} />
            <StatChip label="Mode" value={stats.mode.slice(0, 2).join('/') || '—'} />
            <View style={cardStyles.statDivider} />
            <StatChip label="Mean" value={stats.mean?.toFixed(1) ?? '—'} />
            <View style={cardStyles.statDivider} />
            <StatChip label="Players" value={String(session.players.length)} />
          </View>

          {/* Frequency chart */}
          <View style={cardStyles.freqChart}>
            {stats.frequencies.slice(0, 8).map(f => {
              const maxCount = Math.max(...stats.frequencies.map(ff => ff.count), 1);
              const barPct = activeRolls.length > 0 ? f.count / maxCount : 0;
              const isHot = f.deviation > 0.5;
              const isCold = f.deviation < -0.5;
              const barColor = isHot ? ACCENT : isCold ? '#5C7A9C' : '#2A4060';
              return (
                <View key={f.value} style={cardStyles.freqRow}>
                  <Text style={cardStyles.freqVal}>{f.value}</Text>
                  <View style={cardStyles.freqBarTrack}>
                    <View style={[cardStyles.freqBarFill, { width: `${barPct * 100}%` as `${number}%`, backgroundColor: barColor }]} />
                  </View>
                  <Text style={cardStyles.freqCount}>{f.count}</Text>
                </View>
              );
            })}
          </View>

          <CardFooter winner={winner} />
        </LinearGradient>
      )}

      {/* ── Accolade ────────────────────────────────────────────────────── */}
      {type === 'accolade' && (() => {
        const player = session.players[playerIdx] ?? session.players[0];
        if (!player) return null;
        const playerSummary = stats.playerSummaries.find(ps => ps.playerId === player.id);
        const isD20 = session.diceMode === 'D20';
        const isWinner = player.id === session.winnerPlayerId;
        return (
          <LinearGradient
            colors={[CARD_BG_START, CARD_BG_END]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[cardStyles.card, { borderLeftColor: player.color, borderLeftWidth: 4 }]}
          >
            {/* Player color glow strip */}
            <View style={[cardStyles.playerGlowStrip, { backgroundColor: player.color + '18' }]} />

            <CardHeader session={session} activeRollCount={activeRolls.length} durationSeconds={durationSeconds} />

            {/* Player hero */}
            <View style={cardStyles.accoladeHero}>
              <View style={[cardStyles.accoladeAvatar, { backgroundColor: player.color + '30', borderColor: player.color + '60' }]}>
                <Text style={[cardStyles.accoladeAvatarText, { color: player.color }]}>
                  {player.displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[cardStyles.accoladeName, { color: player.color }]} numberOfLines={1}>
                    {player.displayName}
                  </Text>
                  {isWinner && <Text style={cardStyles.trophyBadge}>🏆</Text>}
                </View>
                <Text style={cardStyles.accoladeSubtitle}>{gameLabel(session)}</Text>
              </View>
            </View>

            {playerSummary && (
              <View style={cardStyles.statStrip}>
                <StatChip label="Rolls" value={String(playerSummary.rollCount)} accent />
                <View style={cardStyles.statDivider} />
                <StatChip label="Avg" value={playerSummary.mean?.toFixed(2) ?? '—'} />
                <View style={cardStyles.statDivider} />
                <StatChip label="Mode" value={playerSummary.mode.slice(0, 2).join('/') || '—'} />
                {isD20 && (
                  <>
                    <View style={cardStyles.statDivider} />
                    <StatChip label="Nat 20s" value={String(playerSummary.nat20Count)} accent />
                  </>
                )}
              </View>
            )}
            {playerSummary?.longestStreak && (
              <View style={cardStyles.streakBadge}>
                <Text style={cardStyles.streakText}>
                  🔥 Rolled {playerSummary.longestStreak.value} × {playerSummary.longestStreak.length} in a row
                </Text>
              </View>
            )}
            <CardFooter winner={null} />
          </LinearGradient>
        );
      })()}

      {/* ── Rivalry ─────────────────────────────────────────────────────── */}
      {type === 'rivalry' && session.players.length >= 2 && (() => {
        const [p1, p2] = [session.players[0]!, session.players[1]!];
        const s1 = stats.playerSummaries.find(ps => ps.playerId === p1.id);
        const s2 = stats.playerSummaries.find(ps => ps.playerId === p2.id);
        const p1wins = p1.id === session.winnerPlayerId;
        const p2wins = p2.id === session.winnerPlayerId;
        return (
          <LinearGradient
            colors={[CARD_BG_START, CARD_BG_END]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={cardStyles.card}
          >
            <CardHeader session={session} activeRollCount={activeRolls.length} durationSeconds={durationSeconds} />

            {/* Rivalry split */}
            <View style={cardStyles.rivalrySplit}>
              {/* Player 1 */}
              <View style={[cardStyles.rivalryHalf, cardStyles.rivalryHalfLeft, { borderColor: p1.color + (p1wins ? 'AA' : '30') }]}>
                <LinearGradient
                  colors={[p1.color + '22', p1.color + '08']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFillObject}
                />
                <View style={[cardStyles.rivalryAvatarBig, { backgroundColor: p1.color + '40', borderColor: p1.color }]}>
                  <Text style={[cardStyles.rivalryAvatarText, { color: p1.color }]}>
                    {p1.displayName.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={[cardStyles.rivalryPlayerName, { color: p1.color }]} numberOfLines={1}>{p1.displayName}</Text>
                {p1wins && <Text style={cardStyles.rivalryWinnerLabel}>WINNER</Text>}
                {s1 && (
                  <View style={cardStyles.rivalryStats}>
                    <View style={cardStyles.rivalryStatItem}>
                      <Text style={cardStyles.rivalryStatValue}>{s1.rollCount}</Text>
                      <Text style={cardStyles.rivalryStatLabel}>rolls</Text>
                    </View>
                    <View style={cardStyles.rivalryStatItem}>
                      <Text style={cardStyles.rivalryStatValue}>{s1.mean?.toFixed(1) ?? '—'}</Text>
                      <Text style={cardStyles.rivalryStatLabel}>avg</Text>
                    </View>
                  </View>
                )}
              </View>

              {/* VS badge */}
              <View style={cardStyles.rivalryVsBadge}>
                <Text style={cardStyles.rivalryVsText}>VS</Text>
              </View>

              {/* Player 2 */}
              <View style={[cardStyles.rivalryHalf, cardStyles.rivalryHalfRight, { borderColor: p2.color + (p2wins ? 'AA' : '30') }]}>
                <LinearGradient
                  colors={[p2.color + '08', p2.color + '22']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFillObject}
                />
                <View style={[cardStyles.rivalryAvatarBig, { backgroundColor: p2.color + '40', borderColor: p2.color }]}>
                  <Text style={[cardStyles.rivalryAvatarText, { color: p2.color }]}>
                    {p2.displayName.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={[cardStyles.rivalryPlayerName, { color: p2.color }]} numberOfLines={1}>{p2.displayName}</Text>
                {p2wins && <Text style={cardStyles.rivalryWinnerLabel}>WINNER</Text>}
                {s2 && (
                  <View style={cardStyles.rivalryStats}>
                    <View style={cardStyles.rivalryStatItem}>
                      <Text style={cardStyles.rivalryStatValue}>{s2.rollCount}</Text>
                      <Text style={cardStyles.rivalryStatLabel}>rolls</Text>
                    </View>
                    <View style={cardStyles.rivalryStatItem}>
                      <Text style={cardStyles.rivalryStatValue}>{s2.mean?.toFixed(1) ?? '—'}</Text>
                      <Text style={cardStyles.rivalryStatLabel}>avg</Text>
                    </View>
                  </View>
                )}
              </View>
            </View>

            <CardFooter winner={null} />
          </LinearGradient>
        );
      })()}

      {/* ── Catan Production ────────────────────────────────────────────── */}
      {type === 'production' && catanStats && (
        <LinearGradient
          colors={[CARD_BG_START, CARD_BG_END]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={cardStyles.card}
        >
          <CardHeader session={session} activeRollCount={activeRolls.length} durationSeconds={durationSeconds} />

          <Text style={cardStyles.catanSectionTitle}>PRODUCTION</Text>

          <View style={cardStyles.catanChart}>
            {catanStats.playerStats.map(ps => {
              const player = session.players.find(p => p.id === ps.playerId);
              const color = player?.color ?? ACCENT;
              const pct = Math.round(ps.productionLuckPct);
              const pctColor = pct > 10 ? ACCENT : pct < -10 ? '#E06060' : TEXT_MUTED;
              const maxProduction = Math.max(...catanStats.playerStats.map(p => Math.max(p.totalExpectedProduction, p.totalActualProduction)), 1);
              const expectedWidth = ps.totalExpectedProduction / maxProduction;
              const actualWidth = ps.totalActualProduction / maxProduction;

              return (
                <View key={ps.playerId} style={cardStyles.catanRow}>
                  {/* Player label */}
                  <View style={cardStyles.catanLabel}>
                    <View style={[cardStyles.catanDot, { backgroundColor: color }]} />
                    <Text style={cardStyles.catanName} numberOfLines={1}>{ps.displayName}</Text>
                  </View>
                  {/* Bar chart */}
                  <View style={cardStyles.catanBars}>
                    {/* Expected bar */}
                    <View style={cardStyles.catanBarRow}>
                      <Text style={cardStyles.catanBarLabel}>EXP</Text>
                      <View style={cardStyles.catanBarTrack}>
                        <View style={[cardStyles.catanBarFill, { width: `${expectedWidth * 100}%` as `${number}%`, backgroundColor: TEXT_DIM }]} />
                      </View>
                      <Text style={cardStyles.catanBarVal}>{ps.totalExpectedProduction.toFixed(1)}</Text>
                    </View>
                    {/* Actual bar */}
                    <View style={cardStyles.catanBarRow}>
                      <Text style={cardStyles.catanBarLabel}>GOT</Text>
                      <View style={cardStyles.catanBarTrack}>
                        <View style={[cardStyles.catanBarFill, { width: `${actualWidth * 100}%` as `${number}%`, backgroundColor: color }]} />
                      </View>
                      <Text style={[cardStyles.catanBarVal, { color: TEXT_PRIMARY }]}>{ps.totalActualProduction.toFixed(1)}</Text>
                    </View>
                  </View>
                  {/* Delta */}
                  <Text style={[cardStyles.catanDelta, { color: pctColor }]}>
                    {pct === 0 ? '—' : `${pct > 0 ? '+' : ''}${pct}%`}
                  </Text>
                </View>
              );
            })}
          </View>

          {catanStats.findings && (
            <View style={cardStyles.catanFinding}>
              <Text style={cardStyles.catanFindingText}>{catanStats.findings.headline}</Text>
            </View>
          )}

          <CardFooter winner={winner} />
        </LinearGradient>
      )}
    </View>
  );
});

// ─── Card sub-components ──────────────────────────────────────────────────────

function CardHeader({ session, activeRollCount, durationSeconds }: {
  session: GameSession;
  activeRollCount: number;
  durationSeconds: number | null;
}) {
  return (
    <View style={cardStyles.headerRow}>
      <View style={cardStyles.wordmark}>
        <LinearGradient
          colors={[ACCENT, ACCENT_DIM]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={cardStyles.wordmarkDot}
        >
          <Text style={cardStyles.wordmarkCheck}>✓</Text>
        </LinearGradient>
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
      {winner
        ? <Text style={cardStyles.footerWinner}>🏆 {winner.displayName}</Text>
        : <View />
      }
      <Text style={cardStyles.footerTagline}>Bad luck or skill issue?</Text>
    </View>
  );
}

function StatChip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={cardStyles.statChip}>
      <Text style={[cardStyles.statChipValue, accent && cardStyles.statChipValueAccent]}>{value}</Text>
      <Text style={cardStyles.statChipLabel}>{label}</Text>
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
  wrapper: { borderRadius: 18, overflow: 'hidden' },
  card: { padding: 22, gap: 16, borderRadius: 18, overflow: 'hidden' },

  // Verdict card
  verdictCard: { gap: 18 },
  verdictHero: { alignItems: 'center', gap: 12, paddingVertical: 8 },
  verdictIconBadge: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: ACCENT + '20',
    borderWidth: 1, borderColor: ACCENT + '40',
    alignItems: 'center', justifyContent: 'center',
  },
  verdictIconText: { fontSize: 26 },
  verdictHeadlineLarge: {
    fontSize: 26, fontFamily: 'Inter_700Bold', color: TEXT_PRIMARY,
    textAlign: 'center', lineHeight: 32,
  },
  verdictBodyText: { fontSize: 13, color: TEXT_MUTED, textAlign: 'center', lineHeight: 20, paddingHorizontal: 8 },
  smallSamplePill: {
    backgroundColor: '#1E2A36',
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: BORDER_SUBTLE,
  },
  smallSampleText: { fontSize: 12, color: TEXT_MUTED, fontFamily: 'Inter_400Regular' },

  // Stat strip (shared)
  statStrip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0A1825', borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 8,
    borderWidth: 1, borderColor: BORDER_SUBTLE,
  },
  statDivider: { width: 1, height: 28, backgroundColor: BORDER_SUBTLE, marginHorizontal: 4 },
  statChip: { flex: 1, alignItems: 'center', gap: 3 },
  statChipValue: { fontSize: 20, fontFamily: 'Inter_700Bold', color: TEXT_PRIMARY },
  statChipValueAccent: { color: ACCENT },
  statChipLabel: { fontSize: 10, color: TEXT_MUTED, letterSpacing: 0.5, fontFamily: 'Inter_500Medium' },

  // Header
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  wordmarkDot: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  wordmarkCheck: { fontSize: 14, color: '#000', fontWeight: '800' },
  wordmarkText: { fontSize: 10, color: TEXT_MUTED, letterSpacing: 2, fontFamily: 'Inter_600SemiBold' },
  headerRight: { flex: 1, alignItems: 'flex-end', gap: 2 },
  headerGame: { fontSize: 11, color: TEXT_PRIMARY, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5 },
  headerMeta: { fontSize: 10, color: TEXT_MUTED },

  // Footer
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  footerWinner: { fontSize: 12, color: ACCENT, fontFamily: 'Inter_600SemiBold' },
  footerTagline: { fontSize: 10, color: TEXT_DIM, fontFamily: 'Inter_400Regular' },

  // Summary frequency chart
  freqChart: { gap: 7 },
  freqRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  freqVal: { width: 22, fontSize: 12, color: TEXT_MUTED, fontFamily: 'Inter_600SemiBold' },
  freqBarTrack: { flex: 1, height: 7, backgroundColor: '#0D1825', borderRadius: 4, overflow: 'hidden' },
  freqBarFill: { height: 7, borderRadius: 4 },
  freqCount: { width: 24, textAlign: 'right', fontSize: 11, color: TEXT_MUTED, fontFamily: 'Inter_500Medium' },

  // Accolade
  playerGlowStrip: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  accoladeHero: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 4 },
  accoladeAvatar: {
    width: 54, height: 54, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5,
  },
  accoladeAvatarText: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  accoladeName: { fontSize: 22, fontFamily: 'Inter_700Bold', flex: 1 },
  accoladeSubtitle: { fontSize: 11, color: TEXT_MUTED, fontFamily: 'Inter_400Regular' },
  trophyBadge: { fontSize: 20 },
  streakBadge: {
    backgroundColor: '#0A1825',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9,
    borderWidth: 1, borderColor: BORDER_SUBTLE,
  },
  streakText: { fontSize: 13, color: TEXT_MUTED, fontStyle: 'italic' },

  // Rivalry
  rivalrySplit: { flexDirection: 'row', gap: 12, alignItems: 'stretch' },
  rivalryHalf: {
    flex: 1, borderRadius: 12, borderWidth: 1.5,
    padding: 14, gap: 10, alignItems: 'center',
    overflow: 'hidden',
  },
  rivalryHalfLeft: {},
  rivalryHalfRight: {},
  rivalryAvatarBig: {
    width: 48, height: 48, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5,
  },
  rivalryAvatarText: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  rivalryPlayerName: { fontSize: 15, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  rivalryWinnerLabel: {
    fontSize: 9, color: ACCENT, fontFamily: 'Inter_700Bold',
    letterSpacing: 1.5, backgroundColor: ACCENT + '20',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4,
  },
  rivalryStats: { gap: 4, width: '100%' },
  rivalryStatItem: { alignItems: 'center' },
  rivalryStatValue: { fontSize: 24, color: TEXT_PRIMARY, fontFamily: 'Inter_700Bold' },
  rivalryStatLabel: { fontSize: 10, color: TEXT_MUTED, letterSpacing: 0.5 },
  rivalryVsBadge: {
    alignSelf: 'center',
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#0A1825',
    borderWidth: 1, borderColor: BORDER_SUBTLE,
    alignItems: 'center', justifyContent: 'center',
  },
  rivalryVsText: { fontSize: 11, color: TEXT_MUTED, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },

  // Catan Production
  catanSectionTitle: { fontSize: 10, color: TEXT_MUTED, fontFamily: 'Inter_600SemiBold', letterSpacing: 2 },
  catanChart: { gap: 12 },
  catanRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  catanLabel: { width: 80, flexDirection: 'row', alignItems: 'center', gap: 6 },
  catanDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  catanName: { fontSize: 11, color: TEXT_PRIMARY, fontFamily: 'Inter_500Medium', flex: 1 },
  catanBars: { flex: 1, gap: 4 },
  catanBarRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  catanBarLabel: { width: 26, fontSize: 9, color: TEXT_MUTED, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5 },
  catanBarTrack: { flex: 1, height: 7, backgroundColor: '#0D1825', borderRadius: 4, overflow: 'hidden' },
  catanBarFill: { height: 7, borderRadius: 4 },
  catanBarVal: { width: 30, fontSize: 10, color: TEXT_MUTED, fontFamily: 'Inter_500Medium', textAlign: 'right' },
  catanDelta: { width: 38, fontSize: 12, fontFamily: 'Inter_700Bold', textAlign: 'right' },
  catanFinding: {
    backgroundColor: '#0A1825',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9,
    borderWidth: 1, borderColor: BORDER_SUBTLE,
  },
  catanFindingText: { fontSize: 12, color: TEXT_MUTED, fontStyle: 'italic' },
});
