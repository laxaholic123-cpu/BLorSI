/**
 * Game mode registry.
 *
 * The single place that knows which modes exist. Adding a board game means
 * adding its id to `GameModeId`, writing an adapter, and registering it here —
 * nothing in the core stats path should need editing.
 *
 * `getModeAdapter` returns undefined for 'general', which is the modeless dice
 * tracker and has no board state. Callers treat that as "no board", not as an
 * error.
 */

import type { GameModeId, GameSession, GameType } from '@/types/models';
import type { GameModeAdapter } from '@/services/modes/types';
import { catanMode } from '@/services/modes/catanMode';

const ADAPTERS: Record<GameModeId, GameModeAdapter> = {
  catan: catanMode,
};

/** The adapter for a game type, or undefined when the mode has no board. */
export function getModeAdapter(
  gameType: GameType,
): GameModeAdapter | undefined {
  return gameType === 'general' ? undefined : ADAPTERS[gameType];
}

/** The adapter for a session, or undefined when it carries no board state. */
export function getSessionModeAdapter(
  session: GameSession,
): GameModeAdapter | undefined {
  return getModeAdapter(session.gameType);
}

export type { GameModeAdapter, ModeProductionStats } from '@/services/modes/types';
export { catanMode };
