/**
 * CatanHexGrid — renders the 19-hex Catan board (3-4-5-4-3) as an SVG.
 *
 * Uses pointy-top hexagons. Each hex is coloured by resource type and
 * shows its number token. Supports press/long-press callbacks, selection
 * overlay (for settlement placement), and low-confidence amber highlighting.
 */

import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Svg, { Circle, G, Polygon, Text as SvgText } from 'react-native-svg';
import type { CatanHexDef, ResourceType } from '@/types/models';

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

function hexCenter(col: number, row: number) {
  return {
    cx: CX + col * HEX_W,
    cy: CY + (row - 2) * 1.5 * HEX_R,
  };
}

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
  style?: StyleProp<ViewStyle>;
}

export function CatanHexGrid({
  hexes,
  onHexPress,
  onHexLongPress,
  selectedIndices = [],
  selectionColor = '#FFFFFF',
  lowConfidenceIndices = [],
  style,
}: CatanHexGridProps) {
  return (
    <Svg
      width="100%"
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      preserveAspectRatio="xMidYMid meet"
      style={style}
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
          <G
            key={i}
            onPress={onHexPress ? () => onHexPress(i) : undefined}
            onLongPress={onHexLongPress ? () => onHexLongPress(i) : undefined}
          >
            {/* Hex background */}
            <Polygon
              points={hexPoints(cx, cy, HEX_R - 1.5)}
              fill={rs.fill}
              stroke={isSelected ? selectionColor : (isLowConf ? '#F59E0B' : '#111111')}
              strokeWidth={isSelected ? 3.5 : (isLowConf ? 3 : 1)}
            />

            {/* Resource abbreviation */}
            <SvgText
              x={cx}
              y={hasNumber ? cy - 10 : cy + 5}
              textAnchor="middle"
              fill={rs.textColor}
              fontSize={11}
              fontWeight="700"
            >
              {rs.abbr}
            </SvgText>

            {/* Number token */}
            {hasNumber && (
              <>
                <Circle cx={cx} cy={cy + 12} r={13} fill="white" opacity={0.92} />
                <SvgText
                  x={cx}
                  y={cy + 17}
                  textAnchor="middle"
                  fill={hotNum ? '#CC0000' : '#111111'}
                  fontSize={13}
                  fontWeight="700"
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
                />
                {/* Selection rank badge */}
                <Circle cx={cx - 24} cy={cy - 24} r={10} fill={selectionColor} opacity={0.9} />
                <SvgText
                  x={cx - 24}
                  y={cy - 20}
                  textAnchor="middle"
                  fill="#000000"
                  fontSize={11}
                  fontWeight="700"
                >
                  {selRank + 1}
                </SvgText>
              </>
            )}

            {/* Low-confidence amber corner mark */}
            {isLowConf && !isSelected && (
              <Circle cx={cx + 22} cy={cy - 26} r={7} fill="#F59E0B" />
            )}
          </G>
        );
      })}
    </Svg>
  );
}
