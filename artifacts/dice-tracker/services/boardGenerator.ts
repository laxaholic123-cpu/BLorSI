/**
 * Catan board generator.
 *
 * Produces a complete, legal board — terrain, number tokens and ports — so a
 * game can start without photographing or hand-entering anything. Pure and
 * deterministic given a seed: the same seed and options always yield the same
 * board, which is what makes a board shareable and a bug reproducible.
 *
 * Strategy is generate-and-score, not constraint-solve. Several hundred
 * candidates are built and the best-scoring one is returned. That choice buys
 * three things a solver would not: it always returns *something* (a board that
 * satisfies four of five constraints beats an error message), it yields a score
 * worth showing the player, and it degrades honestly when the settings are
 * tighter than the tile bag allows.
 *
 * Catan-specific by design. It lives outside `services/modes/` because nothing
 * cross-mode consumes it — another game would ship its own generator.
 */

import type { CatanHexDef, CatanPortDef, PortType, ResourceType } from '@/types/modes/catan';
import {
  BOARD_HEX_COUNT,
  BOARD_RESOURCE_COUNTS,
  BOARD_TOKEN_COUNTS,
} from '@/services/boardConstraints';
import { CATAN_PIPS } from '@/services/catanStats';
import {
  getAdjacentHexPairs,
  getCoastalEdgesClockwise,
  getLandIntersections,
  HEX_AXIAL,
  PORT_TYPE_COUNTS,
  PORT_COUNT,
  STANDARD_PORT_LAYOUT,
  type CoastalEdge,
} from '@/services/catanBoard';
import { makeRng } from '@/services/luckEngine';

// ─── Options ──────────────────────────────────────────────────────────────────

export interface BoardGenOptions {
  /** Desert pinned to the middle hex, or shuffled in with everything else. */
  desert: 'center' | 'random';

  /**
   * Terrain spread. 'spread' forbids two hexes of the same resource sharing an
   * edge; 'random' shuffles the bag and accepts whatever falls out.
   */
  resources: 'spread' | 'random';

  /**
   * Token placement. 'balanced' applies the full constraint set (see
   * BALANCE_RULES); 'random' shuffles the token bag straight onto the board.
   */
  numbers: 'balanced' | 'random';

  /** Port positions: the standard-style fixed arrangement, or anywhere. */
  portPositions: 'fixed' | 'random';

  /**
   * Port types: 'standard' keeps each position's canonical trade rate, as a
   * printed sea frame does. 'shuffled' redistributes the nine port tiles among
   * the positions, which is the optional shuffle the rulebook allows.
   */
  portTypes: 'standard' | 'shuffled';

  /**
   * Where 2:1 ports sit relative to the resource they trade. Only has an effect
   * when `portTypes` is 'shuffled' — with 'standard' the pairing is already
   * decided by the frame.
   */
  portAffinity: 'random' | 'near' | 'far';

  /** Seed for reproducibility. Omit for a fresh board each call. */
  seed?: number;

  /** Candidates to evaluate. More is slower and slightly better. */
  candidates?: number;
}

export const DEFAULT_GEN_OPTIONS: BoardGenOptions = {
  desert: 'center',
  resources: 'spread',
  numbers: 'balanced',
  portPositions: 'fixed',
  portTypes: 'standard',
  portAffinity: 'random',
  candidates: 400,
};

// ─── Balance rules ────────────────────────────────────────────────────────────

/** Tokens printed in red. They roll most often, so two touching is decisive. */
const RED_NUMBERS: readonly number[] = [6, 8];

/** The rarest tokens. Two touching creates a corner nobody wants. */
const EXTREME_NUMBERS: readonly number[] = [2, 12];

/**
 * Pip ceiling for one intersection (three mutually adjacent hexes).
 *
 * A settlement on a 12-pip corner produces a third more than one on a 9-pip
 * corner, every game, forever. This is the constraint that most affects whether
 * the game was decided by placement rather than play — which matters more here
 * than in a generic generator, because this app's entire claim is telling those
 * two apart.
 */
