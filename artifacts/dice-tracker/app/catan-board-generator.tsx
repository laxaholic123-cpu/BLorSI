/**
 * Catan board generator.
 *
 * DISCLAIMER: This is an independent companion tool and is not affiliated
 * with or endorsed by the publishers or owners of Catan.
 *
 * Builds a legal board so players can lay out the physical tiles from the
 * screen. A generated board is known exactly, so nothing needs photographing —
 * this is the one setup path where the board reader is not involved at all.
 *
 * The metrics panel is descriptive, not prescriptive. Balance and chaos are
 * constructed indices whose weights are declared in `boardGenerator.ts`; the
 * raw counts are shown beside them so nobody has to trust the weighting.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
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
import * as Haptics from 'expo-haptics';

import { useColors } from '@/hooks/useColors';
import { useSettings } from '@/context/SettingsContext';
import { CatanHexGrid } from '@/components/CatanHexGrid';
import { saveBoardLayout } from '@/services/boardLayouts';
import { saveActiveBoard } from '@/services/storage';
import {
  generateBoard,
  DEFAULT_GEN_OPTIONS,
  type BoardGenOptions,
  type GeneratedBoard,
} from '@/services/boardGenerator';
import { describePort } from '@/services/catanBoard';

// ─── Option metadata ──────────────────────────────────────────────────────────

type OptionKey = 'desert' | 'resources' | 'numbers' | 'portPositions' | 'portTypes' | 'portAffinity';

interface OptionSpec {
  key: OptionKey;
  label: string;
  help: string;
  choices: Array<{ value: string; label: string }>;
}

const OPTION_SPECS: OptionSpec[] = [
  {
    key: 'desert',
    label: 'Desert',
    help: 'Where the robber starts.',
    choices: [
      { value: 'center', label: 'Centre' },
      { value: 'random', label: 'Anywhere' },
    ],
  },
  {
    key: 'resources',
    label: 'Resources',
    help: 'Spread avoids two of the same terrain touching.',
    choices: [
      { value: 'spread', label: 'Spread out' },
      { value: 'random', label: 'Random' },
    ],
  },
  {
    key: 'numbers',
    label: 'Numbers',
    help: 'Balanced keeps 6s and 8s apart and caps how strong any one corner can be.',
    choices: [
      { value: 'balanced', label: 'Balanced' },
      { value: 'random', label: 'Random' },
    ],
  },
  {
    key: 'portPositions',
    label: 'Harbour positions',
    help: 'Fixed matches a printed sea frame. Verify against your own box — editions differ.',
    choices: [
      { value: 'fixed', label: 'Fixed' },
      { value: 'random', label: 'Shuffled' },
    ],
  },
  {
    key: 'portTypes',
    label: 'Harbour tiles',
    help: 'Standard keeps each slot’s printed trade rate; shuffled redistributes the nine tiles.',
    choices: [
      { value: 'standard', label: 'Standard' },
      { value: 'shuffled', label: 'Shuffle tiles' },
    ],
  },
  {
    key: 'portAffinity',
    label: 'Harbour placement',
    help: 'Only applies when harbour tiles are shuffled.',
    choices: [
      { value: 'random', label: 'Random' },
      { value: 'near', label: 'Near match' },
      { value: 'far', label: 'Far from match' },
    ],
  },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CatanBoardGeneratorScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  // This screen draws its own chrome (headerShown: false), so it owes the
  // status bar its own padding. Web has no inset but does sit under the dev
  // toolbar, which is why the sibling screens add a fixed offset there.
  const webTop = Platform.OS === 'web' ? 67 : 0;

  const [options, setOptions] = useState<BoardGenOptions>({ ...DEFAULT_GEN_OPTIONS });
  const [board, setBoard] = useState<GeneratedBoard>(() =>
    generateBoard(DEFAULT_GEN_OPTIONS),
  );
  const [isSaving, setIsSaving] = useState(false);

  const haptic = useCallback(
    (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
      if (settings?.hapticsEnabled) Haptics.impactAsync(style).catch(() => {});
    },
    [settings?.hapticsEnabled],
  );

  const regenerate = useCallback(
    (next: BoardGenOptions) => {
      haptic(Haptics.ImpactFeedbackStyle.Medium);
      // No seed — a fresh search every press. The winning seed comes back on
      // the result, so whatever appears can still be reproduced later.
      setBoard(generateBoard({ ...next, seed: undefined }));
    },
    [haptic],
  );

  const setOption = (key: OptionKey, value: string) => {
    const next = { ...options, [key]: value } as BoardGenOptions;
    setOptions(next);
    regenerate(next);
  };

  const affinityDisabled = options.portTypes === 'standard';

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveBoardLayout(
        board.hexes,
        `Generated ${new Date().toLocaleDateString()}`,
        undefined,
        board.ports,
      );
      Alert.alert('Saved', 'This board is in your saved layouts.');
    } catch {
      Alert.alert('Could not save', 'The layout was not saved. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const m = board.metrics;

  /**
   * Describe a hex the way it looks on the table.
   *
   * Never by array index. "Hex 18" and "hexes 0, 3, 4" are positions in a 0-18
   * array, but they read as number tokens — and there is no 0, 1, 7 or 13-18
   * token in Catan, so they look like a generator that invented numbers. This
   * is the only vocabulary the player shares with the app: the terrain and the
   * token on it.
   */
  const describeHex = (index: number): string => {
    const hex = board.hexes[index];
    if (!hex) return '?';
    const name = hex.resource ?? 'unknown';
    return hex.number === null ? name : `${name} ${hex.number}`;
  };

  const hotLabel = useMemo(() => {
    if (!m.hottestIntersection) return '—';
    const { pips, hexIndices } = m.hottestIntersection;
    return `${pips} pips · ${hexIndices.map(describeHex).join(' + ')}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.hottestIntersection, board.hexes]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingTop: insets.top + webTop + 12,
          paddingBottom: insets.bottom + 120,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Back. This screen had no way out but "Use this board" — the same
            dead-end shape as the two scan routes fixed in 766b1d0, and one the
            hardware back button hides on Android but not on iOS. */}
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            haptic();
            router.back();
          }}
          hitSlop={12}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
          <Text style={[styles.backText, { color: colors.foreground }]}>Setup</Text>
        </TouchableOpacity>

        <Text style={[styles.title, { color: colors.foreground }]}>Generate a board</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          Lay your tiles out to match. Nothing is photographed — a generated board is
          already known.
        </Text>

        {/* ── Board ─────────────────────────────────────────────────────── */}
        <View style={[styles.boardCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <CatanHexGrid hexes={board.hexes} ports={board.ports} />
        </View>

        {/* ── Headline metrics ──────────────────────────────────────────── */}
        <View style={styles.metricRow}>
          <MetricTile
            label="Balance"
            value={String(m.balanceScore)}
            hint="100 = no violations"
            colors={colors}
            tint={m.balanceScore >= 80 ? '#10B981' : m.balanceScore >= 50 ? '#F59E0B' : '#EF4444'}
          />
          <MetricTile
            label="Chaos"
            value={String(m.chaos)}
            hint="spread of corner strength"
            colors={colors}
            tint="#8B5CF6"
          />
        </View>

        <TouchableOpacity
          style={[styles.generateBtn, { backgroundColor: colors.primary }]}
          onPress={() => regenerate(options)}
          activeOpacity={0.85}
        >
          <Ionicons name="dice-outline" size={20} color={colors.primaryForeground} />
          <Text style={[styles.generateText, { color: colors.primaryForeground }]}>
            Generate another
          </Text>
        </TouchableOpacity>

        {/* ── Detail ────────────────────────────────────────────────────── */}
        <SectionLabel text="WHAT CAME OUT" colors={colors} />
        <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <DetailRow label="Strongest corner" value={hotLabel} colors={colors} />
          <DetailRow label="Corners over 11 pips" value={String(m.intersectionsOverCap)} colors={colors} />
          <DetailRow label="Adjacent 6s / 8s" value={String(m.redAdjacencies)} colors={colors} />
          <DetailRow label="Adjacent same number" value={String(m.duplicateAdjacencies)} colors={colors} />
          <DetailRow label="Adjacent 2s / 12s" value={String(m.extremeAdjacencies)} colors={colors} />
          <DetailRow label="Adjacent same terrain" value={String(m.sameResourceAdjacencies)} colors={colors} />
          <DetailRow
            label="Most pips"
            value={m.richestResource ? `${m.richestResource} (${m.pipsByResource[m.richestResource]})` : '—'}
            colors={colors}
          />
          <DetailRow
            label="Fewest pips"
            value={m.starvedResource ? `${m.starvedResource} (${m.pipsByResource[m.starvedResource]})` : '—'}
            colors={colors}
            last
          />
        </View>

        {/* ── Harbours ──────────────────────────────────────────────────── */}
        <SectionLabel text="HARBOURS" colors={colors} />
        <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {board.ports.map((p, i) => (
            <DetailRow
              key={`${p.hexIndex}-${p.edge}`}
              label={`beside ${describeHex(p.hexIndex)}`}
              value={describePort(p.type)}
              colors={colors}
              last={i === board.ports.length - 1}
            />
          ))}
        </View>

        {/* ── Options ───────────────────────────────────────────────────── */}
        <SectionLabel text="SETTINGS" colors={colors} />
        {OPTION_SPECS.map(spec => {
          const disabled = spec.key === 'portAffinity' && affinityDisabled;
          return (
            <View
              key={spec.key}
              style={[
                styles.optionCard,
                { backgroundColor: colors.card, borderColor: colors.border, opacity: disabled ? 0.45 : 1 },
              ]}
            >
              <Text style={[styles.optionLabel, { color: colors.foreground }]}>{spec.label}</Text>
              <Text style={[styles.optionHelp, { color: colors.mutedForeground }]}>{spec.help}</Text>
              <View style={styles.choiceRow}>
                {spec.choices.map(choice => {
                  const active = (options[spec.key] as string) === choice.value;
                  return (
                    <TouchableOpacity
                      key={choice.value}
                      disabled={disabled}
                      onPress={() => setOption(spec.key, choice.value)}
                      activeOpacity={0.8}
                      style={[
                        styles.choice,
                        {
                          backgroundColor: active ? colors.primary : colors.muted,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.choiceText,
                          { color: active ? colors.primaryForeground : colors.mutedForeground },
                        ]}
                      >
                        {choice.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}

        <Text style={[styles.seed, { color: colors.mutedForeground }]}>
          Seed {board.seed} · {board.candidatesEvaluated} boards considered
        </Text>
      </ScrollView>

      {/* ── Actions ─────────────────────────────────────────────────────── */}
      <View
        style={[
          styles.footer,
          { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 12 },
        ]}
      >
        <TouchableOpacity
          style={[styles.secondaryBtn, { borderColor: colors.border, opacity: isSaving ? 0.6 : 1 }]}
          onPress={handleSave}
          disabled={isSaving}
          activeOpacity={0.85}
        >
          <Ionicons name="bookmark-outline" size={18} color={colors.foreground} />
          <Text style={[styles.secondaryText, { color: colors.foreground }]}>Save layout</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          onPress={async () => {
            haptic(Haptics.ImpactFeedbackStyle.Medium);
            // Hand the board forward so settlements can be picked off it rather
            // than typed in. Best-effort: if this fails, exposure setup falls
            // back to tapping numbers, which is where it started.
            await saveActiveBoard({ hexes: board.hexes, ports: board.ports });
            router.navigate('/catan-exposure-quick' as never);
          }}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>
            Use this board
          </Text>
          <Ionicons name="arrow-forward" size={18} color={colors.primaryForeground} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Small presentational pieces ──────────────────────────────────────────────

function SectionLabel({ text, colors }: { text: string; colors: ReturnType<typeof useColors> }) {
  return (
    <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{text}</Text>
  );
}

function MetricTile({
  label, value, hint, colors, tint,
}: {
  label: string;
  value: string;
  hint: string;
  colors: ReturnType<typeof useColors>;
  tint: string;
}) {
  return (
    <View style={[styles.metricTile, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: tint }]}>{value}</Text>
      <Text style={[styles.metricHint, { color: colors.mutedForeground }]}>{hint}</Text>
    </View>
  );
}

function DetailRow({
  label, value, colors, last,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
  last?: boolean;
}) {
  return (
    <View style={[styles.detailRow, !last && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  backText: { fontSize: 15, fontWeight: '600' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 4 },
  sub: { fontSize: 13, lineHeight: 18, marginBottom: 16 },
  boardCard: { borderRadius: 14, borderWidth: 1, padding: 10, marginBottom: 14 },
  metricRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  metricTile: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 12, alignItems: 'center' },
  metricLabel: { fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
  metricValue: { fontSize: 30, fontWeight: '700', marginVertical: 2 },
  metricHint: { fontSize: 10, textAlign: 'center' },
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12, marginBottom: 6,
  },
  generateText: { fontSize: 15, fontWeight: '700' },
  sectionLabel: { fontSize: 11, letterSpacing: 1, marginTop: 18, marginBottom: 8 },
  detailCard: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  detailLabel: { fontSize: 13 },
  detailValue: { fontSize: 13, fontWeight: '600' },
  optionCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 10 },
  optionLabel: { fontSize: 15, fontWeight: '600' },
  optionHelp: { fontSize: 12, lineHeight: 16, marginTop: 2, marginBottom: 10 },
  choiceRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  choice: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  choiceText: { fontSize: 13, fontWeight: '600' },
  seed: { fontSize: 11, textAlign: 'center', marginTop: 18 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', gap: 10, padding: 12, borderTopWidth: 1,
  },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1,
  },
  secondaryText: { fontSize: 14, fontWeight: '600' },
  primaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12,
  },
  primaryText: { fontSize: 15, fontWeight: '700' },
});
