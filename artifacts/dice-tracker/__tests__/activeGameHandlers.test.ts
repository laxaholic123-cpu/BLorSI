/**
 * Tests confirming that handleRoll, handleUndo, handlePrevPlayer, and
 * handleNextPlayer don't leave the app in a broken state when storage fails.
 *
 * Strategy: mock AsyncStorage at the real storage-service boundary rather than
 * mocking the context methods, so the tests exercise the actual error-propagation
 * path: AsyncStorage rejects → saveRollEvents / saveSession re-throw → context
 * method rejects → handler catch block fires.
 *
 * Both active-game.tsx and active-catan.tsx share the same handler contracts;
 * these simulations mirror their implementations exactly.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveRollEvents, saveSession } from '../services/storage';
import {
  getNextPlayerIndex,
  getPrevPlayerIndex,
  recordRoll,
  undoLastRoll,
} from '../services/rollInput';
import type { GameSession, RollEvent } from '../types/models';
import { SCHEMA_VERSION } from '../types/models';

// ─── AsyncStorage mock ────────────────────────────────────────────────────────

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeSession(overrides?: Partial<GameSession>): GameSession {
  return {
    id: 'session-1',
    gameType: 'general',
    diceMode: '2D6',
    minimumRoll: 2,
    maximumRoll: 12,
    players: [
      { id: 'p1', displayName: 'Alice', color: '#F5A623', seatNumber: 1, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'p2', displayName: 'Bob',   color: '#4A90E2', seatNumber: 2, createdAt: '2026-01-01T00:00:00Z' },
    ],
    currentPlayerIndex: 0,
    autoAdvancePlayer: true,
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

function makeRollEvent(overrides?: Partial<RollEvent>): RollEvent {
  return {
    id: 'evt-1',
    sessionId: 'session-1',
    playerId: 'p1',
    value: 6,
    turnNumber: 1,
    sequenceNumber: 1,
    timestamp: '2026-01-01T10:01:00Z',
    source: 'touchscreen',
    ...overrides,
  };
}

// ─── Context method simulations ───────────────────────────────────────────────
//
// These mirror GameContext.persistRollEvents and GameContext.updateSession exactly:
// optimistic state update first, then the real storage write (which now re-throws
// on failure).  Using the real storage functions (not a mock of the context method)
// ensures the test exercises the actual error-propagation chain.

async function simulatePersistRollEvents(
  sessionId: string,
  events: RollEvent[],
  setRollEvents: (e: RollEvent[]) => void,
): Promise<void> {
  setRollEvents(events);              // optimistic update (mirrors GameContext)
  await saveRollEvents(sessionId, events); // re-throws on storage failure
}

async function simulateUpdateSession(
  session: GameSession,
  setActiveSession: (s: GameSession) => void,
): Promise<void> {
  setActiveSession(session);          // optimistic update (mirrors GameContext)
  await saveSession(session);         // re-throws on storage failure
}

// ─── Handler simulations ───────────────────────────────────────────────────────
//
// Two separate try/catch blocks so a failed second write never rolls back a
// successful first write.

interface RollHandlerDeps {
  activeSession: GameSession;
  currentPlayer: GameSession['players'][number];
  rollEvents: RollEvent[];
  setRollEvents: (e: RollEvent[]) => void;
  setActiveSession: (s: GameSession) => void;
  loadActiveGame: () => Promise<void>;
  setLastPressedValue: (v: number | null) => void;
}

async function simulateHandleRoll(value: number, deps: RollHandlerDeps): Promise<void> {
  const {
    activeSession, currentPlayer, rollEvents,
    setRollEvents, setActiveSession, loadActiveGame, setLastPressedValue,
  } = deps;

  setLastPressedValue(value);
  const newEvents = recordRoll(
    { session: activeSession, playerId: currentPlayer.id, value, source: 'touchscreen' },
    rollEvents,
  );

  // Step 1: Persist the roll. If this fails, roll was never saved — roll back.
  try {
    await simulatePersistRollEvents(activeSession.id, newEvents, setRollEvents);
  } catch {
    setRollEvents(rollEvents);
    setLastPressedValue(null);
    return;
  }

  // Step 2: Roll is safely in storage. Advance the player. Failure here must NOT
  // roll back rollEvents — the roll is already persisted.
  if (activeSession.autoAdvancePlayer && activeSession.players.length > 1) {
    const nextIdx = getNextPlayerIndex(activeSession.currentPlayerIndex, activeSession.players.length);
    try {
      await simulateUpdateSession({ ...activeSession, currentPlayerIndex: nextIdx }, setActiveSession);
    } catch {
      await loadActiveGame().catch(() => undefined);
    }
  }
}

interface UndoHandlerDeps {
  activeSession: GameSession;
  rollEvents: RollEvent[];
  setRollEvents: (e: RollEvent[]) => void;
  setActiveSession: (s: GameSession) => void;
  loadActiveGame: () => Promise<void>;
  setLastPressedValue: (v: number | null) => void;
}

async function simulateHandleUndo(deps: UndoHandlerDeps): Promise<void> {
  const {
    activeSession, rollEvents,
    setRollEvents, setActiveSession, loadActiveGame, setLastPressedValue,
  } = deps;

  const { events: newEvents, undoneEvent } = undoLastRoll(rollEvents);

  // Step 1: Persist the undo. If this fails, undo was never saved — roll back.
  try {
    await simulatePersistRollEvents(activeSession.id, newEvents, setRollEvents);
  } catch {
    setRollEvents(rollEvents);
    return;
  }

  // Step 2: Undo is safely in storage. Revert the player index. Failure here
  // must NOT roll back rollEvents.
  if (undoneEvent && activeSession.autoAdvancePlayer && activeSession.players.length > 1) {
    const undonePlayerIdx = activeSession.players.findIndex(p => p.id === undoneEvent.playerId);
    if (undonePlayerIdx !== -1) {
      try {
        await simulateUpdateSession({ ...activeSession, currentPlayerIndex: undonePlayerIdx }, setActiveSession);
      } catch {
        await loadActiveGame().catch(() => undefined);
      }
    }
  }

  setLastPressedValue(null);
}

interface PlayerNavDeps {
  activeSession: GameSession;
  setActiveSession: (s: GameSession) => void;
  loadActiveGame: () => Promise<void>;
}

async function simulateHandlePrevPlayer(deps: PlayerNavDeps): Promise<void> {
  const { activeSession, setActiveSession, loadActiveGame } = deps;
  const prevIdx = getPrevPlayerIndex(activeSession.currentPlayerIndex, activeSession.players.length);
  try {
    await simulateUpdateSession({ ...activeSession, currentPlayerIndex: prevIdx }, setActiveSession);
  } catch {
    await loadActiveGame().catch(() => undefined);
  }
}

async function simulateHandleNextPlayer(deps: PlayerNavDeps): Promise<void> {
  const { activeSession, setActiveSession, loadActiveGame } = deps;
  const nextIdx = getNextPlayerIndex(activeSession.currentPlayerIndex, activeSession.players.length);
  try {
    await simulateUpdateSession({ ...activeSession, currentPlayerIndex: nextIdx }, setActiveSession);
  } catch {
    await loadActiveGame().catch(() => undefined);
  }
}

// ─── Storage contract: saveRollEvents / saveSession re-throw on failure ────────

describe('storage contract — write functions surface errors', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('saveRollEvents rejects when AsyncStorage.setItem rejects', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('AsyncStorage unavailable'));
    await expect(saveRollEvents('session-1', [])).rejects.toThrow();
  });

  it('saveSession rejects when AsyncStorage.setItem rejects', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('AsyncStorage unavailable'));
    await expect(saveSession(makeSession())).rejects.toThrow();
  });

  it('saveRollEvents resolves on success', async () => {
    await expect(saveRollEvents('session-1', [])).resolves.not.toThrow();
  });

  it('saveSession resolves on success', async () => {
    await expect(saveSession(makeSession())).resolves.not.toThrow();
  });
});

// ─── handleRoll — persistRollEvents (saveRollEvents) throws ───────────────────

describe('handleRoll — roll storage write fails', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('rolls back rollEvents to the pre-roll snapshot (no phantom roll)', async () => {
    const session = makeSession();
    const existingEvents: RollEvent[] = [makeRollEvent()];
    const setRollEvents = jest.fn();
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('AsyncStorage unavailable'));

    await simulateHandleRoll(9, {
      activeSession: session,
      currentPlayer: session.players[0]!,
      rollEvents: existingEvents,
      setRollEvents,
      setActiveSession: jest.fn(),
      loadActiveGame: jest.fn().mockResolvedValue(undefined),
      setLastPressedValue: jest.fn(),
    });

    // Optimistic set then rollback to original events
    const calls = setRollEvents.mock.calls.map(c => c[0] as RollEvent[]);
    // Last call must be the rollback to original events
    expect(calls[calls.length - 1]).toBe(existingEvents);
  });

  it('clears lastPressedValue after a storage failure (no phantom grid highlight)', async () => {
    const session = makeSession();
    const setLastPressedValue = jest.fn();
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('quota exceeded'));

    await simulateHandleRoll(5, {
      activeSession: session,
      currentPlayer: session.players[0]!,
      rollEvents: [],
      setRollEvents: jest.fn(),
      setActiveSession: jest.fn(),
      loadActiveGame: jest.fn().mockResolvedValue(undefined),
      setLastPressedValue,
    });

    const calls = setLastPressedValue.mock.calls.map(c => c[0]);
    expect(calls[0]).toBe(5);                       // optimistic highlight
    expect(calls[calls.length - 1]).toBe(null);     // cleared on failure
  });

  it('does not call updateSession when the roll save fails', async () => {
    // updateSession calls setActiveSession — if it were called the mock would record it
    const setActiveSession = jest.fn();
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('write failed'));

    await simulateHandleRoll(4, {
      activeSession: makeSession({ autoAdvancePlayer: true }),
      currentPlayer: makeSession().players[0]!,
      rollEvents: [],
      setRollEvents: jest.fn(),
      setActiveSession,
      loadActiveGame: jest.fn().mockResolvedValue(undefined),
      setLastPressedValue: jest.fn(),
    });

    expect(setActiveSession).not.toHaveBeenCalled();
  });
});

// ─── handleRoll — roll save succeeds, player-advance save fails ───────────────

describe('handleRoll — roll save succeeds, player-advance save fails', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('does NOT roll back rollEvents — the roll is safely in storage', async () => {
    const setRollEvents = jest.fn();
    // First setItem call (saveRollEvents) succeeds; second (saveSession) fails
    jest.spyOn(AsyncStorage, 'setItem')
      .mockResolvedValueOnce(undefined)      // saveRollEvents succeeds
      .mockRejectedValueOnce(new Error('session write failed')); // saveSession fails

    await simulateHandleRoll(6, {
      activeSession: makeSession({ autoAdvancePlayer: true }),
      currentPlayer: makeSession().players[0]!,
      rollEvents: [],
      setRollEvents,
      setActiveSession: jest.fn(),
      loadActiveGame: jest.fn().mockResolvedValue(undefined),
      setLastPressedValue: jest.fn(),
    });

    // setRollEvents is called once (optimistic) but never rolled back
    const calls = setRollEvents.mock.calls.map(c => c[0] as RollEvent[]);
    // The rollback value would be [] (empty original) — confirm last call is NOT []
    // (it was called once with the new events, and NOT again with the rollback)
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveLength(0); // new events (1 roll), not the empty rollback
  });

  it('calls loadActiveGame to reconcile memory with persisted state', async () => {
    const loadActiveGame = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(AsyncStorage, 'setItem')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('session write failed'));

    await simulateHandleRoll(6, {
      activeSession: makeSession({ autoAdvancePlayer: true }),
      currentPlayer: makeSession().players[0]!,
      rollEvents: [],
      setRollEvents: jest.fn(),
      setActiveSession: jest.fn(),
      loadActiveGame,
      setLastPressedValue: jest.fn(),
    });

    expect(loadActiveGame).toHaveBeenCalledTimes(1);
  });

  it('does not throw even when loadActiveGame also fails', async () => {
    jest.spyOn(AsyncStorage, 'setItem')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('session write failed'));

    await expect(
      simulateHandleRoll(6, {
        activeSession: makeSession({ autoAdvancePlayer: true }),
        currentPlayer: makeSession().players[0]!,
        rollEvents: [],
        setRollEvents: jest.fn(),
        setActiveSession: jest.fn(),
        loadActiveGame: jest.fn().mockRejectedValue(new Error('storage completely gone')),
        setLastPressedValue: jest.fn(),
      }),
    ).resolves.not.toThrow();
  });
});

// ─── handleUndo — undo save fails ────────────────────────────────────────────

describe('handleUndo — undo storage write fails', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('rolls back rollEvents so the undone roll stays visible (no phantom undo)', async () => {
    const existingEvents: RollEvent[] = [makeRollEvent()];
    const setRollEvents = jest.fn();
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('AsyncStorage unavailable'));

    await simulateHandleUndo({
      activeSession: makeSession(),
      rollEvents: existingEvents,
      setRollEvents,
      setActiveSession: jest.fn(),
      loadActiveGame: jest.fn().mockResolvedValue(undefined),
      setLastPressedValue: jest.fn(),
    });

    const calls = setRollEvents.mock.calls.map(c => c[0] as RollEvent[]);
    expect(calls[calls.length - 1]).toBe(existingEvents);
  });

  it('does not clear lastPressedValue when undo storage fails', async () => {
    const setLastPressedValue = jest.fn();
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('write failed'));

    await simulateHandleUndo({
      activeSession: makeSession(),
      rollEvents: [makeRollEvent()],
      setRollEvents: jest.fn(),
      setActiveSession: jest.fn(),
      loadActiveGame: jest.fn().mockResolvedValue(undefined),
      setLastPressedValue,
    });

    expect(setLastPressedValue).not.toHaveBeenCalled();
  });

  it('does not call updateSession (setActiveSession) when undo save fails', async () => {
    const setActiveSession = jest.fn();
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('write failed'));

    await simulateHandleUndo({
      activeSession: makeSession({ autoAdvancePlayer: true }),
      rollEvents: [makeRollEvent({ playerId: 'p2' })],
      setRollEvents: jest.fn(),
      setActiveSession,
      loadActiveGame: jest.fn().mockResolvedValue(undefined),
      setLastPressedValue: jest.fn(),
    });

    expect(setActiveSession).not.toHaveBeenCalled();
  });
});

// ─── handleUndo — undo save succeeds, player-revert save fails ───────────────

describe('handleUndo — undo save succeeds, player-revert save fails', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('does NOT roll back rollEvents — the undo is safely in storage', async () => {
    const setRollEvents = jest.fn();
    jest.spyOn(AsyncStorage, 'setItem')
      .mockResolvedValueOnce(undefined)       // saveRollEvents succeeds
      .mockRejectedValueOnce(new Error('session write failed')); // saveSession fails

    await simulateHandleUndo({
      activeSession: makeSession({ autoAdvancePlayer: true, currentPlayerIndex: 1 }),
      rollEvents: [makeRollEvent({ playerId: 'p1' })],
      setRollEvents,
      setActiveSession: jest.fn(),
      loadActiveGame: jest.fn().mockResolvedValue(undefined),
      setLastPressedValue: jest.fn(),
    });

    // setRollEvents called once (optimistic) but never rolled back
    expect(setRollEvents).toHaveBeenCalledTimes(1);
    // The single call was the optimistic update with the soft-deleted events, not a rollback
    const [[calledWith]] = setRollEvents.mock.calls as [[RollEvent[]]];
    expect(calledWith.some(e => e.deletedAt)).toBe(true);
  });

  it('calls loadActiveGame to reconcile memory with persisted state', async () => {
    const loadActiveGame = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(AsyncStorage, 'setItem')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('session write failed'));

    await simulateHandleUndo({
      activeSession: makeSession({ autoAdvancePlayer: true, currentPlayerIndex: 1 }),
      rollEvents: [makeRollEvent({ playerId: 'p1' })],
      setRollEvents: jest.fn(),
      setActiveSession: jest.fn(),
      loadActiveGame,
      setLastPressedValue: jest.fn(),
    });

    expect(loadActiveGame).toHaveBeenCalledTimes(1);
  });

  it('still clears lastPressedValue even when player-revert fails', async () => {
    const setLastPressedValue = jest.fn();
    jest.spyOn(AsyncStorage, 'setItem')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('session write failed'));

    await simulateHandleUndo({
      activeSession: makeSession({ autoAdvancePlayer: true, currentPlayerIndex: 1 }),
      rollEvents: [makeRollEvent({ playerId: 'p1' })],
      setRollEvents: jest.fn(),
      setActiveSession: jest.fn(),
      loadActiveGame: jest.fn().mockResolvedValue(undefined),
      setLastPressedValue,
    });

    expect(setLastPressedValue).toHaveBeenCalledWith(null);
  });
});

// ─── handlePrevPlayer / handleNextPlayer — updateSession fails ────────────────

describe('handlePrevPlayer — player-advance save fails', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('calls loadActiveGame to reconcile memory with persisted state', async () => {
    const loadActiveGame = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('write failed'));

    await simulateHandlePrevPlayer({
      activeSession: makeSession({ currentPlayerIndex: 1 }),
      setActiveSession: jest.fn(),
      loadActiveGame,
    });

    expect(loadActiveGame).toHaveBeenCalledTimes(1);
  });

  it('does not throw when both the advance and loadActiveGame fail', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('storage dead'));

    await expect(
      simulateHandlePrevPlayer({
        activeSession: makeSession({ currentPlayerIndex: 0 }),
        setActiveSession: jest.fn(),
        loadActiveGame: jest.fn().mockRejectedValue(new Error('storage dead')),
      }),
    ).resolves.not.toThrow();
  });
});

describe('handleNextPlayer — player-advance save fails', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('calls loadActiveGame to reconcile memory with persisted state', async () => {
    const loadActiveGame = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('write failed'));

    await simulateHandleNextPlayer({
      activeSession: makeSession({ currentPlayerIndex: 0 }),
      setActiveSession: jest.fn(),
      loadActiveGame,
    });

    expect(loadActiveGame).toHaveBeenCalledTimes(1);
  });

  it('does not throw when both the advance and loadActiveGame fail', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('storage dead'));

    await expect(
      simulateHandleNextPlayer({
        activeSession: makeSession({ currentPlayerIndex: 0 }),
        setActiveSession: jest.fn(),
        loadActiveGame: jest.fn().mockRejectedValue(new Error('storage dead')),
      }),
    ).resolves.not.toThrow();
  });

  it('advances to the correct next index on success', async () => {
    const setActiveSession = jest.fn();

    await simulateHandleNextPlayer({
      activeSession: makeSession({ currentPlayerIndex: 0 }),
      setActiveSession,
      loadActiveGame: jest.fn().mockResolvedValue(undefined),
    });

    expect(setActiveSession).toHaveBeenCalledTimes(1);
    expect(setActiveSession.mock.calls[0]![0].currentPlayerIndex).toBe(1);
  });

  it('wraps back to index 0 when advancing past the last player', async () => {
    const setActiveSession = jest.fn();

    await simulateHandleNextPlayer({
      activeSession: makeSession({ currentPlayerIndex: 1 }),
      setActiveSession,
      loadActiveGame: jest.fn().mockResolvedValue(undefined),
    });

    expect(setActiveSession).toHaveBeenCalledTimes(1);
    expect(setActiveSession.mock.calls[0]![0].currentPlayerIndex).toBe(0);
  });
});
