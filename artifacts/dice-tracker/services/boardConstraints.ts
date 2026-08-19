/**
 * Board composition constraints and repair.
 *
 * All functions are pure — no side effects, no storage calls, no UI imports.
 *
 * A Catan board is not an arbitrary image. It is always built from a fixed bag
 * of components: nineteen tiles in known quantities and eighteen number tokens
 * in known quantities. That turns "read each tile independently and hope" into
 * "assign a known multiset to nineteen positions", which is a constrained
 * assignment problem with an exact solution.
 *
 * The practical consequence is that a mediocre per-tile reading still produces a
 * correct board. If a scanner reports five ore tiles, it is provably wrong, and
 * the assignment will move the least-confident of them somewhere legal rather
 * than handing the player a board that cannot exist.
 *
 * This is used today to repair AI scan output, and is the backbone a local
 * scanner would reuse.
 */

import type { CatanHexDef, ResourceType } from '@/types/models';

// ─── Component counts ─────────────────────────────────────────────────────────

/** Tiles in the base game box. Sums to 19. */
export const BOARD_RESOURCE_COUNTS: Readonly<Record<string, number>> = {
  desert: 1,
  grain: 4,
  lumber: 4,
  wool: 4,
  ore: 3,
  brick: 3,
};

/** Number tokens in the base game box. Sums to 18 — the desert has none. */
export const BOARD_TOKEN_COUNTS: Readonly<Record<number, number>> = {
  2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1,
};

export const BOARD_HEX_COUNT = 19;
export const BOARD_TOKEN_TOTAL = 18;

const RESOURCE_CLASSES = Object.keys(BOARD_RESOURCE_COUNTS) as ResourceType[];
const TOKEN_CLASSES = Object.keys(BOARD_TOKEN_COUNTS).map(Number);

// ─── Hungarian assignment ─────────────────────────────────────────────────────

const INF = Number.POSITIVE_INFINITY;

/**
 * Minimum-cost perfect assignment on a square cost matrix (Hungarian / JV
 * method with potentials, O(n³)).
 *
 * Returns `assignment[row] = col`. At n = 19 this is a few thousand operations,
 * so it runs comfortably inside a render pass on a phone.
 */
export function hungarian(cost: ReadonlyArray<ReadonlyArray<number>>): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const m = cost[0]!.length;

  // 1-indexed working arrays; index 0 is the sentinel the algorithm needs.
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(INF);
    const used = new Array<boolean>(m + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = INF;
      let j1 = 0;

      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }

      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j]! > 0) assignment[p[j]! - 1] = j - 1;
  }
  return assignment;
}

/**
 * Expand a class → capacity map into one column per available component, so a
 * capacitated assignment becomes a plain square one.
 */
function expandSlots<T>(counts: ReadonlyArray<[T, number]>): T[] {
  const slots: T[] = [];
  for (const [value, count] of counts) {
    for (let i = 0; i < count; i++) slots.push(value);
  }
  return slots;
}

// ─── Cost model ───────────────────────────────────────────────────────────────

/**
 * How strongly a reading resists being overruled.
 *
 * A high-confidence reading costs a lot to move, a low-confidence one costs
 * little, and an absent reading costs nothing — so the assignment fills unknown
 * tiles from whatever the component counts have left over, and only overrides a
 * confident tile when the counts leave no alternative.
 */
const COST_CONFIDENT_MISMATCH = 10;
const COST_UNSURE_MISMATCH = 3;
const COST_UNKNOWN = 1;
const COST_MATCH = 0;

