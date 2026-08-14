/**
 * Regression tests for the production-weight helpers in catanStats.
 *
 * Two bugs motivated these:
 *
 * 1. Actual production tested `affectedNumbers.includes(v)` — counting a number
 *    once — while expected production iterated the array, counting it twice. A
 *    settlement touching two hexes with the same token therefore produced a luck
 *    figure that was wrong by construction.
 *
 * 2. A robber block zeroed EVERY building a player owned on the blocked number.
 *    The robber sits on one hex; it cannot suppress a second settlement on a
 *    different hex that happens to carry the same token.
 */

import {
  blockedWeightForNumber,
  grossWeightForNumber,
  netWeightForNumber,
  weightOnNumber,
} from '@/services/catanStats';
import type { BuildingState } from '@/types/catanStats';

const settlement = (locationId: string, numbers: number[]): BuildingState => ({
  locationId,
  affectedNumbers: numbers,
  productionWeight: 1,
});

const city = (locationId: string, numbers: number[]): BuildingState => ({
  locationId,
  affectedNumbers: numbers,
  productionWeight: 2,
});

describe('weightOnNumber', () => {
  it('counts a number once per hex bearing it', () => {
    expect(weightOnNumber(settlement('a', [9, 4, 11]), 9)).toBe(1);
  });

  it('counts a settlement wedged between two identical tokens twice', () => {
    expect(weightOnNumber(settlement('a', [9, 9, 4]), 9)).toBe(2);
  });

  it('scales by production weight for cities', () => {
    expect(weightOnNumber(city('a', [9, 9, 4]), 9)).toBe(4);
    expect(weightOnNumber(city('a', [9, 4, 11]), 4)).toBe(2);
  });

  it('returns zero for a number the building does not touch', () => {
    expect(weightOnNumber(settlement('a', [9, 4]), 6)).toBe(0);
  });
});

describe('grossWeightForNumber', () => {
  it('sums across every building the player owns', () => {
    const buildings = [settlement('a', [8, 3]), city('b', [8, 11])];
    expect(grossWeightForNumber(buildings, 8)).toBe(3); // 1 + 2
  });

  it('includes duplicate tokens on a single building', () => {
    const buildings = [settlement('a', [8, 8, 3]), settlement('b', [8, 11])];
    expect(grossWeightForNumber(buildings, 8)).toBe(3); // 2 + 1
  });
});

describe('blockedWeightForNumber', () => {
  it('is zero when no building touches the number', () => {
    expect(blockedWeightForNumber([settlement('a', [3, 4])], 8)).toBe(0);
  });

  it('charges one hex worth of production, not the whole number', () => {
    // Two separate settlements on 8. The robber occupies one hex only.
    const buildings = [settlement('a', [8, 3]), settlement('b', [8, 11])];
    expect(blockedWeightForNumber(buildings, 8)).toBe(1);
  });

  it('charges the largest single share when buildings differ', () => {
    const buildings = [settlement('a', [8, 3]), city('b', [8, 11])];
    expect(blockedWeightForNumber(buildings, 8)).toBe(2);
  });

  it('does not multiply by duplicate tokens on one building', () => {
    // A settlement touching two 8-hexes: the robber blocks one of them.
    expect(blockedWeightForNumber([settlement('a', [8, 8, 3])], 8)).toBe(1);
  });
});

describe('netWeightForNumber', () => {
  it('equals gross when nothing is blocked', () => {
    const buildings = [settlement('a', [8, 3]), city('b', [8, 11])];
    expect(netWeightForNumber(buildings, 8, [])).toBe(3);
  });

  it('leaves a second settlement producing when the robber blocks the first', () => {
    // This is the bug: previously both settlements were zeroed.
    const buildings = [settlement('a', [8, 3]), settlement('b', [8, 11])];
    expect(netWeightForNumber(buildings, 8, [8])).toBe(1);
  });

  it('keeps a settlement on a duplicate token half-productive under the robber', () => {
    const buildings = [settlement('a', [8, 8, 3])];
    expect(netWeightForNumber(buildings, 8, [8])).toBe(1); // 2 gross − 1 blocked
  });

  it('never goes negative', () => {
    const buildings = [settlement('a', [8, 3])];
    expect(netWeightForNumber(buildings, 8, [8])).toBe(0);
  });

  it('ignores blocks on unrelated numbers', () => {
    const buildings = [settlement('a', [8, 3])];
    expect(netWeightForNumber(buildings, 8, [6, 11])).toBe(1);
  });
});
