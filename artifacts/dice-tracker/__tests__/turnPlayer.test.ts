import { playerOnTurn } from '@/services/turnPlayer';
import type { Player, RollEvent } from '@/types/models';

const players = ['a', 'b', 'c'].map((id, i) => ({
  id, displayName: id.toUpperCase(), color: '#000', seatNumber: i + 1, createdAt: '',
})) as unknown as Player[];

const roll = (playerId: string, seq: number, deleted = false): RollEvent => ({
  id: `r${seq}`, sessionId: 's', playerId, value: 6, turnNumber: 1,
  sequenceNumber: seq, timestamp: '', source: 'touchscreen',
  ...(deleted ? { deletedAt: 'x' } : {}),
});

const session = (currentPlayerIndex: number, autoAdvancePlayer = true) => ({
  players, currentPlayerIndex, autoAdvancePlayer,
});

describe('playerOnTurn', () => {
  it('is the current player before anything is rolled', () => {
    expect(playerOnTurn(session(0), [])?.id).toBe('a');
  });

  it('is the player who just ROLLED, not the one auto-advance moved to', () => {
    // A rolled, the session advanced to B, and A is now building.
    expect(playerOnTurn(session(1), [roll('a', 1)])?.id).toBe('a');
  });

  it('wraps around the table', () => {
    expect(playerOnTurn(session(0), [roll('a', 1), roll('b', 2), roll('c', 3)])?.id).toBe('c');
  });

  it('ignores undone rolls', () => {
    expect(playerOnTurn(session(1), [roll('a', 1), roll('b', 2, true)])?.id).toBe('a');
  });

  it('honours a turn moved by hand since the last roll', () => {
    // A rolled (session at B), then someone tapped Next to C.
    expect(playerOnTurn(session(2), [roll('a', 1)])?.id).toBe('c');
  });

  it('is simply the current player when auto-advance is off', () => {
    expect(playerOnTurn(session(0, false), [roll('a', 1)])?.id).toBe('a');
    expect(playerOnTurn(session(2, false), [roll('a', 1)])?.id).toBe('c');
  });
});
