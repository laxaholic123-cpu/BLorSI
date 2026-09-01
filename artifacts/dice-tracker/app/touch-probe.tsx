/**
 * Touch dispatch probe — a DIAGNOSTIC, not a feature. Reachable only by URL.
 *
 * WHY THIS EXISTS
 * ---------------
 * Android SVG touch dispatch has silently broken this project three times:
 * long-press correction, the corner drag handles, and the roll pad. Every one
 * of them looked right in code, worked on web, and did nothing on a phone —
 * and each cost a whole session to diagnose, because the symptom is always the
 * same ("tapping does nothing") regardless of which of several causes it is.
 *
 * Corners and roads are the only interactive elements in the app with no React
 * Native `<Pressable>` fallback: they rely on `onPress` on a transparent SVG
 * `<Circle>`. If that primitive does not receive taps in this build, opening
 * placement and the mid-game corner picker both fail together, and there is no
 * way to tell that apart from "the geometry is wrong" or "the handler is not
 * wired" by tapping the real screen.
 *
 * So this screen tests the PRIMITIVES side by side and counts what fires.
 * Twenty seconds with a thumb tells you which variants work, which is the
 * difference between one fix and an evening of guessing.
 *
 * Read the results like this:
 *
 *   F fires, A does not      transparent SVG fill is not tappable on this
 *                            build. Corners and roads need a Pressable
 *                            overlay, like the hexes already have.
 *   A fires                  the primitive is fine; a failure on a real screen
 *                            is geometry, legality filtering, or wiring.
 *   E fires                  <G> dispatch works here after all; the note in
 *                            CLAUDE.md is build-specific, not universal.
 *   G never fires            expected. onLongPress on an SVG shape is already
 *                            known not to work; it is here as the control.
 *
 * Delete this screen once the question is settled, or keep it — it costs one
 * route and answers the same question after every dependency bump.
 */

import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Svg, { Circle, G, Rect, Text as SvgText } from 'react-native-svg';

import { useColors } from '@/hooks/useColors';

type VariantId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

const VARIANTS: { id: VariantId; label: string; note: string }[] = [
  { id: 'A', label: 'Circle fill="transparent"', note: 'what corners and roads use TODAY' },
  { id: 'B', label: 'Circle fill="#000" opacity={0}', note: 'invisible a different way' },
  { id: 'C', label: 'Circle fill="rgba(0,0,0,0.01)"', note: 'almost-transparent paint' },
  { id: 'D', label: 'Rect fill="transparent"', note: 'is it the SHAPE or the fill?' },
  { id: 'E', label: 'onPress on a <G> group', note: 'documented as unreliable' },
  { id: 'F', label: 'RN <Pressable> overlay', note: 'the known-good baseline (hexes use this)' },
  { id: 'G', label: 'Circle onLongPress', note: 'control — expected to FAIL' },
];

const BOX = 320;
const R = 26;

