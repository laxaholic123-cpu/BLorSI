import { correctRoll, undoLastRoll } from '@/services/rollInput';
import type { RollEvent } from '@/types/models';

const roll = (n: number, value: number): RollEvent => ({
  id: `r${n}`, sessionId: 's', playerId: `p${n % 2}`, value, turnNumber: 1,
  sequenceNumber: n, timestamp: `2026-01-01T12:0${n}:00.000Z`, source: 'touchscreen',
  individualDiceValues: [1, value - 1],
});

describe('correctRoll', () => {
  const events = [roll(1, 6), roll(2, 8), roll(3, 9)];
  const fixed = correctRoll('r1', 5, events);
  const live = fixed.filter(e => !e.deletedAt);

  it('replaces the value and keeps the original for the record', () => {
    expect(live.map(e => e.value)).toEqual([5, 8, 9]);
    expect(fixed.find(e => e.id === 'r1')!.deletedAt).toBeTruthy();
    expect(live[0]!.correctionOfEventId).toBe('r1');
    expect(live[0]!.source).toBe('corrected');
  });

  it('keeps the roll in its place, so the LAST roll is still the last', () => {
    // Appended, the fix became the newest event and Undo removed it instead
    // of the roll actually thrown last.
    expect(live.at(-1)!.id).toBe('r3');
    expect(undoLastRoll(fixed).undoneEvent!.id).toBe('r3');
  });

  it('keeps who rolled, when, and in what order', () => {
    const c = live[0]!;
    expect(c.playerId).toBe('p1');
    expect(c.sequenceNumber).toBe(1);
    expect(c.turnNumber).toBe(1);
    // Stats order builds and robber moves against roll times within a round.
    expect(c.timestamp).toBe(events[0]!.timestamp);
  });

  it('drops the two dice, which no longer add up', () => {
    expect(live[0]!.individualDiceValues).toBeUndefined();
  });

  it('does nothing for a roll that does not exist', () => {
    expect(correctRoll('nope', 5, events)).toBe(events);
  });

  it('can fix the same roll twice', () => {
    const again = correctRoll(live[0]!.id, 4, fixed).filter(e => !e.deletedAt);
    expect(again.map(e => e.value)).toEqual([4, 8, 9]);
  });
});
