/**
 * "Did your numbers come up?" — the figure the results screen should have led
 * with all along.
 *
 * The tests that matter are the ones about HONESTY: every number here is a
 * count or a difference of counts, expected is always relative to the rolls
 * actually made, and no wording claims anything about luck.
 */

import {
  biggestResourceGap,
  describeExposure,
  exposureReports,
  playerExposureReport,
  resourceExposure,
} from '@/services/exposureReport';
import { getAllIntersections } from '@/services/catanBoard';
import { CATAN_PROBS } from '@/services/catanStats';
import type { CatanPlayerExposureEvent, Player, RollEvent } from '@/types/models';

const PLAYER: Player = { id: 'p1', displayName: 'Ada', color: '#fff' } as Player;

function rolls(values: number[]): RollEvent[] {
  return values.map((value, i) => ({
    id: `r${i}`, sessionId: 's', playerId: 'p1', value,
    turnNumber: i + 1, sequenceNumber: i + 1,
    timestamp: new Date().toISOString(), source: 'touchscreen' as const,
  }));
}

function settlement(cornerId: string, numbers: number[], weight = 1): CatanPlayerExposureEvent {
  return {
    id: `e-${cornerId}`, sessionId: 's', playerId: 'p1',
    eventType: 'initialSettlement', turnNumber: 0,
    timestamp: new Date().toISOString(),
    affectedNumbers: numbers, hexIdentifiers: [cornerId],
    productionWeight: weight, robberBlocked: false,
  } as CatanPlayerExposureEvent;
}

describe('playerExposureReport', () => {
  it('lists only the numbers the player actually holds', () => {
    const r = playerExposureReport(PLAYER, rolls([2, 6, 8]), [settlement('a', [6, 9])]);
    expect(r.numbers.map(n => n.number).sort((x, y) => x - y)).toEqual([6, 9]);
  });

  it('counts how often each of those came up', () => {
    const r = playerExposureReport(
      PLAYER, rolls([6, 6, 9, 4, 6]), [settlement('a', [6, 9])],
    );
    expect(r.numbers.find(n => n.number === 6)!.actual).toBe(3);
    expect(r.numbers.find(n => n.number === 9)!.actual).toBe(1);
  });

  it('expects counts RELATIVE to the rolls actually made', () => {
    // The whole point: "you should have seen six 8s" is meaningless without
    // saying six out of how many.
    const short = playerExposureReport(PLAYER, rolls(Array(36).fill(4)), [settlement('a', [8])]);
    const long = playerExposureReport(PLAYER, rolls(Array(72).fill(4)), [settlement('a', [8])]);
    expect(short.numbers[0]!.expected).toBeCloseTo(36 * CATAN_PROBS[8]!, 6);
    expect(long.numbers[0]!.expected).toBeCloseTo(72 * CATAN_PROBS[8]!, 6);
    expect(long.numbers[0]!.expected).toBeCloseTo(2 * short.numbers[0]!.expected, 6);
  });

  it('weights a city double, and stacks two buildings on one number', () => {
    const r = playerExposureReport(
      PLAYER, rolls([5]),
      [settlement('a', [5], 1), settlement('b', [5], 2)],
    );
    expect(r.numbers.find(n => n.number === 5)!.weight).toBe(3);
  });

  it('counts a number twice when one corner touches two hexes carrying it', () => {
    const r = playerExposureReport(PLAYER, rolls([5]), [settlement('a', [5, 5], 1)]);
    expect(r.numbers.find(n => n.number === 5)!.weight).toBe(2);
  });

  it('counts payouts as ROLLS that paid, not production', () => {
    // Three rolls land on numbers held; the fourth does not.
    const r = playerExposureReport(
      PLAYER, rolls([6, 9, 6, 3]), [settlement('a', [6, 9])],
    );
    expect(r.payouts).toBe(3);
    expect(r.totalRolls).toBe(4);
  });

  it('puts expected payouts on the same scale as actual', () => {
    const r = playerExposureReport(PLAYER, rolls(Array(36).fill(2)), [settlement('a', [6, 8])]);
    expect(r.expectedPayouts).toBeCloseTo(36 * (CATAN_PROBS[6]! + CATAN_PROBS[8]!), 6);
  });

  it('ignores deleted rolls, because undo must undo', () => {
    const rs = rolls([6, 6, 6]);
    rs[1]!.deletedAt = new Date().toISOString();
    const r = playerExposureReport(PLAYER, rs, [settlement('a', [6])]);
    expect(r.totalRolls).toBe(2);
    expect(r.numbers[0]!.actual).toBe(2);
  });

  it('drops a building that was removed', () => {
    const removed: CatanPlayerExposureEvent = {
      ...settlement('a', [6]), eventType: 'buildingRemoved', productionWeight: 0, turnNumber: 2,
    } as CatanPlayerExposureEvent;
    const r = playerExposureReport(PLAYER, rolls([6]), [settlement('a', [6]), removed]);
    expect(r.numbers).toHaveLength(0);
  });

  it('sorts the strongest exposure first', () => {
    const r = playerExposureReport(
      PLAYER, rolls([5]),
      [settlement('a', [5], 1), settlement('b', [8], 2)],
    );
    expect(r.numbers[0]!.number).toBe(8);
  });

  it('survives a player with nothing recorded', () => {
    const r = playerExposureReport(PLAYER, rolls([6, 8]), []);
    expect(r.numbers).toEqual([]);
    expect(r.payouts).toBe(0);
    expect(r.expectedPayouts).toBe(0);
  });
});