export default function TouchProbeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [counts, setCounts] = useState<Record<VariantId, number>>({
    A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0,
  });
  const [last, setLast] = useState<string>('nothing yet');

  const hit = (id: VariantId) => {
    setCounts(prev => ({ ...prev, [id]: prev[id] + 1 }));
    setLast(`${id} at ${new Date().toLocaleTimeString()}`);
  };

  /** Row y-positions inside the SVG, one per SVG-based variant. */
  const rows: { id: VariantId; y: number }[] = [
    { id: 'A', y: 30 },
    { id: 'B', y: 85 },
    { id: 'C', y: 140 },
    { id: 'D', y: 195 },
    { id: 'E', y: 250 },
    { id: 'G', y: 305 },
  ];

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16, gap: 14 }}
    >
      <Text style={[styles.h1, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
        Touch dispatch probe
      </Text>
      <Text style={[styles.body, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        Tap each target once. Whichever counters move are the primitives that
        receive touches on this device and this build. Platform:{' '}
        <Text style={{ fontFamily: 'Inter_700Bold' }}>{Platform.OS}</Text>.
      </Text>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.mono, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          last: {last}
        </Text>
      </View>

      {/* The SVG-based variants, all inside ONE Svg so they share a coordinate
          space and a single hit-test pass — which is how they appear on the
          real screens. */}
      <View style={{ alignItems: 'center' }}>
        <Svg width={BOX} height={340} viewBox={`0 0 ${BOX} 340`}>
          {rows.map(({ id, y }) => (
            <G key={id}>
              {/* A visible ring so there is something to aim at. Decorative. */}
              <Circle
                cx={60}
                cy={y}
                r={R}
                fill="none"
                stroke="#7B8FA8"
                strokeWidth={2}
                pointerEvents="none"
              />
              {/* The letter inside the ring, and its running count beside it.
                  Without these the rings are six identical circles and there
                  is no way to report which one fired. Decorative — every one
                  is pointerEvents="none" so none can steal the tap it is
                  labelling, which is the bug this screen exists to find. */}
              <SvgText
                x={60}
                y={y + 6}
                fontSize={17}
                fontWeight="bold"
                fill={counts[id] > 0 ? '#3EB86B' : '#7B8FA8'}
                textAnchor="middle"
                pointerEvents="none"
              >
                {id}
              </SvgText>
              <SvgText
                x={104}
                y={y + 6}
                fontSize={15}
                fill={counts[id] > 0 ? '#3EB86B' : '#7B8FA8'}
                textAnchor="start"
                pointerEvents="none"
              >
                {counts[id] > 0 ? `FIRED x${counts[id]}` : 'no'}
              </SvgText>
              {id === 'A' && (
                <Circle cx={60} cy={y} r={R} fill="transparent" onPress={() => hit('A')} />
              )}
              {id === 'B' && (
                <Circle cx={60} cy={y} r={R} fill="#000000" opacity={0} onPress={() => hit('B')} />
              )}
              {id === 'C' && (
                <Circle cx={60} cy={y} r={R} fill="rgba(0,0,0,0.01)" onPress={() => hit('C')} />
              )}
              {id === 'D' && (
                <Rect
                  x={60 - R}
                  y={y - R}
                  width={R * 2}
                  height={R * 2}
                  fill="transparent"
                  onPress={() => hit('D')}
                />
              )}
              {id === 'E' && (
                // The handler is on the GROUP, with a real shape inside it.
                <G onPress={() => hit('E')}>
                  <Circle cx={60} cy={y} r={R} fill="transparent" />
                </G>
              )}
              {id === 'G' && (
                <Circle cx={60} cy={y} r={R} fill="transparent" onLongPress={() => hit('G')} />
              )}
            </G>
          ))}
        </Svg>
      </View>

      {/* F sits outside the SVG on purpose: it is the React Native path, and
          the point of the comparison is that it does NOT go through
          react-native-svg's hit testing at all. */}
      <View style={{ alignItems: 'center' }}>
        <Pressable
          onPress={() => hit('F')}
          style={({ pressed }) => [
            styles.pressable,
            { borderColor: colors.border, backgroundColor: pressed ? colors.muted : 'transparent' },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Variant F, React Native Pressable"
        >
          <Text style={{ color: colors.foreground, fontFamily: 'Inter_500Medium' }}>
            F · tap here
          </Text>
        </Pressable>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {VARIANTS.map(v => (
          <View key={v.id} style={styles.row}>
            <Text
              style={[
                styles.count,
                {
                  color: counts[v.id] > 0 ? '#3EB86B' : colors.mutedForeground,
                  fontFamily: 'Inter_700Bold',
                },
              ]}
            >
              {v.id} {counts[v.id]}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.body, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
                {v.label}
              </Text>
              <Text style={[styles.small, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                {v.note}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <Text style={[styles.small, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        If F moves and A does not, transparent SVG fills are not tappable in this
        build — corners and roads need a Pressable overlay like the hexes have.
        If A moves, the primitive is fine and any failure on a real screen is
        geometry, legality filtering, or wiring.
      </Text>

      <Pressable
        onPress={() => router.back()}
        style={[styles.pressable, { borderColor: colors.border, alignSelf: 'center' }]}
      >
        <Text style={{ color: colors.foreground, fontFamily: 'Inter_500Medium' }}>Back</Text>
      </Pressable>
      <View style={{ height: insets.bottom + 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 20 },
  body: { fontSize: 13, lineHeight: 18 },
  small: { fontSize: 11, lineHeight: 16 },
  mono: { fontSize: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  count: { fontSize: 14, width: 46 },
  pressable: {
    borderWidth: 1, borderRadius: 10,
    paddingVertical: 12, paddingHorizontal: 22,
  },
});
