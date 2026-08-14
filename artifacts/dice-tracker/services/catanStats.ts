/**
 * Catan-Compatible Mode statistics service.
 *
 * All functions are pure — no side effects, no storage calls, no UI imports.
 * Time-aware: production weights are applied only for the turns they were active.
 */

import type { CatanPlayerExposureEvent, GameSession, Player, RollEvent } from '@/types/models';
import type {
  BuildingState,
  CatanGameStats,
  CatanPlayerProductionStats,
} from '@/types/catanStats';
import { CATAN_SMALL_SAMPLE_THRESHOLD } from '@/types/catanStats';
import { classifyCatanVerdict } from '@/services/catanVerdict';
import { simulateProductionPercentile, type PercentileResult } from '@/services/luckEngine';

/** Controls the optional Monte Carlo pass. See computePlayerProductionStats. */
export interface CatanStatsOptions {
  /** Run the simulation and populate the percentile fields. Off by default. */
  simulate?: boolean;
  /** Simulated games per player. Defaults to the engine's 10,000. */
  iterations?: number;
  /** Seed, for reproducible verdicts and tests. */
  seed?: number;
}

// ─── 2D6 probability constants ────────────────────────────────────────────────

/** Probability of each 2D6 sum (7 included for completeness). */
export const CATAN_PROBS: Record<number, number> = {
  2: 1 / 36, 3: 2 / 36, 4: 3 / 36, 5: 4 / 36, 6: 5 / 36,
  7: 6 / 36,
  8: 5 / 36, 9: 4 / 36, 10: 3 / 36, 11: 2 / 36, 12: 1 / 36,
};

/** Pip counts per number (Catan convention: 6/8 = 5 pips, etc.) */
export const CATAN_PIPS: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1,
};

/** Every producing dice number, in order. 7 is excluded — it moves the robber. */
export const CATAN_NUMBERS: number[] = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];

// ─── Production weight helpers ────────────────────────────────────────────────
//
// These three helpers exist so that ACTUAL and EXPECTED production are always
// derived from the same function. Previously actual production tested
// `affectedNumbers.includes(v)` (counting a number once) while expected
// production iterated the array (counting it twice), so any board where a
// settlement touched two hexes bearing the same token produced a luck figure
// that was wrong by construction.

/**
 * Production weight a single building yields when `num` is rolled.
 * Duplicates count: a settlement touching two 9-hexes produces twice on a 9.
 */
export function weightOnNumber(bldg: BuildingState, num: number): number {
  let hits = 0;
  for (const n of bldg.affectedNumbers) if (n === num) hits++;
  return hits * bldg.productionWeight;
}

/** Total unblocked weight a player's buildings yield when `num` is rolled. */
export function grossWeightForNumber(buildings: BuildingState[], num: number): number {
  let gross = 0;
  for (const bldg of buildings) gross += weightOnNumber(bldg, num);
  return gross;
}

/**
 * Weight the robber removes when `num` is rolled.
 *
 * The robber occupies exactly ONE hex, so it can only ever suppress one hex's
 * worth of production — not every building the player owns on that number.
 * Capture only records the number the robber landed on, so when a player has
 * several buildings on it we charge the largest single share: the robber
 * overwhelmingly targets the most productive tile, and it keeps the loss
 * bounded by what one hex can actually produce.
 */
export function blockedWeightForNumber(buildings: BuildingState[], num: number): number {
  let largest = 0;
  for (const bldg of buildings) {
    if (!bldg.affectedNumbers.includes(num)) continue;
    if (bldg.productionWeight > largest) largest = bldg.productionWeight;
  }
  return largest;
}

/** Production weight actually collected on `num`, after the robber. */
export function netWeightForNumber(
  buildings: BuildingState[],
  num: number,
  blockedNumbers: number[],
): number {
  const gross = grossWeightForNumber(buildings, num);
  if (gross === 0) return 0;
  const blocked = blockedNumbers.includes(num) ? blockedWeightForNumber(buildings, num) : 0;
  return Math.max(0, gross - blocked);
}

// ─── Building state (time-aware) ──────────────────────────────────────────────

/**
 * Returns the resolved set of ACTIVE buildings for a player at a given turn.
 *
 * Rules:
 * - Uses the most recent event per locationId (hexIdentifiers[0]) at or before turnNumber.
 * - Skips robberBlock events (those are handled separately).
 * - Skips buildings whose most recent state is 'buildingRemoved' or productionWeight === 0.
 */
