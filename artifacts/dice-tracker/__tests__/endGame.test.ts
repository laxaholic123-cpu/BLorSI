/**
 * Tests for the shared confirmEndGame utility (services/endGame.ts).
 *
 * Both active-game.tsx and active-catan.tsx delegate their handleEndConfirm
 * handlers to this utility. Testing here exercises the real production code
 * that ships with the app.
 *
 * Key invariant: navigation to /results fires whether or not updateSession
 * succeeds — a storage failure must never trap the user on the game screen.
 */

import { confirmEndGame } from '../services/endGame';
import type { GameSession } from '../types/models';
import { SCHEMA_VERSION } from '../types/models';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeSession(overrides?: Partial<GameSession>): GameSession {
  return {
    id: 'test-session-1',
    gameType: 'general',
    diceMode: '2D6',
    minimumRoll: 2,
    maximumRoll: 12,
    players: [
      { id: 'p1', displayName: 'Alice', color: '#F5A623', seatNumber: 1, createdAt: '2026-01-01T00:00:00Z' },
    ],
    currentPlayerIndex: 0,
    autoAdvancePlayer: false,
    startedAt: '2026-01-01T10:00:00Z',
    status: 'active',
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
  };
}

// ─── Storage failure path ─────────────────────────────────────────────────────

describe('confirmEndGame — storage failure path', () => {
  it('navigates to /results even when updateSession throws an Error', async () => {
    const session = makeSession();
    const updateSession = jest.fn().mockRejectedValue(new Error('AsyncStorage unavailable'));
    const navigate = jest.fn();

    await confirmEndGame(session, { updateSession, navigate });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/results');
  });

  it('navigates to /results even when updateSession throws a non-Error value', async () => {
    const session = makeSession();
    const updateSession = jest.fn().mockRejectedValue('quota exceeded');
    const navigate = jest.fn();

    await confirmEndGame(session, { updateSession, navigate });

    expect(navigate).toHaveBeenCalledWith('/results');
  });

  it('calls updateSession exactly once before navigating, even when it throws', async () => {
    const session = makeSession();
    const updateSession = jest.fn().mockRejectedValue(new Error('write failed'));
    const navigate = jest.fn();

    await confirmEndGame(session, { updateSession, navigate });

    expect(updateSession).toHaveBeenCalledTimes(1);
    const updateOrder = updateSession.mock.invocationCallOrder[0]!;
    const navigateOrder = navigate.mock.invocationCallOrder[0]!;
    expect(navigateOrder).toBeGreaterThan(updateOrder);
  });
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('confirmEndGame — happy path', () => {
  it('calls updateSession with status "completed" and an endedAt timestamp', async () => {
    const session = makeSession();
    const updateSession = jest.fn().mockResolvedValue(undefined);
    const navigate = jest.fn();

    await confirmEndGame(session, { updateSession, navigate });

    expect(updateSession).toHaveBeenCalledTimes(1);
    const saved = updateSession.mock.calls[0]![0] as GameSession;
    expect(saved.status).toBe('completed');
    expect(typeof saved.endedAt).toBe('string');
    expect(saved.endedAt!.length).toBeGreaterThan(0);
  });

  it('preserves existing session fields when marking completed', async () => {
    const session = makeSession({ id: 'my-session', gameType: 'catan' });
    const updateSession = jest.fn().mockResolvedValue(undefined);
    const navigate = jest.fn();

    await confirmEndGame(session, { updateSession, navigate });

    const saved = updateSession.mock.calls[0]![0] as GameSession;
    expect(saved.id).toBe('my-session');
    expect(saved.gameType).toBe('catan');
    expect(saved.players[0]!.displayName).toBe('Alice');
  });

  it('navigates to /results after a successful save', async () => {
    const session = makeSession();
    const updateSession = jest.fn().mockResolvedValue(undefined);
    const navigate = jest.fn();

    await confirmEndGame(session, { updateSession, navigate });

    expect(navigate).toHaveBeenCalledWith('/results');
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

// ─── No active session guard ──────────────────────────────────────────────────

describe('confirmEndGame — no active session guard', () => {
  it('does nothing when activeSession is null', async () => {
    const updateSession = jest.fn();
    const navigate = jest.fn();

    await confirmEndGame(null, { updateSession, navigate });

    expect(updateSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
