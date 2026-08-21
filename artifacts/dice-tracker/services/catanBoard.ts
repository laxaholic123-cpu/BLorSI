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

// ─── Intersections ────────────────────────────────────────────────────────────

/** Three mutually adjacent hexes meeting at a corner. */
export interface LandIntersection {
  /** Hex indices, ascending. Always three — coastal corners are excluded. */
  hexIndices: [number, number, number];
}

/**
 * Every corner where three land hexes meet.
 *
 * Corners with only one or two land hexes are excluded on purpose: this exists
 * to answer "how strong is the best spot on this board", and a coastal corner
 * touching two tiles is never that spot. Count is asserted in tests rather than
 * stated here — it is a fact about the geometry, not a choice.
 */
export function getLandIntersections(): LandIntersection[] {
  const seen = new Set<string>();
  const out: LandIntersection[] = [];

  for (let hexIndex = 0; hexIndex < HEX_COUNT; hexIndex++) {
    for (const edge of ALL_EDGES) {
      // Two consecutive edges bound one corner.
      const next = ((edge + 1) % 6) as HexEdge;
      const a = getNeighborIndex(hexIndex, edge);
      const b = getNeighborIndex(hexIndex, next);
      if (a === null || b === null) continue;

      const triple = [hexIndex, a, b].sort((x, y) => x - y) as [number, number, number];
      const key = triple.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ hexIndices: triple });
    }
  }

  return out;
}

/**
 * A settlement corner: the meeting point of one, two or three hexes.
 *
 * Vertices are numbered 0-5 matching the drawing order in `CatanHexGrid`
 * (starting at the top and running clockwise). Vertex k is bounded by edges k
 * and k+1, which is what makes the hex lookup below correct.
 *
 * Unlike `getLandIntersections`, this includes coastal corners — a settlement
 * on the shore touching two hexes is perfectly legal and extremely common, so
 * exposure entry needs all of them.
 */
export interface Intersection {
  /** Stable id: the touching hex indices, ascending, joined by '-'. */
  id: string;
  /** One to three hexes, ascending. */
  hexIndices: number[];
}

/**
 * The hexes touching one corner, ascending.
 *
 * Vertex k is bounded by edges k and k+1, so the hexes across those two edges
 * are the corner's other occupants.
 */
export function hexesAtIntersection(hexIndex: number, vertex: number): number[] {
  const a = getNeighborIndex(hexIndex, (vertex % 6) as HexEdge);
  const b = getNeighborIndex(hexIndex, ((vertex + 1) % 6) as HexEdge);
  return [hexIndex, a, b]
    .filter((h): h is number => h !== null)
    .sort((x, y) => x - y);
}

/**
 * Corner identity is POSITIONAL, not the set of hexes that touch it.
 *
 * The obvious id — sorted touching hexes, "0-3-4" — is wrong, and wrong in the
 * quiet way. It is unique only for the 24 interior corners. On the coast, hex 0
 * has three outer vertices that touch nothing else, so all three collapse to
 * "0"; the two ends of the 0/1 border both give "0-1". That yields 48 ids for
 * 54 corners, and two players on different shore corners would have been told
 * the spot was taken while their exposure quietly merged.
 *
 * So corners are keyed by where they actually are. Each hex centre is placed in
 * unit axial space and each vertex offset from it; corners shared by several
 * hexes land on the same point and collapse correctly, while distinct corners
 * stay distinct however few hexes they touch.
 */
const vertexPoint = (hexIndex: number, vertex: number): string => {
  const axial = HEX_AXIAL[hexIndex]!;
  const cx = Math.sqrt(3) * (axial.q + axial.r / 2);
  const cy = 1.5 * axial.r;
  const theta = ((-90 + 60 * (vertex % 6)) * Math.PI) / 180;

  /**
   * Rounded to integer thousandths, NOT via toFixed.
   *
   * These coordinates are irrational sums that land on zero only to within a
   * rounding error, and the error has a sign: reaching one corner from the hex
   * on its left gives +1e-16 while the hex on its right gives -1e-16.
   * `toFixed(3)` renders those as "0.000" and "-0.000" — two different keys for
   * one corner, which split six corners in half and produced 60 corners where
   * there are 54. Integer keys have no negative zero.
   *
   * A thousandth is far finer than the ~0.87 gap between adjacent corners, so
   * the rounding can only ever merge a corner with itself.
   */
  const key = (v: number): number => {
    const n = Math.round(v * 1000);
    return n === 0 ? 0 : n;
  };

  return `${key(cx + Math.cos(theta))},${key(cy + Math.sin(theta))}`;
};

/**
 * Canonical id per corner position: the lowest hex that touches it, and the
 * vertex number on that hex. Written "4v2" so it stays readable in stored data.
 */
const CANONICAL_ID_BY_POINT: ReadonlyMap<string, string> = (() => {
  const best = new Map<string, { hexIndex: number; vertex: number }>();
  for (let hexIndex = 0; hexIndex < HEX_COUNT; hexIndex++) {
    for (let vertex = 0; vertex < 6; vertex++) {
      const point = vertexPoint(hexIndex, vertex);
      const current = best.get(point);
      if (
        !current ||
        hexIndex < current.hexIndex ||
        (hexIndex === current.hexIndex && vertex < current.vertex)
      ) {
        best.set(point, { hexIndex, vertex });
      }
    }
  }
  const out = new Map<string, string>();
  for (const [point, { hexIndex, vertex }] of best) out.set(point, `${hexIndex}v${vertex}`);
  return out;
})();