export function getBuildingStatesAtTurn(
  playerId: string,
  turnNumber: number,
  allEvents: CatanPlayerExposureEvent[],
): BuildingState[] {
  const BUILDING_TYPES: CatanPlayerExposureEvent['eventType'][] = [
    'initialSettlement',
    'settlementBuilt',
    'cityUpgrade',
    'buildingRemoved',
    'manualCorrection',
  ];

  // Filter to this player's building events up to this turn, sorted ascending
  const relevant = allEvents
    .filter(
      e =>
        e.playerId === playerId &&
        e.turnNumber <= turnNumber &&
        BUILDING_TYPES.includes(e.eventType),
    )
    .sort((a, b) => a.turnNumber - b.turnNumber);

  // Latest event per locationId wins
  const locationMap = new Map<string, CatanPlayerExposureEvent>();
  for (const event of relevant) {
    const locationId = event.hexIdentifiers?.[0];
    if (!locationId) continue;
    locationMap.set(locationId, event);
  }

  const states: BuildingState[] = [];
  for (const [locationId, event] of locationMap) {
    if (event.eventType === 'buildingRemoved') continue;
    if (event.productionWeight <= 0) continue;
    states.push({
      locationId,
      affectedNumbers: event.affectedNumbers,
      productionWeight: event.productionWeight,
      resourceType: event.resourceType,
    });
  }

  return states;
}

/**
 * Returns the dice numbers currently blocked by the robber for a player at turn T.
 *
 * Robber blocks are identified by hexIdentifiers[0] starting with 'rblock_'.
 * Each 'robberBlockStarted' is cancelled by a 'robberBlockEnded' with the same blockId.
 *
 * NOTE: the robber prompt only records the *number* the robber landed on, not
 * which hex. A player with two buildings on the same number therefore cannot be
 * resolved exactly — see blockedWeightForRoll() for how that ambiguity is
 * handled. Fixing it properly means recording the blocked hex identifier at
 * capture time.
 */
export function getActiveRobberBlockedNumbers(
  playerId: string,
  turnNumber: number,
  allEvents: CatanPlayerExposureEvent[],
): number[] {
  const robberEvents = allEvents
    .filter(
      e =>
        e.playerId === playerId &&
        e.turnNumber <= turnNumber &&
        (e.eventType === 'robberBlockStarted' || e.eventType === 'robberBlockEnded'),
    )
    .sort((a, b) => a.turnNumber - b.turnNumber);

  const activeBlocks = new Map<string, number[]>(); // blockId → blocked numbers

  for (const event of robberEvents) {
    const blockId = event.hexIdentifiers?.[0];
    if (!blockId) continue;
    if (event.eventType === 'robberBlockStarted') {
      activeBlocks.set(blockId, event.affectedNumbers);
    } else {
      activeBlocks.delete(blockId);
    }
  }

  const all: number[] = [];
  for (const nums of activeBlocks.values()) all.push(...nums);
  return [...new Set(all)];
}

// ─── Per-player production stats ──────────────────────────────────────────────

