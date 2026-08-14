/**
 * End-to-end checks that the simulation actually reaches the verdict.
 *
 * These guard the wiring, not the maths — the engine's own behaviour is covered
 * in luckEngine.test.ts.
 */

import { computeAllStats } from '@/services/stats';
import { classifyVerdict } from '@/services/verdict';
import { computeCatanGameStats } from '@/services/catanStats';
import type {
  CatanPlayerExposureEvent,
  GameSession,
  Player,
  RollEvent,
} from '@/types/models';
import { SCHEMA_VERSION } from '@/types/models';

const player = (id: string, seat: number): Player => ({
  id,
  displayName: id,
  color: '#F5A623',
  seatNumber: seat,
  createdAt: '2026-01-01T00:00:00Z',
});

const session = (players: Player[], overrides: Partial<GameSession> = {}): GameSession => ({
  id: 's1',
  gameType: 'general',
  diceMode: '2D6',
  minimumRoll: 2,
  maximumRoll: 12,
  players,
  currentPlayerIndex: 0,
  autoAdvancePlayer: true,
  startedAt: '2026-01-01T00:00:00Z',
  status: 'completed',
  placements: [],
  settings: {
    recordIndividualDice: false,
    trackWinner: false,
    trackPlacements: false,
    catanRobberTracking: false,
    catanResourceTracking: false,
  },
  schemaVersion: SCHEMA_VERSION,
  ...overrides,
});

const rolls = (values: number[], playerId = 'alice'): RollEvent[] =>
  values.map((value, i) => ({
    id: `r${i}`,
    sessionId: 's1',
    playerId,
    value,
    turnNumber: i + 1,
    sequenceNumber: i + 1,
    timestamp: '2026-01-01T00:00:00Z',
    source: 'touchscreen' as const,
  }));

describe('classifyVerdict — shape anomalies', () => {
  it('calls out a misshapen distribution even when the mean is perfect', () => {
    // meanZScore of 0 would otherwise return "cleared_of_wrongdoing".
    expect(classifyVerdict(180, 0, false, false, 99.9)).toBe('dice_look_rigged');
  });

  it('does not call out shape on a short session', () => {
    // Below the 60-roll floor the fit percentile is too jumpy to accuse anyone.
    expect(classifyVerdict(40, 0, false, false, 99.9)).toBe('cleared_of_wrongdoing');
  });

  it('does not call out shape on an ordinary fit', () => {
    expect(classifyVerdict(180, 0, false, false, 60)).toBe('cleared_of_wrongdoing');
  });

  it('behaves exactly as before when no fit percentile is supplied', () => {
    expect(classifyVerdict(180, 0, false, false)).toBe('cleared_of_wrongdoing');
    expect(classifyVerdict(180, -1.5, false, false)).toBe('bad_luck');
    expect(classifyVerdict(180, -2.5, false, true)).toBe('bad_luck_and_skill_issue');
  });
});

describe('computeAllStats — simulation wiring', () => {
  it('omits fitPercentile unless simulation is requested', () => {
    const s = session([player('alice', 1)]);
    const stats = computeAllStats(s, rolls(new Array(80).fill(7)));
    expect(stats.fitPercentile).toBeUndefined();
  });

  it('produces a fitPercentile when asked', () => {
    const s = session([player('alice', 1)]);
    const stats = computeAllStats(s, rolls(new Array(80).fill(7)), {
      simulate: true,
      iterations: 500,
      seed: 1,
    });
    expect(typeof stats.fitPercentile).toBe('number');
  });

  it('flags 80 consecutive sevens as rigged despite a textbook mean of 7', () => {
    const s = session([player('alice', 1)]);
    const stats = computeAllStats(s, rolls(new Array(80).fill(7)), {
      simulate: true,
      iterations: 500,
      seed: 1,
    });
    // The mean is exactly the expected mean, so the z-score sees nothing wrong.
    expect(stats.meanZScore).toBeCloseTo(0);
    expect(stats.verdict).toBe('dice_look_rigged');
  });
});

describe('computeCatanGameStats — simulation wiring', () => {
  const catanSession = session([player('alice', 1), player('bob', 2)], {
    gameType: 'catan',
  });

  const exposures: CatanPlayerExposureEvent[] = [
    {
      id: 'e1',
      sessionId: 's1',
      playerId: 'alice',
      eventType: 'initialSettlement',
      turnNumber: 0,
      timestamp: '2026-01-01T00:00:00Z',
      affectedNumbers: [6, 8],
      hexIdentifiers: ['loc-a'],
      productionWeight: 1,
      robberBlocked: false,
    },
    {
      id: 'e2',
      sessionId: 's1',
      playerId: 'bob',
      eventType: 'initialSettlement',
      turnNumber: 0,
      timestamp: '2026-01-01T00:00:00Z',
      affectedNumbers: [5, 9],
      hexIdentifiers: ['loc-b'],
      productionWeight: 1,
      robberBlocked: false,
    },
  ];

  const sixtyRolls = rolls(
    Array.from({ length: 60 }, (_, i) => [2, 5, 6, 8, 9, 11][i % 6]!),
  );

  it('omits percentiles unless simulation is requested', () => {
    const stats = computeCatanGameStats(catanSession, sixtyRolls, exposures);
    expect(stats.playerStats[0]!.productionLuckPercentile).toBeUndefined();
    expect(stats.findings?.luckPercentile).toBeUndefined();
  });

  it('populates percentiles for every player when asked', () => {
    const stats = computeCatanGameStats(catanSession, sixtyRolls, exposures, {
      simulate: true,
      iterations: 500,
      seed: 2,
    });
    for (const p of stats.playerStats) {
      expect(typeof p.productionLuckPercentile).toBe('number');
      expect(p.productionLuckPercentile).toBeGreaterThanOrEqual(0);
      expect(p.productionLuckPercentile).toBeLessThanOrEqual(100);
    }
    expect(stats.findings?.luckPercentile?.['alice']).toBeDefined();
    expect(stats.findings?.luckPercentile?.['bob']).toBeDefined();
  });

  it('is reproducible across runs', () => {
    const opts = { simulate: true, iterations: 500, seed: 2 } as const;
    const a = computeCatanGameStats(catanSession, sixtyRolls, exposures, opts);
    const b = computeCatanGameStats(catanSession, sixtyRolls, exposures, opts);
    expect(a.playerStats[0]!.productionLuckPercentile).toBe(
      b.playerStats[0]!.productionLuckPercentile,
    );
  });
});
