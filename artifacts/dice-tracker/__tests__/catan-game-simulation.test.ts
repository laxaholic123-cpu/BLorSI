/**
 * Catan game-simulation tests.
 *
 * Simulates complete Settlement Mode games at the pure service layer —
 * no UI, no AsyncStorage, no React Native — to catch integration bugs that
 * unit tests of individual functions cannot reach.
 *
 * Uses deterministic, pre-seeded roll sequences throughout to avoid flakiness.
 *
 * Scenarios
 * ---------
 * 1. 4-player full game (60 rolls) — end-to-end stats are non-zero and correct
 * 2. Robber hex derivation — only players with exposure on the hex are blocked
 * 3. Robber on un-settled hex — no block events created
 * 4. Building mid-game — settlement at turn 10, city at turn 20
 * 5. Robber + city interplay — city upgrade during an active block
 * 6. Solo 1-player game (40 rolls) — verdict runs without error
 * 7. Placement strength matches expected probability sum
 */

import {
  CATAN_PROBS,
  computeCatanGameStats,
  computePlayerProductionStats,
  getBuildingStatesAtTurn,
  getActiveRobberBlockedNumbers,
} from '../services/catanStats';
import type {
  CatanPlayerExposureEvent,
  GameSession,
  Player,
  RollEvent,
} from '../types/models';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let seq = 0;
beforeEach(() => { seq = 0; });

const makePlayer = (id: string, name = `Player ${id}`): Player => ({
  id,
  displayName: name,
  color: '#4A90E2',
  seatNumber: 1,
  createdAt: '2024-01-01T00:00:00Z',
});

const makeSession = (
  players: Player[],
  overrides: Partial<GameSession> = {},
): GameSession => ({
  id: 'gsim',
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
    recordIndividualDice: false,
    trackWinner: false,
    trackPlacements: false,
    catanRobberTracking: true,
    catanResourceTracking: false,
  },
  schemaVersion: 1,
  ...overrides,
});

const makeRoll = (
  value: number,
  playerId: string,
  turnNumber: number,
): RollEvent => ({
  id: `r${++seq}`,
  sessionId: 'gsim',
  playerId,
  value,
  turnNumber,
  sequenceNumber: seq,
  timestamp: '2024-01-01T00:00:00Z',
  source: 'touchscreen',
});

