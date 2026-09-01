/**
 * Did YOUR numbers come up?
 *
 * WHY THIS EXISTS
 * ---------------
 * The results screen led with the mean roll, the median roll and the shape of
 * the distribution. Those are facts about the dice, and they are very nearly
 * irrelevant to the question anyone actually asks after a game — which is not
 * "was the mean 7.1?" but "I was on 6 and 9 all game and never saw them, was
 * that real?"
 *
 * Mean and median are also the WORST kind of summary here, because a table
 * whose numbers all landed can share a mean with a table where nobody's did.
 * Production already knew the right answer; the screen just never said it.
 *
 * So this reports, per player, the thing they are exposed to versus the thing
 * that happened:
 *
 *   - which numbers they hold, and how heavily
 *   - how many times each of those actually came up
 *   - how many times a fair run of the SAME LENGTH would have produced
 *   - the gap, per number and overall
 *
 * Expected counts are computed against the number of rolls actually made, not
 * a fixed idea of a game, because "you should have seen six 8s" means nothing
 * without saying six out of how many. That is the same relative-not-absolute
 * rule the verdict layer already follows.
 *
 * NOTHING HERE IS A LUCK CLAIM. Every figure is a count or a difference of
 * counts. Whether a gap is remarkable is the percentile's job, and the
 * percentile comes from `luckEngine`'s simulation — see the statistical stance
 * in CLAUDE.md.
 */

import { CATAN_NUMBERS, CATAN_PROBS, getBuildingStatesAtTurn } from '@/services/catanStats';
import { getAllIntersections } from '@/services/catanBoard';
import type {
  CatanHexDef,
  CatanPlayerExposureEvent,
  Player,
  ResourceType,
  RollEvent,
} from '@/types/models';

export interface NumberExposure {
  number: number;
  /**
   * How heavily they sit on it at the END of the game — 1 per settlement, 2
   * per city, counted once per touching hex.
   *
   * End-state, deliberately: this table answers "what were you holding", and a
   * per-turn weighting would make the column incomparable between players who
   * built at different times. The luck figures upstairs are the per-turn ones.
   */
  weight: number;
  /** Times this number actually came up. */
  actual: number;
  /** Times it would come up in a fair run of the same length. */
  expected: number;
}

export interface PlayerExposureReport {
  playerId: string;
  displayName: string;
  /** Every number they hold, strongest first. */
  numbers: NumberExposure[];
  /** Rolls that paid them anything. */
  payouts: number;
  /** Rolls that would pay them, in a fair run of the same length. */
  expectedPayouts: number;
  /** Total rolls in the game, so every figure above has a denominator. */
  totalRolls: number;
  /** Sum of `actual` across their numbers. */
  hitsOnMyNumbers: number;
  /** Sum of `expected` across their numbers. */
  expectedHitsOnMyNumbers: number;
}

/**
 * One player's exposure, against what the dice did.
 *
 * Uses the END-OF-GAME building set. A per-turn version is what the production
 * luck figure already does; this is the readable companion to it, and mixing
 * the two framings in one table is what made the old screen hard to follow.
 */
export function playerExposureReport(
  player: Player,
  rollEvents: readonly RollEvent[],
  exposureEvents: readonly CatanPlayerExposureEvent[],
): PlayerExposureReport {
  const rolls = rollEvents.filter(r => !r.deletedAt);
  const totalRolls = rolls.length;
  const mine = exposureEvents.filter(e => e.playerId === player.id);
  const buildings = getBuildingStatesAtTurn(player.id, Number.MAX_SAFE_INTEGER, [...mine]);

  const weightByNumber = new Map<number, number>();
  for (const b of buildings) {
    for (const n of b.affectedNumbers) {
      if (!CATAN_NUMBERS.includes(n)) continue;
      weightByNumber.set(n, (weightByNumber.get(n) ?? 0) + b.productionWeight);
    }
  }

  const actualByNumber = new Map<number, number>();
  for (const r of rolls) {
    actualByNumber.set(r.value, (actualByNumber.get(r.value) ?? 0) + 1);
  }

  const numbers: NumberExposure[] = [...weightByNumber.entries()]
    .map(([number, weight]) => ({
      number,
      weight,
      actual: actualByNumber.get(number) ?? 0,
      expected: (CATAN_PROBS[number] ?? 0) * totalRolls,
    }))
    .sort((a, b) => b.weight - a.weight || b.actual - a.actual || a.number - b.number);

  const held = new Set(numbers.map(n => n.number));
  const payouts = rolls.filter(r => held.has(r.value)).length;
  const pPayout = [...held].reduce((sum, n) => sum + (CATAN_PROBS[n] ?? 0), 0);

  return {
    playerId: player.id,
    displayName: player.displayName,
    numbers,
    payouts,
    expectedPayouts: pPayout * totalRolls,
    totalRolls,
    hitsOnMyNumbers: numbers.reduce((s, n) => s + n.actual, 0),
    expectedHitsOnMyNumbers: numbers.reduce((s, n) => s + n.expected, 0),
  };
}