const MAX_INTERSECTION_PIPS = 11;

/**
 * Penalties applied to the 0–100 score, per violation.
 *
 * These weights are a stated convention, not a measurement — there is no
 * experiment that makes an adjacent red pair "worth" 12 points. They are
 * declared here rather than buried so they can be argued with, and the raw
 * counts are reported alongside the score so nobody has to trust the weighting
 * to read the board.
 */
const PENALTY = {
  redAdjacency: 12,
  duplicateAdjacency: 6,
  extremeAdjacency: 4,
  sameResourceAdjacency: 3,
  intersectionPipsOver: 5,
  resourceImbalance: 1.5,
} as const;

// ─── Result ───────────────────────────────────────────────────────────────────

export interface HotIntersection {
  hexIndices: [number, number, number];
  pips: number;
}

export interface BoardMetrics {
  /** 0–100. Composite of the penalties above; 100 means no violations. */
  balanceScore: number;
  /**
   * 0–100 spread of production across intersections, scaled from the standard
   * deviation of corner pip totals. Low means every spot is much like every
   * other; high means the board has clear winners and dead zones. Neither is
   * "better" — a chaotic board is a different game, not a worse one.
   */
  chaos: number;
  /** Pairs of adjacent hexes both carrying a red number. */
  redAdjacencies: number;
  /** Pairs of adjacent hexes carrying the same number. */
  duplicateAdjacencies: number;
  /** Pairs of adjacent hexes both carrying a 2 or a 12. */
  extremeAdjacencies: number;
  /** Pairs of adjacent hexes carrying the same resource. */
  sameResourceAdjacencies: number;
  /** The strongest corner on the board. */
  hottestIntersection: HotIntersection | null;
  /** Intersections above MAX_INTERSECTION_PIPS. */
  intersectionsOverCap: number;
  /** Total pips per resource — reveals a starved or dominant resource. */
  pipsByResource: Record<string, number>;
  /** Resource with the fewest pips, and the most. */
  starvedResource: ResourceType | null;
  richestResource: ResourceType | null;
  /** Resources whose only ports are far from them, or absent. */
  portedResources: PortType[];
}

export interface GeneratedBoard {
  hexes: CatanHexDef[];
  ports: CatanPortDef[];
  metrics: BoardMetrics;
  /** The seed that produced this board. Always populated, so it is shareable. */
  seed: number;
  /** Candidates evaluated to reach it. */
  candidatesEvaluated: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CENTER_HEX_INDEX = 9;

/** Fisher-Yates, seeded. Returns a new array. */
function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const a = out[i]!;
    out[i] = out[j]!;
    out[j] = a;
  }
  return out;
}

function resourceBag(): ResourceType[] {
  const bag: ResourceType[] = [];
  for (const [resource, count] of Object.entries(BOARD_RESOURCE_COUNTS)) {
    for (let i = 0; i < count; i++) bag.push(resource as ResourceType);
  }
  return bag;
}

function tokenBag(): number[] {
  const bag: number[] = [];
  for (const [token, count] of Object.entries(BOARD_TOKEN_COUNTS)) {
    for (let i = 0; i < count; i++) bag.push(Number(token));
  }
  return bag;
}

const pipsFor = (n: number | null): number => (n === null ? 0 : CATAN_PIPS[n] ?? 0);

export const isRed = (n: number | null): boolean =>
  n !== null && RED_NUMBERS.includes(n);

// ─── Terrain ──────────────────────────────────────────────────────────────────

const ADJACENT_PAIRS = getAdjacentHexPairs();
const LAND_INTERSECTIONS = getLandIntersections();

