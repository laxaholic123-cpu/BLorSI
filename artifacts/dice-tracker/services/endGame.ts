/**
 * endGame — shared end-game confirm logic used by active-game.tsx and
 * active-catan.tsx.
 *
 * Marks the session completed and navigates to /results. Navigation happens
 * whether or not the write succeeds, so a storage failure can never trap the
 * player on the game screen.
 */

import type { GameSession } from '@/types/models';

export interface EndGameDeps {
  updateSession: (session: GameSession) => Promise<void>;
  navigate: (path: string) => void;
  /**
   * Told when the session could not be marked completed. Optional so existing
   * callers keep working, but callers that can show a message should pass it —
   * see the note in confirmEndGame.
   */
  onPersistError?: (message: string) => void;
}

const PERSIST_ERROR_MESSAGE =
  'Your results are shown below, but this game could not be marked finished on ' +
  'this device. It may reappear as an active game next time you open the app.';

/**
 * Mark the session as completed and navigate to the results screen.
 *
 * A storage failure here is non-fatal but NOT harmless: the session keeps its
 * "active" status, so the next launch offers to resume a game the player
 * considers over, and any further rolls land in a session whose results they
 * have already seen. The original code swallowed that silently — the player was
 * no longer trapped, but they also had no idea anything had gone wrong. It is
 * reported now so the surprise on next launch is explainable.
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
    // Never rethrow — navigation below must happen regardless.
    deps.onPersistError?.(PERSIST_ERROR_MESSAGE);
  }
  deps.navigate('/results');
}
