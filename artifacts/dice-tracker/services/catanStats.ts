/**
 * Catan-Compatible Mode statistics service.
 *
 * All functions are pure — no side effects, no storage calls, no UI imports.
 * Time-aware: production weights are applied only for the turns they were active.
 */

import type {
  CatanPlayerExposureEvent,
  GameSession,
  Player,
  PortType,
  RollEvent,
} from '@/types/models';
import type {
  BuildingState,
  CatanGameStats,
  CatanPlayerProductionStats,
} from '@/types/catanStats';
import { CATAN_SMALL_SAMPLE_THRESHOLD } from '@/types/catanStats';
import { getAllIntersections } from '@/services/catanBoard';
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
 *
 * TWO MODES, and the difference is how much the capture knew.
 *
 * When the block records the HEX (`robberHexIndex`, written since the robber
 * moved onto tiles) this is EXACT: charge the buildings actually standing on
 * that tile and nothing else. A player with two settlements on the robbed hex
 * loses both; a player whose second 5 is across the board loses nothing.
 *
 * When it does not — every block written before that field existed — fall back
 * to the old heuristic of charging the largest single share. Capture recorded
 * only the number, so the most that can honestly be said is that one hex's
 * worth went, and the loss stays bounded by what one hex can produce.
 */
export function blockedWeightForNumber(
  buildings: BuildingState[],
  num: number,
  robberHexIndex?: number | null,
): number {
  if (typeof robberHexIndex === 'number') {
    const onHex = new Set(
      getAllIntersections()
        .filter(i => i.hexIndices.includes(robberHexIndex))
        .map(i => i.id),
    );
    let sum = 0;
    for (const bldg of buildings) {
      if (!bldg.affectedNumbers.includes(num)) continue;
      if (!onHex.has(bldg.locationId)) continue;
      sum += bldg.productionWeight;
    }
    return sum;
  }

  let largest = 0;
  for (const bldg of buildings) {
    if (!bldg.affectedNumbers.includes(num)) continue;
    if (bldg.productionWeight > largest) largest = bldg.productionWeight;
  }
  return largest;
}

/**
 * Robber blocks on a player at a turn, carrying the hex when it is known.
 *
 * Parsed here rather than imported from `catanRobber`, which reaches this
 * module through `catanBoardState` and would close a cycle.
 */
export function getActiveRobberBlockDetails(
  playerId: string,
  turnNumber: number,
  allEvents: CatanPlayerExposureEvent[],
  /** The roll this is being asked for; see `hasHappened`. */
  asOf?: string,
): { numbers: number[]; hexIndex: number | null }[] {
  const live = new Map<string, { numbers: number[]; hexIndex: number | null }>();
  const relevant = allEvents
    .filter(
      e =>
        e.playerId === playerId &&
        hasHappened(e, turnNumber, asOf) &&
        (e.eventType === 'robberBlockStarted' || e.eventType === 'robberBlockEnded'),
    )
    .sort((a, b) => a.turnNumber - b.turnNumber);

  for (const e of relevant) {
    const id = e.hexIdentifiers?.[0];
    if (!id) continue;
    if (e.eventType === 'robberBlockStarted') {
      live.set(id, {
        numbers: e.affectedNumbers,
        hexIndex: typeof e.robberHexIndex === 'number' ? e.robberHexIndex : null,
      });
    } else {
      live.delete(id);
    }
  }
  return [...live.values()];
}

/** Production weight actually collected on `num`, after the robber. */
export function netWeightForNumber(
  buildings: BuildingState[],
  num: number,
  blockedNumbers: number[],
  /**
   * The blocks in full, when the caller has them. Each may name the hex, which
   * turns the robber charge from an estimate into an exact figure.
   *
   * Optional so every existing caller keeps working unchanged and keeps the
   * old number-only behaviour.
   */
  blockDetails?: readonly { numbers: number[]; hexIndex: number | null }[],
): number {
  const gross = grossWeightForNumber(buildings, num);
  if (gross === 0) return 0;

  if (blockDetails) {
    let blocked = 0;
    for (const b of blockDetails) {
      if (!b.numbers.includes(num)) continue;
      blocked = Math.max(blocked, blockedWeightForNumber(buildings, num, b.hexIndex));
    }
    return Math.max(0, gross - blocked);
  }

  const blocked = blockedNumbers.includes(num) ? blockedWeightForNumber(buildings, num) : 0;
  return Math.max(0, gross - blocked);
}

// ─── When does an event count? ───────────────────────────────────────────────

/**
 * Has this event happened yet, as of a given roll?
 *
 * `turnNumber` is a ROUND, shared by every roll in it. Resolving state with
 * `event.turnNumber <= roll.turnNumber` alone therefore applied a settlement
 * built by the third player to the first two players' rolls of that round,
 * thrown before it existed, and treated a robber moved mid-round as having sat
 * on its new tile all round. Up to a round of error per build or robber move.
 *
 * Within the SAME round the event must also have been recorded no later than
 * the roll. Earlier rounds always count. Round 0 (the opening) always counts,
 * and deliberately ignores timestamps: editing the opening mid-game re-stamps
 * those events with the current time, and they must still apply from the start.
 * Without `asOf`, or with a timestamp that cannot be parsed, the old round rule
 * stands, so older data and "state at the end of round N" queries are unchanged.
 */
