/**
 * Unit tests for the game mode boundary (services/modes).
 *
 * Two kinds of test here. The first exercise the registry and the Catan
 * adapter. The last one is different: it pins the *invariant* the boundary
 * exists to protect — that cross-mode code does not import a specific game.
 * Behaviour tests would all still pass with the boundary quietly bypassed,
 * which is exactly how this kind of separation rots.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { getModeAdapter, getSessionModeAdapter, catanMode } from '../services/modes';
import { CATAN_NUMBERS, CATAN_PROBS } from '../services/catanStats';
import type { GameSession } from '../types/models';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseSession = (overrides: Partial<GameSession> = {}): GameSession => ({
  id: 's1',
  gameType: 'catan',
  diceMode: '2D6',
  minimumRoll: 2,
  maximumRoll: 12,
  players: [],
  currentPlayerIndex: 0,
  autoAdvancePlayer: true,
  startedAt: new Date().toISOString(),
  status: 'completed',
  settings: {
    recordIndividualDice: false,
    trackWinner: true,
    catanRobberTracking: true,
    catanResourceTracking: false,
    catanDevCardTracking: false,
  },
  schemaVersion: 3,
  ...overrides,
});

// ─── Registry ─────────────────────────────────────────────────────────────────

describe('mode registry', () => {
  it('resolves the catan adapter by game type', () => {
    expect(getModeAdapter('catan')).toBe(catanMode);
  });

  it('returns undefined for the modeless dice tracker', () => {
    // 'general' is not an error case — it is a session with no board at all.
    expect(getModeAdapter('general')).toBeUndefined();
  });

  it('resolves an adapter from a session', () => {
    expect(getSessionModeAdapter(baseSession())).toBe(catanMode);
    expect(getSessionModeAdapter(baseSession({ gameType: 'general' }))).toBeUndefined();
  });
});

// ─── Catan adapter ────────────────────────────────────────────────────────────

describe('catan adapter', () => {
  it('excludes 7 from the board numbers', () => {
    // 7 is rolled more often than any other number and produces nothing.
    // A mode that leaked it into boardNumbers would inflate expected
    // production for every player at the table.
    expect(catanMode.boardNumbers).not.toContain(7);
    expect(catanMode.boardNumbers).toEqual(CATAN_NUMBERS);
  });

  it('exposes probabilities matching the 2D6 distribution', () => {
    for (const n of catanMode.boardNumbers) {
      expect(catanMode.numberProbabilities[n]).toBe(CATAN_PROBS[n]);
    }
  });

  it('reports board state only for catan sessions', () => {
    expect(catanMode.hasBoardState(baseSession())).toBe(true);
    expect(catanMode.hasBoardState(baseSession({ gameType: 'general' }))).toBe(false);
  });

  it('returns no positions for a player with no events', () => {
    expect(catanMode.getPositionsAtTurn('nobody', 5, [])).toEqual([]);
    expect(catanMode.getBlockedNumbersAtTurn('nobody', 5, [])).toEqual([]);
  });
});

// ─── The invariant ────────────────────────────────────────────────────────────

describe('cross-mode code stays mode-agnostic', () => {
  // careerStats aggregates across every game someone has played. The moment it
  // imports Catan directly, a second board game silently drops out of career
  // totals rather than failing loudly.
  it('careerStats imports no Catan module', () => {
    const src = readFileSync(
      join(__dirname, '..', 'services', 'careerStats.ts'),
      'utf8',
    );
    const imports = src.match(/^import .*$/gm) ?? [];
    const offenders = imports.filter(line => /catan/i.test(line));
    expect(offenders).toEqual([]);
  });

  it('careerStats does not branch on a specific game type', () => {
    const src = readFileSync(
      join(__dirname, '..', 'services', 'careerStats.ts'),
      'utf8',
    );
    // Strip comments first — the explanatory ones legitimately name Catan.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/gameType\s*[=!]==?\s*['"]catan['"]/);
  });
});
