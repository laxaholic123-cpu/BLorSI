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
import Svg, { Circle, G, Line, Polygon, Rect, Text as SvgText } from 'react-native-svg';
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
 * WHERE THE OLD SVG HIT RADII WENT, and the lesson that outlived them.
 *
 * Corners and roads used to carry transparent SVG <Circle>s at r=16 and r=14.
 * Those are gone — no SVG shape dispatches touches in this build — but the
 * geometry finding still governs the <Pressable> boxes that replaced them:
 *
 * An edge midpoint sits exactly 20 units from each of its endpoints. The two
 * radii summed to 30, so a corner covered 25.1% of each touching road's hit
 * area, and corners were drawn last. Each radius had been checked for overlap
 * WITHIN its own family and never across families.
 *
 * Generalise it: two hit targets sized independently, each provably disjoint
 * from its own kind, is not evidence they are disjoint from each other. Count
 * the cross-family distances. The overlay keeps corners rendered after roads
 * for the same reason — where they overlap, the corner should win.
 */

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

/**
 * Screen position of every ROAD, keyed by the same edge id the placement
 * service uses: the two corner ids, sorted, joined by a pipe.
 *
 * Derived from the corner points rather than recomputed, so a road can never
 * draw somewhere its own endpoints are not.
 */
const EDGE_SEGMENTS: ReadonlyMap<string, { x1: number; y1: number; x2: number; y2: number;
                                           mx: number; my: number }> = (() => {
  const map = new Map<string, { x1: number; y1: number; x2: number; y2: number;
                                mx: number; my: number }>();
  HEX_POS.forEach((_pos, hexIndex) => {
    for (let vertex = 0; vertex < 6; vertex++) {
      const a = intersectionIdAt(hexIndex, vertex);
      const b = intersectionIdAt(hexIndex, (vertex + 1) % 6);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const id = `${lo}|${hi}`;
      if (map.has(id)) continue;
      const pa = INTERSECTION_POINTS.get(lo);
      const pb = INTERSECTION_POINTS.get(hi);
      if (!pa || !pb) continue;
      map.set(id, { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y,
                    mx: (pa.x + pb.x) / 2, my: (pa.y + pb.y) / 2 });
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
  /**
   * Of the marked corners, which hold CITIES rather than settlements.
   *
   * Drawn as a square rather than a bigger circle. A city produces double, so
   * a board view that renders both the same way is not showing the board — and
   * size alone is a weak cue at this scale, where a settlement dot is already
   * only nine units across.
   */
  cityIntersections?: readonly string[];
  /**
   * When given, ONLY these corners are drawn and tappable.
   *
   * Restricting to the legal set is the single biggest thing that reduces
   * mis-taps here: 54 corners at a ~28px target is dense, and a mis-tap does
   * not look like an error — it silently records production the player never
   * had. Showing six legal corners instead of fifty-four makes the wrong tap
   * mostly unreachable rather than merely discouraged.
   */
  legalIntersections?: readonly string[];
  /** Show tappable roads along the hex edges. */
  showRoads?: boolean;
  /** Called with the edge id when a road is tapped. */
  onRoadPress?: (edgeId: string) => void;
  /** Edge ids to draw as built, with the colour to draw them in. */
  roadMarks?: Record<string, string>;
  /** When given, ONLY these roads are drawn and tappable. */
  legalRoads?: readonly string[];
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
  cityIntersections,
  legalIntersections,
  showRoads = false,
  onRoadPress,
  roadMarks,
  legalRoads,
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
   * MEASURED ON A DEVICE, 31 Aug 2026, and it is worse than that note said:
   * NO SVG shape dispatches touches at all in this build. `app/touch-probe.tsx`
   * put seven variants side by side and only the React Native <Pressable>
   * fired. Transparent fill, solid fill at zero opacity, near-opaque paint,
   * <Rect> and a handler on a <G> all did nothing — so this is not about
   * transparency, and no amount of changing the paint would have fixed it.
   *
   * Cause: `newArchEnabled: true` (Fabric) with react-native-svg 15.12.1.
   * Under the new architecture this version's touch handling does not reach
   * shapes. It explains all three of this project's historical touch bugs at
   * once — long-press correction, the corner handles, and the roll pad — which
   * were each diagnosed separately as their own mystery.
   *
   * So EVERY interactive target in this component is a real <Pressable> laid
   * over the drawing. The SVG is pictures only.
   */
  const wantsHexTouches = Boolean(onHexPress || onHexLongPress);
  const wantsCornerTouches = Boolean(showIntersections && onIntersectionPress);
  const wantsRoadTouches = Boolean(showRoads && onRoadPress);
  const wantsOverlay = wantsHexTouches || wantsCornerTouches || wantsRoadTouches;

  /** Touch box per hex, in viewBox units. Rows sit 60 apart, so 56 cannot overlap. */
  const TOUCH = 56;

  /**
   * Corners are laid over roads, so where the two boxes overlap the CORNER
   * wins — settlements are placed first and are the more consequential of the
   * two. Same ordering the SVG used, now expressed as render order in the
   * overlay.
   *
   * The boxes are squares, not discs, so they are kept smaller than the old
   * SVG radii: a 32-unit square inscribes the 16-unit circle it replaces, and
   * corners sit 40 apart, so neighbours still cannot overlap.
   */
  const CORNER_TOUCH = 36;
  /**
   * Road targets were 22 and reported as "takes a tap or two to register".
   *
   * 22 viewBox units is about 24px on a phone — half the 48dp guideline, and
   * roads are the one target you aim at with the board already crowded. Two
   * edge midpoints meeting at a corner sit 0.87 x HEX_R apart, so 34 is the
   * ceiling before neighbours overlap; 32 keeps a margin and is ~35px.
   */
  const ROAD_TOUCH = 32;

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
            {/* Hex background. No handlers: the tap target is a <Pressable>
                in the overlay, like every other target in this component. */}
            <Polygon
              points={hexPoints(cx, cy, HEX_R - 1.5)}
              fill={rs.fill}
              stroke={isSelected ? selectionColor : (isLowConf ? '#F59E0B' : '#111111')}
              strokeWidth={isSelected ? 3.5 : (isLowConf ? 3 : 1)}
              pointerEvents="none"
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

      {/* Roads, then corners. Both are PICTURES ONLY — every touch target for
          them is a <Pressable> in the overlay below the SVG, because no SVG
          shape dispatches touches in this build. Ordering still matters, but
          now it is the overlay's render order that decides who wins an
          overlap, not this. */}
      {(showRoads || roadMarks) &&
        [...EDGE_SEGMENTS.entries()].map(([id, seg]) => {
          const mark = roadMarks?.[id];
          const offerable = showRoads && (!legalRoads || legalRoads.includes(id));
          if (!mark && !offerable) return null;
          return (
            <G key={`rd-${id}`}>
              <Line
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                /* An OFFERED road has to read as an invitation on a dark
                   board. It was #7B8FA8 at 0.5 opacity and 4 wide — reported
                   as "grey on a black background, tough to see". Now bright,
                   full opacity and nearly as thick as a built road, so the
                   difference between "you may build here" and "someone built
                   here" is colour rather than a guess at contrast. */
                stroke={mark ?? '#F0C24B'}
                strokeWidth={mark ? 7 : 6}
                strokeLinecap="round"
                opacity={mark ? 1 : 0.95}
                strokeDasharray={mark ? undefined : '10 6'}
                pointerEvents="none"
              />
            </G>
          );
        })}

      {showIntersections &&
        [...INTERSECTION_POINTS.entries()].map(([id, pt]) => {
          const mark = intersectionMarks?.[id];
          // A corner outside the legal set is not drawn at all, so it cannot be
          // tapped by accident — but one already BUILT on stays visible,
          // because the board should show what is there.
          if (!mark && legalIntersections && !legalIntersections.includes(id)) return null;
          const isCity = Boolean(mark) && cityIntersections?.includes(id);
          return (
            <G key={`ix-${id}`}>
              {/* The mark people see. Decorative: pointerEvents="none" so it
                  cannot steal the tap from the hit target below it.
                  A city is a SQUARE, not a bigger dot — at nine units across,
                  size alone does not read. */}
              {isCity ? (
                <Rect
                  x={pt.x - 9}
                  y={pt.y - 9}
                  width={18}
                  height={18}
                  rx={3}
                  fill={mark}
                  stroke="#FFFFFF"
                  strokeWidth={2}
                  pointerEvents="none"
                />
              ) : (
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
              )}
              {/* No hit target here any more. It used to be a transparent
                  <Circle> drawn last, and on a device it never fired — see the
                  note by `wantsHexTouches`. The tap target is a <Pressable> in
                  the overlay instead. */}
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

  if (!wantsOverlay) return svg;

  /** viewBox units → a percentage box on the overlay, which sits exactly over
   *  the SVG because both use the same aspect ratio and `xMidYMid meet`. */
  const box = (cx: number, cy: number, size: number): ViewStyle => ({
    position: 'absolute',
    left: `${((cx - size / 2 - vbX) / vbW) * 100}%`,
    top: `${((cy - size / 2 - vbY) / vbH) * 100}%`,
    width: `${(size / vbW) * 100}%`,
    height: `${(size / vbH) * 100}%`,
  });

  return (
    <View style={[{ width: '100%', aspectRatio: vbW / vbH }, style]}>
      {svg}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {wantsHexTouches &&
          HEX_POS.map(([col, row], i) => {
            const { cx, cy } = hexCenter(col, row);
            return (
              <Pressable
                key={`touch-${i}`}
                onPress={onHexPress ? () => onHexPress(i) : undefined}
                onLongPress={onHexLongPress ? () => onHexLongPress(i) : undefined}
                delayLongPress={350}
                style={box(cx, cy, TOUCH)}
              />
            );
          })}

        {/* Roads BEFORE corners, so a corner laid over a road wins the overlap.
            Only offerable edges get a target — the same restriction that made
            mis-taps unreachable rather than merely discouraged. */}
        {wantsRoadTouches &&
          [...EDGE_SEGMENTS.entries()]
            .filter(([id]) => !legalRoads || legalRoads.includes(id))
            .map(([id, seg]) => (
              <Pressable
                key={`rt-${id}`}
                onPress={() => onRoadPress?.(id)}
                style={box(seg.mx, seg.my, ROAD_TOUCH)}
                accessibilityRole="button"
                accessibilityLabel="Build a road here"
              />
            ))}

        {wantsCornerTouches &&
          [...INTERSECTION_POINTS.entries()]
            .filter(([id]) => !legalIntersections || legalIntersections.includes(id))
            .map(([id, pt]) => (
              <Pressable
                key={`ct-${id}`}
                onPress={() => onIntersectionPress?.(id)}
                style={box(pt.x, pt.y, CORNER_TOUCH)}
                accessibilityRole="button"
                accessibilityLabel="Place on this corner"
              />
            ))}
      </View>
    </View>
  );
}
