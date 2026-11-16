/**
 * Builds and robber moves count from the roll they happened on.
 *
 * `turnNumber` is a round shared by every roll in it. Before this, a settlement
 * built by the third player counted for the first two players' rolls of that
 * round, and a robber moved mid-round was treated as having sat there all
 * round. Every case here has the event and the rolls in the SAME round, which
 * is the only place the old rule and the new one differ.
 */

import {
  computePlayerProductionStats,
  getBuildingStatesAtTurn,
  hasHappened,
  makeTurnProduction,
} from '@/services/catanStats';
import type { CatanPlayerExposureEvent, Player, RollEvent } from '@/types/models';

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 12, minute)).toISOString();
const player = { id: 'a', displayName: 'Alex', color: '#000', seatNumber: 1, createdAt: '' } as unknown as Player;

let seq = 0;
const roll = (value: number, minute: number, turnNumber: number, playerId = 'a'): RollEvent => ({
  id: `r${++seq}`, sessionId: 's', playerId, value, turnNumber,
  sequenceNumber: seq, timestamp: at(minute), source: 'touchscreen',
});
const event = (
  eventType: CatanPlayerExposureEvent['eventType'],
  id: string,
  numbers: number[],
  turnNumber: number,
  minute: number,
  extra: Partial<CatanPlayerExposureEvent> = {},
): CatanPlayerExposureEvent => ({
  id: `e${++seq}`, sessionId: 's', playerId: 'a', eventType, turnNumber,
  timestamp: at(minute), affectedNumbers: numbers, hexIdentifiers: [id],
  productionWeight: 1, robberBlocked: false, ...extra,
});

describe('hasHappened', () => {
  it('counts earlier rounds and never later ones', () => {
    expect(hasHappened({ turnNumber: 2, timestamp: at(50) }, 3, at(10))).toBe(true);
    expect(hasHappened({ turnNumber: 4, timestamp: at(1) }, 3, at(10))).toBe(false);
  });

  it('orders by time within the same round', () => {
    expect(hasHappened({ turnNumber: 3, timestamp: at(9) }, 3, at(10))).toBe(true);
    expect(hasHappened({ turnNumber: 3, timestamp: at(11) }, 3, at(10))).toBe(false);
  });

  it('keeps the old round rule when no roll time is given or a time is unreadable', () => {
    expect(hasHappened({ turnNumber: 3, timestamp: at(11) }, 3)).toBe(true);
    expect(hasHappened({ turnNumber: 3, timestamp: '' }, 3, at(10))).toBe(true);
    expect(hasHappened({ turnNumber: 3, timestamp: at(11) }, 3, 'not a date')).toBe(true);
  });
});

describe('a settlement built mid-round', () => {
  const opening = event('initialSettlement', 'c1', [6], 0, 0);
  const built = event('settlementBuilt', 'c2', [8], 3, 12);
  const rolls = [roll(8, 10, 3), roll(8, 14, 3), roll(8, 20, 4)];

  it('does not collect on a roll thrown before it existed', () => {
    const stats = computePlayerProductionStats(player, rolls, [opening, built]);
    // Three 8s were rolled; the first came before the build.
    expect(stats.totalActualProduction).toBe(2);
  });

  it('is left out of what the earlier roll was EXPECTED to pay, too', () => {
    const before = computePlayerProductionStats(player, [rolls[0]!], [opening, built]);
    const after = computePlayerProductionStats(player, [rolls[1]!], [opening, built]);
    expect(after.totalExpectedProduction).toBeGreaterThan(before.totalExpectedProduction);
  });

  it('still counts for the whole round when asked without a roll time', () => {
    expect(getBuildingStatesAtTurn('a', 3, [opening, built])).toHaveLength(2);
    expect(getBuildingStatesAtTurn('a', 3, [opening, built], at(10))).toHaveLength(1);
  });
});

describe('the robber moved mid-round', () => {
  const opening = event('initialSettlement', 'c1', [6], 0, 0);
  const blocked = event('robberBlockStarted', 'rblock_1', [6], 3, 12, { productionWeight: 0, robberBlocked: true });
  const lifted = event('robberBlockEnded', 'rblock_1', [6], 5, 32, { productionWeight: 0 });

  it('does not block a roll thrown before it arrived', () => {
    const stats = computePlayerProductionStats(player, [roll(6, 10, 3), roll(6, 14, 3)], [opening, blocked]);
    expect(stats.totalActualProduction).toBe(1);
    expect(stats.robberLostProduction).toBe(1);
  });

  it('keeps blocking until the roll after it leaves', () => {
    const stats = computePlayerProductionStats(
      player, [roll(6, 30, 5), roll(6, 34, 5)], [opening, blocked, lifted]);
    expect(stats.totalActualProduction).toBe(1);
    expect(stats.robberLostProduction).toBe(1);
  });
});

describe('the opening', () => {
  it('applies from the first roll even when it was edited later in the game', () => {
    // Edit Settlements re-records turn-0 events with the current time.
    const edited = event('initialSettlement', 'c1', [6], 0, 55);
    const stats = computePlayerProductionStats(player, [roll(6, 5, 1)], [edited]);
    expect(stats.totalActualProduction).toBe(1);
  });
});

describe('makeTurnProduction', () => {
  it('gives rolls either side of an event different answers, and caches each', () => {
    const opening = event('initialSettlement', 'c1', [6], 0, 0);
    const built = event('settlementBuilt', 'c2', [8], 3, 12);
    const production = makeTurnProduction([opening, built]);
    const before = production('a', 3, at(10));
    const after = production('a', 3, at(14));
    expect(before.weightsByValue[8]).toBe(0);
    expect(after.weightsByValue[8]).toBe(1);
    expect(production('a', 3, at(11))).toBe(before);
    expect(production('a', 3, at(20))).toBe(after);
  });
});
