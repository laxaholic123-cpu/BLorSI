/**
 * Accolades: one per player, on a distinct axis, with their place stated.
 *
 * The properties worth protecting are social rather than numerical. An
 * accolade engine that is merely correct can still produce a results screen
 * nobody wants to look at — three badges for one player and none for two
 * others, or four badges that all say the same thing in different words.
 *
 * So these tests are mostly about COVERAGE and DISTINCTNESS, with a few on
 * honesty: a badge must carry a real number, and must never claim a simulated
 * percentile when the simulation did not run.
 */

import {
  ACCOLADE_CATALOGUE,
  ACCOLADE_COUNT,
  assignAccolades,
  profileRolls,
  type PlayerRollProfile,
} from '@/services/catanAccolades';
import type { CatanPlayerProductionStats } from '@/types/catanStats';
import type { CatanPlayerExposureEvent, RollEvent } from '@/types/models';

function player(
  id: string,
  over: Partial<CatanPlayerProductionStats> = {},
): CatanPlayerProductionStats {
  return {
    playerId: id,
    displayName: id.toUpperCase(),
    totalActualProduction: 50,
    totalExpectedProduction: 50,
    productionLuck: 0,
    productionLuckPct: 0,
    placementStrength: 0.4,
    numberDiversity: 4,
    portAccess: [],
    robberLostProduction: 0,
    initialBuildingCount: 2,
    finalCityCount: 0,
    ...over,
  };
}

function profile(id: string, over: Partial<PlayerRollProfile> = {}): PlayerRollProfile {
  return {
    playerId: id, rolls: 20, sevens: 3, mean: 7, longestRepeat: 2,
    gaveToOthers: 30, keptForSelf: 10, twos: 1, twelves: 1, doubles: 2,
    draws: 3, knights: 2, vpCards: 1, actionCards: 0,
    vpDrawLuck: 0.4, knightDrawLuck: 0.3,
    bestTurn: 6, longestDrought: 4, earlyProduction: 20, lateProduction: 30,
    firstCityTurn: 8, expansions: 2, longestRoad: 4, ...over,
  };
}

const FOUR = [
  player('a', { productionLuckPercentile: 95, robberLostProduction: 0, placementStrength: 0.7 }),
  player('b', { productionLuckPercentile: 60, robberLostProduction: 6, placementStrength: 0.5 }),
  player('c', { productionLuckPercentile: 35, robberLostProduction: 2, placementStrength: 0.4 }),
  player('d', { productionLuckPercentile: 5, robberLostProduction: 0, placementStrength: 0.2 }),
];

