/**
 * Career statistics service.
 *
 * All functions are pure — no side effects, no storage calls, no UI imports.
 * Aggregates per-session data into cross-session career insights.
 *
 * Player identity across sessions is resolved by displayName (lowercased),
 * since the app has no persistent user accounts.
 */

import type { CatanPlayerExposureEvent, GameSession, RollEvent } from '@/types/models';
import {
  getBuildingStatesAtTurn,
  getActiveRobberBlockedNumbers,
  computePlayerProductionStats,
  CATAN_PROBS,
} from '@/services/catanStats';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum sessions before career trends are surfaced */
export const CAREER_MIN_SESSIONS = 3;

/** Minimum shared Catan sessions to show a head-to-head record */
export const HEAD_TO_HEAD_MIN_SESSIONS = 2;

/** Luck% difference threshold — within this range is a "tie" */
const TIE_THRESHOLD_PCT = 5;

const CATAN_NUMBERS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12] as const;

// ─── Output types ─────────────────────────────────────────────────────────────

export interface CareerSummary {
  totalSessions: number;
  completedSessions: number;
  totalRolls: number;
  catanSessions: number;
  /** True when enough sessions exist to surface meaningful career trends */
  hasEnoughData: boolean;
}

/**
 * Lifetime production luck for a single dice number across all Catan sessions.
 * Aggregated over all players on the device.
 */
export interface CatanNumberCareerStat {
  number: number;
  /** Sum of expected weighted production across all contributing sessions */
  totalExpected: number;
  /** Sum of actual weighted production received */
  totalActual: number;
  /** (actual − expected) / expected × 100 */
  luckPct: number;
  /** How many distinct sessions contributed to this stat */
  sessionCount: number;
}

/**
 * Career head-to-head record between two recurring players.
 * Only built for pairs who share ≥ HEAD_TO_HEAD_MIN_SESSIONS Catan sessions
 * with exposure data.
 */
export interface HeadToHeadRecord {
  /** Canonical display name (lowercase key; original casing preserved below) */
  nameA: string;
  nameB: string;
  sharedSessions: number;
  /** Sessions where A's luck% exceeded B's by > TIE_THRESHOLD_PCT */
  winsA: number;
  winsB: number;
  ties: number;
  /**
   * A's average luck% minus B's average luck% across shared sessions.
   * Positive → A tends to be luckier; negative → B tends to be luckier.
   */
  avgLuckDiffA: number;
}

export interface CareerStats {
  summary: CareerSummary;
  /**
   * Per-number lifetime production performance, sorted luckiest first.
   * Null when no Catan sessions with exposure data exist.
   */
  numberStats: CatanNumberCareerStat[] | null;
  /** Head-to-head records for recurring player pairs, sorted by most sessions */
  headToHead: HeadToHeadRecord[];
}

// ─── Number career stats ──────────────────────────────────────────────────────

function computeNumberCareerStats(
  sessions: GameSession[],
  rollsBySession: Record<string, RollEvent[]>,
  exposuresBySession: Record<string, CatanPlayerExposureEvent[]>,
): CatanNumberCareerStat[] | null {
  // Accumulate expected/actual production per number across all sessions/players
  const acc: Record<
    number,
    { expected: number; actual: number; sessionIds: Set<string> }
  > = {};
  for (const n of CATAN_NUMBERS) {
    acc[n] = { expected: 0, actual: 0, sessionIds: new Set() };
  }

  let hasData = false;

  for (const session of sessions) {
    if (session.gameType !== 'catan') continue;
    const rollEvents = rollsBySession[session.id] ?? [];
    const exposureEvents = exposuresBySession[session.id] ?? [];
    if (exposureEvents.length === 0) continue;

    const activeRolls = rollEvents.filter(r => !r.deletedAt);
    if (activeRolls.length === 0) continue;

    hasData = true;

    for (const player of session.players) {
      const playerExposures = exposureEvents.filter(e => e.playerId === player.id);
      if (playerExposures.length === 0) continue;

      for (const roll of activeRolls) {
        const T = roll.turnNumber;
        const V = roll.value;
        if (V === 7) continue; // 7 never triggers production

        const buildings = getBuildingStatesAtTurn(player.id, T, playerExposures);
        const blockedNums = getActiveRobberBlockedNumbers(player.id, T, playerExposures);

        for (const bldg of buildings) {
          for (const n of bldg.affectedNumbers) {
            if (!CATAN_NUMBERS.includes(n as typeof CATAN_NUMBERS[number])) continue;
            const entry = acc[n];
            if (!entry) continue;

            if (!blockedNums.includes(n)) {
              // Expected contribution this turn
              entry.expected += (CATAN_PROBS[n] ?? 0) * bldg.productionWeight;
              // Actual production if the roll matched
              if (V === n) {
                entry.actual += bldg.productionWeight;
              }
            }
            entry.sessionIds.add(session.id);
          }
        }
      }
    }
  }

  if (!hasData) return null;

  const stats: CatanNumberCareerStat[] = CATAN_NUMBERS
    .map(n => {
      const { expected, actual, sessionIds } = acc[n]!;
      const luckPct = expected > 0
        ? ((actual - expected) / expected) * 100
        : 0;
      return {
        number: n,
        totalExpected: expected,
        totalActual: actual,
        luckPct,
        sessionCount: sessionIds.size,
      };
    })
    .filter(s => s.totalExpected > 0) // only numbers with any exposure
    .sort((a, b) => b.luckPct - a.luckPct); // luckiest first

  return stats.length > 0 ? stats : null;
}

