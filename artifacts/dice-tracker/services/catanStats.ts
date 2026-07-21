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
): CatanPlayerProductionStats {
  const activeRolls = rollEvents.filter(e => !e.deletedAt);
  const playerEvents = exposureEvents.filter(e => e.playerId === player.id);

  let totalActual = 0;
  let totalExpected = 0;
  let robberLostProduction = 0;

  for (const roll of activeRolls) {
    const T = roll.turnNumber;
    const V = roll.value;

    const buildings = getBuildingStatesAtTurn(player.id, T, playerEvents);
    const blockedNumbers = getActiveRobberBlockedNumbers(player.id, T, playerEvents);
    const rollBlocked = blockedNumbers.includes(V);

    // ── Actual production ──────────────────────────────────────────────────
    let weightOnV = 0;
    let weightOnVUnblocked = 0;
    for (const bldg of buildings) {
      if (bldg.affectedNumbers.includes(V)) {
        weightOnVUnblocked += bldg.productionWeight;
        if (!rollBlocked) weightOnV += bldg.productionWeight;
      }
    }
    totalActual += weightOnV;
    robberLostProduction += weightOnVUnblocked - weightOnV;

    // ── Expected production (per-turn, given current exposure) ─────────────
    //   E[production] = Σ_n P(n) × weight(n)  for all non-blocked numbers n
    for (const bldg of buildings) {
      for (const num of bldg.affectedNumbers) {
        if (!blockedNumbers.includes(num)) {
          totalExpected += (CATAN_PROBS[num] ?? 0) * bldg.productionWeight;
        }
      }
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
  };
}

// ─── Full Catan stats ─────────────────────────────────────────────────────────

export function computeCatanGameStats(
  session: GameSession,
  rollEvents: RollEvent[],
  exposureEvents: CatanPlayerExposureEvent[],
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
    computePlayerProductionStats(p, rollEvents, exposureEvents),
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