// ─── Resources, which is how players actually think ──────────────────────────
//
// The grievance nobody ever phrases as a number is "I could not get ORE all
// game". Catan is a resource game; a settlement on 6-ore and one on 6-wool are
// the same pips and a completely different experience, and the second is the
// one that loses you the game when you needed cities.
//
// A number-only report cannot say anything about that, which is why it read as
// generic even though every figure in it was true.

export interface ResourceExposure {
  resource: ResourceType;
  /** Total production weight standing on that resource. */
  weight: number;
  /** Payouts per roll this position is worth on paper — Σ P(n) × weight. */
  perRoll: number;
  /** Production actually received from it. */
  actual: number;
  /** What a fair run of the same length would have paid. */
  expected: number;
}

/**
 * What each resource actually paid, against what the position was worth.
 *
 * Needs the board, because the exposure events carry numbers and not terrain.
 * Without a board this returns nothing rather than guessing — a scanned game
 * with no saved layout genuinely cannot answer this.
 */
export function resourceExposure(
  player: Player,
  rollEvents: readonly RollEvent[],
  exposureEvents: readonly CatanPlayerExposureEvent[],
  hexes: readonly CatanHexDef[] | null | undefined,
): ResourceExposure[] {
  if (!hexes || hexes.length === 0) return [];
  const rolls = rollEvents.filter(r => !r.deletedAt);
  const totalRolls = rolls.length;
  const mine = exposureEvents.filter(e => e.playerId === player.id);
  const buildings = getBuildingStatesAtTurn(player.id, Number.MAX_SAFE_INTEGER, [...mine]);
  const corners = new Map(getAllIntersections().map(i => [i.id, i.hexIndices]));

  const rollCount = new Map<number, number>();
  for (const r of rolls) rollCount.set(r.value, (rollCount.get(r.value) ?? 0) + 1);

  interface Acc { weight: number; perRoll: number; actual: number; expected: number }
  const byResource = new Map<ResourceType, Acc>();

  for (const b of buildings) {
    const touching = corners.get(b.locationId);
    // A building placed through the number pad has no corner, so it cannot be
    // attributed to a terrain. Skipped rather than guessed — see the
    // `unplaceable` count on BoardSnapshot for the same honesty problem.
    if (!touching) continue;
    for (const hexIndex of touching) {
      const hex = hexes[hexIndex];
      if (!hex?.resource || hex.resource === 'desert' || hex.resource === 'any') continue;
      const n = hex.number;
      if (typeof n !== 'number' || !CATAN_NUMBERS.includes(n)) continue;
      const acc = byResource.get(hex.resource)
        ?? { weight: 0, perRoll: 0, actual: 0, expected: 0 };
      const p = CATAN_PROBS[n] ?? 0;
      acc.weight += b.productionWeight;
      acc.perRoll += p * b.productionWeight;
      acc.actual += (rollCount.get(n) ?? 0) * b.productionWeight;
      acc.expected += p * totalRolls * b.productionWeight;
      byResource.set(hex.resource, acc);
    }
  }

  return [...byResource.entries()]
    .map(([resource, a]) => ({ resource, ...a }))
    .sort((x, y) => y.perRoll - x.perRoll || x.resource.localeCompare(y.resource));
}

/**
 * The single most out-of-line resource, over OR under.
 *
 * Both directions on purpose. The bias this whole app exists to correct is
 * that people notice the shortfalls and forget the windfalls, so a panel that
 * only ever reports droughts is not neutral reporting — it is the same
 * distortion with a chart on it.
 *
 * Standardised, because a gap of 3 means something different on ore worth 0.1
 * a roll than on wheat worth 0.4.
 */
export function biggestResourceGap(
  resources: readonly ResourceExposure[],
): { resource: ResourceType; diff: number; z: number } | null {
  let best: { resource: ResourceType; diff: number; z: number } | null = null;
  for (const r of resources) {
    if (r.expected <= 0) continue;
    const diff = r.actual - r.expected;
    const z = diff / Math.sqrt(r.expected);
    if (!best || Math.abs(z) > Math.abs(best.z)) best = { resource: r.resource, diff, z };
  }
  return best;
}

/** Every player's report, in the order they were given. */
export function exposureReports(
  players: readonly Player[],
  rollEvents: readonly RollEvent[],
  exposureEvents: readonly CatanPlayerExposureEvent[],
): PlayerExposureReport[] {
  return players.map(p => playerExposureReport(p, rollEvents, exposureEvents));
}

/**
 * One sentence a person would actually say, for the top of a player's row.
 *
 * Deliberately a COUNT and a comparison, never a verdict: "38 of 88, par 33"
 * is a fact whatever the dice were doing. The word for whether that gap is
 * strange belongs to the percentile, which has a simulation behind it.
 */
export function describeExposure(report: PlayerExposureReport): string {
  if (report.totalRolls === 0) return 'No rolls recorded.';
  if (report.numbers.length === 0) return 'No settlements recorded, so nothing to compare.';
  const par = Math.round(report.expectedPayouts);
  const diff = report.payouts - par;
  const gap =
    diff === 0 ? 'exactly par'
      : diff > 0 ? `${diff} above par`
        : `${Math.abs(diff)} below par`;
  return `Paid on ${report.payouts} of ${report.totalRolls} rolls — par was ${par}, so ${gap}.`;
}
