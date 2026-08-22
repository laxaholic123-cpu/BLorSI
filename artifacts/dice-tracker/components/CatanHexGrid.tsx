/**
 * CatanHexGrid — renders the 19-hex Catan board (3-4-5-4-3) as an SVG.
 *
 * Uses pointy-top hexagons. Each hex is coloured by resource type and
 * shows its number token. Supports press/long-press callbacks, selection
 * overlay (for settlement placement), and low-confidence amber highlighting.
 *
 * Optionally draws harbours on the sea side of coastal edges. Passing `ports`
 * widens the viewBox rather than shrinking the island, so a board with and
 * without harbours renders the hexes at the same size.
 */

import React from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle, G, Line, Polygon, Text as SvgText } from 'react-native-svg';
import type { CatanHexDef, CatanPortDef, ResourceType } from '@/types/models';
import { intersectionIdAt } from '@/services/catanBoard';

// ─── Layout constants ─────────────────────────────────────────────────────────

const HEX_R = 40; // circumradius
const HEX_W = HEX_R * Math.sqrt(3); // pointy-top width ≈ 69.28
const SVG_W = 346;
const SVG_H = 320;
const CX = 173; // grid centre x
const CY = 160; // grid centre y

/**
 * [col, row] offsets for the 19 Catan hexes, read left-to-right top-to-bottom.
 * col is in hexW units from CX; row drives the y position.
 */
const HEX_POS: [number, number][] = [
  // row 0 — 3 hexes
  [-1, 0], [0, 0], [1, 0],
  // row 1 — 4 hexes
  [-1.5, 1], [-0.5, 1], [0.5, 1], [1.5, 1],
  // row 2 — 5 hexes (middle)
  [-2, 2], [-1, 2], [0, 2], [1, 2], [2, 2],
  // row 3 — 4 hexes
  [-1.5, 3], [-0.5, 3], [0.5, 3], [1.5, 3],
  // row 4 — 3 hexes
  [-1, 4], [0, 4], [1, 4],
];

/**
 * Padding added around the island when harbours are drawn.
 *
 * The island already fills the base viewBox exactly — the outermost hexes touch
 * x=0, x=346, y=0 and y=320 — so anything drawn outside an edge is clipped
 * unless the viewBox grows.
 */
const PORT_PAD = 30;

/**
 * Midpoint angle of each hex edge, in degrees.
 *
 * Edges are numbered clockwise from the top-left (NW, NE, E, SE, SW, W) to
 * match EDGE_NAMES in `services/catanBoard.ts`. For a pointy-top hex the NW
 * edge midpoint sits at 240°, and each subsequent edge is 60° further round.
 */
const edgeAngleDeg = (edge: number): number => 240 + 60 * edge;

/** Distance from hex centre to an edge midpoint. */
const APOTHEM = HEX_R * Math.cos(Math.PI / 6);

/**
 * Touch radius for a settlement corner.
 *
 * Neighbouring corners sit exactly HEX_R apart (a regular hexagon's side equals
 * its circumradius), so anything under 20 keeps the targets disjoint. 16 leaves
 * margin while roughly doubling the tappable area over the visible dot.
 */
const INTERSECTION_HIT_R = 16;

/**
 * Vertex angles, in drawing order. Index is the vertex number used by
 * `getAllIntersections`: 0 is the top corner, running clockwise.
 */
const VERTEX_ANGLES = [-90, -30, 30, 90, 150, 210];

function hexCenter(col: number, row: number) {
  return {
    cx: CX + col * HEX_W,
    cy: CY + (row - 2) * 1.5 * HEX_R,
  };
}

/**
 * Screen position of every settlement corner, keyed by intersection id.
 *
 * Built once. A corner shared by three hexes resolves to the same point from
 * any of them, so the first hex to claim an id wins and the rest agree.
 */
