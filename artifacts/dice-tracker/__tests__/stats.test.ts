/**
 * Unit tests for the statistics service.
 *
 * Covers: frequency counts, mean, median, mode, expected probabilities,
 * actual-vs-expected, per-player summaries, streaks, droughts (gaps),
 * nat-1/20 counts, doubles detection, 2D6 distribution, small-sample
 * warnings, verdict classification, and corrected events.
 */

import {
  TWO_D6_PROBS,
  computeAllStats,
  computeFrequencies,
  getExpectedMean,
  getExpectedProbabilities,
  getExpectedStdDev,
  getFrequencyMap,
  getLeastCommon,
  getLongestGap,
  getLongestStreak,
  getMean,
  getMeanZScore,
  getMedian,
  getMode,
  getPlayerSummary,
  SMALL_SAMPLE_THRESHOLD,
} from '../services/stats';
import { classifyVerdict } from '../services/verdict';
import type { GameSession, Player, RollEvent } from '../types/models';
import type { FrequencyEntry } from '../types/stats';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const makePlayer = (id: string, name = `Player ${id}`): Player => ({
  id,
  displayName: name,
  color: '#1ABC9C',
  seatNumber: 1,
  createdAt: '2024-01-01T00:00:00Z',
});

const makeSession = (
  overrides: Partial<GameSession> = {},
): GameSession => ({
  id: 'sess1',
  gameType: 'general',
  diceMode: 'D6',
  minimumRoll: 1,
  maximumRoll: 6,
  players: [makePlayer('p1')],
  currentPlayerIndex: 0,
  autoAdvancePlayer: false,
  startedAt: '2024-01-01T00:00:00Z',
  endedAt: '2024-01-01T01:00:00Z',
  status: 'completed',
  winnerPlayerId: undefined,
  placements: [],
  settings: {
    recordIndividualDice: false,
    trackWinner: false,
    trackPlacements: false,
    catanRobberTracking: false,
    catanResourceTracking: false,
  },
  schemaVersion: 1,
  ...overrides,
});

let seq = 0;
const makeEvent = (
  value: number,
  playerId = 'p1',
  sessionId = 'sess1',
  overrides: Partial<RollEvent> = {},
): RollEvent => ({
  id: `evt${++seq}`,
  sessionId,
  playerId,
  value,
  turnNumber: 1,
  sequenceNumber: seq,
  timestamp: '2024-01-01T00:00:00Z',
  source: 'touchscreen',
  ...overrides,
});

beforeEach(() => { seq = 0; });

// ─── 2D6 probability table ────────────────────────────────────────────────────