/**
 * Lay terrain out, honouring the desert and spread options.
 *
 * Spread is attempted, not guaranteed. Placing 19 tiles from a bag holding four
 * of some resources with no two alike touching is not always satisfiable from a
 * given partial state, so this retries a bounded number of times and returns
 * its best effort. The score then reflects whatever it settled for, rather than
 * the caller getting an exception for asking a reasonable question.
 */
function placeTerrain(rng: () => number, opts: BoardGenOptions): ResourceType[] {
  const attempts = opts.resources === 'spread' ? 40 : 1;
  let best: ResourceType[] | null = null;
  let bestViolations = Infinity;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const layout = layTerrainOnce(rng, opts);
    if (opts.resources !== 'spread') return layout;

    const violations = countSameResourceAdjacencies(layout);
    if (violations < bestViolations) {
      best = layout;
      bestViolations = violations;
    }
    if (violations === 0) return layout;
  }

  return best ?? layTerrainOnce(rng, opts);
}

function layTerrainOnce(rng: () => number, opts: BoardGenOptions): ResourceType[] {
  const bag = resourceBag();

  if (opts.desert === 'random') return shuffled(bag, rng);

  // Desert pinned to the middle; everything else shuffled around it.
  const rest = shuffled(bag.filter(r => r !== 'desert'), rng);
  const layout: ResourceType[] = [];
  let cursor = 0;
  for (let i = 0; i < BOARD_HEX_COUNT; i++) {
    layout.push(i === CENTER_HEX_INDEX ? 'desert' : rest[cursor++]!);
  }
  return layout;
}

function countSameResourceAdjacencies(resources: readonly ResourceType[]): number {
  let count = 0;
  for (const [a, b] of ADJACENT_PAIRS) {
    const ra = resources[a];
    const rb = resources[b];
    // The desert is unique, so it can never collide with itself.
    if (ra === rb && ra !== 'desert') count++;
  }
  return count;
}

// ─── Numbers ──────────────────────────────────────────────────────────────────

/**
 * Assign number tokens to the non-desert hexes.
 *
 * Like terrain, balance is attempted rather than guaranteed, and for the same
 * reason: with the desert in the centre, the tightest corners are forced, and
 * some option combinations admit no perfect board at all.
 */
function placeNumbers(
  resources: readonly ResourceType[],
  rng: () => number,
  opts: BoardGenOptions,
): Array<number | null> {
  const attempts = opts.numbers === 'balanced' ? 60 : 1;
  let best: Array<number | null> | null = null;
  let bestPenalty = Infinity;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const layout = layNumbersOnce(resources, rng);
    if (opts.numbers !== 'balanced') return layout;

    const penalty = numberPenalty(resources, layout);
    if (penalty < bestPenalty) {
      best = layout;
      bestPenalty = penalty;
    }
    if (penalty === 0) return layout;
  }

  return best ?? layNumbersOnce(resources, rng);
}

function layNumbersOnce(
  resources: readonly ResourceType[],
  rng: () => number,
): Array<number | null> {
  const tokens = shuffled(tokenBag(), rng);
  const out: Array<number | null> = [];
  let cursor = 0;
  for (let i = 0; i < BOARD_HEX_COUNT; i++) {
    out.push(resources[i] === 'desert' ? null : tokens[cursor++]!);
  }
  return out;
}

/** Weighted violation count for a token layout — lower is better. */
function numberPenalty(
  resources: readonly ResourceType[],
  numbers: readonly (number | null)[],
): number {
  const c = countNumberViolations(numbers);
  const over = LAND_INTERSECTIONS.reduce((sum, ix) => {
    const pips = ix.hexIndices.reduce((t, h) => t + pipsFor(numbers[h] ?? null), 0);
    return sum + Math.max(0, pips - MAX_INTERSECTION_PIPS);
  }, 0);
  return (
    c.red * PENALTY.redAdjacency +
    c.duplicate * PENALTY.duplicateAdjacency +
    c.extreme * PENALTY.extremeAdjacency +
    over * PENALTY.intersectionPipsOver +
    resourcePipSpread(resources, numbers) * PENALTY.resourceImbalance
  );
}