const INTERSECTION_POINTS: ReadonlyMap<string, { x: number; y: number }> = (() => {
  const map = new Map<string, { x: number; y: number }>();
  HEX_POS.forEach(([col, row], hexIndex) => {
    const { cx, cy } = hexCenter(col, row);
    for (let vertex = 0; vertex < 6; vertex++) {
      const id = intersectionIdAt(hexIndex, vertex);
      if (map.has(id)) continue;
      const rad = (VERTEX_ANGLES[vertex]! * Math.PI) / 180;
      map.set(id, {
        x: cx + HEX_R * Math.cos(rad),
        y: cy + HEX_R * Math.sin(rad),
      });
    }
  });
  return map;
})();

/** Pointy-top hexagon SVG points string for the given centre and radius. */
function hexPoints(cx: number, cy: number, r: number): string {
  const ANGLES = [-90, -30, 30, 90, 150, 210];
  return ANGLES.map(deg => {
    const rad = (deg * Math.PI) / 180;
    return `${(cx + r * Math.cos(rad)).toFixed(2)},${(cy + r * Math.sin(rad)).toFixed(2)}`;
  }).join(' ');
}

// ─── Resource styling ─────────────────────────────────────────────────────────

interface ResStyle { fill: string; textColor: string; abbr: string }

const RES_STYLE: Record<ResourceType, ResStyle> = {
  grain:   { fill: '#E8B840', textColor: '#5A3A00', abbr: 'GRN' },
  ore:     { fill: '#8A8A8A', textColor: '#1A1A1A', abbr: 'ORE' },
  lumber:  { fill: '#2E5E10', textColor: '#C8F0A0', abbr: 'LMB' },
  brick:   { fill: '#C03820', textColor: '#FFD0C0', abbr: 'BRK' },
  wool:    { fill: '#58B030', textColor: '#0A2A00', abbr: 'WOL' },
  desert:  { fill: '#C8A050', textColor: '#5A3A00', abbr: 'DST' },
  any:     { fill: '#4A6080', textColor: '#C0D8F0', abbr: 'ANY' },
};
const UNKNOWN_STYLE: ResStyle = { fill: '#333333', textColor: '#888888', abbr: '???' };

/** Harbour styling: colour carries the resource, text carries the trade rate. */
const PORT_STYLE = (type: CatanPortDef['type']): ResStyle =>
  type === 'generic'
    ? { fill: '#4A6080', textColor: '#E8F0FF', abbr: '3:1' }
    : { ...(RES_STYLE[type] ?? UNKNOWN_STYLE), abbr: '2:1' };

// ─── Component ────────────────────────────────────────────────────────────────

export interface CatanHexGridProps {
  /** 19-element array — index matches HEX_POS order. */
  hexes: CatanHexDef[];
  /** Called when a hex is tapped (placement mode). */
  onHexPress?: (index: number) => void;
  /** Called when a hex is long-pressed (review/correction mode). */
  onHexLongPress?: (index: number) => void;
  /** Hex indices highlighted in the player's colour. */
  selectedIndices?: number[];
  /** Colour used for the selection overlay. */
  selectionColor?: string;
  /** Hex indices highlighted amber — AI is uncertain about these. */
  lowConfidenceIndices?: number[];
  /** Harbours to draw on the sea side of their coastal edge. */
  ports?: CatanPortDef[];
  /**
   * Show tappable settlement corners. Only meaningful when the board is known,
   * which is why it is opt-in rather than always on.
   */
  showIntersections?: boolean;
  /** Called with the intersection id when a corner is tapped. */
  onIntersectionPress?: (intersectionId: string) => void;
  /** Corner ids to mark as taken, with the colour to mark them in. */
  intersectionMarks?: Record<string, string>;
  style?: StyleProp<ViewStyle>;
}