describe('TWO_D6_PROBS', () => {
  it('has exactly 11 entries (values 2–12)', () => {
    expect(Object.keys(TWO_D6_PROBS).length).toBe(11);
  });

  it('probabilities sum to 1', () => {
    const total = Object.values(TWO_D6_PROBS).reduce((s, p) => s + p, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('peak is at 7 (6/36)', () => {
    expect(TWO_D6_PROBS[7]).toBeCloseTo(6 / 36, 10);
  });

  it('value 2 has probability 1/36', () => {
    expect(TWO_D6_PROBS[2]).toBeCloseTo(1 / 36, 10);
  });

  it('value 12 has probability 1/36', () => {
    expect(TWO_D6_PROBS[12]).toBeCloseTo(1 / 36, 10);
  });

  it('is symmetric: P(7−k) === P(7+k) for k=1..5', () => {
    for (let k = 1; k <= 5; k++) {
      expect(TWO_D6_PROBS[7 - k]).toBeCloseTo(TWO_D6_PROBS[7 + k]!, 10);
    }
  });
});

// ─── getExpectedProbabilities ─────────────────────────────────────────────────

describe('getExpectedProbabilities', () => {
  it('uniform D6: each value gets 1/6', () => {
    const probs = getExpectedProbabilities('D6', 1, 6);
    for (let v = 1; v <= 6; v++) {
      expect(probs[v]).toBeCloseTo(1 / 6, 10);
    }
  });

  it('uniform D20: each value gets 1/20', () => {
    const probs = getExpectedProbabilities('D20', 1, 20);
    expect(Object.keys(probs).length).toBe(20);
    for (let v = 1; v <= 20; v++) {
      expect(probs[v]).toBeCloseTo(1 / 20, 10);
    }
  });

  it('2D6: returns the TWO_D6_PROBS table', () => {
    const probs = getExpectedProbabilities('2D6', 2, 12);
    expect(probs[7]).toBeCloseTo(6 / 36, 10);
    expect(probs[2]).toBeCloseTo(1 / 36, 10);
  });

  it('custom range: uniform over [3, 7]', () => {
    const probs = getExpectedProbabilities('custom', 3, 7);
    for (let v = 3; v <= 7; v++) {
      expect(probs[v]).toBeCloseTo(1 / 5, 10);
    }
  });
});

// ─── Expected mean & std dev ──────────────────────────────────────────────────

describe('getExpectedMean', () => {
  it('D6 expected mean is 3.5', () => {
    expect(getExpectedMean('D6', 1, 6)).toBe(3.5);
  });

  it('2D6 expected mean is 7', () => {
    expect(getExpectedMean('2D6', 2, 12)).toBe(7);
  });

  it('D20 expected mean is 10.5', () => {
    expect(getExpectedMean('D20', 1, 20)).toBe(10.5);
  });
});

describe('getExpectedStdDev', () => {
  it('D6 std dev ≈ 1.708', () => {
    expect(getExpectedStdDev('D6', 1, 6)).toBeCloseTo(Math.sqrt(35 / 12), 5);
  });

  it('2D6 std dev ≈ 2.415', () => {
    expect(getExpectedStdDev('2D6', 2, 12)).toBeCloseTo(Math.sqrt(35 / 6), 5);
  });
});

// ─── getMean ─────────────────────────────────────────────────────────────────

describe('getMean', () => {
  it('returns null for empty array', () => {
    expect(getMean([])).toBeNull();
  });

  it('single value', () => {
    expect(getMean([4])).toBe(4);
  });

  it('average of [1, 2, 3, 4, 5, 6]', () => {
    expect(getMean([1, 2, 3, 4, 5, 6])).toBeCloseTo(3.5, 10);
  });
});

// ─── getMedian ───────────────────────────────────────────────────────────────

describe('getMedian', () => {
  it('returns null for empty array', () => {
    expect(getMedian([])).toBeNull();
  });

  it('odd count: middle value', () => {
    expect(getMedian([1, 3, 5])).toBe(3);
  });

  it('even count: average of two middle values', () => {
    expect(getMedian([1, 2, 3, 4])).toBe(2.5);
  });

  it('unsorted input is handled', () => {
    expect(getMedian([5, 1, 3])).toBe(3);
  });
});

// ─── getFrequencyMap ─────────────────────────────────────────────────────────

describe('getFrequencyMap', () => {
  it('empty array returns empty map', () => {
    expect(getFrequencyMap([])).toEqual({});
  });

  it('counts correctly', () => {
    expect(getFrequencyMap([1, 2, 2, 3, 3, 3])).toEqual({ 1: 1, 2: 2, 3: 3 });
  });
});

// ─── computeFrequencies ───────────────────────────────────────────────────────

describe('computeFrequencies', () => {
  it('produces one entry per value in [min, max]', () => {
    const probs = getExpectedProbabilities('D4', 1, 4);
    const entries = computeFrequencies([1, 1, 2, 4], 1, 4, probs);
    expect(entries.length).toBe(4);
  });

  it('expectedCount = probability × totalRolls', () => {
    const probs = getExpectedProbabilities('D6', 1, 6);
    const entries = computeFrequencies([1, 2, 3, 4, 5, 6], 1, 6, probs);
    for (const e of entries) {
      expect(e.expectedCount).toBeCloseTo((1 / 6) * 6, 10);
    }
  });

  it('deviation = count − expectedCount', () => {
    const probs = getExpectedProbabilities('D6', 1, 6);
    const entries = computeFrequencies([1, 1, 1, 1, 1, 1], 1, 6, probs);
    const entry1 = entries.find(e => e.value === 1)!;
    expect(entry1.deviation).toBeCloseTo(6 - 1, 5); // 6 actual, ~1 expected
  });

  it('2D6 expected counts sum to totalRolls', () => {
    const probs = getExpectedProbabilities('2D6', 2, 12);
    const values = Array.from({ length: 36 }, (_, i) => (i % 11) + 2);
    const entries = computeFrequencies(values, 2, 12, probs);
    const totalExpected = entries.reduce((s, e) => s + e.expectedCount, 0);
    expect(totalExpected).toBeCloseTo(36, 5);
  });
});

// ─── getMode ─────────────────────────────────────────────────────────────────

describe('getMode', () => {
  it('returns empty array when nothing rolled', () => {
    const probs = getExpectedProbabilities('D6', 1, 6);
    const entries = computeFrequencies([], 1, 6, probs);
    expect(getMode(entries)).toEqual([]);
  });

  it('single most common value', () => {
    const probs = getExpectedProbabilities('D6', 1, 6);
    const entries = computeFrequencies([3, 3, 3, 1, 2], 1, 6, probs);
    expect(getMode(entries)).toEqual([3]);
  });

  it('ties return all tied values', () => {
    const probs = getExpectedProbabilities('D6', 1, 6);
    const entries = computeFrequencies([1, 1, 2, 2], 1, 6, probs);
    expect(getMode(entries)).toEqual(expect.arrayContaining([1, 2]));
    expect(getMode(entries).length).toBe(2);
  });
});

// ─── getLeastCommon ───────────────────────────────────────────────────────────

describe('getLeastCommon', () => {
  it('returns empty when nothing rolled', () => {
    const probs = getExpectedProbabilities('D6', 1, 6);
    const entries = computeFrequencies([], 1, 6, probs);
    expect(getLeastCommon(entries)).toEqual([]);
  });

  it('ignores values that were never rolled', () => {
    const probs = getExpectedProbabilities('D6', 1, 6);
    const entries = computeFrequencies([1, 1, 2], 1, 6, probs);
    // 3-6 have count 0 and should be excluded; 2 (count 1) < 1 (count 2) so 2 is least
    expect(getLeastCommon(entries)).toEqual([2]);
  });
});

// ─── getLongestStreak ─────────────────────────────────────────────────────────

describe('getLongestStreak', () => {
  it('returns null for empty array', () => {
    expect(getLongestStreak([])).toBeNull();
  });

  it('returns null when no repeated consecutive value', () => {
    expect(getLongestStreak([1, 2, 3])).toBeNull();
  });

  it('detects a streak of 3', () => {
    const result = getLongestStreak([1, 2, 2, 2, 3]);
    expect(result).toEqual({ value: 2, length: 3 });
  });

  it('picks the longest when multiple streaks', () => {
    const result = getLongestStreak([1, 1, 2, 2, 2, 3, 3]);
    expect(result).toEqual({ value: 2, length: 3 });
  });
});

// ─── getLongestGap ────────────────────────────────────────────────────────────

describe('getLongestGap', () => {
  it('returns null for empty array', () => {
    expect(getLongestGap([], 1, 6)).toBeNull();
  });

  it('returns null when only one roll', () => {
    expect(getLongestGap([3], 1, 6)).toBeNull();
  });

  it('finds a gap of 3 for value 1', () => {
    // 1 appears at index 0, then not again until index 4 — gap of 3 rolls (2,3,4)
    const result = getLongestGap([1, 2, 3, 4, 1], 1, 6);
    expect(result?.value).toBe(1);
    expect(result?.longestGap).toBe(3);
  });

  it('ignores values that appear only once (gap after first occurrence needs second)', () => {
    // value 6 never repeats → its gap should NOT be reported
    const result = getLongestGap([1, 2, 3, 6], 1, 6);
    // Gap is measured between appearances; 6 only appears once so no gap
    expect(result?.value).not.toBe(6);
  });
});

// ─── getMeanZScore ────────────────────────────────────────────────────────────

describe('getMeanZScore', () => {
  it('returns null for fewer than 2 rolls', () => {
    expect(getMeanZScore(3.5, 'D6', 1, 6, 1)).toBeNull();
  });

  it('returns 0 when mean equals expected mean', () => {
    const z = getMeanZScore(3.5, 'D6', 1, 6, 100);
    expect(z).toBeCloseTo(0, 5);
  });

  it('negative z-score when mean is below expected', () => {
    const z = getMeanZScore(2.0, 'D6', 1, 6, 100);
    expect(z).toBeLessThan(0);
  });

  it('positive z-score when mean is above expected', () => {
    const z = getMeanZScore(5.0, 'D6', 1, 6, 100);
    expect(z).toBeGreaterThan(0);
  });
});

// ─── Small sample ─────────────────────────────────────────────────────────────

describe('small sample', () => {
  it('threshold is 30', () => {
    expect(SMALL_SAMPLE_THRESHOLD).toBe(30);
  });

  it('isSmallSample is true when fewer than 30 rolls', () => {
    const session = makeSession();
    const events = Array.from({ length: 10 }, (_, i) => makeEvent((i % 6) + 1));
    const stats = computeAllStats(session, events);
    expect(stats.isSmallSample).toBe(true);
    expect(stats.verdict).toBe('too_early');
  });

  it('isSmallSample is false at 30+ rolls', () => {
    const session = makeSession();
    // Perfectly uniform D6 distribution × 5 = 30 rolls
    const events = Array.from({ length: 30 }, (_, i) => makeEvent((i % 6) + 1));
    const stats = computeAllStats(session, events);
    expect(stats.isSmallSample).toBe(false);
  });
});

// ─── Per-player summary ───────────────────────────────────────────────────────

describe('getPlayerSummary', () => {
  it('rollCount matches events for that player', () => {
    const events = [makeEvent(3), makeEvent(4), makeEvent(5)];
    const summary = getPlayerSummary(events, makePlayer('p1'), 'D6');
    expect(summary.rollCount).toBe(3);
  });

  it('nat1Count and nat20Count for D20', () => {
    const events = [makeEvent(1), makeEvent(20), makeEvent(20), makeEvent(7)];
    const summary = getPlayerSummary(events, makePlayer('p1'), 'D20');
    expect(summary.nat1Count).toBe(1);
    expect(summary.nat20Count).toBe(2);
  });

  it('nat1Count is 0 for non-D20 modes', () => {
    const events = [makeEvent(1), makeEvent(1)];
    const summary = getPlayerSummary(events, makePlayer('p1'), 'D6');
    expect(summary.nat1Count).toBe(0);
  });

  it('doublesCount uses individualDiceValues', () => {
    const events = [
      makeEvent(4, 'p1', 'sess1', { individualDiceValues: [2, 2] }),
      makeEvent(7, 'p1', 'sess1', { individualDiceValues: [3, 4] }),
      makeEvent(6, 'p1', 'sess1', { individualDiceValues: [3, 3] }),
    ];
    const summary = getPlayerSummary(events, makePlayer('p1'), '2D6');
    expect(summary.doublesCount).toBe(2);
  });

  it('doublesCount is 0 when not 2D6 mode', () => {
    const events = [makeEvent(2, 'p1', 'sess1', { individualDiceValues: [1, 1] })];
    const summary = getPlayerSummary(events, makePlayer('p1'), 'D6');
    expect(summary.doublesCount).toBe(0);
  });

  it('per-player summary ignores other players events', () => {
    const events = [makeEvent(3, 'p1'), makeEvent(6, 'p2'), makeEvent(5, 'p1')];
    const summary = getPlayerSummary(events, makePlayer('p1'), 'D6');
    expect(summary.rollCount).toBe(2);
  });
});

// ─── Corrected events ─────────────────────────────────────────────────────────

describe('corrected events (soft-deleted)', () => {
  it('deletedAt events are excluded from stats', () => {
    const session = makeSession();
    const deleted = makeEvent(1, 'p1', 'sess1', {
      deletedAt: '2024-01-01T00:01:00Z',
    });
    const active = makeEvent(6);
    const stats = computeAllStats(session, [deleted, active]);
    expect(stats.totalRolls).toBe(1);
    expect(stats.mean).toBe(6);
  });

  it('corrected event replaces original in active set', () => {
    const session = makeSession();
    const original = makeEvent(1, 'p1', 'sess1', {
      deletedAt: '2024-01-01T00:01:00Z',
    });
    const correction = makeEvent(6, 'p1', 'sess1', {
      source: 'corrected',
      correctionOfEventId: original.id,
    });
    const stats = computeAllStats(session, [original, correction]);
    expect(stats.totalRolls).toBe(1);
    expect(stats.mean).toBe(6);
  });
});

// ─── Verdict classification ───────────────────────────────────────────────────

describe('classifyVerdict', () => {
  it('too_early when small sample', () => {
    expect(classifyVerdict(10, -2.5, true, false)).toBe('too_early');
  });

  it('bad_luck when z < -1.0', () => {
    expect(classifyVerdict(100, -1.5, false, false)).toBe('bad_luck');
  });

  it('bad_luck_and_skill_issue when z < -2.0 and multiplayer', () => {
    expect(classifyVerdict(100, -2.5, false, true)).toBe('bad_luck_and_skill_issue');
  });

  it('suspiciously_lucky when z > 1.5', () => {
    expect(classifyVerdict(100, 2.0, false, false)).toBe('suspiciously_lucky');
  });

  it('cleared_of_wrongdoing when |z| < 0.3', () => {
    expect(classifyVerdict(100, 0.1, false, false)).toBe('cleared_of_wrongdoing');
  });

  it('skill_issue when |z| < 1.0 and multiplayer', () => {
    expect(classifyVerdict(100, 0.5, false, true)).toBe('skill_issue');
  });

  it('dice_were_fair when |z| < 1.0 and single player', () => {
    expect(classifyVerdict(100, 0.6, false, false)).toBe('dice_were_fair');
  });

  it('mixed_evidence when z ≈ 1.2', () => {
    expect(classifyVerdict(100, 1.2, false, false)).toBe('mixed_evidence');
  });
});

// ─── computeAllStats integration ─────────────────────────────────────────────

describe('computeAllStats', () => {
  it('totalRolls matches active events', () => {
    const session = makeSession();
    const events = [makeEvent(3), makeEvent(5), makeEvent(5, 'p1', 'sess1', { deletedAt: '2024-01-01T00:01:00Z' })];
    const stats = computeAllStats(session, events);
    expect(stats.totalRolls).toBe(2); // deleted excluded
  });

  it('frequencies cover all values from min to max', () => {
    const session = makeSession(); // D6
    const events = [makeEvent(3)];
    const stats = computeAllStats(session, events);
    expect(stats.frequencies.length).toBe(6);
    expect(stats.frequencies.map(f => f.value)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('player summaries have one entry per player', () => {
    const session = makeSession({
      players: [makePlayer('p1'), makePlayer('p2')],
    });
    const events = [makeEvent(3, 'p1'), makeEvent(5, 'p2')];
    const stats = computeAllStats(session, events);
    expect(stats.playerSummaries.length).toBe(2);
  });

  it('2D6 expectedMean is 7', () => {
    const session = makeSession({ diceMode: '2D6', minimumRoll: 2, maximumRoll: 12 });
    const events = [makeEvent(7)];
    const stats = computeAllStats(session, events);
    expect(stats.expectedMean).toBe(7);
  });

  it('nat1Count and nat20Count only set for D20', () => {
    const session = makeSession({ diceMode: 'D20', minimumRoll: 1, maximumRoll: 20 });
    const events = [makeEvent(1), makeEvent(20), makeEvent(20)];
    const stats = computeAllStats(session, events);
    expect(stats.nat1Count).toBe(1);
    expect(stats.nat20Count).toBe(2);
  });

  it('D6 nat counts are 0', () => {
    const session = makeSession();
    const events = [makeEvent(1), makeEvent(6)];
    const stats = computeAllStats(session, events);
    expect(stats.nat1Count).toBe(0);
    expect(stats.nat20Count).toBe(0);
  });

  it('durationSeconds computed from startedAt/endedAt', () => {
    const session = makeSession({
      startedAt: '2024-01-01T00:00:00Z',
      endedAt: '2024-01-01T00:05:00Z',
    });
    const events = [makeEvent(3)];
    const stats = computeAllStats(session, events);
    expect(stats.durationSeconds).toBe(300);
  });

  it('verdict headline and explanation are non-empty strings', () => {
    const session = makeSession();
    const events = Array.from({ length: 30 }, (_, i) => makeEvent((i % 6) + 1));
    const stats = computeAllStats(session, events);
    expect(typeof stats.verdictHeadline).toBe('string');
    expect(stats.verdictHeadline.length).toBeGreaterThan(0);
    expect(typeof stats.verdictExplanation).toBe('string');
    expect(stats.verdictExplanation.length).toBeGreaterThan(0);
  });

  it('uniform D6 across many rolls → cleared_of_wrongdoing or dice_were_fair', () => {
    const session = makeSession();
    // 60 perfectly uniform rolls — very close to expected
    const events = Array.from({ length: 60 }, (_, i) => makeEvent((i % 6) + 1));
    const stats = computeAllStats(session, events);
    expect(['cleared_of_wrongdoing', 'dice_were_fair']).toContain(stats.verdict);
  });

  it('very low rolls → bad_luck verdict', () => {
    const session = makeSession();
    // 50 rolls all of value 1 — far below D6 mean of 3.5
    const events = Array.from({ length: 50 }, () => makeEvent(1));
    const stats = computeAllStats(session, events);
    expect(stats.verdict).toBe('bad_luck');
  });

  it('very high rolls → suspiciously_lucky verdict', () => {
    const session = makeSession();
    // 50 rolls all of value 6 — far above D6 mean
    const events = Array.from({ length: 50 }, () => makeEvent(6));
    const stats = computeAllStats(session, events);
    expect(stats.verdict).toBe('suspiciously_lucky');
  });
});
