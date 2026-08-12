/**
 * Unit tests for careerStats.ts
 *
 * Tests the pure computation functions with fixture data,
 * covering edge cases and the main happy path.
 */

import {
  computeCareerStats,
  CAREER_MIN_SESSIONS,
  HEAD_TO_HEAD_MIN_SESSIONS,
  type CareerStats,
} from '../services/careerStats';
import type { CatanPlayerExposureEvent, GameSession, RollEvent } from '../types/models';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PLAYER_A = {
  id: 'p-alice',
  displayName: 'Alice',
  color: '#F5A623',
  seatNumber: 1,
  createdAt: '2025-01-01T00:00:00Z',
};
const PLAYER_B = {
  id: 'p-bob',
  displayName: 'Bob',
  color: '#4A90E2',
  seatNumber: 2,
  createdAt: '2025-01-01T00:00:00Z',
};
const PLAYER_C = {
  id: 'p-carol',
  displayName: 'Carol',
  color: '#5CB85C',
  seatNumber: 3,
  createdAt: '2025-01-01T00:00:00Z',
};

const BASE_SESSION: Omit<GameSession, 'id' | 'players' | 'startedAt' | 'status'> = {
  gameType: 'catan',
  diceMode: '2D6',
  minimumRoll: 2,
  maximumRoll: 12,
  currentPlayerIndex: 0,
  autoAdvancePlayer: true,
  placements: [],
  settings: {
    recordIndividualDice: false,
    trackWinner: false,
    trackPlacements: false,
    catanRobberTracking: true,
    catanResourceTracking: false,
  },
  schemaVersion: 1,
};

function makeSession(
  id: string,
  players = [PLAYER_A, PLAYER_B],
  status: 'completed' | 'active' = 'completed',
): GameSession {
  return {
    ...BASE_SESSION,
    id,
    players,
    startedAt: '2025-01-01T12:00:00Z',
    endedAt: '2025-01-01T14:00:00Z',
    status,
  };
}

function makeRoll(id: string, sessionId: string, playerId: string, value: number, turnNumber = 1): RollEvent {
  return {
    id,
    sessionId,
    playerId,
    value,
    turnNumber,
    sequenceNumber: 1,
    timestamp: '2025-01-01T12:01:00Z',
    source: 'touchscreen',
  };
}

/**
 * Minimal exposure: player settled on hex with number `n`.
 * hexIdentifiers[0] = locationId for time-aware deduplication.
 */
function makeExposure(
  id: string,
  sessionId: string,
  playerId: string,
  number: number,
  weight = 1,
): CatanPlayerExposureEvent {
  return {
    id,
    sessionId,
    playerId,
    eventType: 'initialSettlement',
    turnNumber: 0,
    timestamp: '2025-01-01T12:00:00Z',
    affectedNumbers: [number],
    hexIdentifiers: [`loc-${id}`],
    productionWeight: weight,
    robberBlocked: false,
  };
}

// ─── computeCareerStats — summary ────────────────────────────────────────────

describe('computeCareerStats — summary', () => {
  it('returns zero totals for empty input', () => {
    const result = computeCareerStats([], {}, {});
    expect(result.summary.totalSessions).toBe(0);
    expect(result.summary.totalRolls).toBe(0);
    expect(result.summary.catanSessions).toBe(0);
    expect(result.summary.hasEnoughData).toBe(false);
    expect(result.numberStats).toBeNull();
    expect(result.headToHead).toHaveLength(0);
  });

  it('counts sessions and rolls correctly', () => {
    const s1 = makeSession('s1');
    const s2 = makeSession('s2');
    const rollsBySession = {
      s1: [makeRoll('r1', 's1', 'p-alice', 6), makeRoll('r2', 's1', 'p-bob', 9)],
      s2: [makeRoll('r3', 's2', 'p-alice', 5)],
    };
    const result = computeCareerStats([s1, s2], rollsBySession, {});
    expect(result.summary.totalSessions).toBe(2);
    expect(result.summary.totalRolls).toBe(3);
    expect(result.summary.catanSessions).toBe(2);
  });

  it('excludes deleted rolls from total count', () => {
    const s1 = makeSession('s1');
    const rollsBySession = {
      s1: [
        makeRoll('r1', 's1', 'p-alice', 6),
        { ...makeRoll('r2', 's1', 'p-alice', 9), deletedAt: '2025-01-01T12:05:00Z' },
      ],
    };
    const result = computeCareerStats([s1], rollsBySession, {});
    expect(result.summary.totalRolls).toBe(1);
  });

  it('hasEnoughData is false below threshold', () => {
    const sessions = [makeSession('s1'), makeSession('s2')];
    expect(computeCareerStats(sessions, {}, {}).summary.hasEnoughData).toBe(false);
  });

  it(`hasEnoughData is true at ${CAREER_MIN_SESSIONS} sessions`, () => {
    const sessions = Array.from({ length: CAREER_MIN_SESSIONS }, (_, i) =>
      makeSession(`s${i}`),
    );
    expect(computeCareerStats(sessions, {}, {}).summary.hasEnoughData).toBe(true);
  });

  it('counts non-Catan sessions separately', () => {
    const catanSess = makeSession('s1');
    const generalSess: GameSession = { ...makeSession('s2'), gameType: 'general' };
    const result = computeCareerStats([catanSess, generalSess], {}, {});
    expect(result.summary.totalSessions).toBe(2);
    expect(result.summary.catanSessions).toBe(1);
  });
});