// ─── Head-to-head ─────────────────────────────────────────────────────────────

function computeHeadToHead(
  sessions: GameSession[],
  rollsBySession: Record<string, RollEvent[]>,
  exposuresBySession: Record<string, CatanPlayerExposureEvent[]>,
): HeadToHeadRecord[] {
  // Session-level pair data accumulator
  const pairMap = new Map<
    string,
    {
      nameA: string;
      nameB: string;
      winsA: number;
      winsB: number;
      ties: number;
      luckSumA: number;
      luckSumB: number;
      count: number;
    }
  >();

  for (const session of sessions) {
    if (session.gameType !== 'catan') continue;
    if (session.status !== 'completed') continue;
    if (session.players.length < 2) continue;

    const rollEvents = rollsBySession[session.id] ?? [];
    const exposureEvents = exposuresBySession[session.id] ?? [];
    if (exposureEvents.length === 0) continue;

    // Compute luck% for each player in this session
    const luckByKey = new Map<string, number>();
    for (const player of session.players) {
      const stats = computePlayerProductionStats(player, rollEvents, exposureEvents);
      if (stats.totalExpectedProduction > 0) {
        luckByKey.set(player.displayName.toLowerCase(), stats.productionLuckPct);
      }
    }
    if (luckByKey.size < 2) continue;

    const keys = [...luckByKey.keys()];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const rawA = keys[i]!;
        const rawB = keys[j]!;
        const luckA = luckByKey.get(rawA)!;
        const luckB = luckByKey.get(rawB)!;

        // Canonical alphabetical order for stable pair key
        const [keyA, keyB] = rawA < rawB ? [rawA, rawB] : [rawB, rawA];
        const [lA, lB] = rawA < rawB ? [luckA, luckB] : [luckB, luckA];

        const pairKey = `${keyA}|||${keyB}`;
        const rec = pairMap.get(pairKey) ?? {
          nameA: keyA,
          nameB: keyB,
          winsA: 0, winsB: 0, ties: 0,
          luckSumA: 0, luckSumB: 0, count: 0,
        };

        const diff = lA - lB;
        if (diff > TIE_THRESHOLD_PCT) rec.winsA++;
        else if (diff < -TIE_THRESHOLD_PCT) rec.winsB++;
        else rec.ties++;

        rec.luckSumA += lA;
        rec.luckSumB += lB;
        rec.count++;
        pairMap.set(pairKey, rec);
      }
    }
  }

  const records: HeadToHeadRecord[] = [];
  for (const rec of pairMap.values()) {
    if (rec.count < HEAD_TO_HEAD_MIN_SESSIONS) continue;
    records.push({
      nameA: rec.nameA,
      nameB: rec.nameB,
      sharedSessions: rec.count,
      winsA: rec.winsA,
      winsB: rec.winsB,
      ties: rec.ties,
      avgLuckDiffA: rec.count > 0
        ? (rec.luckSumA - rec.luckSumB) / rec.count
        : 0,
    });
  }

  return records.sort((a, b) => b.sharedSessions - a.sharedSessions);
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Compute cross-session career statistics.
 *
 * Pure function — takes pre-loaded data, returns derived stats.
 * Safe to call with sparse data (missing roll/exposure maps are treated as empty).
 */
export function computeCareerStats(
  sessions: GameSession[],
  rollsBySession: Record<string, RollEvent[]>,
  exposuresBySession: Record<string, CatanPlayerExposureEvent[]>,
): CareerStats {
  const completedSessions = sessions.filter(s => s.status === 'completed').length;
  const catanSessions = sessions.filter(s => s.gameType === 'catan').length;
  const totalRolls = Object.values(rollsBySession).reduce(
    (sum, rolls) => sum + rolls.filter(r => !r.deletedAt).length,
    0,
  );

  const summary: CareerSummary = {
    totalSessions: sessions.length,
    completedSessions,
    totalRolls,
    catanSessions,
    hasEnoughData: sessions.length >= CAREER_MIN_SESSIONS,
  };

  const numberStats = computeNumberCareerStats(sessions, rollsBySession, exposuresBySession);
  const headToHead = computeHeadToHead(sessions, rollsBySession, exposuresBySession);

  return { summary, numberStats, headToHead };
}