export function hasHappened(
  event: { turnNumber: number; timestamp: string },
  turnNumber: number,
  asOf?: string,
): boolean {
  if (event.turnNumber < turnNumber) return true;
  if (event.turnNumber > turnNumber) return false;
  if (asOf === undefined || event.turnNumber === 0) return true;
  const at = Date.parse(asOf);
  const when = Date.parse(event.timestamp);
  if (!Number.isFinite(at) || !Number.isFinite(when)) return true;
  return when <= at;
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
  /** The roll this is being asked for; see `hasHappened`. */
  asOf?: string,
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
        hasHappened(e, turnNumber, asOf) &&
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
  /** The roll this is being asked for; see `hasHappened`. */
  asOf?: string,
): number[] {
  const robberEvents = allEvents
    .filter(
      e =>
        e.playerId === playerId &&
        hasHappened(e, turnNumber, asOf) &&
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

/**
 * What a player's buildings pay on each number, per TURN, computed once.
 *
 * Building and robber state only change when the turn does, so every roll in a
 * turn shares one answer. Three callers used to work this out for themselves,
 * per roll, each rescanning the whole event log — and two of them (the accolade
 * roll profiles and the end-of-game answers) did it WITHOUT the robber's tile,
 * so they charged the robber differently from the headline stats and could
 * disagree with them about the same roll. One lookup, one robber rule.
 */
export interface TurnProduction {
  buildings: BuildingState[];
  blockDetails: { numbers: number[]; hexIndex: number | null }[];
  /** Net production weight by dice value (index 0, 1 and 7 are zero). */
  weightsByValue: number[];
}

export function makeTurnProduction(
  exposureEvents: readonly CatanPlayerExposureEvent[],
): (playerId: string, turnNumber: number, asOf?: string) => TurnProduction {
  const byPlayer = new Map<string, {
    events: CatanPlayerExposureEvent[];
    /** Sorted times of the events recorded in each round, for the cache key. */
    timesByTurn: Map<number, number[]>;
  }>();
  const cache = new Map<string, TurnProduction>();

  return (playerId, turnNumber, asOf) => {
    let mine = byPlayer.get(playerId);
    if (!mine) {
      const events = exposureEvents.filter(e => e.playerId === playerId);
      const timesByTurn = new Map<number, number[]>();
      for (const e of events) {
        if (e.turnNumber === 0) continue;
        const when = Date.parse(e.timestamp);
        if (!Number.isFinite(when)) continue;
        const list = timesByTurn.get(e.turnNumber) ?? [];
        list.push(when);
        timesByTurn.set(e.turnNumber, list);
      }
      for (const list of timesByTurn.values()) list.sort((x, y) => x - y);
      mine = { events, timesByTurn };
      byPlayer.set(playerId, mine);
    }

    // State only changes when an event lands, so rolls between the same two
    // events of a round share one answer. The key is how many of this round's
    // events had happened by the roll.
    let seen = -1;
    const at = asOf === undefined ? NaN : Date.parse(asOf);
    if (Number.isFinite(at)) {
      seen = 0;
      for (const when of mine.timesByTurn.get(turnNumber) ?? []) {
        if (when <= at) seen++;
        else break;
      }
    }
    const key = `${playerId}:${turnNumber}:${seen}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const buildings = getBuildingStatesAtTurn(playerId, turnNumber, mine.events, asOf);
    const blockedNumbers = getActiveRobberBlockedNumbers(playerId, turnNumber, mine.events, asOf);
    const blockDetails = getActiveRobberBlockDetails(playerId, turnNumber, mine.events, asOf);
    const weightsByValue: number[] = new Array(13).fill(0);
    for (const num of CATAN_NUMBERS) {
      weightsByValue[num] = netWeightForNumber(buildings, num, blockedNumbers, blockDetails);
    }
    const out = { buildings, blockDetails, weightsByValue };
    cache.set(key, out);
    return out;
  };
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

  /*
    State as of each ROLL, through the shared lookup. It caches per stretch of a
    round between two events, which keeps the cost flat: this loop once rescanned
    every event per roll, measured at 21.5ms for 240 rolls and growing with the
    square of the log (`tools/perf_probe.mjs`), reported from a device as the app
    slowing down as the game went on.
  */
  const production = makeTurnProduction(playerEvents);

  for (const roll of activeRolls) {
    const V = roll.value;
    const { buildings, weightsByValue } = production(player.id, roll.turnNumber, roll.timestamp);
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

  // ── Port access (initial setup) ─────────────────────────────────────────
  // Collected from the events rather than the resolved building states, since
  // ports are a property of the intersection, not of production.
  const portAccess: PortType[] = [];
  for (const event of playerEvents) {
    if (event.turnNumber !== 0) continue;
    if (event.eventType !== 'initialSettlement') continue;
    if (event.portAccess && !portAccess.includes(event.portAccess)) {
      portAccess.push(event.portAccess);
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
    portAccess,
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
