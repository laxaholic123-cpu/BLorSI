/**
 * The board as it stands, for everybody, at a point in the game.
 *
 * Two jobs, and the second one is the reason this is not just a grid:
 *
 *   1. Show what is on the board — who holds which corner, which are cities,
 *      whose roads run where.
 *   2. Say what it CANNOT show. A settlement recorded through the number pad
 *      has no position, so it cannot be drawn. A board that quietly omits two
 *      of your four settlements looks complete while being wrong, which is the
 *      same failure as a reader that declines invisibly — the whole value of
 *      showing the board is that it can be checked against the table.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CatanHexGrid } from '@/components/CatanHexGrid';
import { useColors } from '@/hooks/useColors';
import { boardStateAtTurn } from '@/services/catanBoardState';
import type { CatanHexDef, CatanPlayerExposureEvent, CatanPortDef } from '@/types/models';

export interface CatanBoardPanelProps {
  hexes: CatanHexDef[];
  ports?: CatanPortDef[];
  events: readonly CatanPlayerExposureEvent[];
  players: readonly { id: string; displayName: string; color?: string }[];
  /** Show the board as of this turn. Defaults to the whole log. */
  throughTurn?: number;
  /** Heading above the board. */
  title?: string;
}

const FALLBACK_COLORS = ['#E24A4A', '#3E7BE8', '#E8A33E', '#3EB86B', '#A05CE8', '#E85CB0'];

export function CatanBoardPanel({
  hexes,
  ports,
  events,
  players,
  throughTurn,
  title,
}: CatanBoardPanelProps) {
  const colors = useColors();

  const colorOf = useMemo(() => {
    const map = new Map<string, string>();
    players.forEach((p, i) => {
      map.set(p.id, p.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]!);
    });
    return map;
  }, [players]);

  const snapshot = useMemo(
    () => boardStateAtTurn(events, players.map(p => p.id), throughTurn),
    [events, players, throughTurn],
  );

  const { intersectionMarks, cityIntersections, roadMarks } = useMemo(() => {
    const marks: Record<string, string> = {};
    const cities: string[] = [];
    for (const [cornerId, b] of snapshot.buildings) {
      marks[cornerId] = colorOf.get(b.playerId) ?? '#FFFFFF';
      if (b.weight >= 2) cities.push(cornerId);
    }
    const roads: Record<string, string> = {};
    for (const [edgeId, playerId] of snapshot.roads) {
      roads[edgeId] = colorOf.get(playerId) ?? '#FFFFFF';
    }
    return { intersectionMarks: marks, cityIntersections: cities, roadMarks: roads };
  }, [snapshot, colorOf]);

  const missing = useMemo(
    () =>
      [...snapshot.unplaceable.entries()]
        .map(([playerId, count]) => ({
          name: players.find(p => p.id === playerId)?.displayName ?? 'Someone',
          count,
        }))
        .filter(m => m.count > 0),
    [snapshot, players],
  );

  const placed = snapshot.buildings.size;
  const roadCount = snapshot.roads.size;

  return (
    <View style={{ gap: 8 }}>
      {title ? (
        <Text style={[styles.title, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
          {title}
        </Text>
      ) : null}

      <CatanHexGrid
        hexes={hexes}
        ports={ports}
        showIntersections
        intersectionMarks={intersectionMarks}
        cityIntersections={cityIntersections}
        /* No legalIntersections, and no handlers: this is a VIEW. Marked
           corners still draw, unmarked ones do not, and nothing is tappable —
           which also means no inert hit target sits on top of the roads. */
        legalIntersections={[]}
        showRoads={roadCount > 0}
        legalRoads={[]}
        roadMarks={roadMarks}
      />

      <View style={styles.legendRow}>
        {players.map(p => (
          <View key={p.id} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: colorOf.get(p.id) }]} />
            <Text
              style={[styles.legendText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}
              numberOfLines={1}
            >
              {p.displayName}
            </Text>
          </View>
        ))}
      </View>

      <Text style={[styles.counts, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        {placed} {placed === 1 ? 'building' : 'buildings'} · {roadCount}{' '}
        {roadCount === 1 ? 'road' : 'roads'} on the board
      </Text>

      {missing.length > 0 && (
        /* The honesty line. Not an error — those buildings are recorded and
           counted in every stat; they just have no position to draw. */
        <View style={[styles.noteBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Text style={[styles.note, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {missing.map(m => `${m.name}: ${m.count}`).join(' · ')}
            {missing.length === 1 && missing[0]!.count === 1
              ? ' building is not shown'
              : ' buildings are not shown'}
            . They were recorded by number rather than by tapping the board, so
            the app knows what they earn but not where they are. They still
            count in every stat.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 11, letterSpacing: 1 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  legendText: { fontSize: 11, maxWidth: 90 },
  counts: { fontSize: 11, textAlign: 'center' },
  noteBox: { borderWidth: 1, borderRadius: 10, padding: 10 },
  note: { fontSize: 11, lineHeight: 16 },
});