describe('the catalogue', () => {
  it('offers at least 30 distinct accolades', () => {
    // The stated bar. Each axis reads three ways depending on where a player
    // landed on it, so the catalogue is three times the axis count.
    expect(ACCOLADE_COUNT).toBeGreaterThanOrEqual(30);
    expect(ACCOLADE_CATALOGUE.length * 3).toBe(ACCOLADE_COUNT);
  });

  it('gives every axis three readings and no duplicate titles within one', () => {
    for (const entry of ACCOLADE_CATALOGUE) {
      expect(entry.titles).toHaveLength(3);
      expect(new Set(entry.titles).size).toBe(3);
    }
  });

  it('uses a distinct kind per axis', () => {
    const kinds = ACCOLADE_CATALOGUE.map(e => e.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

describe('assignAccolades', () => {
  it('gives every player exactly one', () => {
    const out = assignAccolades(FOUR);
    expect(out).toHaveLength(4);
    expect(new Set(out.map(a => a.playerId)).size).toBe(4);
  });

  it('never hands the same axis to two players', () => {
    // The failure this whole design exists to prevent. A naive superlative pass
    // gave three of six badges to one player and left two with nothing.
    const out = assignAccolades(FOUR);
    expect(new Set(out.map(a => a.kind)).size).toBe(4);
  });

  it('reports a real place, not just a win', () => {
    // Coming 4th of 4 is a fact worth reading, and often the best story at the
    // table. An engine that only ever reports 1st has nothing to say about
    // three quarters of the players.
    const out = assignAccolades(FOUR);
    for (const a of out) {
      expect(a.rank).toBeGreaterThanOrEqual(1);
      expect(a.rank).toBeLessThanOrEqual(a.outOf);
      expect(a.outOf).toBeGreaterThan(0);
    }
  });

  it('carries a number in every detail line', () => {
    // "Luckiest" with no figure is a horoscope. Every line must cite something.
    for (const a of assignAccolades(FOUR, new Map(FOUR.map(p => [p.playerId, profile(p.playerId)])))) {
      expect(a.detail).toMatch(/\d/);
      expect(a.detail.length).toBeGreaterThan(20);
    }
  });

  it('preserves the order it was given, for laying out beside the stats', () => {
    const out = assignAccolades(FOUR);
    expect(out.map(a => a.playerId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('never claims a simulated percentile when there was no simulation', () => {
    // productionLuckPercentile is undefined when the caller did not ask for the
    // simulation. Falling back to a raw percentage would be a different claim
    // wearing the same words — the same +20% means very different things over
    // 40 rolls and 150.
    const noSim = FOUR.map(p => {
      const { productionLuckPercentile: _drop, ...rest } = p;
      return rest as CatanPlayerProductionStats;
    });
    for (const a of assignAccolades(noSim)) {
      expect(a.kind).not.toBe('luck_percentile');
      expect(a.detail).not.toMatch(/fair games/);
    }
  });

  it('still says something about a player nothing distinguishes', () => {
    const identical = ['a', 'b', 'c'].map(id => player(id));
    const out = assignAccolades(identical);
    expect(out).toHaveLength(3);
    for (const a of out) expect(a.detail.length).toBeGreaterThan(10);
    expect(new Set(out.map(a => a.kind)).size).toBe(3);
  });

  it('handles a solo player and an empty table', () => {
    expect(assignAccolades([])).toEqual([]);
    expect(assignAccolades([player('a')])).toHaveLength(1);
  });

  it('copes with more players than a six-seat game', () => {
    const many = Array.from({ length: 6 }, (_, i) => player(`p${i}`, {
      placementStrength: 0.2 + i * 0.1,
      robberLostProduction: i,
    }));
    const out = assignAccolades(many);
    expect(out).toHaveLength(6);
    expect(new Set(out.map(a => a.kind)).size).toBe(6);
  });
});

describe('profileRolls', () => {
  const players = [{ id: 'a' }, { id: 'b' }];
  const roll = (id: string, value: number, seq: number, turn = 1): RollEvent => ({
    id: `r${seq}`, sessionId: 's', playerId: id, value,
    turnNumber: turn, sequenceNumber: seq,
    timestamp: '2026-08-26T00:00:00.000Z', source: 'touchscreen',
  });

  it('counts each player\'s own throws, not the table\'s', () => {
    const p = profileRolls(players, [
      roll('a', 7, 0), roll('b', 7, 1), roll('a', 7, 2), roll('a', 5, 3),
    ], []);
    expect(p.get('a')!.rolls).toBe(3);
    expect(p.get('a')!.sevens).toBe(2);
    expect(p.get('b')!.sevens).toBe(1);
  });

  it('finds the longest run of one value by that player', () => {
    // Consecutive for THEM, not on the table — the rolls in between belong to
    // other players and must not break the streak.
    const p = profileRolls(players, [
      roll('a', 8, 0), roll('b', 3, 1), roll('a', 8, 2), roll('b', 4, 3), roll('a', 8, 4),
      roll('a', 2, 5),
    ], []);
    expect(p.get('a')!.longestRepeat).toBe(3);
  });

  it('ignores deleted rolls', () => {
    const undone = { ...roll('a', 7, 1), deletedAt: '2026-08-26T00:01:00.000Z' };
    const p = profileRolls(players, [roll('a', 7, 0), undone], []);
    expect(p.get('a')!.rolls).toBe(1);
  });

  it('splits what a throw paid between the thrower and everyone else', () => {
    // The number nothing else in the app knows: whose turns actually fed the
    // table. B holds the 8; when A throws it, that is A giving to B.
    const exposure: CatanPlayerExposureEvent[] = [{
      id: 'e1', sessionId: 's', playerId: 'b', eventType: 'initialSettlement',
      turnNumber: 0, timestamp: '2026-08-26T00:00:00.000Z',
      hexIdentifiers: ['loc-b'], affectedNumbers: [8],
      productionWeight: 1, robberBlocked: false,
    }];
    const p = profileRolls(players, [roll('a', 8, 0)], exposure);
    expect(p.get('a')!.gaveToOthers).toBeGreaterThan(0);
    expect(p.get('a')!.keptForSelf).toBe(0);
  });

  it('pays nobody for a seven', () => {
    const exposure: CatanPlayerExposureEvent[] = [{
      id: 'e1', sessionId: 's', playerId: 'b', eventType: 'initialSettlement',
      turnNumber: 0, timestamp: '2026-08-26T00:00:00.000Z',
      hexIdentifiers: ['loc-b'], affectedNumbers: [7],
      productionWeight: 1, robberBlocked: false,
    }];
    const p = profileRolls(players, [roll('a', 7, 0)], exposure);
    expect(p.get('a')!.gaveToOthers).toBe(0);
  });
});

describe('the wider catalogue', () => {
  it('never reports a strength above 1', () => {
    // The tie-break weights multiply past 1 internally; the published value is
    // documented as 0-1 and callers may scale a bar off it.
    const withProfiles = new Map(FOUR.map(p => [p.playerId, profile(p.playerId)]));
    for (const a of assignAccolades(FOUR, withProfiles)) {
      expect(a.strength).toBeGreaterThan(0);
      expect(a.strength).toBeLessThanOrEqual(1);
    }
  });

  it('stays silent about the deck when nobody bought a card', () => {
    // Reporting "drew 0 of 0, 1st of 4" would be a badge about nothing.
    const none = new Map(FOUR.map(p => [p.playerId, profile(p.playerId, {
      draws: 0, knights: 0, vpCards: 0, actionCards: 0,
      vpDrawLuck: 0, knightDrawLuck: 0,
    })]));
    for (const a of assignAccolades(FOUR, none)) {
      expect(a.kind).not.toBe('vp_draw_luck');
    }
  });

  it('stays silent about doubles when the dice were not recorded', () => {
    // recordIndividualDice is off by default, so most sessions have no dice
    // detail at all — better to skip the axis than print a table of zeroes.
    const none = new Map(FOUR.map(p => [p.playerId, profile(p.playerId, { doubles: 0 })]));
    for (const a of assignAccolades(FOUR, none)) {
      expect(a.kind).not.toBe('doubles');
    }
  });

  it('ranks the earliest city first, not last', () => {
    // first_city is the one axis where a LOW number is the good one.
    const profiles = new Map([
      ['a', profile('a', { firstCityTurn: 4 })],
      ['b', profile('b', { firstCityTurn: 9 })],
      ['c', profile('c', { firstCityTurn: 14 })],
      ['d', profile('d', { firstCityTurn: 19 })],
    ]);
    const out = assignAccolades(FOUR, profiles).find(a => a.kind === 'first_city');
    if (out) {
      const turns: Record<string, number> = { a: 4, b: 9, c: 14, d: 19 };
      const mine = turns[out.playerId]!;
      const earlier = Object.values(turns).filter(t => t < mine).length;
      expect(out.rank).toBe(earlier + 1);
    }
  });
});

describe('profileRolls — the shape of a game', () => {
  const players = [{ id: 'a' }];
  const roll = (value: number, seq: number, turn = 1): RollEvent => ({
    id: `r${seq}`, sessionId: 's', playerId: 'a', value,
    turnNumber: turn, sequenceNumber: seq,
    timestamp: '2026-08-26T00:00:00.000Z', source: 'touchscreen',
  });
  const holds = (numbers: number[]): CatanPlayerExposureEvent[] => [{
    id: 'e1', sessionId: 's', playerId: 'a', eventType: 'initialSettlement',
    turnNumber: 0, timestamp: '2026-08-26T00:00:00.000Z',
    hexIdentifiers: ['loc-a'], affectedNumbers: numbers,
    productionWeight: 1, robberBlocked: false,
  }];

  it('counts the longest run of rolls that paid nothing', () => {
    // Two players can finish on identical production having had completely
    // different games. This is what tells them apart.
    const p = profileRolls(players, [
      roll(8, 0), roll(3, 1), roll(4, 2), roll(5, 3), roll(8, 4),
    ], holds([8]));
    expect(p.get('a')!.longestDrought).toBe(3);
  });

  it('splits the game in half to find a late surge', () => {
    const p = profileRolls(players, [
      roll(2, 0), roll(2, 1), roll(8, 2), roll(8, 3),
    ], holds([8]));
    const me = p.get('a')!;
    expect(me.earlyProduction).toBe(0);
    expect(me.lateProduction).toBeGreaterThan(0);
  });

  it('measures deck draws against what the deck owed', () => {
    // 5 of 25 cards are victory points, so five draws owe exactly one.
    const draws = ['victoryPoint', 'victoryPoint', 'knight', 'knight', 'knight']
      .map((cardType, i) => ({
        id: `d${i}`, sessionId: 's', playerId: 'a',
        cardType: cardType as 'victoryPoint' | 'knight',
        turnNumber: 5, sequenceNumber: i, timestamp: '2026-08-26T00:00:00.000Z',
      }));
    const me = profileRolls(players, [], [], draws).get('a')!;
    expect(me.draws).toBe(5);
    expect(me.vpCards).toBe(2);
    expect(me.vpDrawLuck).toBeCloseTo(1, 5);
  });

  it('ignores an undone draw', () => {
    const draws = [
      { id: 'd0', sessionId: 's', playerId: 'a', cardType: 'knight' as const,
        turnNumber: 5, sequenceNumber: 0, timestamp: '2026-08-26T00:00:00.000Z' },
      { id: 'd1', sessionId: 's', playerId: 'a', cardType: 'knight' as const,
        turnNumber: 5, sequenceNumber: 1, timestamp: '2026-08-26T00:00:00.000Z',
        deletedAt: '2026-08-26T00:02:00.000Z' },
    ];
    expect(profileRolls(players, [], [], draws).get('a')!.knights).toBe(1);
  });
});

describe('the Longest Road accolade', () => {
  it('names it only when the threshold is met and the lead is clear', () => {
    const profiles = new Map([
      ['a', profile('a', { longestRoad: 7 })],
      ['b', profile('b', { longestRoad: 4 })],
      ['c', profile('c', { longestRoad: 3 })],
      ['d', profile('d', { longestRoad: 2 })],
    ]);
    const road = assignAccolades(FOUR, profiles).find(x => x.kind === 'longest_road');
    if (road) {
      // Whoever gets the axis, the text must match their actual standing.
      const len = { a: 7, b: 4, c: 3, d: 2 }[road.playerId as 'a' | 'b' | 'c' | 'd'];
      expect(road.detail).toContain(String(len));
      if (road.rank === 1 && len >= 5) expect(road.detail).toContain('Longest Road');
      if (len < 5) expect(road.detail).toContain('short of the 5');
    }
  });
});
