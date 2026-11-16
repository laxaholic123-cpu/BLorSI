/**
 * Whose turn is it to BUILD?
 *
 * Not the same question as "who rolls next", and treating them as one was a
 * real bug. With auto-advance on, the session moves to the next player the
 * moment a roll is saved — but in Catan you roll first and build afterwards, so
 * for the whole build phase the session is already pointing at the wrong
 * person. Build menus opened from the game screen preselected the next player,
 * and a "building makes it your turn" rule then handed the turn back to the
 * builder, who would have rolled twice.
 *
 * The player on turn is the one who threw the last roll, until the next roll.
 * Two cases fall back to the session's current player: nothing has been rolled
 * yet, and somebody has moved the turn by hand since the last roll (Prev/Next),
 * which is an explicit statement that overrides the inference.
 */

import type { GameSession, Player, RollEvent } from '@/types/models';

export function playerOnTurn(
  session: Pick<GameSession, 'players' | 'currentPlayerIndex' | 'autoAdvancePlayer'>,
  rollEvents: readonly RollEvent[],
): Player | null {
  const current = session.players[session.currentPlayerIndex] ?? null;
  if (!session.autoAdvancePlayer || session.players.length < 2) return current;

  let last: RollEvent | null = null;
  for (const r of rollEvents) {
    if (r.deletedAt) continue;
    if (!last || r.sequenceNumber > last.sequenceNumber) last = r;
  }
  if (!last) return current;

  const rollerIndex = session.players.findIndex(p => p.id === last!.playerId);
  if (rollerIndex < 0) return current;
  // Auto-advance leaves the session exactly one seat past the roller. Anything
  // else means the turn was moved by hand, and that choice stands.
  const advanced = (rollerIndex + 1) % session.players.length;
  return session.currentPlayerIndex === advanced ? session.players[rollerIndex]! : current;
}