describe('describeExposure', () => {
  const FORBIDDEN = ['luck', 'lucky', 'unlucky', 'unfair', 'rigged', 'deserved', 'should have'];

  it('states a count and a comparison, never a verdict', () => {
    const r = playerExposureReport(PLAYER, rolls([6, 9, 6, 3]), [settlement('a', [6, 9])]);
    const text = describeExposure(r).toLowerCase();
    for (const word of FORBIDDEN) expect(text).not.toContain(word);
    expect(text).toContain('par');
  });

  it('says something sensible with no rolls and with no settlements', () => {
    expect(describeExposure(playerExposureReport(PLAYER, [], [settlement('a', [6])])))
      .toContain('No rolls');
    expect(describeExposure(playerExposureReport(PLAYER, rolls([6]), [])))
      .toContain('No settlements');
  });
});

describe('exposureReports', () => {
  it('returns one report per player, in order', () => {
    const players = [PLAYER, { ...PLAYER, id: 'p2', displayName: 'Bo' } as Player];
    const out = exposureReports(players, rolls([6]), [settlement('a', [6])]);
    expect(out.map(r => r.displayName)).toEqual(['Ada', 'Bo']);
  });
});

/**
 * Resources, which is how players actually talk about this.
 *
 * "I could not get ore all game" is the grievance; "my 8 underperformed" is
 * not something anyone says. A settlement on 6-ore and one on 6-wool are the
 * same pips and a completely different game.
 */
describe('resourceExposure', () => {
  /** A board where every hex is a known resource and number. */
  const hexes = Array.from({ length: 19 }, (_, i) => ({
    resource: (['ore', 'grain', 'lumber', 'brick', 'wool'] as const)[i % 5],
    number: [5, 8, 9, 4, 6][i % 5],
  })) as unknown as import('@/types/models').CatanHexDef[];

  const cornerOnHex = (h: number) =>
    getAllIntersections().find(i => i.hexIndices.includes(h))!;

  it('returns nothing without a board, rather than guessing', () => {
    const c = cornerOnHex(0);
    expect(resourceExposure(PLAYER, rolls([5]), [settlement(c.id, [5])], null)).toEqual([]);
    expect(resourceExposure(PLAYER, rolls([5]), [settlement(c.id, [5])], [])).toEqual([]);
  });

  it('attributes production to the terrain, not just the number', () => {
    const c = cornerOnHex(0); // hex 0 is ore
    const out = resourceExposure(PLAYER, rolls([5, 5, 5]), [settlement(c.id, [5])], hexes);
    const ore = out.find(r => r.resource === 'ore');
    expect(ore).toBeDefined();
    expect(ore!.actual).toBeGreaterThan(0);
  });

  it('skips a building with no corner, because terrain cannot be inferred', () => {
    // The number-pad path records numbers and a random id — real production,
    // no position, so no resource. Counted nowhere rather than guessed.
    const noCorner = settlement('not-a-corner', [5]);
    expect(resourceExposure(PLAYER, rolls([5]), [noCorner], hexes)).toEqual([]);
  });

  it('ignores the desert', () => {
    const desert = hexes.map((h, i) =>
      (i === 0 ? { resource: 'desert', number: null } : h)) as typeof hexes;
    const c = getAllIntersections().find(
      i => i.hexIndices.length === 1 && i.hexIndices[0] === 0);
    if (c) {
      expect(resourceExposure(PLAYER, rolls([5]), [settlement(c.id, [])], desert)).toEqual([]);
    }
  });

  it('doubles a city', () => {
    const c = cornerOnHex(0);
    const one = resourceExposure(PLAYER, rolls([5]), [settlement(c.id, [5], 1)], hexes);
    const two = resourceExposure(PLAYER, rolls([5]), [settlement(c.id, [5], 2)], hexes);
    expect(two[0]!.weight).toBe(2 * one[0]!.weight);
    expect(two[0]!.actual).toBe(2 * one[0]!.actual);
  });

  it('scales expected with the number of rolls', () => {
    const c = cornerOnHex(0);
    const short = resourceExposure(PLAYER, rolls(Array(20).fill(2)), [settlement(c.id, [5])], hexes);
    const long = resourceExposure(PLAYER, rolls(Array(40).fill(2)), [settlement(c.id, [5])], hexes);
    expect(long[0]!.expected).toBeCloseTo(2 * short[0]!.expected, 6);
  });

  it('sorts the strongest exposure first', () => {
    const out = resourceExposure(
      PLAYER, rolls([5]),
      [settlement(cornerOnHex(0).id, [5]), settlement(cornerOnHex(1).id, [8])],
      hexes,
    );
    expect(out.length).toBeGreaterThan(1);
    expect(out[0]!.perRoll).toBeGreaterThanOrEqual(out[1]!.perRoll);
  });
});

describe('biggestResourceGap', () => {
  it('reports a WINDFALL as readily as a drought', () => {
    // The bias this app exists to correct is that people remember the misses.
    // A panel that only ever finds droughts is that same distortion, charted.
    const over = biggestResourceGap([
      { resource: 'ore', weight: 1, perRoll: 0.1, actual: 20, expected: 8 },
    ]);
    expect(over!.diff).toBeGreaterThan(0);
    expect(over!.z).toBeGreaterThan(0);
  });

  it('picks the most out-of-line by z, not by raw difference', () => {
    const out = biggestResourceGap([
      // bigger raw gap, but on a much larger expectation
      { resource: 'grain', weight: 1, perRoll: 0.4, actual: 46, expected: 40 },
      // smaller raw gap, far more extreme relative to its own scale
      { resource: 'ore', weight: 1, perRoll: 0.05, actual: 0, expected: 5 },
    ]);
    expect(out!.resource).toBe('ore');
  });

  it('is null when there is nothing to compare', () => {
    expect(biggestResourceGap([])).toBeNull();
  });
});