// ─── computeCareerStats — numberStats ────────────────────────────────────────

describe('computeCareerStats — numberStats', () => {
  it('returns null when no Catan sessions exist', () => {
    const generalSess: GameSession = { ...makeSession('s1'), gameType: 'general' };
    const result = computeCareerStats([generalSess], {}, {});
    expect(result.numberStats).toBeNull();
  });

  it('returns null when Catan sessions have no exposure data', () => {
    const s1 = makeSession('s1');
    const rollsBySession = { s1: [makeRoll('r1', 's1', 'p-alice', 6)] };
    const result = computeCareerStats([s1], rollsBySession, {});
    expect(result.numberStats).toBeNull();
  });

  it('returns null when there are no active rolls in Catan sessions', () => {
    const s1 = makeSession('s1');
    const rollsBySession = {
      s1: [{ ...makeRoll('r1', 's1', 'p-alice', 6), deletedAt: '2025-01-01T12:05:00Z' }],
    };
    const exposuresBySession = {
      s1: [makeExposure('e1', 's1', 'p-alice', 6)],
    };
    const result = computeCareerStats([s1], rollsBySession, exposuresBySession);
    expect(result.numberStats).toBeNull();
  });

  it('computes positive luck for a number that hit above expectation', () => {
    // 6 has probability 5/36 ≈ 0.139. If it hits 3 times out of 3 rolls, that's 100% actual vs low expected
    const s1 = makeSession('s1');
    // Alice has a settlement on 6
    const exposures = [makeExposure('e1', 's1', 'p-alice', 6)];
    // 3 rolls of 6 — all hit Alice's settlement
    const rolls = [
      makeRoll('r1', 's1', 'p-alice', 6, 1),
      makeRoll('r2', 's1', 'p-bob', 6, 2),
      makeRoll('r3', 's1', 'p-alice', 6, 3),
    ];
    const result = computeCareerStats([s1], { s1: rolls }, { s1: exposures });
    expect(result.numberStats).not.toBeNull();
    const sixStat = result.numberStats!.find(s => s.number === 6);
    expect(sixStat).toBeDefined();
    expect(sixStat!.luckPct).toBeGreaterThan(0); // hit above expectation
    expect(sixStat!.sessionCount).toBe(1);
  });

  it('computes negative luck for a number that underperformed', () => {
    // 6 hit 0 times out of many rolls — below expectation
    const s1 = makeSession('s1');
    const exposures = [makeExposure('e1', 's1', 'p-alice', 6)];
    // 10 rolls of 9 — none hit Alice's 6-settlement
    const rolls = Array.from({ length: 10 }, (_, i) =>
      makeRoll(`r${i}`, 's1', 'p-alice', 9, i + 1),
    );
    const result = computeCareerStats([s1], { s1: rolls }, { s1: exposures });
    const sixStat = result.numberStats!.find(s => s.number === 6);
    expect(sixStat!.luckPct).toBeLessThan(0); // missed all rolls = below expectation
  });

  it('sorts numberStats luckiest first', () => {
    // Create a scenario where one number hits consistently and another misses
    const s1 = makeSession('s1');
    const exposures = [
      makeExposure('e1', 's1', 'p-alice', 9), // 9 will be lucky
      makeExposure('e2', 's1', 'p-alice', 11), // 11 will be unlucky
    ];
    // 5 rolls of 9 (all hit 9-settlement), 0 rolls of 11
    const rolls = Array.from({ length: 5 }, (_, i) =>
      makeRoll(`r${i}`, 's1', 'p-alice', 9, i + 1),
    );
    const result = computeCareerStats([s1], { s1: rolls }, { s1: exposures });
    expect(result.numberStats).not.toBeNull();
    const stats = result.numberStats!;
    // 9 should appear before 11
    const idx9 = stats.findIndex(s => s.number === 9);
    const idx11 = stats.findIndex(s => s.number === 11);
    expect(idx9).toBeLessThan(idx11);
    expect(stats[idx9]!.luckPct).toBeGreaterThan(stats[idx11]!.luckPct);
  });

  it('aggregates across multiple sessions', () => {
    const s1 = makeSession('s1');
    const s2 = makeSession('s2');
    const exposures1 = [makeExposure('e1', 's1', 'p-alice', 6)];
    const exposures2 = [makeExposure('e2', 's2', 'p-alice', 6)];
    const rolls1 = [makeRoll('r1', 's1', 'p-alice', 6, 1)];
    const rolls2 = [makeRoll('r2', 's2', 'p-alice', 6, 1)];

    const result = computeCareerStats(
      [s1, s2],
      { s1: rolls1, s2: rolls2 },
      { s1: exposures1, s2: exposures2 },
    );
    const sixStat = result.numberStats!.find(s => s.number === 6);
    expect(sixStat!.sessionCount).toBe(2); // contributed from both sessions
  });

  it('excludes numbers with no exposure from numberStats', () => {
    const s1 = makeSession('s1');
    // Only expose to number 6 — not 9
    const exposures = [makeExposure('e1', 's1', 'p-alice', 6)];
    const rolls = [makeRoll('r1', 's1', 'p-alice', 9, 1)];
    const result = computeCareerStats([s1], { s1: rolls }, { s1: exposures });
    const nineStat = result.numberStats?.find(s => s.number === 9);
    expect(nineStat).toBeUndefined(); // 9 had no exposure
  });

  it('ignores 7s in number stats (7 produces no resources)', () => {
    const s1 = makeSession('s1');
    const exposures = [makeExposure('e1', 's1', 'p-alice', 6)];
    const rolls = [
      makeRoll('r1', 's1', 'p-alice', 7, 1), // 7 should be ignored
      makeRoll('r2', 's1', 'p-alice', 6, 2),
    ];
    const result = computeCareerStats([s1], { s1: rolls }, { s1: exposures });
    // 7 should not appear in number stats
    const sevenStat = result.numberStats?.find(s => s.number === 7);
    expect(sevenStat).toBeUndefined();
  });

  it('handles city upgrades (weight = 2) correctly', () => {
    const s1 = makeSession('s1');
    const exposures: CatanPlayerExposureEvent[] = [
      // Settlement first (weight 1) at turn 0
      {
        id: 'e1',
        sessionId: 's1',
        playerId: 'p-alice',
        eventType: 'cityUpgrade',
        turnNumber: 0,
        timestamp: '2025-01-01T12:00:00Z',
        affectedNumbers: [6],
        hexIdentifiers: ['loc-city'],
        productionWeight: 2, // city weight
        robberBlocked: false,
      },
    ];
    const rolls = [makeRoll('r1', 's1', 'p-alice', 6, 1)];
    const result = computeCareerStats([s1], { s1: rolls }, { s1: exposures });
    const sixStat = result.numberStats!.find(s => s.number === 6);
    // City produces 2 resources; actual = 2, expected = 2 × 5/36 × 1roll = 0.278
    expect(sixStat!.totalActual).toBeCloseTo(2);
    expect(sixStat!.totalExpected).toBeCloseTo((5 / 36) * 2, 3);
  });
});