export function CatanHexGrid({
  hexes,
  onHexPress,
  onHexLongPress,
  selectedIndices = [],
  selectionColor = '#FFFFFF',
  lowConfidenceIndices = [],
  ports,
  showIntersections = false,
  onIntersectionPress,
  intersectionMarks,
  style,
}: CatanHexGridProps) {
  const pad = ports && ports.length > 0 ? PORT_PAD : 0;
  const vbX = -pad;
  const vbY = -pad;
  const vbW = SVG_W + pad * 2;
  const vbH = SVG_H + pad * 2;

  /**
   * Hex touches go through React Native, not through the SVG.
   *
   * react-native-svg's Android touch handling fires onPress on concrete shapes
   * but does NOT reliably fire onLongPress — which is how the board-review
   * correction ("long-press any hex to fix it") shipped looking correct and did
   * nothing on a real phone. Rather than fight it, real <Pressable>s are laid
   * over the hex centres and RN's own responder system does the work.
   *
   * Not rendered in intersection mode: there the taps belong to the corner
   * circles inside the SVG, and an overlay would swallow every one of them.
   */
  const wantsHexTouches = Boolean(onHexPress || onHexLongPress) && !showIntersections;

  /** Touch box per hex, in viewBox units. Rows sit 60 apart, so 56 cannot overlap. */
  const TOUCH = 56;

  const svg = (
    <Svg
      width="100%"
      viewBox={`${-pad} ${-pad} ${SVG_W + pad * 2} ${SVG_H + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      style={
        wantsHexTouches
          ? { width: '100%', height: '100%' }
          : [{ aspectRatio: vbW / vbH, width: '100%' }, style]
      }
    >
      {HEX_POS.map(([col, row], i) => {
        const { cx, cy } = hexCenter(col, row);
        const hex = hexes[i];
        const rs = hex?.resource ? (RES_STYLE[hex.resource] ?? UNKNOWN_STYLE) : UNKNOWN_STYLE;
        const isSelected = selectedIndices.includes(i);
        const isLowConf = lowConfidenceIndices.includes(i);
        const selRank = selectedIndices.indexOf(i); // -1 or 0-2
        const hasNumber = hex?.number != null;
        const hotNum = hex?.number === 6 || hex?.number === 8;

        return (
          <G key={i}>
            {/* Hex background — touch handlers live here so Android dispatches
                press/long-press correctly. react-native-svg on Android does not
                reliably fire events on <G> groups; only concrete shapes work. */}
            <Polygon
              points={hexPoints(cx, cy, HEX_R - 1.5)}
              fill={rs.fill}
              stroke={isSelected ? selectionColor : (isLowConf ? '#F59E0B' : '#111111')}
              strokeWidth={isSelected ? 3.5 : (isLowConf ? 3 : 1)}
              onPress={onHexPress ? () => onHexPress(i) : undefined}
              onLongPress={onHexLongPress ? () => onHexLongPress(i) : undefined}
            />

            {/* Resource abbreviation — pointerEvents="none" so touches fall
                through to the background Polygon above on Android. */}
            <SvgText
              x={cx}
              y={hasNumber ? cy - 10 : cy + 5}
              textAnchor="middle"
              fill={rs.textColor}
              fontSize={11}
              fontWeight="700"
              pointerEvents="none"
            >
              {rs.abbr}
            </SvgText>

            {/* Number token — same reason: none on all decorative shapes. */}
            {hasNumber && (
              <>
                <Circle cx={cx} cy={cy + 12} r={13} fill="white" opacity={0.92} pointerEvents="none" />
                <SvgText
                  x={cx}
                  y={cy + 17}
                  textAnchor="middle"
                  fill={hotNum ? '#CC0000' : '#111111'}
                  fontSize={13}
                  fontWeight="700"
                  pointerEvents="none"
                >
                  {hex.number}
                </SvgText>
              </>
            )}

            {/* Selection overlay */}
            {isSelected && (
              <>
                <Polygon
                  points={hexPoints(cx, cy, HEX_R - 1.5)}
                  fill={selectionColor}
                  opacity={0.3}
                  pointerEvents="none"
                />
                {/* Selection rank badge */}
                <Circle cx={cx - 24} cy={cy - 24} r={10} fill={selectionColor} opacity={0.9} pointerEvents="none" />
                <SvgText
                  x={cx - 24}
                  y={cy - 20}
                  textAnchor="middle"
                  fill="#000000"
                  fontSize={11}
                  fontWeight="700"
                  pointerEvents="none"
                >
                  {selRank + 1}
                </SvgText>
              </>
            )}

            {/* Low-confidence amber corner mark */}
            {isLowConf && !isSelected && (
              <Circle cx={cx + 22} cy={cy - 26} r={7} fill="#F59E0B" pointerEvents="none" />
            )}
          </G>
        );
      })}

      {/* Settlement corners. Drawn above the hexes so the touch target is not
          swallowed by the hex polygons beneath, and as concrete <Circle>s
          rather than a <G> — Android only dispatches events on real shapes. */}
      {showIntersections &&
        [...INTERSECTION_POINTS.entries()].map(([id, pt]) => {
          const mark = intersectionMarks?.[id];
          return (
            <G key={`ix-${id}`}>
              {/* The dot people see. Decorative: pointerEvents="none" so it
                  cannot steal the tap from the hit target below it. */}
              <Circle
                cx={pt.x}
                cy={pt.y}
                r={mark ? 9 : 7}
                fill={mark ?? '#0B1220'}
                opacity={mark ? 1 : 0.45}
                stroke={mark ? '#FFFFFF' : '#7B8FA8'}
                strokeWidth={mark ? 2 : 1}
                pointerEvents="none"
              />
              {/* Invisible hit target, drawn last so it sits on top.
                  A 7-unit dot is about 12px across on a phone — less than a
                  third of the 48dp minimum, and finger-sized targets matter
                  more here than anywhere else in the app, because a mis-tap
                  does not look like an error: it silently records production
                  the player never had.
                  r=16 gives a ~28px target while staying inside the 40-unit
                  gap between neighbouring corners, so no two overlap. */}
              <Circle
                cx={pt.x}
                cy={pt.y}
                r={INTERSECTION_HIT_R}
                fill="transparent"
                onPress={onIntersectionPress ? () => onIntersectionPress(id) : undefined}
              />
            </G>
          );
        })}

      {/* Harbours. Drawn after the hexes so they sit above the island edge,
          and decorative throughout — pointerEvents="none" everywhere, for the
          same Android dispatch reason as the number tokens above. */}
      {ports?.map((port, i) => {
        const pos = HEX_POS[port.hexIndex];
        if (!pos) return null;
        const { cx, cy } = hexCenter(pos[0], pos[1]);
        const rad = (edgeAngleDeg(port.edge) * Math.PI) / 180;
        const dist = APOTHEM + 16;
        const px = cx + dist * Math.cos(rad);
        const py = cy + dist * Math.sin(rad);
        const ps = PORT_STYLE(port.type);

        return (
          <G key={`port-${i}`} pointerEvents="none">
            {/* Stem back to the coast, so it reads as attached to its edge. */}
            <Line
              x1={cx + APOTHEM * Math.cos(rad)}
              y1={cy + APOTHEM * Math.sin(rad)}
              x2={px}
              y2={py}
              stroke="#7B8FA8"
              strokeWidth={2}
              pointerEvents="none"
            />
            <Circle
              cx={px}
              cy={py}
              r={12}
              fill={ps.fill}
              stroke="#0B1220"
              strokeWidth={1.5}
              pointerEvents="none"
            />
            <SvgText
              x={px}
              y={py + 3.5}
              textAnchor="middle"
              fill={ps.textColor}
              fontSize={9}
              fontWeight="700"
              pointerEvents="none"
            >
              {ps.abbr}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );

  if (!wantsHexTouches) return svg;

  return (
    <View style={[{ width: '100%', aspectRatio: vbW / vbH }, style]}>
      {svg}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {HEX_POS.map(([col, row], i) => {
          const { cx, cy } = hexCenter(col, row);
          return (
            <Pressable
              key={`touch-${i}`}
              onPress={onHexPress ? () => onHexPress(i) : undefined}
              onLongPress={onHexLongPress ? () => onHexLongPress(i) : undefined}
              delayLongPress={350}
              style={{
                position: 'absolute',
                left: `${((cx - TOUCH / 2 - vbX) / vbW) * 100}%`,
                top: `${((cy - TOUCH / 2 - vbY) / vbH) * 100}%`,
                width: `${(TOUCH / vbW) * 100}%`,
                height: `${(TOUCH / vbH) * 100}%`,
              }}
            />
          );
        })}
      </View>
    </View>
  );
}
