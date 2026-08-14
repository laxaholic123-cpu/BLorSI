/**
 * Catan board geometry — hex adjacency, coastal edges, and port layouts.
 *
 * All functions are pure — no side effects, no storage calls, no UI imports.
 *
 * The 19 hexes are addressed by index 0–18, reading left-to-right and
 * top-to-bottom through the 3-4-5-4-3 rows. Adjacency is derived from axial
 * coordinates rather than hardcoded tables, so the coastal-edge set is computed
 * and can be asserted against the known total of 30 rather than trusted.
 */

import type { CatanPortDef, HexEdge, PortType } from '@/types/models';

// ─── Axial coordinates ────────────────────────────────────────────────────────

export interface Axial {
  q: number;
  r: number;
}

/**
 * Hex index → axial coordinate.
 *
 * The board is a hexagon of radius 2: every (q, r) with |q| ≤ 2, |r| ≤ 2 and
 * |q + r| ≤ 2. Rows are constant r, which is what produces 3-4-5-4-3.
 */
export const HEX_AXIAL: readonly Axial[] = [
  // r = -2 (top row, 3 hexes) → indices 0-2
  { q: 0, r: -2 }, { q: 1, r: -2 }, { q: 2, r: -2 },
  // r = -1 (4 hexes) → indices 3-6
  { q: -1, r: -1 }, { q: 0, r: -1 }, { q: 1, r: -1 }, { q: 2, r: -1 },
  // r = 0 (middle row, 5 hexes) → indices 7-11
  { q: -2, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 },
  // r = 1 (4 hexes) → indices 12-15
  { q: -2, r: 1 }, { q: -1, r: 1 }, { q: 0, r: 1 }, { q: 1, r: 1 },
  // r = 2 (bottom row, 3 hexes) → indices 16-18
  { q: -2, r: 2 }, { q: -1, r: 2 }, { q: 0, r: 2 },
];

export const HEX_COUNT = 19;

/** Total coastal edges around the 19-hex board. Asserted in tests. */
export const COASTAL_EDGE_COUNT = 30;

/**
 * Edge index → axial offset of the neighbour across that edge.
 * Clockwise from the top-left face: NW, NE, E, SE, SW, W.
 */
export const EDGE_OFFSETS: readonly Axial[] = [
  { q: 0, r: -1 },  // 0 NW
  { q: 1, r: -1 },  // 1 NE
  { q: 1, r: 0 },   // 2 E
  { q: 0, r: 1 },   // 3 SE
  { q: -1, r: 1 },  // 4 SW
  { q: -1, r: 0 },  // 5 W
];

export const EDGE_NAMES: readonly string[] = ['NW', 'NE', 'E', 'SE', 'SW', 'W'];

export const ALL_EDGES: readonly HexEdge[] = [0, 1, 2, 3, 4, 5];

const axialKey = (a: Axial): string => `${a.q},${a.r}`;

const INDEX_BY_AXIAL: ReadonlyMap<string, number> = new Map(
  HEX_AXIAL.map((a, i) => [axialKey(a), i]),
);

/** Axial coordinate → hex index, or null when off the board. */
export function axialToIndex(q: number, r: number): number | null {
  return INDEX_BY_AXIAL.get(axialKey({ q, r })) ?? null;
}

/** The hex across the given edge, or null when that edge faces the sea. */
export function getNeighborIndex(hexIndex: number, edge: HexEdge): number | null {
  const origin = HEX_AXIAL[hexIndex];
  if (!origin) return null;
  const offset = EDGE_OFFSETS[edge]!;
  return axialToIndex(origin.q + offset.q, origin.r + offset.r);
}

/** True when the edge borders the sea rather than another hex. */
export function isCoastalEdge(hexIndex: number, edge: HexEdge): boolean {
  if (hexIndex < 0 || hexIndex >= HEX_COUNT) return false;
  return getNeighborIndex(hexIndex, edge) === null;
}

export interface CoastalEdge {
  hexIndex: number;
  edge: HexEdge;
}

/**
 * Every coastal edge, walking the board clockwise from hex 0's NW face.
 *
 * The order matters: it is what makes "space the ports evenly around the coast"
 * a meaningful statement, and what a future scanner would walk when matching
 * detected frame pieces to edges.
 */