/** Canonical corner id for a hex vertex. */
export function intersectionIdAt(hexIndex: number, vertex: number): string {
  return CANONICAL_ID_BY_POINT.get(vertexPoint(hexIndex, vertex))!;
}

/** Every settlement corner on the board. Count is asserted in tests. */
export function getAllIntersections(): Intersection[] {
  const byId = new Map<string, Intersection>();

  for (let hexIndex = 0; hexIndex < HEX_COUNT; hexIndex++) {
    for (let vertex = 0; vertex < 6; vertex++) {
      const id = intersectionIdAt(hexIndex, vertex);
      const existing = byId.get(id);
      const hexIndices = hexesAtIntersection(hexIndex, vertex);
      if (!existing) {
        byId.set(id, { id, hexIndices });
      } else {
        // Merge: reaching the same corner from another hex can reveal a hex the
        // first approach could not see.
        const merged = [...new Set([...existing.hexIndices, ...hexIndices])]
          .sort((x, y) => x - y);
        byId.set(id, { id, hexIndices: merged });
      }
    }
  }

  return [...byId.values()].sort((x, y) => x.id.localeCompare(y.id));
}

/** Cached, because exposure entry asks per tap and the board never changes. */
const HEXES_BY_INTERSECTION_ID: ReadonlyMap<string, number[]> = new Map(
  getAllIntersections().map(ix => [ix.id, ix.hexIndices]),
);

/** The hexes touching a corner, by its canonical id. */
export function hexesForIntersectionId(intersectionId: string): number[] {
  return HEXES_BY_INTERSECTION_ID.get(intersectionId) ?? [];
}

/**
 * The two corner ids a port serves.
 *
 * A harbour sits on an edge, but settlements sit on corners — the two ends of
 * that edge are the only spots that gain the trade rate. Edge e runs between
 * vertices e-1 and e.
 */
export function intersectionIdsForPort(port: CatanPortDef): [string, string] {
  return [
    intersectionIdAt(port.hexIndex, (port.edge + 5) % 6),
    intersectionIdAt(port.hexIndex, port.edge),
  ];
}

/** The port serving a given corner, if any. */
export function portForIntersection(
  intersectionId: string,
  ports: readonly CatanPortDef[],
): PortType | undefined {
  for (const port of ports) {
    const [a, b] = intersectionIdsForPort(port);
    if (a === intersectionId || b === intersectionId) return port.type;
  }
  return undefined;
}

/** Every unordered pair of adjacent hexes, each pair listed once. */
export function getAdjacentHexPairs(): Array<[number, number]> {
  const seen = new Set<string>();
  const out: Array<[number, number]> = [];

  for (let hexIndex = 0; hexIndex < HEX_COUNT; hexIndex++) {
    for (const edge of ALL_EDGES) {
      const other = getNeighborIndex(hexIndex, edge);
      if (other === null) continue;
      const pair = (hexIndex < other ? [hexIndex, other] : [other, hexIndex]) as [number, number];
      const key = pair.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(pair);
    }
  }

  return out;
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
 * Harbour arrangement, read off a physical board.
 *
 * Transcribed from a photographed 5th-edition base game: starting at the 3:1
 * above the ore-4 hex and going clockwise — 3:1, 2:1 brick, 2:1 lumber, 3:1,
 * 2:1 grain, 2:1 ore, 3:1, 2:1 wool, 3:1.
 *
 * This replaced an unverified placeholder whose spacing was right (3-4 coastal
 * edges apart) but whose TYPES were not. The placeholder ran
 * generic/specific/generic/specific with a single pair at the end — exactly the
 * minimum number of same-type neighbours an odd cycle allows. That evenness is
 * the tell: it was constructed to look tidy rather than transcribed. The real
 * frame reads G,S,S,G,S,S,G,S,G, with three same-type pairs, because harbours
 * were placed to suit the island rather than a pattern.
 *
 * Anchoring was checked four ways before trusting it — the harbours adjacent to
 * hexes 18, 15, 12 and 7 in the photo all land where this walk puts them.
 *
 * Still edition-specific. Frames differ between printings, so this is one real
 * board rather than a universal truth; a group whose box disagrees needs their
 * own layout. Ports feed `portAccess` only, which never enters production or
 * luck, so a mismatch misreports trade access and nothing else.
 */
export const STANDARD_PORT_LAYOUT: readonly CatanPortDef[] = [
  { hexIndex: 18, edge: 3, type: 'generic' }, // above the ore 4, clockwise from here
  { hexIndex: 17, edge: 4, type: 'brick' },
  { hexIndex: 12, edge: 4, type: 'lumber' },
  { hexIndex: 7, edge: 5, type: 'generic' },
  { hexIndex: 3, edge: 0, type: 'grain' },
  { hexIndex: 1, edge: 0, type: 'ore' },
  { hexIndex: 2, edge: 1, type: 'generic' },
  { hexIndex: 6, edge: 2, type: 'wool' },
  { hexIndex: 15, edge: 2, type: 'generic' },
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
