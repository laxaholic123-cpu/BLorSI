/**
 * Catan's implementation of the game mode boundary.
 *
 * A thin adapter, on purpose. The real logic stays in `services/catanStats.ts`
 * — this exists so cross-mode consumers can reach it without importing anything
 * with "catan" in the name, and so the next board game has a worked example of
 * what it needs to supply.
 */

import type { BoardExposureEvent, BoardPosition } from '@/types/boardState';
import type { CatanPlayerExposureEvent } from '@/types/modes/catan';
import type { GameSession, Player, RollEvent } from '@/types/models';
import {
  CATAN_NUMBERS,
  CATAN_PROBS,
  getBuildingStatesAtTurn,
  getActiveRobberBlockedNumbers,
  computePlayerProductionStats,
} from '@/services/catanStats';
import type { GameModeAdapter, ModeProductionStats } from '@/services/modes/types';

/**
 * Narrow the boundary's event type to Catan's.
 *
 * Safe because the registry only hands an adapter events from a session whose
 * gameType selected that adapter — the objects really are Catan events. The
 * cast is confined to this file so the widening is visible in one place.
 */
const asCatan = (events: BoardExposureEvent[]): CatanPlayerExposureEvent[] =>
  events as CatanPlayerExposureEvent[];

export const catanMode: GameModeAdapter = {
  id: 'catan',
  label: 'Catan',

  /** 7 is absent: it moves the robber rather than producing. */
  boardNumbers: CATAN_NUMBERS,

  numberProbabilities: CATAN_PROBS,

  getPositionsAtTurn(
    playerId: string,
    turnNumber: number,
    events: BoardExposureEvent[],
  ): BoardPosition[] {
    return getBuildingStatesAtTurn(playerId, turnNumber, asCatan(events));
  },

  getBlockedNumbersAtTurn(
    playerId: string,
    turnNumber: number,
    events: BoardExposureEvent[],
  ): number[] {
    return getActiveRobberBlockedNumbers(playerId, turnNumber, asCatan(events));
  },

  getProductionStats(
    player: Player,
    rollEvents: RollEvent[],
    events: BoardExposureEvent[],
  ): ModeProductionStats {
    // Simulation deliberately left off: career aggregation runs this once per
    // player per session, and the percentile is not used in the aggregate.
    const stats = computePlayerProductionStats(player, rollEvents, asCatan(events));
    return {
      playerId: player.id,
      actual: stats.totalActualProduction,
      expected: stats.totalExpectedProduction,
    };
  },

  hasBoardState(session: GameSession): boolean {
    return session.gameType === 'catan';
  },
};