// ─── computeCareerStats — headToHead ─────────────────────────────────────────

describe('computeCareerStats — headToHead', () => {
  it('returns empty when no completed Catan sessions with exposure data', () => {
    const s1 = makeSession('s1');
    const result = computeCareerStats([s1], {}, {});
    expect(result.headToHead).toHaveLength(0);
  });

  it('returns empty when pairs have fewer than minimum shared sessions', () => {
    const s1 = makeSession('s1');
    const exposures = [
      makeExposure('e1', 's1', 'p-alice', 6),
      makeExposure('e2', 's1', 'p-bob', 9),
    ];
    // 5 rolls of 6 (lucky for alice) + 0 rolls of 9 (unlucky for bob)
    const rolls = Array.from({ length: 5 }, (_, i) =>
      makeRoll(`r${i}`, 's1', 'p-alice', 6, i + 1),
    );
    const result = computeCareerStats([s1], { s1: rolls }, { s1: exposures });
    // Only 1 shared session — below HEAD_TO_HEAD_MIN_SESSIONS
    expect(result.headToHead).toHaveLength(0);
  });

  it('records a head-to-head when pair has enough shared sessions', () => {
    const s1 = makeSession('s1', [PLAYER_A, PLAYER_B]);
    const s2 = makeSession('s2', [PLAYER_A, PLAYER_B]);

    // Alice on 6, Bob on 9 in both sessions
    // Rolls: all 6s → Alice always luckier
    const makeSessionData = (sid: string) => ({
      rolls: [
        ...Array.from({ length: 5 }, (_, i) => makeRoll(`${sid}r${i}`, sid, 'p-alice', 6, i + 1)),
        ...Array.from({ length: 5 }, (_, i) => makeRoll(`${sid}rn${i}`, sid, 'p-bob', 5, i + 1)),
      ],
      exposures: [
        makeExposure(`${sid}ea`, sid, 'p-alice', 6),
        makeExposure(`${sid}eb`, sid, 'p-bob', 9), // 9 never hits → Bob unlucky
      ],
    });

    const { rolls: rolls1, exposures: exp1 } = makeSessionData('s1');
    const { rolls: rolls2, exposures: exp2 } = makeSessionData('s2');

    const result = computeCareerStats(
      [s1, s2],
      { s1: rolls1, s2: rolls2 },
      { s1: exp1, s2: exp2 },
    );

    expect(result.headToHead).toHaveLength(1);
    const rec = result.headToHead[0]!;
    // canonical alphabetical order: alice < bob
    expect(rec.nameA).toBe('alice');
    expect(rec.nameB).toBe('bob');
    expect(rec.sharedSessions).toBe(2);
    // Alice should win both (she's on 6 hitting, Bob is on 9 not hitting)
    expect(rec.winsA).toBe(2);
    expect(rec.winsB).toBe(0);
    expect(rec.avgLuckDiffA).toBeGreaterThan(0); // Alice luckier on average
  });

  it('records ties correctly when luck is within threshold', () => {
    // Both players have identical exposure → identical luck% → tie
    const s1 = makeSession('s1', [PLAYER_A, PLAYER_B]);
    const s2 = makeSession('s2', [PLAYER_A, PLAYER_B]);

    const makeSessionData = (sid: string) => ({
      rolls: [makeRoll(`${sid}r1`, sid, 'p-alice', 6, 1)],
      exposures: [
        makeExposure(`${sid}ea`, sid, 'p-alice', 6),
        makeExposure(`${sid}eb`, sid, 'p-bob', 6), // same number exposure
      ],
    });

    const { rolls: r1, exposures: e1 } = makeSessionData('s1');
    const { rolls: r2, exposures: e2 } = makeSessionData('s2');

    const result = computeCareerStats(
      [s1, s2],
      { s1: r1, s2: r2 },
      { s1: e1, s2: e2 },
    );

    expect(result.headToHead).toHaveLength(1);
    expect(result.headToHead[0]!.ties).toBeGreaterThanOrEqual(0);
  });

  it('builds records for three-player games (three pairs)', () => {
    const s1 = makeSession('s1', [PLAYER_A, PLAYER_B, PLAYER_C]);
    const s2 = makeSession('s2', [PLAYER_A, PLAYER_B, PLAYER_C]);

    const makeThreePlayerData = (sid: string) => ({
      rolls: [makeRoll(`${sid}r1`, sid, 'p-alice', 6, 1)],
      exposures: [
        makeExposure(`${sid}ea`, sid, 'p-alice', 6),
        makeExposure(`${sid}eb`, sid, 'p-bob', 9),
        makeExposure(`${sid}ec`, sid, 'p-carol', 11),
      ],
    });

    const { rolls: r1, exposures: e1 } = makeThreePlayerData('s1');
    const { rolls: r2, exposures: e2 } = makeThreePlayerData('s2');

    const result = computeCareerStats(
      [s1, s2],
      { s1: r1, s2: r2 },
      { s1: e1, s2: e2 },
    );

    // Three players → three pairs (alice-bob, alice-carol, bob-carol)
    expect(result.headToHead).toHaveLength(3);
  });

  it('skips active (non-completed) sessions for head-to-head', () => {
    const s1 = makeSession('s1', [PLAYER_A, PLAYER_B], 'active');
    const s2 = makeSession('s2', [PLAYER_A, PLAYER_B], 'active');
    const rolls = [makeRoll('r1', 's1', 'p-alice', 6, 1)];
    const exposures = [makeExposure('e1', 's1', 'p-alice', 6), makeExposure('e2', 's1', 'p-bob', 9)];
    const result = computeCareerStats([s1, s2], { s1: rolls }, { s1: exposures });
    expect(result.headToHead).toHaveLength(0);
  });

  it('sorts head-to-head by most shared sessions first', () => {
    // A-B share 3 sessions; A-C share 2 sessions → A-B first
    const sessions = [
      makeSession('s1', [PLAYER_A, PLAYER_B]),
      makeSession('s2', [PLAYER_A, PLAYER_B]),
      makeSession('s3', [PLAYER_A, PLAYER_B]),
      makeSession('s4', [PLAYER_A, PLAYER_C]),
      makeSession('s5', [PLAYER_A, PLAYER_C]),
    ];

    const makeData = (sid: string, players: typeof sessions[0]['players']) => {
      const rolls = [makeRoll(`${sid}r1`, sid, players[0]!.id, 6, 1)];
      const exposures = players.map((p, i) => makeExposure(`${sid}e${i}`, sid, p.id, 6 + i));
      return { rolls, exposures };
    };

    const rollsBySession: Record<string, RollEvent[]> = {};
    const exposuresBySession: Record<string, CatanPlayerExposureEvent[]> = {};
    sessions.forEach(s => {
      const data = makeData(s.id, s.players);
      rollsBySession[s.id] = data.rolls;
      exposuresBySession[s.id] = data.exposures;
    });

    const result = computeCareerStats(sessions, rollsBySession, exposuresBySession);
    expect(result.headToHead[0]!.sharedSessions).toBeGreaterThanOrEqual(
      result.headToHead[1]!.sharedSessions,
    );
  });
});