function countNumberViolations(numbers: readonly (number | null)[]) {
  let red = 0;
  let duplicate = 0;
  let extreme = 0;
  for (const [a, b] of ADJACENT_PAIRS) {
    const na = numbers[a] ?? null;
    const nb = numbers[b] ?? null;
    if (na === null || nb === null) continue;
    if (isRed(na) && isRed(nb)) red++;
    if (na === nb) duplicate++;
    if (EXTREME_NUMBERS.includes(na) && EXTREME_NUMBERS.includes(nb)) extreme++;
  }
  return { red, duplicate, extreme };
}

/** Spread of total pips across the five producing resources. */
function resourcePipSpread(
  resources: readonly ResourceType[],
  numbers: readonly (number | null)[],
): number {
  const totals = pipsByResource(resources, numbers);
  const values = Object.values(totals);
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function pipsByResource(
  resources: readonly ResourceType[],
  numbers: readonly (number | null)[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (let i = 0; i < BOARD_HEX_COUNT; i++) {
    const r = resources[i];
    if (!r || r === 'desert') continue;
    totals[r] = (totals[r] ?? 0) + pipsFor(numbers[i] ?? null);
  }
  return totals;
}

// ─── Ports ────────────────────────────────────────────────────────────────────

const COASTAL_EDGES = getCoastalEdgesClockwise();

/**
 * Port positions spaced evenly around the coast.
 *
 * Nine ports over thirty coastal edges is 3.33 apart, so the spacing alternates
 * between 3 and 4 edges. That gap is what stops two ports sharing a settlement
 * intersection, which is why positions are derived from the clockwise walk
 * rather than picked at random.
 */
function evenlySpacedPositions(rotation: number): CoastalEdge[] {
  const out: CoastalEdge[] = [];
  for (let i = 0; i < PORT_COUNT; i++) {
    const idx = (rotation + Math.round((i * COASTAL_EDGES.length) / PORT_COUNT))
      % COASTAL_EDGES.length;
    out.push(COASTAL_EDGES[idx]!);
  }
  return out;
}

/** Axial distance between two hexes. */
function hexDistance(a: number, b: number): number {
  const A = HEX_AXIAL[a]!;
  const B = HEX_AXIAL[b]!;
  return (
    (Math.abs(A.q - B.q) + Math.abs(A.q + A.r - B.q - B.r) + Math.abs(A.r - B.r)) / 2
  );
}

/** Distance from a coastal position to the nearest hex of a given resource. */
function distanceToResource(
  position: CoastalEdge,
  resource: PortType,
  resources: readonly ResourceType[],
): number {
  let best = Infinity;
  for (let i = 0; i < BOARD_HEX_COUNT; i++) {
    if (resources[i] !== resource) continue;
    best = Math.min(best, hexDistance(position.hexIndex, i));
  }
  return best === Infinity ? 0 : best;
}

function portTypeBag(): PortType[] {
  const bag: PortType[] = [];
  for (const [type, count] of Object.entries(PORT_TYPE_COUNTS)) {
    for (let i = 0; i < count; i++) bag.push(type as PortType);
  }
  return bag;
}

function placePorts(
  resources: readonly ResourceType[],
  rng: () => number,
  opts: BoardGenOptions,
): CatanPortDef[] {
  const positions: CoastalEdge[] =
    opts.portPositions === 'fixed'
      ? STANDARD_PORT_LAYOUT.map(p => ({ hexIndex: p.hexIndex, edge: p.edge }))
      : evenlySpacedPositions((rng() * COASTAL_EDGES.length) | 0);

  if (opts.portTypes === 'standard') {
    // Keep the canonical trade rate for each slot, as a printed frame does.
    // When positions moved, the type sequence rides along in clockwise order so
    // the generic/specific alternation is preserved.
    return positions.map((pos, i) => ({
      hexIndex: pos.hexIndex,
      edge: pos.edge,
      type: STANDARD_PORT_LAYOUT[i]!.type,
    }));
  }

  const specific = portTypeBag().filter(t => t !== 'generic');
  const open = [...positions];
  const assigned: CatanPortDef[] = [];

  // Specific ports first — they are the only ones affinity can mean anything
  // for. Shuffled so the order resources get first pick is not fixed.
  for (const resource of shuffled(specific, rng)) {
    let chosenIdx = 0;
    if (opts.portAffinity === 'random') {
      chosenIdx = (rng() * open.length) | 0;
    } else {
      const want = opts.portAffinity === 'near' ? -1 : 1;
      let bestScore = -Infinity;
      open.forEach((pos, i) => {
        const d = distanceToResource(pos, resource, resources);
        const score = want * d;
        if (score > bestScore) {
          bestScore = score;
          chosenIdx = i;
        }
      });
    }
    const pos = open.splice(chosenIdx, 1)[0]!;
    assigned.push({ hexIndex: pos.hexIndex, edge: pos.edge, type: resource });
  }

  for (const pos of open) {
    assigned.push({ hexIndex: pos.hexIndex, edge: pos.edge, type: 'generic' });
  }

  return assigned;
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

export function measureBoard(
  hexes: readonly CatanHexDef[],
  ports: readonly CatanPortDef[],
): BoardMetrics {
  const resources = hexes.map(h => h.resource) as ResourceType[];
  const numbers = hexes.map(h => h.number);

  const counts = countNumberViolations(numbers);
  const sameResource = countSameResourceAdjacencies(resources);

  const intersectionPips = LAND_INTERSECTIONS.map(ix =>
    ix.hexIndices.reduce((t, h) => t + pipsFor(numbers[h] ?? null), 0),
  );

  let hottest: HotIntersection | null = null;
  LAND_INTERSECTIONS.forEach((ix, i) => {
    const pips = intersectionPips[i]!;
    if (!hottest || pips > hottest.pips) {
      hottest = { hexIndices: ix.hexIndices, pips };
    }
  });

  const overCap = intersectionPips.filter(p => p > MAX_INTERSECTION_PIPS).length;
  const overage = intersectionPips.reduce(
    (sum, p) => sum + Math.max(0, p - MAX_INTERSECTION_PIPS),
    0,
  );

  const totals = pipsByResource(resources, numbers);
  const entries = Object.entries(totals);
  const starved = entries.length
    ? (entries.reduce((a, b) => (a[1] <= b[1] ? a : b))[0] as ResourceType)
    : null;
  const richest = entries.length
    ? (entries.reduce((a, b) => (a[1] >= b[1] ? a : b))[0] as ResourceType)
    : null;

  const penalty =
    counts.red * PENALTY.redAdjacency +
    counts.duplicate * PENALTY.duplicateAdjacency +
    counts.extreme * PENALTY.extremeAdjacency +
    sameResource * PENALTY.sameResourceAdjacency +
    overage * PENALTY.intersectionPipsOver +
    resourcePipSpread(resources, numbers) * PENALTY.resourceImbalance;

  // Chaos: standard deviation of corner strength, scaled so a typical board
  // lands mid-range. The divisor is a presentation choice, not a measurement.
  const mean =
    intersectionPips.reduce((a, b) => a + b, 0) / (intersectionPips.length || 1);
  const sd = Math.sqrt(
    intersectionPips.reduce((s, p) => s + (p - mean) ** 2, 0) /
      (intersectionPips.length || 1),
  );

  return {
    balanceScore: Math.max(0, Math.min(100, Math.round(100 - penalty))),
    chaos: Math.max(0, Math.min(100, Math.round((sd / 4) * 100))),
    redAdjacencies: counts.red,
    duplicateAdjacencies: counts.duplicate,
    extremeAdjacencies: counts.extreme,
    sameResourceAdjacencies: sameResource,
    hottestIntersection: hottest,
    intersectionsOverCap: overCap,
    pipsByResource: totals,
    starvedResource: starved,
    richestResource: richest,
    portedResources: [...new Set(ports.map(p => p.type))].filter(t => t !== 'generic'),
  };
}

// ─── Generate ─────────────────────────────────────────────────────────────────

/**
 * Penalty used to CHOOSE between candidates.
 *
 * Deliberately not the same as the reported balance score. Selection may only
 * optimise the constraints the player actually asked for: if they chose random
 * numbers, ranking candidates by number violations would quietly hand them a
 * balanced board and label it random. Measuring caught exactly that — "random"
 * mode was producing 0.03 adjacent red pairs per board, which is not random by
 * any reading.
 *
 * `measureBoard` still reports everything, because a player wanting chaos is
 * still entitled to know how chaotic they got.
 */
function selectionPenalty(m: BoardMetrics, opts: BoardGenOptions): number {
  let penalty = 0;

  if (opts.numbers === 'balanced') {
    penalty +=
      m.redAdjacencies * PENALTY.redAdjacency +
      m.duplicateAdjacencies * PENALTY.duplicateAdjacency +
      m.extremeAdjacencies * PENALTY.extremeAdjacency +
      m.intersectionsOverCap * PENALTY.intersectionPipsOver;
  }

  if (opts.resources === 'spread') {
    penalty += m.sameResourceAdjacencies * PENALTY.sameResourceAdjacency;
  }

  return penalty;
}

/**
 * Build a board, keeping the best of several hundred candidates.
 *
 * Returns the seed that produced the winner, not the seed that was passed in,
 * so any board on screen can be reproduced exactly — including a board reached
 * by pressing "generate again" a dozen times.
 *
 * With every constraint switched off there is nothing to rank, so the first
 * candidate wins and the search exits immediately. That is the intended
 * behaviour, not an optimisation: fully random means fully random.
 */
export function generateBoard(
  options: Partial<BoardGenOptions> = {},
): GeneratedBoard {
  const opts: BoardGenOptions = { ...DEFAULT_GEN_OPTIONS, ...options };
  const rootSeed = opts.seed ?? ((Math.random() * 0x7fffffff) | 0);
  const candidates = Math.max(1, opts.candidates ?? 400);

  let best: GeneratedBoard | null = null;
  let bestPenalty = Infinity;
  let evaluated = 0;

  for (let i = 0; i < candidates; i++) {
    // Each candidate gets its own derived seed, so the winner is reproducible
    // on its own without replaying the whole search.
    const candidateSeed = (rootSeed + i * 0x9e3779b1) | 0;
    const board = buildOne(candidateSeed, opts);
    evaluated++;

    const penalty = selectionPenalty(board.metrics, opts);
    if (penalty < bestPenalty) {
      best = board;
      bestPenalty = penalty;
    }
    if (bestPenalty === 0) break;
  }

  return { ...best!, candidatesEvaluated: evaluated };
}

/** One candidate from one seed. Exported so a shared board can be rebuilt. */
export function buildOne(seed: number, options: Partial<BoardGenOptions> = {}): GeneratedBoard {
  const opts: BoardGenOptions = { ...DEFAULT_GEN_OPTIONS, ...options };
  const rng = makeRng(seed >>> 0);

  const resources = placeTerrain(rng, opts);
  const numbers = placeNumbers(resources, rng, opts);
  const ports = placePorts(resources, rng, opts);

  const hexes: CatanHexDef[] = resources.map((resource, index) => ({
    index,
    resource,
    number: numbers[index] ?? null,
    confidence: 'high',
  }));

  return {
    hexes,
    ports,
    metrics: measureBoard(hexes, ports),
    seed,
    candidatesEvaluated: 1,
  };
}