export function computePlayerProductionStats(
  player: Player,
  rollEvents: RollEvent[],
  exposureEvents: CatanPlayerExposureEvent[],
  options: CatanStatsOptions = {},
): CatanPlayerProductionStats {
  const activeRolls = rollEvents.filter(e => !e.deletedAt);
  const playerEvents = exposureEvents.filter(e => e.playerId === player.id);

  let totalActual = 0;
  let totalExpected = 0;
  let robberLostProduction = 0;

  // Per-roll production lookup, indexed by dice value. Built here because the
  // per-turn building and robber state is already resolved on this pass; the
  // simulator then replays these same turns with fair dice.
  const perRollWeights: number[][] = [];

  for (const roll of activeRolls) {
    const T = roll.turnNumber;
    const V = roll.value;

    const buildings = getBuildingStatesAtTurn(player.id, T, playerEvents);
    const blockedNumbers = getActiveRobberBlockedNumbers(player.id, T, playerEvents);

    // Net weight for every possible value on this turn (index 0/1 unused).
    const weightsByValue: number[] = new Array(13).fill(0);
    for (const num of CATAN_NUMBERS) {
      weightsByValue[num] = netWeightForNumber(buildings, num, blockedNumbers);
    }
    perRollWeights.push(weightsByValue);

    // ── Actual production ──────────────────────────────────────────────────
    const grossOnV = grossWeightForNumber(buildings, V);
    const netOnV = weightsByValue[V] ?? 0;
    totalActual += netOnV;
    robberLostProduction += grossOnV - netOnV;

    // ── Expected production (per-turn, given current exposure) ─────────────
    //   E[production] = Σ_n P(n) × netWeight(n)
    // Reads the same table the actual figure above does, so the two can never
    // drift apart in how they treat duplicates or the robber.
    for (const num of CATAN_NUMBERS) {
      totalExpected += (CATAN_PROBS[num] ?? 0) * weightsByValue[num]!;
    }
  }

  // ── Placement strength (initial setup, turnNumber = 0) ──────────────────
  const initialBuildings = getBuildingStatesAtTurn(player.id, 0, playerEvents);
  let placementStrength = 0;
  const exposedNumbers = new Set<number>();
  for (const bldg of initialBuildings) {
    for (const num of bldg.affectedNumbers) {
      placementStrength += (CATAN_PROBS[num] ?? 0) * bldg.productionWeight;
      exposedNumbers.add(num);
    }
  }

  // ── Final city count (most recent state) ────────────────────────────────
  const lastRollTurn = activeRolls.length > 0
    ? Math.max(...activeRolls.map(r => r.turnNumber))
    : 0;
  const finalBuildings = getBuildingStatesAtTurn(player.id, lastRollTurn + 999, playerEvents);
  const finalCityCount = finalBuildings.filter(b => b.productionWeight === 2).length;

  // Simulation is opt-in: it costs ~10k × rolls operations per player, which is
  // fine on a results screen but not when career stats aggregate every player of
  // every session, or when the live in-game panel recomputes on each roll.
  let sim: PercentileResult | null = null;
  if (options.simulate && perRollWeights.length > 0 && totalExpected > 0) {
    sim = simulateProductionPercentile(perRollWeights, totalActual, {
      iterations: options.iterations,
      seed: options.seed,
    });
  }

  return {
    playerId: player.id,
    displayName: player.displayName,
    totalActualProduction: totalActual,
    totalExpectedProduction: totalExpected,
    productionLuck: totalActual - totalExpected,
    productionLuckPct: totalExpected > 0
      ? ((totalActual - totalExpected) / totalExpected) * 100
      : 0,
    placementStrength,
    numberDiversity: exposedNumbers.size,
    robberLostProduction,
    initialBuildingCount: initialBuildings.length,
    finalCityCount,
    ...(sim
      ? {
          productionLuckPercentile: sim.percentile,
          productionSimMean: sim.simMean,
          productionSimStdDev: sim.simStdDev,
        }
      : {}),
  };
}

// ─── Full Catan stats ─────────────────────────────────────────────────────────

export function computeCatanGameStats(
  session: GameSession,
  rollEvents: RollEvent[],
  exposureEvents: CatanPlayerExposureEvent[],
  options: CatanStatsOptions = {},
): CatanGameStats {
  const activeRolls = rollEvents.filter(e => !e.deletedAt);
  const totalRolls = activeRolls.length;
  const sevenCount = activeRolls.filter(r => r.value === 7).length;
  const nonSevenCount = totalRolls - sevenCount;
  const sevenExpected = Math.round((6 / 36) * totalRolls);
  const sevenPct = totalRolls > 0 ? (sevenCount / totalRolls) * 100 : 0;
  const isSmallSample = totalRolls < CATAN_SMALL_SAMPLE_THRESHOLD;
  const hasExposureData = exposureEvents.length > 0;

  const playerStats = session.players.map(p =>
    computePlayerProductionStats(p, rollEvents, exposureEvents, options),
  );

  const findings = hasExposureData
    ? classifyCatanVerdict(playerStats, sevenCount, totalRolls, isSmallSample)
    : null;

  return {
    totalRolls,
    sevenCount,
    sevenPct,
    nonSevenCount,
    sevenExpected,
    playerStats,
    findings,
    isSmallSample,
    smallSampleThreshold: CATAN_SMALL_SAMPLE_THRESHOLD,
    hasExposureData,
  };
}
