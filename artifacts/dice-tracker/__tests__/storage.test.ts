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
  loadRollEvents,
  loadSession,
  normalizeSession,
  saveSession,
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

  it('leaves an already-present session alone rather than overwriting it', async () => {
    // Import is additive. Restoring a stale backup must never roll back games
    // played since it was taken, and the session ID is the only thing linking
    // the two copies — so the copy already on the device wins.
    const session = makeSession();
    const payload = JSON.stringify({ sessions: [session] });

    const first = await importAllData(payload);
    expect(first).toEqual({ imported: 1, skipped: 0 });

    const second = await importAllData(payload);
    expect(second).toEqual({ imported: 0, skipped: 1 });
  });

  it('drops malformed roll events instead of trusting the backup file', async () => {
    const session = makeSession();
    const payload = JSON.stringify({
      sessions: [session],
      rollsBySession: {
        [session.id]: [
          { id: 'r1', sessionId: session.id, playerId: 'p1', value: 8 },
          { id: 'r2', value: 'not-a-number' },
          null,
          'garbage',
        ],
      },
    });

    const result = await importAllData(payload);
    expect(result.imported).toBe(1);
    const rolls = await loadRollEvents(session.id);
    expect(rolls).toHaveLength(1);
    expect(rolls[0]!.id).toBe('r1');
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

// ─── normalizeSession ─────────────────────────────────────────────────────────

describe('normalizeSession (legacy custom mode migration)', () => {
  it('returns the session unchanged when diceMode is already valid', () => {
    const session = makeSession({ diceMode: '2D6', gameType: 'general' });
    expect(normalizeSession(session)).toBe(session); // same reference — no copy made
  });

  it('maps diceMode:custom to 2D6 and updates minimumRoll/maximumRoll', () => {
    const session = makeSession({
      diceMode: 'custom' as any,
      gameType: 'custom' as any,
      minimumRoll: 3,
      maximumRoll: 15,
    });
    const normalized = normalizeSession(session);
    expect(normalized.diceMode).toBe('2D6');
    expect(normalized.gameType).toBe('general');
    expect(normalized.minimumRoll).toBe(2);
    expect(normalized.maximumRoll).toBe(12);
  });

  it('preserves all other session fields during normalization', () => {
    const session = makeSession({
      diceMode: 'custom' as any,
      gameType: 'custom' as any,
      minimumRoll: 3,
      maximumRoll: 15,
    });
    const normalized = normalizeSession(session);
    expect(normalized.id).toBe(session.id);
    expect(normalized.players).toBe(session.players);
    expect(normalized.customGameName).toBe(session.customGameName);
    expect(normalized.status).toBe(session.status);
  });

  it('does not touch catan sessions', () => {
    const session = makeCatanSession();
    expect(normalizeSession(session)).toBe(session);
  });
});

// ─── loadSession legacy normalization ────────────────────────────────────────

describe('loadSession — legacy custom session normalization', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('normalizes a persisted legacy custom session on load', async () => {
    const legacySession = makeSession({
      id: 'legacy-custom',
      diceMode: 'custom' as any,
      gameType: 'custom' as any,
      minimumRoll: 3,
      maximumRoll: 18,
    });
    await saveSession(legacySession);

    const loaded = await loadSession('legacy-custom');
    expect(loaded).not.toBeNull();
    expect(loaded!.diceMode).toBe('2D6');
    expect(loaded!.gameType).toBe('general');
    expect(loaded!.minimumRoll).toBe(2);
    expect(loaded!.maximumRoll).toBe(12);
  });

  it('returns a standard session unchanged from loadSession', async () => {
    const session = makeSession({ id: 'standard-session' });
    await saveSession(session);
    const loaded = await loadSession('standard-session');
    expect(loaded!.diceMode).toBe('2D6');
    expect(loaded!.gameType).toBe('general');
    expect(loaded!.minimumRoll).toBe(2);
    expect(loaded!.maximumRoll).toBe(12);
  });
});

// ─── loadPrefillSession legacy normalization ──────────────────────────────────

describe('loadPrefillSession — legacy custom prefill normalization', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('normalizes a legacy custom prefill on load', async () => {
    const legacySession = makeSession({
      id: 'legacy-prefill',
      diceMode: 'custom' as any,
      gameType: 'custom' as any,
      minimumRoll: 4,
      maximumRoll: 20,
      customGameName: 'My Custom Game',
    });
    await savePrefillSession(legacySession);

    const loaded = await loadPrefillSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.diceMode).toBe('2D6');
    expect(loaded!.gameType).toBe('general');
    expect(loaded!.minimumRoll).toBe(2);
    expect(loaded!.maximumRoll).toBe(12);
    // customGameName is deliberately retained so the user's label is preserved
    expect(loaded!.customGameName).toBe('My Custom Game');
  });

  it('persists the normalized prefill so the second read is also clean', async () => {
    const legacySession = makeSession({
      id: 'legacy-prefill-2',
      diceMode: 'custom' as any,
      gameType: 'custom' as any,
    });
    await savePrefillSession(legacySession);

    // First load triggers write-back
    await loadPrefillSession();
    // Second load reads the already-normalized record
    const second = await loadPrefillSession();
    expect(second!.diceMode).toBe('2D6');
    expect(second!.gameType).toBe('general');
  });

  it('simulates duplicating a legacy custom session: prefill normalizes, players are retained', async () => {
    // session-detail saves the (already loadSession-normalized) session as prefill
    const normalizedByLoadSession = makeSession({
      id: 'dup-test',
      diceMode: 'custom' as any, // raw stored value before session-detail reads it
      gameType: 'custom' as any,
      minimumRoll: 3,
      maximumRoll: 15,
    });
    await savePrefillSession(normalizedByLoadSession);

    const prefill = await loadPrefillSession();
    expect(prefill!.diceMode).toBe('2D6');
    expect(prefill!.players).toHaveLength(2);
    expect(prefill!.players[0]!.displayName).toBe('Alice');
  });
});

// ─── importAllData legacy normalization ──────────────────────────────────────

describe('importAllData — legacy custom session normalization', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('normalizes a legacy custom session during import', async () => {
    const legacySession = makeSession({
      id: 'import-legacy',
      diceMode: 'custom' as any,
      gameType: 'custom' as any,
      minimumRoll: 5,
      maximumRoll: 30,
    });
    const payload = JSON.stringify({ sessions: [legacySession] });

    const result = await importAllData(payload);
    expect(result.imported).toBe(1);

    // Read it back and confirm it was stored normalized
    const stored = await loadSession('import-legacy');
    expect(stored!.diceMode).toBe('2D6');
    expect(stored!.gameType).toBe('general');
    expect(stored!.minimumRoll).toBe(2);
    expect(stored!.maximumRoll).toBe(12);
  });

  it('normalizes a mixed import (custom + standard) without touching the standard session', async () => {
    const legacySession = makeSession({ id: 'old-custom', diceMode: 'custom' as any, gameType: 'custom' as any });
    const normalSession = makeSession({ id: 'new-standard', diceMode: 'D6', minimumRoll: 1, maximumRoll: 6 });
    const payload = JSON.stringify({ sessions: [legacySession, normalSession] });

    const result = await importAllData(payload);
    expect(result.imported).toBe(2);

    const loaded = await loadSession('new-standard');
    expect(loaded!.diceMode).toBe('D6');
  });
});