/** Default eventType is 'initialSettlement' — mirrors the real exposure setup screens. */
const makeExposure = (
  playerId: string,
  affectedNumbers: number[],
  locationId: string,
  opts: Partial<CatanPlayerExposureEvent> = {},
): CatanPlayerExposureEvent => ({
  id: `e${++seq}`,
  sessionId: 'gsim',
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

const makeRobberBlock = (
  playerId: string,
  affectedNumbers: number[],
  blockId: string,
  turnNumber: number,
  ended = false,
): CatanPlayerExposureEvent => ({
  id: `e${++seq}`,
  sessionId: 'gsim',
  playerId,
  eventType: ended ? 'robberBlockEnded' : 'robberBlockStarted',
  turnNumber,
  timestamp: '2024-01-01T00:00:00Z',
  affectedNumbers,
  hexIdentifiers: [blockId],
  productionWeight: 0,
  robberBlocked: !ended,
});

/**
 * Build round-robin rolls for N players across the given value sequence.
 * Player index = i % players.length; turnNumber = floor(i / players.length) + 1.
 */
function makeRoundRobinRolls(
  players: Player[],
  rollValues: number[],
): RollEvent[] {
  const rolls: RollEvent[] = [];
  for (let i = 0; i < rollValues.length; i++) {
    const playerIdx = i % players.length;
    const turnNumber = Math.floor(i / players.length) + 1;
    rolls.push({
      id: `r${++seq}`,
      sessionId: 'gsim',
      playerId: players[playerIdx]!.id,
      value: rollValues[i]!,
      turnNumber,
      sequenceNumber: seq,
      timestamp: '2024-01-01T00:00:00Z',
      source: 'touchscreen',
    });
  }
  return rolls;
}

/**
 * Simulate the robber hex-derivation logic from active-catan.tsx.
 *
 * Creates a robberBlockStarted event for every player who has an
 * initialSettlement, settlementBuilt, or cityUpgrade on the selected hex.
 *
 * NOTE: The initial check in active-catan.tsx omitted 'initialSettlement',
 * which meant the robber never blocked players whose settlements were recorded
 * during the exposure setup phase. The fix (also applied to the screen) adds
 * 'initialSettlement' to the check.
 */
function deriveRobberBlocks(
  hexNumber: number,
  exposureEvents: CatanPlayerExposureEvent[],
  sessionId: string,
  turnNumber: number,
): CatanPlayerExposureEvent[] {
  const affectedPlayerIds = new Set<string>();
  for (const event of exposureEvents) {
    if (
      (event.eventType === 'initialSettlement' ||
        event.eventType === 'settlementBuilt' ||
        event.eventType === 'cityUpgrade') &&
      event.affectedNumbers.includes(hexNumber)
    ) {
      affectedPlayerIds.add(event.playerId);
    }
  }
  return [...affectedPlayerIds].map((playerId, i) => ({
    id: `rb${++seq}`,
    sessionId,
    playerId,
    eventType: 'robberBlockStarted' as const,
    turnNumber,
    timestamp: '2024-01-01T00:00:00Z',
    affectedNumbers: [hexNumber],
    hexIdentifiers: [`rblock_derived_${i}`],
    productionWeight: 0,
    robberBlocked: true,
  }));
}

// ─── Scenario 1: 4-player full game ───────────────────────────────────────────
//
// 60 rolls, 4 players, each with two 2-number settlements.
// Roll values cycle through all 10 Catan numbers — each number appears 6 times.
// Every player has at least 4 unique hex numbers, so all players produce > 0.
// Expected production per player ≈ 24 (6 rolls × 4 hex numbers × weight 1).

describe('Scenario 1 — 4-player full game (60 rolls)', () => {
  const p1 = makePlayer('p1', 'Alice');
  const p2 = makePlayer('p2', 'Bob');
  const p3 = makePlayer('p3', 'Carol');
  const p4 = makePlayer('p4', 'Dan');
  const players = [p1, p2, p3, p4];

  // Deterministic: cycle [2,3,4,5,6,8,9,10,11,12] × 6
  const CATAN_NUMBERS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
  const rollValues: number[] = Array.from({ length: 60 }, (_, i) => CATAN_NUMBERS[i % 10]!);

  let exposureEvents: CatanPlayerExposureEvent[];
  let rolls: RollEvent[];
  let session: GameSession;

  beforeEach(() => {
    seq = 0;
    // Each player: two settlements on distinct Catan numbers
    exposureEvents = [
      makeExposure('p1', [5, 9], 'loc_1a'),
      makeExposure('p1', [6, 10], 'loc_1b'),
      makeExposure('p2', [4, 8], 'loc_2a'),
      makeExposure('p2', [3, 11], 'loc_2b'),
      makeExposure('p3', [6, 8], 'loc_3a'),
      makeExposure('p3', [9, 10], 'loc_3b'),
      makeExposure('p4', [5, 8], 'loc_4a'),
      makeExposure('p4', [4, 6], 'loc_4b'),
    ];
    rolls = makeRoundRobinRolls(players, rollValues);
    session = makeSession(players);
  });

  it('computeCatanGameStats returns 60 rolls and 4 player stats', () => {
    const stats = computeCatanGameStats(session, rolls, exposureEvents);
    expect(stats.totalRolls).toBe(60);
    expect(stats.playerStats).toHaveLength(4);
  });

  it('all 4 players have positive actual production', () => {
    const stats = computeCatanGameStats(session, rolls, exposureEvents);
    for (const ps of stats.playerStats) {
      expect(ps.totalActualProduction).toBeGreaterThan(0);
    }
  });

  it('all 4 players have positive placement strength', () => {
    const stats = computeCatanGameStats(session, rolls, exposureEvents);
    for (const ps of stats.playerStats) {
      expect(ps.placementStrength).toBeGreaterThan(0);
    }
  });

  it('each player produced exactly 24 (6 rolls × 4 numbers × weight 1)', () => {
    // Each of the 10 Catan numbers appears exactly 6 times.
    // p1: hex numbers {5,9,6,10} → 4 × 6 = 24
    // p2: hex numbers {4,8,3,11} → 4 × 6 = 24
    // p3: hex numbers {6,8,9,10} → 4 × 6 = 24
    // p4: hex numbers {5,8,4,6}  → 4 × 6 = 24
    const stats = computeCatanGameStats(session, rolls, exposureEvents);
    for (const ps of stats.playerStats) {
      expect(ps.totalActualProduction).toBe(24);
    }
  });

  it('total expected production is greater than zero for all players', () => {
    const stats = computeCatanGameStats(session, rolls, exposureEvents);
    for (const ps of stats.playerStats) {
      expect(ps.totalExpectedProduction).toBeGreaterThan(0);
    }
  });

  it('hasExposureData is true and findings is not null', () => {
    const stats = computeCatanGameStats(session, rolls, exposureEvents);
    expect(stats.hasExposureData).toBe(true);
    expect(stats.findings).not.toBeNull();
  });

  it('findings.headline is a non-empty string', () => {
    const stats = computeCatanGameStats(session, rolls, exposureEvents);
    expect(typeof stats.findings?.headline).toBe('string');
    expect(stats.findings!.headline.length).toBeGreaterThan(0);
  });

  it('isSmallSample is false for 60 rolls', () => {
    const stats = computeCatanGameStats(session, rolls, exposureEvents);
    expect(stats.isSmallSample).toBe(false);
  });

  it('robberLostProduction is 0 when no robber blocks were recorded', () => {
    const stats = computeCatanGameStats(session, rolls, exposureEvents);
    for (const ps of stats.playerStats) {
      expect(ps.robberLostProduction).toBe(0);
    }
  });
});

// ─── Scenario 2: Robber hex derivation ────────────────────────────────────────
//
// p1 and p2 have settlements on hex 6 (via initialSettlement — the real app flow).
// p3 has no exposure on hex 6.
// After robber placed on hex 6, only p1 and p2 are blocked; p3 is unaffected.
// Rolls of 6 before the block count as production; after the block they become lost.

describe('Scenario 2 — Robber hex derivation', () => {
  const p1 = makePlayer('p1');
  const p2 = makePlayer('p2');
  const p3 = makePlayer('p3');

  let baseExposure: CatanPlayerExposureEvent[];

  beforeEach(() => {
    seq = 0;
    // initialSettlement — the event type created by both exposure setup screens
    baseExposure = [
      makeExposure('p1', [5, 6], 'loc_a'),   // p1 on hex 6
      makeExposure('p2', [6, 8], 'loc_b'),   // p2 on hex 6
      makeExposure('p3', [9, 10], 'loc_c'),  // p3 NOT on hex 6
    ];
  });

  it('deriveRobberBlocks finds p1 and p2 but not p3 when robber placed on hex 6', () => {
    const blockEvents = deriveRobberBlocks(6, baseExposure, 'gsim', 11);
    const blockedPlayerIds = blockEvents.map(e => e.playerId).sort();
    expect(blockEvents).toHaveLength(2);
    expect(blockedPlayerIds).toEqual(['p1', 'p2']);
  });

  it('derived block events carry affectedNumbers: [6]', () => {
    const blockEvents = deriveRobberBlocks(6, baseExposure, 'gsim', 11);
    for (const e of blockEvents) {
      expect(e.affectedNumbers).toEqual([6]);
      expect(e.eventType).toBe('robberBlockStarted');
    }
  });

  it('p1 and p2 show robberLostProduction > 0 after block; p3 is unaffected', () => {
    // 10 rolls of 6 before block (turns 1–10), block at turn 11, 9 rolls of 6 after (turns 12–20)
    const preBlockRolls = Array.from({ length: 10 }, (_, i) =>
      makeRoll(6, 'p1', i + 1),
    );
    const blockEvents = deriveRobberBlocks(6, baseExposure, 'gsim', 11);
    const allExposure = [...baseExposure, ...blockEvents];
    const postBlockRolls = Array.from({ length: 9 }, (_, i) =>
      makeRoll(6, 'p1', i + 12),
    );
    const allRolls = [...preBlockRolls, ...postBlockRolls];

    const s1 = computePlayerProductionStats(p1, allRolls, allExposure);
    const s2 = computePlayerProductionStats(p2, allRolls, allExposure);
    const s3 = computePlayerProductionStats(p3, allRolls, allExposure);

    // p1: produces 1 per roll of 6 while unblocked (10 pre-block); loses 9 post-block
    expect(s1.totalActualProduction).toBe(10);
    expect(s1.robberLostProduction).toBe(9);

    // p2: same — has hex 6 in {6,8}
    expect(s2.totalActualProduction).toBe(10);
    expect(s2.robberLostProduction).toBe(9);

    // p3: no exposure on 6 — completely unaffected
    expect(s3.totalActualProduction).toBe(0);
    expect(s3.robberLostProduction).toBe(0);
  });

  it('getActiveRobberBlockedNumbers returns 6 for p1 and p2 but not p3 after block', () => {
    const blockEvents = deriveRobberBlocks(6, baseExposure, 'gsim', 11);
    const allExposure = [...baseExposure, ...blockEvents];

    expect(getActiveRobberBlockedNumbers('p1', 12, allExposure)).toContain(6);
    expect(getActiveRobberBlockedNumbers('p2', 12, allExposure)).toContain(6);
    expect(getActiveRobberBlockedNumbers('p3', 12, allExposure)).not.toContain(6);
  });

  it('p1 is NOT blocked before the robber was placed (turn < 11)', () => {
    const blockEvents = deriveRobberBlocks(6, baseExposure, 'gsim', 11);
    const allExposure = [...baseExposure, ...blockEvents];

    expect(getActiveRobberBlockedNumbers('p1', 10, allExposure)).not.toContain(6);
  });
});

// ─── Scenario 3: Robber on un-settled hex ─────────────────────────────────────
//
// No player has any documented exposure on hex 11.
// Robber placed on 11 → deriveRobberBlocks creates zero block events.

describe('Scenario 3 — Robber on hex with no documented settlements', () => {
  beforeEach(() => { seq = 0; });

  it('creates no block events when no player has exposure on the targeted hex', () => {
    const exposure = [
      makeExposure('p1', [5, 9], 'loc_a'),
      makeExposure('p2', [6, 8], 'loc_b'),
      // Nobody on hex 11
    ];
    const blockEvents = deriveRobberBlocks(11, exposure, 'gsim', 5);
    expect(blockEvents).toHaveLength(0);
  });

  it('creates no block events when exposure array is empty', () => {
    const blockEvents = deriveRobberBlocks(8, [], 'gsim', 3);
    expect(blockEvents).toHaveLength(0);
  });
});

// ─── Scenario 4: Building mid-game ────────────────────────────────────────────
//
// p1 starts with one settlement on {5,9}.
// Adds a second settlement on {6,8} at turn 10.
// Upgrades the first settlement to a city (weight 2) at turn 20.
//
// Assertions on getBuildingStatesAtTurn:
//   turn 5  → 1 building: {5,9} weight 1
//   turn 15 → 2 buildings: {5,9} weight 1, {6,8} weight 1
//   turn 25 → 2 buildings: {5,9} weight 2, {6,8} weight 1
//
// Assertions on cumulative production:
//   Roll 5 at turns 5, 15, 25 → production = 1 + 1 + 2 = 4
//   Roll 8 at turns 5, 15, 25 → production = 0 + 1 + 1 = 2

describe('Scenario 4 — Building mid-game (settlement + city upgrade)', () => {
  const p1 = makePlayer('p1');

  let allExposure: CatanPlayerExposureEvent[];

  beforeEach(() => {
    seq = 0;
    allExposure = [
      // Initial setup
      makeExposure('p1', [5, 9], 'loc_a', { turnNumber: 0 }),
      // New settlement built at turn 10
      makeExposure('p1', [6, 8], 'loc_b', { eventType: 'settlementBuilt', turnNumber: 10 }),
      // City upgrade on the initial settlement at turn 20
      makeExposure('p1', [5, 9], 'loc_a', { eventType: 'cityUpgrade', turnNumber: 20, productionWeight: 2 }),
    ];
  });

  describe('getBuildingStatesAtTurn', () => {
    it('turn 5: only the initial settlement exists, weight 1', () => {
      const buildings = getBuildingStatesAtTurn('p1', 5, allExposure);
      expect(buildings).toHaveLength(1);
      expect(buildings[0]!.affectedNumbers).toEqual([5, 9]);
      expect(buildings[0]!.productionWeight).toBe(1);
    });

    it('turn 15: two settlements both weight 1', () => {
      const buildings = getBuildingStatesAtTurn('p1', 15, allExposure);
      expect(buildings).toHaveLength(2);
      const weights = buildings.map(b => b.productionWeight);
      expect(weights).toEqual([1, 1]);
    });

    it('turn 25: initial settlement upgraded to city (weight 2), second still weight 1', () => {
      const buildings = getBuildingStatesAtTurn('p1', 25, allExposure);
      expect(buildings).toHaveLength(2);
      const byLocation = new Map(buildings.map(b => [b.locationId, b]));
      expect(byLocation.get('loc_a')!.productionWeight).toBe(2);
      expect(byLocation.get('loc_b')!.productionWeight).toBe(1);
    });
  });

  describe('cumulative production', () => {
    it('roll of 5 at turns 5, 15, 25 gives production 1+1+2 = 4', () => {
      const rolls = [
        makeRoll(5, 'p1', 5),
        makeRoll(5, 'p1', 15),
        makeRoll(5, 'p1', 25),
      ];
      const stats = computePlayerProductionStats(p1, rolls, allExposure);
      // Turn 5:  weight 1 on {5,9}, no {6,8} yet → 1
      // Turn 15: weight 1 on {5,9}, weight 1 on {6,8} → roll 5 → 1 (from loc_a)
      // Turn 25: weight 2 on {5,9} (city), weight 1 on {6,8} → roll 5 → 2 (from loc_a)
      expect(stats.totalActualProduction).toBe(4);
    });

    it('roll of 8 at turns 5, 15, 25 gives production 0+1+1 = 2', () => {
      const rolls = [
        makeRoll(8, 'p1', 5),
        makeRoll(8, 'p1', 15),
        makeRoll(8, 'p1', 25),
      ];
      const stats = computePlayerProductionStats(p1, rolls, allExposure);
      // Turn 5:  {6,8} not yet built → 0
      // Turn 15: {6,8} weight 1 → 1
      // Turn 25: {6,8} weight 1 (only loc_a was upgraded) → 1
      expect(stats.totalActualProduction).toBe(2);
    });

    it('roll of 6 at turn 5 produces 0 (hex 6 not yet settled)', () => {
      const rolls = [makeRoll(6, 'p1', 5)];
      const stats = computePlayerProductionStats(p1, rolls, allExposure);
      expect(stats.totalActualProduction).toBe(0);
    });

    it('finalCityCount is 1 after the upgrade', () => {
      const rolls = [makeRoll(5, 'p1', 25)]; // at least one roll so final turn is set
      const stats = computePlayerProductionStats(p1, rolls, allExposure);
      expect(stats.finalCityCount).toBe(1);
    });
  });
});

// ─── Scenario 5: Robber + city interplay ──────────────────────────────────────
//
// p1 has a settlement on hex 8 (weight 1 initially).
// Robber block starts at turn 5 on hex 8.
// City upgrade on hex 8 at turn 8 (while block is still active).
// Robber block ends at turn 12.
//
// Rolls of 8 at specific turns:
//   turn 6  → blocked (settlement weight 1)  → actual 0, lost 1
//   turn 9  → blocked (city weight 2)        → actual 0, lost 2
//   turn 14 → unblocked (city weight 2)      → actual 2, lost 0
//
// Total: actualProduction = 2, robberLostProduction = 3

describe('Scenario 5 — Robber + city interplay', () => {
  const p1 = makePlayer('p1');
  const BLOCK_ID = 'rblock_s5';
  const LOC_A = 'loc_s5_a';

  let allExposure: CatanPlayerExposureEvent[];
  let rolls: RollEvent[];

  beforeEach(() => {
    seq = 0;
    allExposure = [
      makeExposure('p1', [8], LOC_A, { turnNumber: 0, productionWeight: 1 }),
      makeRobberBlock('p1', [8], BLOCK_ID, 5),           // block starts turn 5
      makeExposure('p1', [8], LOC_A, {                   // city upgrade at turn 8
        eventType: 'cityUpgrade',
        turnNumber: 8,
        productionWeight: 2,
      }),
      makeRobberBlock('p1', [8], BLOCK_ID, 12, true),    // block ends turn 12
    ];
    rolls = [
      makeRoll(8, 'p1', 6),   // blocked + settlement weight → actual 0, lost 1
      makeRoll(8, 'p1', 9),   // blocked + city weight      → actual 0, lost 2
      makeRoll(8, 'p1', 14),  // unblocked + city weight    → actual 2, lost 0
    ];
  });

  it('building weight at turn 6 is 1 (city upgrade not yet active)', () => {
    const buildings = getBuildingStatesAtTurn('p1', 6, allExposure);
    expect(buildings[0]!.productionWeight).toBe(1);
  });

  it('building weight at turn 9 is 2 (city upgrade active)', () => {
    const buildings = getBuildingStatesAtTurn('p1', 9, allExposure);
    expect(buildings[0]!.productionWeight).toBe(2);
  });

  it('hex 8 is blocked at turns 6 and 9 but not at turn 14', () => {
    expect(getActiveRobberBlockedNumbers('p1', 6, allExposure)).toContain(8);
    expect(getActiveRobberBlockedNumbers('p1', 9, allExposure)).toContain(8);
    expect(getActiveRobberBlockedNumbers('p1', 14, allExposure)).not.toContain(8);
  });

  it('totalActualProduction = 2 (only the unblocked city roll at turn 14)', () => {
    const stats = computePlayerProductionStats(p1, rolls, allExposure);
    expect(stats.totalActualProduction).toBe(2);
  });

  it('robberLostProduction = 3 (lost 1 at turn 6 + lost 2 at turn 9)', () => {
    const stats = computePlayerProductionStats(p1, rolls, allExposure);
    expect(stats.robberLostProduction).toBe(3);
  });
});

// ─── Scenario 6: Solo 1-player game ───────────────────────────────────────────
//
// One player, 40 deterministic rolls (≥ 30 threshold → isSmallSample false).
// Verifies computeCatanGameStats completes without error and verdicts are sound.

describe('Scenario 6 — Solo 1-player game (40 rolls)', () => {
  const p1 = makePlayer('p1', 'Solo');

  beforeEach(() => { seq = 0; });

  it('returns playerStats length 1 and a non-null findings object', () => {
    // Deterministic 40-roll sequence: two full cycles of Catan numbers + extras
    const CATAN_NUMBERS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
    const rollValues: number[] = [
      ...CATAN_NUMBERS, ...CATAN_NUMBERS, ...CATAN_NUMBERS,
      6, 6, 6, 6, 8, 8, 5, 5, 9, 9,
    ]; // 30 + 10 = 40
    const session = makeSession([p1], { autoAdvancePlayer: false });
    const exposure = [
      makeExposure('p1', [5, 9], 'loc_a'),
      makeExposure('p1', [6, 8], 'loc_b'),
    ];
    const rolls = rollValues.map((v, i) => makeRoll(v, 'p1', i + 1));

    const stats = computeCatanGameStats(session, rolls, exposure);

    expect(stats.totalRolls).toBe(40);
    expect(stats.isSmallSample).toBe(false);
    expect(stats.playerStats).toHaveLength(1);
    expect(stats.hasExposureData).toBe(true);
    expect(stats.findings).not.toBeNull();
    expect(stats.findings!.finalOutcome).not.toBe(undefined);
  });

  it('isSmallSample is true for 15 rolls', () => {
    const session = makeSession([p1]);
    const exposure = [makeExposure('p1', [6, 8], 'loc_a')];
    const rolls = Array.from({ length: 15 }, (_, i) => makeRoll(6, 'p1', i + 1));

    const stats = computeCatanGameStats(session, rolls, exposure);
    expect(stats.isSmallSample).toBe(true);
    expect(stats.findings!.finalOutcome).toBe('too_early');
  });
});

// ─── Scenario 7: Placement strength ───────────────────────────────────────────
//
// Placement strength = Σ P(n) × weight for all numbers in the initial settlement.
// Verified analytically so we catch any future accidental changes to the formula.

describe('Scenario 7 — Placement strength matches probability sum', () => {
  const p1 = makePlayer('p1');

  beforeEach(() => { seq = 0; });

  it('two settlements on {5,9} and {6,8} → strength = P(5)+P(9)+P(6)+P(8)', () => {
    const exposure = [
      makeExposure('p1', [5, 9], 'loc_a'),
      makeExposure('p1', [6, 8], 'loc_b'),
    ];
    const expected =
      (CATAN_PROBS[5] ?? 0) +
      (CATAN_PROBS[9] ?? 0) +
      (CATAN_PROBS[6] ?? 0) +
      (CATAN_PROBS[8] ?? 0);
    // = 4/36 + 4/36 + 5/36 + 5/36 = 18/36 = 0.5
    const stats = computePlayerProductionStats(p1, [], exposure);
    expect(stats.placementStrength).toBeCloseTo(expected, 10);
    expect(stats.placementStrength).toBeCloseTo(0.5, 10);
  });

  it('city on {6} at setup (weight 2) → strength = 2 × P(6)', () => {
    const exposure = [makeExposure('p1', [6], 'loc_a', { productionWeight: 2 })];
    const expected = 2 * (CATAN_PROBS[6] ?? 0); // = 10/36 ≈ 0.2778
    const stats = computePlayerProductionStats(p1, [], exposure);
    expect(stats.placementStrength).toBeCloseTo(expected, 10);
  });

  it('overlapping hex numbers across settlements are counted once each', () => {
    // Two settlements both on hex 9 — numberDiversity should be 1
    // but placementStrength adds both weights (both contribute separately)
    const exposure = [
      makeExposure('p1', [9], 'loc_a'),
      makeExposure('p1', [9], 'loc_b'),
    ];
    const stats = computePlayerProductionStats(p1, [], exposure);
    // placementStrength: 2 × P(9) = 2 × 4/36 (both buildings contribute)
    expect(stats.placementStrength).toBeCloseTo(2 * (CATAN_PROBS[9] ?? 0), 10);
    // numberDiversity: unique numbers across initial buildings = 1
    expect(stats.numberDiversity).toBe(1);
  });
});
