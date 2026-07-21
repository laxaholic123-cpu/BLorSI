/**
 * Unit tests for Catan-Compatible Mode statistics.
 *
 * Covers:
 *   - Time-aware building state (city upgrade non-retroactive)
 *   - Robber-adjusted production (blocked numbers excluded)
 *   - Building removal
 *   - Per-player production stats
 *   - Placement strength
 *   - Seven frequency classification
 *   - All Catan verdict categories
 *   - Small sample threshold
 */

import {
  CATAN_PROBS,
  computeCatanGameStats,
  computePlayerProductionStats,
  getActiveRobberBlockedNumbers,
  getBuildingStatesAtTurn,
} from '../services/catanStats';
import {
  classifyCatanVerdict,
  classifyExposureLuck,
  classifyFinalOutcome,
  classifyPlacementRating,
  classifyRollLuck,
  classifySevenFrequency,
} from '../services/catanVerdict';
import type { CatanPlayerExposureEvent, GameSession, Player, RollEvent } from '../types/models';
import type { CatanPlayerProductionStats } from '../types/catanStats';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let seq = 0;
const makePlayer = (id: string, name = `Player ${id}`): Player => ({
  id, displayName: name, color: '#1ABC9C', seatNumber: 1, createdAt: '2024-01-01T00:00:00Z',
});

const makeSession = (players: Player[], overrides: Partial<GameSession> = {}): GameSession => ({
  id: 'sess1',
  gameType: 'catan',
  customGameName: 'Settlement Mode',
  diceMode: '2D6',
  minimumRoll: 2,
  maximumRoll: 12,
  players,
  currentPlayerIndex: 0,
  autoAdvancePlayer: true,
  startedAt: '2024-01-01T00:00:00Z',
  status: 'active',
  winnerPlayerId: undefined,
  placements: [],
  settings: {
    recordIndividualDice: true,
    trackWinner: false,
    trackPlacements: false,
    catanRobberTracking: true,
    catanResourceTracking: false,
  },
  schemaVersion: 1,
  ...overrides,
});

const makeRoll = (value: number, playerId = 'p1', turnNumber = 1): RollEvent => ({
  id: `r${++seq}`,
  sessionId: 'sess1',
  playerId,
  value,
  turnNumber,
  sequenceNumber: seq,
  timestamp: '2024-01-01T00:00:00Z',
  source: 'touchscreen',
});

const makeExposure = (
  playerId: string,
  affectedNumbers: number[],
  locationId: string,
  opts: Partial<CatanPlayerExposureEvent> = {},
): CatanPlayerExposureEvent => ({
  id: `e${++seq}`,
  sessionId: 'sess1',
  playerId,
  eventType: 'initialSettlement',
  turnNumber: 0,
  timestamp: '2024-01-01T00:00:00Z',
  affectedNumbers,
  hexIdentifiers: [locationId],
  productionWeight: 1,
  robberBlocked: false,
  ...opts,
});

beforeEach(() => { seq = 0; });

// ─── CATAN_PROBS ──────────────────────────────────────────────────────────────