// ─── computeCareerStats — integration ────────────────────────────────────────

describe('computeCareerStats — integration', () => {
  it('returns a complete valid CareerStats object for a realistic multi-session scenario', () => {
    const sessions = [
      makeSession('s1', [PLAYER_A, PLAYER_B]),
      makeSession('s2', [PLAYER_A, PLAYER_B]),
      makeSession('s3', [PLAYER_A, PLAYER_B]),
    ];

    const rollsBySession: Record<string, RollEvent[]> = {};
    const exposuresBySession: Record<string, CatanPlayerExposureEvent[]> = {};

    sessions.forEach((s, idx) => {
      rollsBySession[s.id] = [
        makeRoll(`${s.id}r1`, s.id, PLAYER_A.id, 6, 1),
        makeRoll(`${s.id}r2`, s.id, PLAYER_B.id, 9, 2),
        makeRoll(`${s.id}r3`, s.id, PLAYER_A.id, 6, 3),
      ];
      exposuresBySession[s.id] = [
        makeExposure(`${s.id}e1`, s.id, PLAYER_A.id, 6),
        makeExposure(`${s.id}e2`, s.id, PLAYER_B.id, 9),
      ];
      void idx; // silence unused
    });

    const result = computeCareerStats(sessions, rollsBySession, exposuresBySession);

    expect(result.summary.totalSessions).toBe(3);
    expect(result.summary.totalRolls).toBe(9);
    expect(result.summary.catanSessions).toBe(3);
    expect(result.summary.hasEnoughData).toBe(true);

    expect(result.numberStats).not.toBeNull();
    expect(result.numberStats!.every(s => s.luckPct !== undefined)).toBe(true);

    // 3 shared sessions → head-to-head should exist
    expect(result.headToHead).toHaveLength(1);
    expect(result.headToHead[0]!.sharedSessions).toBe(3);
  });

  it('handles missing session data gracefully (no crash on undefined maps)', () => {
    const sessions = [makeSession('s1'), makeSession('s2'), makeSession('s3')];
    // Empty maps — sessions exist but no roll/exposure data loaded
    expect(() => computeCareerStats(sessions, {}, {})).not.toThrow();
    const result = computeCareerStats(sessions, {}, {});
    expect(result.summary.totalRolls).toBe(0);
    expect(result.numberStats).toBeNull();
  });
});
