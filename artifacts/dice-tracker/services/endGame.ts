/**
 * endGame — shared end-game confirm logic used by active-game.tsx and
 * active-catan.tsx.
 *
 * Tries to persist the session as "completed"; navigates to /results
 * regardless of whether storage succeeds so the user is never trapped.
 */

import type { GameSession } from '@/types/models';

export interface EndGameDeps {
  updateSession: (session: GameSession) => Promise<void>;
  navigate: (path: string) => void;
}

/**
 * Mark the session as completed and navigate to the results screen.
 * If storage throws the navigation still fires — a storage failure is
 * treated as a non-fatal error.
 */
export async function confirmEndGame(
  activeSession: GameSession | null,
  deps: EndGameDeps,
): Promise<void> {
  if (!activeSession) return;
  try {
    await deps.updateSession({
      ...activeSession,
      status: 'completed' as const,
      endedAt: new Date().toISOString(),
    });
  } catch {
    // Storage error — navigate anyway so the user is never trapped.
  }
  deps.navigate('/results');
}