describe('CATAN_PROBS', () => {
  it('includes 7', () => {
    expect(CATAN_PROBS[7]).toBeCloseTo(6 / 36, 10);
  });

  it('all 11 values sum to 1', () => {
    const total = Object.values(CATAN_PROBS).reduce((s, p) => s + p, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('6 and 8 have equal probability', () => {
    expect(CATAN_PROBS[6]).toBeCloseTo(CATAN_PROBS[8]!, 10);
  });
});

// ─── getBuildingStatesAtTurn ───────────────────────────────────────────────────

describe('getBuildingStatesAtTurn', () => {
  it('returns initial settlements at turn 0', () => {
    const events = [
      makeExposure('p1', [5, 9], 'loc1'),
      makeExposure('p1', [6, 8], 'loc2'),
    ];
    const states = getBuildingStatesAtTurn('p1', 0, events);
    expect(states).toHaveLength(2);
    expect(states.map(s => s.locationId).sort()).toEqual(['loc1', 'loc2']);
  });

  it('excludes other players\' buildings', () => {
    const events = [
      makeExposure('p1', [5], 'loc1'),
      makeExposure('p2', [6], 'loc2'),
    ];
    const states = getBuildingStatesAtTurn('p1', 0, events);
    expect(states).toHaveLength(1);
    expect(states[0]!.locationId).toBe('loc1');
  });

  it('excludes events after the given turn', () => {
    const events = [
      makeExposure('p1', [5], 'loc1', { turnNumber: 0 }),
      makeExposure('p1', [9], 'loc2', { turnNumber: 5, eventType: 'settlementBuilt' }),
    ];
    const statesAt0 = getBuildingStatesAtTurn('p1', 0, events);
    const statesAt5 = getBuildingStatesAtTurn('p1', 5, events);
    expect(statesAt0).toHaveLength(1);
    expect(statesAt5).toHaveLength(2);
  });

  it('city upgrade at turn T: NOT visible before turn T', () => {
    const events = [
      makeExposure('p1', [6], 'loc1', { turnNumber: 0, productionWeight: 1 }),
      makeExposure('p1', [6], 'loc1', { turnNumber: 5, eventType: 'cityUpgrade', productionWeight: 2 }),
    ];
    // Before upgrade: weight = 1
    const statesBefore = getBuildingStatesAtTurn('p1', 4, events);
    expect(statesBefore[0]!.productionWeight).toBe(1);

    // At and after upgrade: weight = 2
    const statesAfter = getBuildingStatesAtTurn('p1', 5, events);
    expect(statesAfter[0]!.productionWeight).toBe(2);
  });

  it('buildingRemoved event excludes the building', () => {
    const events = [
      makeExposure('p1', [9], 'loc1', { turnNumber: 0 }),
      makeExposure('p1', [9], 'loc1', { turnNumber: 3, eventType: 'buildingRemoved', productionWeight: 0 }),
    ];
    const before = getBuildingStatesAtTurn('p1', 2, events);
    const after = getBuildingStatesAtTurn('p1', 3, events);
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(0);
  });

  it('returns empty when no events', () => {
    expect(getBuildingStatesAtTurn('p1', 0, [])).toHaveLength(0);
  });

  it('ignores events without hexIdentifiers', () => {
    const event: CatanPlayerExposureEvent = {
      id: 'e1', sessionId: 'sess1', playerId: 'p1', eventType: 'initialSettlement',
      turnNumber: 0, timestamp: '2024-01-01T00:00:00Z', affectedNumbers: [5],
      productionWeight: 1, robberBlocked: false,
      // hexIdentifiers intentionally omitted
    };
    const states = getBuildingStatesAtTurn('p1', 0, [event]);
    expect(states).toHaveLength(0);
  });
});

// ─── getActiveRobberBlockedNumbers ────────────────────────────────────────────

describe('getActiveRobberBlockedNumbers', () => {
  it('returns empty when no robber blocks', () => {
    expect(getActiveRobberBlockedNumbers('p1', 1, [])).toHaveLength(0);
  });

  it('returns blocked number when block is active', () => {
    const events = [
      makeExposure('p1', [6], 'rblock_abc', { eventType: 'robberBlockStarted', turnNumber: 2, productionWeight: 0, robberBlocked: true }),
    ];
    const blocked = getActiveRobberBlockedNumbers('p1', 3, events);
    expect(blocked).toContain(6);
  });

  it('does not return block if ended', () => {
    const events = [
      makeExposure('p1', [6], 'rblock_abc', { eventType: 'robberBlockStarted', turnNumber: 2, productionWeight: 0, robberBlocked: true }),
      makeExposure('p1', [6], 'rblock_abc', { eventType: 'robberBlockEnded', turnNumber: 4, productionWeight: 0 }),
    ];
    const at3 = getActiveRobberBlockedNumbers('p1', 3, events);
    const at4 = getActiveRobberBlockedNumbers('p1', 4, events);
    expect(at3).toContain(6);
    expect(at4).not.toContain(6);
  });

  it('does not return blocks for other players', () => {
    const events = [
      makeExposure('p2', [8], 'rblock_xyz', { eventType: 'robberBlockStarted', turnNumber: 1, productionWeight: 0 }),
    ];
    expect(getActiveRobberBlockedNumbers('p1', 2, events)).not.toContain(8);
  });

  it('does not return future blocks', () => {
    const events = [
      makeExposure('p1', [5], 'rblock_abc', { eventType: 'robberBlockStarted', turnNumber: 10, productionWeight: 0 }),
    ];
    expect(getActiveRobberBlockedNumbers('p1', 5, events)).not.toContain(5);
  });
});

// ─── computePlayerProductionStats ─────────────────────────────────────────────

describe('computePlayerProductionStats', () => {
  it('zero production when no exposure', () => {
    const player = makePlayer('p1');
    const rolls: RollEvent[] = [makeRoll(6), makeRoll(9)];
    const stats = computePlayerProductionStats(player, rolls, []);
    expect(stats.totalActualProduction).toBe(0);
    expect(stats.totalExpectedProduction).toBe(0);
  });

  it('actual production matches exposure hits', () => {
    const player = makePlayer('p1');
    // Settlement on 6 → produces 1 when 6 is rolled
    const events = [makeExposure('p1', [6], 'loc1')];
    const rolls: RollEvent[] = [makeRoll(6, 'p1', 1), makeRoll(9, 'p1', 2), makeRoll(6, 'p1', 3)];
    const stats = computePlayerProductionStats(player, rolls, events);
    // 6 rolled twice → 2 production
    expect(stats.totalActualProduction).toBe(2);
  });

  it('city upgrade doubles production from that turn (non-retroactive)', () => {
    const player = makePlayer('p1');
    const events = [
      makeExposure('p1', [6], 'loc1', { turnNumber: 0, productionWeight: 1 }),
      // City upgrade at turn 3
      makeExposure('p1', [6], 'loc1', { turnNumber: 3, eventType: 'cityUpgrade', productionWeight: 2 }),
    ];

    // Roll 6 at turn 1 (before upgrade): production = 1
    // Roll 6 at turn 3 (at upgrade): production = 2
    // Roll 6 at turn 5 (after upgrade): production = 2
    const rolls: RollEvent[] = [
      makeRoll(6, 'p1', 1),
      makeRoll(6, 'p1', 3),
      makeRoll(6, 'p1', 5),
    ];
    const stats = computePlayerProductionStats(player, rolls, events);
    // 1 + 2 + 2 = 5
    expect(stats.totalActualProduction).toBe(5);
  });

  it('robber block prevents production during active turns', () => {
    const player = makePlayer('p1');
    const events = [
      makeExposure('p1', [6], 'loc1', { turnNumber: 0 }),
      // Robber block on number 6 from turn 2 to turn 3
      makeExposure('p1', [6], 'rblock_abc', { eventType: 'robberBlockStarted', turnNumber: 2, productionWeight: 0, robberBlocked: true }),
      makeExposure('p1', [6], 'rblock_abc', { eventType: 'robberBlockEnded', turnNumber: 4, productionWeight: 0 }),
    ];
    const rolls: RollEvent[] = [
      makeRoll(6, 'p1', 1), // not blocked → produces 1
      makeRoll(6, 'p1', 2), // blocked → produces 0
      makeRoll(6, 'p1', 3), // still blocked → produces 0
      makeRoll(6, 'p1', 4), // unblocked → produces 1
    ];
    const stats = computePlayerProductionStats(player, rolls, events);
    expect(stats.totalActualProduction).toBe(2);
    expect(stats.robberLostProduction).toBe(2);
  });

  it('placementStrength reflects initial settlement probabilities', () => {
    const player = makePlayer('p1');
    // Settlement on 6 (5/36 prob)
    const events = [makeExposure('p1', [6], 'loc1')];
    const stats = computePlayerProductionStats(player, [], events);
    expect(stats.placementStrength).toBeCloseTo(5 / 36, 8);
  });

  it('placementStrength doubles for city at turn 0', () => {
    const player = makePlayer('p1');
    // City on 8 (5/36 prob) at setup
    const events = [makeExposure('p1', [8], 'loc1', { productionWeight: 2 })];
    const stats = computePlayerProductionStats(player, [], events);
    expect(stats.placementStrength).toBeCloseTo((5 / 36) * 2, 8);
  });

  it('numberDiversity counts unique initial numbers', () => {
    const player = makePlayer('p1');
    const events = [
      makeExposure('p1', [5, 9], 'loc1'),
      makeExposure('p1', [9, 11], 'loc2'),
    ];
    const stats = computePlayerProductionStats(player, [], events);
    // Unique numbers: 5, 9, 11 → 3
    expect(stats.numberDiversity).toBe(3);
  });

  it('excludes deleted roll events', () => {
    const player = makePlayer('p1');
    const events = [makeExposure('p1', [6], 'loc1')];
    const rolls: RollEvent[] = [
      makeRoll(6, 'p1', 1),
      { ...makeRoll(6, 'p1', 2), deletedAt: '2024-01-01T01:00:00Z' }, // deleted
    ];
    const stats = computePlayerProductionStats(player, rolls, events);
    expect(stats.totalActualProduction).toBe(1); // only the non-deleted roll
  });

  it('finalCityCount counts cities at end of game', () => {
    const player = makePlayer('p1');
    const events = [
      makeExposure('p1', [6], 'loc1', { turnNumber: 0, productionWeight: 1 }),
      makeExposure('p1', [6], 'loc1', { turnNumber: 5, eventType: 'cityUpgrade', productionWeight: 2 }),
    ];
    const rolls: RollEvent[] = [makeRoll(6, 'p1', 3)];
    const stats = computePlayerProductionStats(player, rolls, events);
    expect(stats.finalCityCount).toBe(1);
  });
});

// ─── Seven frequency ──────────────────────────────────────────────────────────

describe('classifySevenFrequency', () => {
  it('expected when sevens ≈ 6/36', () => {
    // 6/36 × 36 = 6 sevens out of 36 rolls
    expect(classifySevenFrequency(6, 36)).toBe('expected');
  });

  it('low when fewer than 11% sevens', () => {
    // 3 sevens in 36 rolls = 8.3%
    expect(classifySevenFrequency(3, 36)).toBe('low');
  });

  it('high when more than 22% sevens', () => {
    // 9 sevens in 36 rolls = 25%
    expect(classifySevenFrequency(9, 36)).toBe('high');
  });

  it('returns expected for empty game', () => {
    expect(classifySevenFrequency(0, 0)).toBe('expected');
  });
});

// ─── Roll luck ────────────────────────────────────────────────────────────────

describe('classifyRollLuck', () => {
  it('neutral when actual ≈ expected', () => {
    const stats: CatanPlayerProductionStats[] = [{
      playerId: 'p1', displayName: 'P1',
      totalActualProduction: 10, totalExpectedProduction: 10,
      productionLuck: 0, productionLuckPct: 0,
      placementStrength: 0.5, numberDiversity: 3,
      robberLostProduction: 0, initialBuildingCount: 2, finalCityCount: 0,
    }];
    expect(classifyRollLuck(stats)).toBe('neutral');
  });

  it('lucky when actual significantly above expected', () => {
    const stats: CatanPlayerProductionStats[] = [{
      playerId: 'p1', displayName: 'P1',
      totalActualProduction: 15, totalExpectedProduction: 10,
      productionLuck: 5, productionLuckPct: 50,
      placementStrength: 0.5, numberDiversity: 3,
      robberLostProduction: 0, initialBuildingCount: 2, finalCityCount: 0,
    }];
    expect(classifyRollLuck(stats)).toBe('lucky');
  });

  it('unlucky when actual significantly below expected', () => {
    const stats: CatanPlayerProductionStats[] = [{
      playerId: 'p1', displayName: 'P1',
      totalActualProduction: 5, totalExpectedProduction: 10,
      productionLuck: -5, productionLuckPct: -50,
      placementStrength: 0.5, numberDiversity: 3,
      robberLostProduction: 0, initialBuildingCount: 2, finalCityCount: 0,
    }];
    expect(classifyRollLuck(stats)).toBe('unlucky');
  });
});

// ─── Exposure luck ────────────────────────────────────────────────────────────

describe('classifyExposureLuck', () => {
  const makeStats = (actual: number, expected: number): CatanPlayerProductionStats => ({
    playerId: 'p1', displayName: 'P1',
    totalActualProduction: actual, totalExpectedProduction: expected,
    productionLuck: actual - expected,
    productionLuckPct: expected > 0 ? ((actual - expected) / expected) * 100 : 0,
    placementStrength: 0.5, numberDiversity: 3,
    robberLostProduction: 0, initialBuildingCount: 2, finalCityCount: 0,
  });

  it('average when within 15%', () => {
    expect(classifyExposureLuck(makeStats(10, 10))).toBe('average');
  });

  it('poor when > 15% below expected', () => {
    expect(classifyExposureLuck(makeStats(7, 10))).toBe('poor'); // -30%
  });

  it('strong when > 15% above expected', () => {
    expect(classifyExposureLuck(makeStats(13, 10))).toBe('strong'); // +30%
  });

  it('average when no expected production', () => {
    expect(classifyExposureLuck(makeStats(0, 0))).toBe('average');
  });
});

// ─── Placement rating ─────────────────────────────────────────────────────────

describe('classifyPlacementRating', () => {
  const makeStats = (placementStrength: number): CatanPlayerProductionStats => ({
    playerId: 'p1', displayName: 'P1',
    totalActualProduction: 10, totalExpectedProduction: 10,
    productionLuck: 0, productionLuckPct: 0,
    placementStrength, numberDiversity: 3,
    robberLostProduction: 0, initialBuildingCount: 2, finalCityCount: 0,
  });

  it('weak when strength < 0.40', () => {
    expect(classifyPlacementRating(makeStats(0.3))).toBe('weak');
  });

  it('average when strength 0.40 – 0.70', () => {
    expect(classifyPlacementRating(makeStats(0.55))).toBe('average');
  });

  it('strong when strength > 0.70', () => {
    expect(classifyPlacementRating(makeStats(0.80))).toBe('strong');
  });
});

// ─── Final outcome ────────────────────────────────────────────────────────────

describe('classifyFinalOutcome', () => {
  it('too_early when small sample', () => {
    expect(classifyFinalOutcome('lucky', ['strong'], ['strong'], true)).toBe('too_early');
  });

  it('lucky_dice_lucky_exposure when lucky + strong exposure', () => {
    expect(classifyFinalOutcome('lucky', ['strong', 'strong'], ['average', 'average'], false)).toBe('lucky_dice_lucky_exposure');
  });

  it('bad_dice_bad_exposure when unlucky + poor exposure', () => {
    expect(classifyFinalOutcome('unlucky', ['poor', 'poor'], ['average', 'average'], false)).toBe('bad_dice_bad_exposure');
  });

  it('dice_were_fair when neutral + average exposure', () => {
    expect(classifyFinalOutcome('neutral', ['average'], ['average'], false)).toBe('dice_were_fair');
  });

  it('strong_placement_poor_luck when strong placement + not lucky', () => {
    expect(classifyFinalOutcome('unlucky', ['average'], ['strong', 'strong'], false)).toBe('strong_placement_poor_luck');
  });

  it('weak_placement_lucky_dice when weak placement + lucky dice', () => {
    expect(classifyFinalOutcome('lucky', ['average'], ['weak', 'weak'], false)).toBe('weak_placement_lucky_dice');
  });
});

// ─── classifyCatanVerdict ──────────────────────────────────────────────────────

describe('classifyCatanVerdict', () => {
  const makePlayerStats = (actual: number, expected: number, placement: number): CatanPlayerProductionStats => ({
    playerId: 'p1', displayName: 'P1',
    totalActualProduction: actual, totalExpectedProduction: expected,
    productionLuck: actual - expected,
    productionLuckPct: expected > 0 ? ((actual - expected) / expected) * 100 : 0,
    placementStrength: placement, numberDiversity: 3,
    robberLostProduction: 0, initialBuildingCount: 2, finalCityCount: 0,
  });

  it('too_early when small sample', () => {
    const findings = classifyCatanVerdict([makePlayerStats(5, 5, 0.5)], 2, 10, true);
    expect(findings.finalOutcome).toBe('too_early');
  });

  it('headline is non-empty string', () => {
    const findings = classifyCatanVerdict([makePlayerStats(10, 10, 0.55)], 6, 36, false);
    expect(typeof findings.headline).toBe('string');
    expect(findings.headline.length).toBeGreaterThan(0);
  });

  it('details is non-empty array', () => {
    const findings = classifyCatanVerdict([makePlayerStats(10, 10, 0.55)], 6, 36, false);
    expect(Array.isArray(findings.details)).toBe(true);
    expect(findings.details.length).toBeGreaterThan(0);
  });

  it('exposes per-player exposure and placement ratings', () => {
    const p1 = makePlayerStats(10, 10, 0.55);
    const p2 = { ...makePlayerStats(5, 10, 0.40), playerId: 'p2', displayName: 'P2' };
    const findings = classifyCatanVerdict([p1, p2], 6, 36, false);
    expect(findings.exposureLuck['p1']).toBeDefined();
    expect(findings.exposureLuck['p2']).toBeDefined();
    expect(findings.placementRating['p1']).toBeDefined();
    expect(findings.placementRating['p2']).toBeDefined();
  });

  it('sevenFrequency reflects actual seven count', () => {
    const findings = classifyCatanVerdict([], 3, 36, false);
    expect(findings.sevenFrequency).toBe('low'); // 3/36 = 8.3%
  });
});

// ─── computeCatanGameStats integration ───────────────────────────────────────

describe('computeCatanGameStats', () => {
  it('totalRolls counts only active (non-deleted) rolls', () => {
    const session = makeSession([makePlayer('p1')]);
    const rolls: RollEvent[] = [
      makeRoll(6, 'p1', 1),
      { ...makeRoll(7, 'p1', 2), deletedAt: '2024-01-01T01:00:00Z' },
    ];
    const stats = computeCatanGameStats(session, rolls, []);
    expect(stats.totalRolls).toBe(1);
  });

  it('sevenCount only counts active sevens', () => {
    const session = makeSession([makePlayer('p1')]);
    const rolls: RollEvent[] = [
      makeRoll(7, 'p1', 1),
      makeRoll(7, 'p1', 2),
      { ...makeRoll(7, 'p1', 3), deletedAt: '2024-01-01T01:00:00Z' },
    ];
    const stats = computeCatanGameStats(session, rolls, []);
    expect(stats.sevenCount).toBe(2);
  });

  it('isSmallSample true when fewer than 30 rolls', () => {
    const session = makeSession([makePlayer('p1')]);
    const rolls = Array.from({ length: 15 }, (_, i) => makeRoll((i % 11) + 2, 'p1', i + 1));
    const stats = computeCatanGameStats(session, rolls, []);
    expect(stats.isSmallSample).toBe(true);
  });

  it('hasExposureData false when no exposure events', () => {
    const session = makeSession([makePlayer('p1')]);
    const stats = computeCatanGameStats(session, [], []);
    expect(stats.hasExposureData).toBe(false);
    expect(stats.findings).toBeNull();
  });

  it('hasExposureData true when exposure events present', () => {
    const session = makeSession([makePlayer('p1')]);
    const exposure = [makeExposure('p1', [6], 'loc1')];
    const stats = computeCatanGameStats(session, [], exposure);
    expect(stats.hasExposureData).toBe(true);
  });

  it('playerStats has one entry per player', () => {
    const session = makeSession([makePlayer('p1'), makePlayer('p2')]);
    const stats = computeCatanGameStats(session, [], []);
    expect(stats.playerStats).toHaveLength(2);
  });

  it('sevenExpected ≈ 6/36 × totalRolls (rounded)', () => {
    const session = makeSession([makePlayer('p1')]);
    const rolls = Array.from({ length: 36 }, (_, i) => makeRoll((i % 11) + 2, 'p1', i + 1));
    const stats = computeCatanGameStats(session, rolls, []);
    expect(stats.sevenExpected).toBe(6); // round(6/36 × 36)
  });
});
