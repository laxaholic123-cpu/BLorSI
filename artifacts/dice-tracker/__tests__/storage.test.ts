/**
 * Tests for storage.ts — import/export and prefill helpers.
 *
 * Uses jest.mock for AsyncStorage so nothing hits the disk.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Pull helpers under test (imported after mock setup)
import {
  clearPrefillSession,
  importAllData,
  loadPrefillSession,
  savePrefillSession,
} from '@/services/storage';
import type { GameSession } from '@/types/models';
import { SCHEMA_VERSION } from '@/types/models';

// ─── AsyncStorage mock ────────────────────────────────────────────────────────

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

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
      { id: 'p2', displayName: 'Bob', color: '#4A90E2', seatNumber: 2, createdAt: '2026-01-01T00:00:00Z' },
    ],
    currentPlayerIndex: 0,
    autoAdvancePlayer: true,
    startedAt: '2026-01-01T10:00:00Z',
    endedAt: '2026-01-01T11:00:00Z',
    status: 'completed',
    placements: [],
    settings: {
      recordIndividualDice: true,
      trackWinner: true,
      trackPlacements: false,
      catanRobberTracking: false,
      catanResourceTracking: false,
    },
    schemaVersion: SCHEMA_VERSION,
    ...overrides,
  };
}

function makeCatanSession(): GameSession {
  return makeSession({
    id: 'catan-session-1',
    gameType: 'catan',
    customGameName: 'Settlement Mode',
    settings: {
      recordIndividualDice: true,
      trackWinner: true,
      trackPlacements: true,
      catanRobberTracking: true,
      catanResourceTracking: false,
    },
  });
}

// ─── importAllData ─────────────────────────────────────────────────────────────

describe('importAllData', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('returns 0 and an error for completely invalid JSON', async () => {
    const result = await importAllData('not json {{{');
    expect(result.imported).toBe(0);
    expect(result.error).toBeDefined();
  });

  it('returns 0 and an error for valid JSON but missing sessions', async () => {
    const result = await importAllData(JSON.stringify({ foo: 'bar' }));
    expect(result.imported).toBe(0);
    expect(result.error).toMatch(/no sessions/i);
  });

  it('returns 0 and an error when sessions is not an array', async () => {
    const result = await importAllData(JSON.stringify({ sessions: 'oops' }));
    expect(result.imported).toBe(0);
    expect(result.error).toBeDefined();
  });

  it('imports a single session and its rolls', async () => {
    const session = makeSession();
    const rolls = [
      { id: 'r1', sessionId: session.id, playerId: 'p1', value: 7, turnNumber: 1, sequenceNumber: 1, timestamp: '2026-01-01T10:05:00Z', source: 'touchscreen' as const },
    ];
    const payload = JSON.stringify({ sessions: [session], rollsBySession: { [session.id]: rolls } });

    const result = await importAllData(payload);
    expect(result.imported).toBe(1);
    expect(result.error).toBeUndefined();
  });

  it('imports multiple sessions', async () => {
    const s1 = makeSession({ id: 'sess-a' });
    const s2 = makeSession({ id: 'sess-b' });
    const payload = JSON.stringify({ sessions: [s1, s2] });

    const result = await importAllData(payload);
    expect(result.imported).toBe(2);
  });

  it('skips sessions without an id', async () => {
    const badSession = { ...makeSession(), id: '' };
    const goodSession = makeSession({ id: 'good-id' });
    const payload = JSON.stringify({ sessions: [badSession, goodSession] });

    const result = await importAllData(payload);
    expect(result.imported).toBe(1);
  });

  it('imports Catan sessions with exposure events', async () => {
    const session = makeCatanSession();
    const exposures = [
      {
        id: 'e1',
        sessionId: session.id,
        playerId: 'p1',
        eventType: 'initialSettlement' as const,
        turnNumber: 0,
        timestamp: '2026-01-01T10:01:00Z',
        affectedNumbers: [6, 8],
        productionWeight: 1,
        robberBlocked: false,
      },
    ];
    const payload = JSON.stringify({
      sessions: [session],
      exposuresBySession: { [session.id]: exposures },
    });

    const result = await importAllData(payload);
    expect(result.imported).toBe(1);
  });

  it('is idempotent — importing the same session twice replaces it, not duplicates', async () => {
    const session = makeSession();
    const payload = JSON.stringify({ sessions: [session] });

    await importAllData(payload);
    const result = await importAllData(payload);
    expect(result.imported).toBe(1); // Second import still reports 1 session processed
  });
});

// ─── Prefill ──────────────────────────────────────────────────────────────────

describe('prefill session', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('returns null when no prefill is saved', async () => {
    const result = await loadPrefillSession();
    expect(result).toBeNull();
  });

  it('saves and loads a prefill session correctly', async () => {
    const session = makeSession();
    await savePrefillSession(session);
    const loaded = await loadPrefillSession();
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(session.id);
    expect(loaded?.players).toHaveLength(session.players.length);
    expect(loaded?.players[0]?.displayName).toBe('Alice');
  });

  it('overwrites an existing prefill with a new one', async () => {
    const s1 = makeSession({ id: 'first' });
    const s2 = makeSession({ id: 'second' });
    await savePrefillSession(s1);
    await savePrefillSession(s2);
    const loaded = await loadPrefillSession();
    expect(loaded?.id).toBe('second');
  });

  it('clears the prefill so loadPrefillSession returns null afterwards', async () => {
    const session = makeSession();
    await savePrefillSession(session);

    await clearPrefillSession();
    const loaded = await loadPrefillSession();
    expect(loaded).toBeNull();
  });

  it('preserves all player fields (name, color, seatNumber) through the round-trip', async () => {
    const session = makeSession();
    await savePrefillSession(session);
    const loaded = await loadPrefillSession();

    const p0 = loaded?.players[0];
    expect(p0?.displayName).toBe('Alice');
    expect(p0?.color).toBe('#F5A623');
    expect(p0?.seatNumber).toBe(1);
  });

  it('preserves gameType and settings through the round-trip', async () => {
    const catanSession = makeCatanSession();
    await savePrefillSession(catanSession);
    const loaded = await loadPrefillSession();

    expect(loaded?.gameType).toBe('catan');
    expect(loaded?.settings.catanRobberTracking).toBe(true);
    expect(loaded?.settings.trackPlacements).toBe(true);
  });

  it('handles clearPrefillSession gracefully when nothing is saved', async () => {
    // Should not throw
    await expect(clearPrefillSession()).resolves.not.toThrow();
  });
});