export function getCoastalEdgesClockwise(): CoastalEdge[] {
  // Perimeter hexes in clockwise order, each contributing its sea-facing edges
  // in clockwise order. Corner hexes contribute three, side hexes two.
  const walk: ReadonlyArray<{ hexIndex: number; edges: HexEdge[] }> = [
    { hexIndex: 0, edges: [0, 1] },
    { hexIndex: 1, edges: [0, 1] },
    { hexIndex: 2, edges: [0, 1, 2] },
    { hexIndex: 6, edges: [1, 2] },
    { hexIndex: 11, edges: [1, 2, 3] },
    { hexIndex: 15, edges: [2, 3] },
    { hexIndex: 18, edges: [2, 3, 4] },
    { hexIndex: 17, edges: [3, 4] },
    { hexIndex: 16, edges: [3, 4, 5] },
    { hexIndex: 12, edges: [4, 5] },
    { hexIndex: 7, edges: [4, 5, 0] },
    { hexIndex: 3, edges: [5, 0] },
    { hexIndex: 0, edges: [5] },
  ];

  const edges: CoastalEdge[] = [];
  for (const entry of walk) {
    for (const edge of entry.edges) edges.push({ hexIndex: entry.hexIndex, edge });
  }
  return edges;
}

// ─── Ports ────────────────────────────────────────────────────────────────────

/** The base game ships nine ports: four generic 3:1 and one 2:1 per resource. */
export const PORT_TYPE_COUNTS: Readonly<Record<PortType, number>> = {
  generic: 4,
  grain: 1,
  ore: 1,
  lumber: 1,
  brick: 1,
  wool: 1,
};

export const PORT_COUNT = 9;

/**
 * Default port arrangement, spaced evenly around the coast.
 *
 * NOTE: port placement is fixed by the physical sea frame, and the arrangement
 * differs between editions and between the standard and variable setups. This
 * is a reasonable default to start from, not an authoritative reproduction of
 * any one edition — players should check it against their own board and edit it.
 * That is why ports are editable and persisted per layout rather than assumed.
 */
export const STANDARD_PORT_LAYOUT: readonly CatanPortDef[] = [
  { hexIndex: 0, edge: 0, type: 'generic' },  // NW coast
  { hexIndex: 1, edge: 1, type: 'wool' },
  { hexIndex: 6, edge: 1, type: 'generic' },
  { hexIndex: 11, edge: 2, type: 'ore' },     // E coast
  { hexIndex: 15, edge: 3, type: 'generic' },
  { hexIndex: 17, edge: 3, type: 'grain' },   // S coast
  { hexIndex: 16, edge: 4, type: 'generic' },
  { hexIndex: 12, edge: 5, type: 'brick' },   // W coast
  { hexIndex: 3, edge: 5, type: 'lumber' },
];

export interface PortLayoutProblem {
  kind: 'not_coastal' | 'duplicate_edge' | 'wrong_count';
  message: string;
}

/**
 * Check a port layout against the board's geometry and the game's component
 * counts. Used to validate hand-edited layouts, imported backups, and anything
 * a future board scanner produces.
 */
export function validatePortLayout(ports: readonly CatanPortDef[]): PortLayoutProblem[] {
  const problems: PortLayoutProblem[] = [];

  if (ports.length !== PORT_COUNT) {
    problems.push({
      kind: 'wrong_count',
      message: `Expected ${PORT_COUNT} ports, found ${ports.length}.`,
    });
  }

  const seen = new Set<string>();
  for (const port of ports) {
    if (!isCoastalEdge(port.hexIndex, port.edge)) {
      problems.push({
        kind: 'not_coastal',
        message: `Hex ${port.hexIndex} edge ${EDGE_NAMES[port.edge] ?? port.edge} does not face the sea.`,
      });
    }
    const key = `${port.hexIndex}:${port.edge}`;
    if (seen.has(key)) {
      problems.push({
        kind: 'duplicate_edge',
        message: `Two ports share hex ${port.hexIndex} edge ${EDGE_NAMES[port.edge] ?? port.edge}.`,
      });
    }
    seen.add(key);
  }

  // Component counts: four 3:1s and exactly one 2:1 per resource.
  const counts = new Map<PortType, number>();
  for (const port of ports) counts.set(port.type, (counts.get(port.type) ?? 0) + 1);
  for (const [type, expected] of Object.entries(PORT_TYPE_COUNTS) as [PortType, number][]) {
    const actual = counts.get(type) ?? 0;
    if (actual !== expected) {
      problems.push({
        kind: 'wrong_count',
        message: `Expected ${expected} ${type} port(s), found ${actual}.`,
      });
    }
  }

  return problems;
}

/** Ports touching a given hex. */
export function portsForHex(
  ports: readonly CatanPortDef[],
  hexIndex: number,
): CatanPortDef[] {
  return ports.filter(p => p.hexIndex === hexIndex);
}

/** Human-readable trade rate, e.g. "2:1 ore" or "3:1 any". */
export function describePort(type: PortType): string {
  return type === 'generic' ? '3:1 any' : `2:1 ${type}`;
}