function mismatchCost(confidence: CatanHexDef['confidence']): number {
  return confidence === 'high' ? COST_CONFIDENT_MISMATCH : COST_UNSURE_MISMATCH;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface BoardProblem {
  kind: 'hex_count' | 'resource_count' | 'token_count' | 'desert_token' | 'missing_token';
  message: string;
}

/**
 * Check a board against the contents of the box. Used to decide whether a scan
 * needs repairing, and to tell the player what looked wrong.
 */
export function validateBoardComposition(hexes: ReadonlyArray<CatanHexDef>): BoardProblem[] {
  const problems: BoardProblem[] = [];

  if (hexes.length !== BOARD_HEX_COUNT) {
    problems.push({
      kind: 'hex_count',
      message: `Expected ${BOARD_HEX_COUNT} hexes, found ${hexes.length}.`,
    });
  }

  const resourceCounts = new Map<string, number>();
  const tokenCounts = new Map<number, number>();
  for (const hex of hexes) {
    if (hex.resource) resourceCounts.set(hex.resource, (resourceCounts.get(hex.resource) ?? 0) + 1);
    if (hex.number !== null) tokenCounts.set(hex.number, (tokenCounts.get(hex.number) ?? 0) + 1);

    if (hex.resource === 'desert' && hex.number !== null) {
      problems.push({
        kind: 'desert_token',
        message: `Hex ${hex.index} is desert but carries a ${hex.number} token.`,
      });
    }
    if (hex.resource && hex.resource !== 'desert' && hex.number === null) {
      problems.push({
        kind: 'missing_token',
        message: `Hex ${hex.index} is ${hex.resource} but has no number token.`,
      });
    }
  }

  for (const [resource, expected] of Object.entries(BOARD_RESOURCE_COUNTS)) {
    const actual = resourceCounts.get(resource) ?? 0;
    if (actual > expected) {
      problems.push({
        kind: 'resource_count',
        message: `Found ${actual} ${resource} tiles; the box contains ${expected}.`,
      });
    }
  }

  for (const [token, expected] of Object.entries(BOARD_TOKEN_COUNTS)) {
    const actual = tokenCounts.get(Number(token)) ?? 0;
    if (actual > expected) {
      problems.push({
        kind: 'token_count',
        message: `Found ${actual} ${token} tokens; the box contains ${expected}.`,
      });
    }
  }

  return problems;
}

// ─── Repair ───────────────────────────────────────────────────────────────────

export interface BoardChange {
  hexIndex: number;
  field: 'resource' | 'number';
  from: ResourceType | number | null;
  to: ResourceType | number | null;
}

export interface ReconcileResult {
  hexes: CatanHexDef[];
  changes: BoardChange[];
}

/**
 * Force a board into a legal composition, moving as little as possible.
 *
 * Resources are assigned first because the desert determines which hexes take
 * number tokens at all. Tokens are then assigned across the eighteen
 * non-desert hexes.
 *
 * A hex whose reading survives keeps its original confidence; a hex the solver
 * had to move is marked 'low' so the review screen flags it for a human glance.
 */
export function reconcileBoard(hexes: ReadonlyArray<CatanHexDef>): ReconcileResult {
  if (hexes.length !== BOARD_HEX_COUNT) {
    return { hexes: hexes.map(h => ({ ...h })), changes: [] };
  }

  const changes: BoardChange[] = [];

  // ── Resources ───────────────────────────────────────────────────────────
  const resourceSlots = expandSlots(
    RESOURCE_CLASSES.map(r => [r, BOARD_RESOURCE_COUNTS[r]!] as [ResourceType, number]),
  );
  const resourceCost = hexes.map(hex =>
    resourceSlots.map(slot => {
      if (!hex.resource) return COST_UNKNOWN;
      return hex.resource === slot ? COST_MATCH : mismatchCost(hex.confidence);
    }),
  );
  const resourceAssignment = hungarian(resourceCost);

  const resolved: CatanHexDef[] = hexes.map((hex, i) => {
    const assigned = resourceSlots[resourceAssignment[i]!]!;
    if (hex.resource !== assigned) {
      changes.push({ hexIndex: hex.index, field: 'resource', from: hex.resource, to: assigned });
      return { ...hex, resource: assigned, confidence: 'low' as const };
    }
    return { ...hex };
  });

  // ── Tokens ──────────────────────────────────────────────────────────────
  const numbered = resolved.filter(h => h.resource !== 'desert');
  const tokenSlots = expandSlots(
    TOKEN_CLASSES.map(t => [t, BOARD_TOKEN_COUNTS[t]!] as [number, number]),
  );
  const tokenCost = numbered.map(hex =>
    tokenSlots.map(slot => {
      if (hex.number === null) return COST_UNKNOWN;
      return hex.number === slot ? COST_MATCH : mismatchCost(hex.confidence);
    }),
  );
  const tokenAssignment = hungarian(tokenCost);

  const numberByIndex = new Map<number, number>();
  numbered.forEach((hex, i) => {
    numberByIndex.set(hex.index, tokenSlots[tokenAssignment[i]!]!);
  });

  const finalHexes = resolved.map(hex => {
    if (hex.resource === 'desert') {
      if (hex.number !== null) {
        changes.push({ hexIndex: hex.index, field: 'number', from: hex.number, to: null });
        return { ...hex, number: null };
      }
      return hex;
    }
    const assigned = numberByIndex.get(hex.index)!;
    if (hex.number !== assigned) {
      changes.push({ hexIndex: hex.index, field: 'number', from: hex.number, to: assigned });
      return { ...hex, number: assigned, confidence: 'low' as const };
    }
    return hex;
  });

  return { hexes: finalHexes, changes };
}

/** One-line summary of a repair, for the board review screen. */
export function describeChange(change: BoardChange): string {
  const from = change.from === null ? 'blank' : String(change.from);
  const to = change.to === null ? 'blank' : String(change.to);
  return `Hex ${change.hexIndex}: ${change.field} ${from} → ${to}`;
}

// ─── Evidence-based reconciliation ────────────────────────────────────────────

/**
 * Per-hex evidence from a scanner, richer than a single guess.
 *
 * `resourceCost[terrain]` and `tokenCost[number]` are costs — LOWER means more
 * likely. A colour classifier supplies perceptual distances; a token reader
 * supplies its own confidence. Anything the scanner has no opinion about should
 * be left at an equal cost across the board.
 */
export interface HexEvidence {
  index: number;
  resourceCost: Partial<Record<ResourceType, number>>;
  tokenCost: Partial<Record<number, number>>;
  /**
   * Whether a number token was found sitting on this hex.
   *
   * This is the single most useful cross-signal on the board. The desert is the
   * only tile without a token, so its absence is strong evidence of desert and
   * its presence is proof of NOT-desert — evidence that arrives completely
   * independently of colour, which matters because the desert's pale tan is the
   * hardest terrain to separate by colour alone. Leave undefined if unknown.
   */
  hasToken?: boolean;
}

/** How hard the token cross-signal pushes. Large enough to overrule colour. */
const TOKEN_PRESENCE_WEIGHT = 8;

/** Cost used for a class the scanner expressed no opinion about. */
const NEUTRAL_COST = 1;

function costFor<K extends string | number>(
  costs: Partial<Record<K, number>>,
  key: K,
): number {
  const value = costs[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : NEUTRAL_COST;
}

/**
 * Resolve a whole board from per-hex evidence.
 *
 * WHY THIS BEATS CLASSIFYING TILES ONE AT A TIME
 * ----------------------------------------------
 * Every tile is assigned in a single global optimisation against the contents of
 * the box, so confident readings actively rescue unconfident ones. If eleven
 * tiles are read cleanly and a twelfth is lost under glare, the solver does not
 * need to recognise the twelfth at all — the other eighteen have consumed
 * everything except one tile and one token, and the leftovers can only go in one
 * place. That is the propagation that makes a lossy scan still produce a correct
 * board, and it gets stronger with every tile that reads cleanly.
 *
 * Costs are combined additively, so independent signals accumulate: a hex that
 * looks tan AND has no token becomes overwhelmingly the desert, while one that
 * looks tan but carries a token is pushed elsewhere however tan it looked.
 */
export function reconcileBoardFromEvidence(
  evidence: ReadonlyArray<HexEvidence>,
): ReconcileResult {
  if (evidence.length !== BOARD_HEX_COUNT) {
    return { hexes: [], changes: [] };
  }

  // ── Resources ───────────────────────────────────────────────────────────
  const resourceSlots = expandSlots(
    RESOURCE_CLASSES.map(r => [r, BOARD_RESOURCE_COUNTS[r]!] as [ResourceType, number]),
  );

  const resourceCost = evidence.map(hex =>
    resourceSlots.map(slot => {
      let cost = costFor(hex.resourceCost, slot);
      if (hex.hasToken !== undefined) {
        if (slot === 'desert') {
          // A token on the tile rules the desert out; its absence argues for it.
          cost += hex.hasToken ? TOKEN_PRESENCE_WEIGHT : -TOKEN_PRESENCE_WEIGHT;
        } else if (!hex.hasToken) {
          // Nothing else can sit tokenless.
          cost += TOKEN_PRESENCE_WEIGHT;
        }
      }
      return cost;
    }),
  );

  const resourceAssignment = hungarian(resourceCost);
  const resolved: CatanHexDef[] = evidence.map((hex, i) => ({
    index: hex.index,
    resource: resourceSlots[resourceAssignment[i]!]!,
    number: null,
    confidence: 'low' as const,
  }));

  // ── Tokens ──────────────────────────────────────────────────────────────
  const numberedIndices: number[] = [];
  resolved.forEach((hex, i) => {
    if (hex.resource !== 'desert') numberedIndices.push(i);
  });

  const tokenSlots = expandSlots(
    TOKEN_CLASSES.map(t => [t, BOARD_TOKEN_COUNTS[t]!] as [number, number]),
  );
  const tokenCost = numberedIndices.map(i =>
    tokenSlots.map(slot => costFor(evidence[i]!.tokenCost, slot)),
  );
  const tokenAssignment = hungarian(tokenCost);

  numberedIndices.forEach((hexPos, row) => {
    resolved[hexPos]!.number = tokenSlots[tokenAssignment[row]!]!;
  });

  // Confidence reflects whether the solver agreed with the scanner's own best
  // guess. Where it overruled the evidence, a human should take a look.
  const hexes = resolved.map((hex, i) => {
    const ev = evidence[i]!;
    const bestResource = cheapestKey(ev.resourceCost);
    const bestToken = cheapestKey(ev.tokenCost);
    const resourceAgreed = bestResource === null || bestResource === hex.resource;
    const tokenAgreed =
      hex.resource === 'desert' || bestToken === null || Number(bestToken) === hex.number;
    return { ...hex, confidence: resourceAgreed && tokenAgreed ? ('high' as const) : ('low' as const) };
  });

  const changes: BoardChange[] = [];
  evidence.forEach((ev, i) => {
    const bestResource = cheapestKey(ev.resourceCost);
    if (bestResource !== null && bestResource !== hexes[i]!.resource) {
      changes.push({
        hexIndex: ev.index,
        field: 'resource',
        from: bestResource as ResourceType,
        to: hexes[i]!.resource,
      });
    }
    const bestToken = cheapestKey(ev.tokenCost);
    if (bestToken !== null && Number(bestToken) !== hexes[i]!.number) {
      changes.push({
        hexIndex: ev.index,
        field: 'number',
        from: Number(bestToken),
        to: hexes[i]!.number,
      });
    }
  });

  return { hexes, changes };
}

/** Key with the lowest cost, or null when nothing was supplied. */
function cheapestKey<K extends string | number>(
  costs: Partial<Record<K, number>>,
): K | null {
  let best: K | null = null;
  let bestCost = Infinity;
  for (const [key, value] of Object.entries(costs) as [K, number][]) {
    if (typeof value === 'number' && value < bestCost) {
      bestCost = value;
      best = key;
    }
  }
  return best;
}
