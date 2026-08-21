/**
 * The game mode boundary.
 *
 * Everything a cross-mode consumer needs from a game with a board, expressed
 * without naming one. Career stats, luck and accolades go through this; they
 * must not import from `services/catan*` or `types/modes/*` directly.
 *
 * The rule for what belongs here: if a second board game would answer the
 * question differently, it is an adapter method. If it would answer it the same
 * way, it belongs in the core and not here at all.
 */

import type { BoardExposureEvent, BoardPosition } from '@/types/boardState';
import type { GameModeId, GameSession, Player, RollEvent } from '@/types/models';

/**
 * Per-player production, in mode-agnostic terms.
 *
 * Modes compute far more than this (Catan tracks ports, robber losses and
 * resource splits). This is the subset every mode can supply and every
 * cross-mode consumer can read.
 */
export interface ModeProductionStats {
  playerId: string;
  /** Production actually received, in the mode's weight units */
  actual: number;
  /** Production expected from the dice actually rolled, same units */
  expected: number;
}

/**
 * Deliberately not generic over the event type.
 *
 * A registry of adapters with differing event types forces every consumer to
 * carry a type parameter it cannot resolve — the session's mode is only known
 * at runtime. So the boundary speaks `BoardExposureEvent`, and each mode
 * narrows to its own event exactly once, inside its own adapter, where the cast
 * is visible and can be explained. The runtime data really is that mode's
 * events; only the static type widens.
 */
export interface GameModeAdapter {
  id: GameModeId;
  /** Human-readable, for UI that lists modes */
  label: string;

  /**
   * Dice numbers this mode's board can expose a player to, in order.
   *
   * Not the same as the dice range: Catan rolls 2D6 but 7 moves the robber
   * rather than producing, so 7 is absent here. A mode where every face
   * produces would list them all.
   */
  boardNumbers: readonly number[];

  /** Probability of each board number on this mode's dice. */
  numberProbabilities: Readonly<Record<number, number>>;

  /** Positions a player holds at a given turn. */
  getPositionsAtTurn(
    playerId: string,
    turnNumber: number,
    events: BoardExposureEvent[],
  ): BoardPosition[];

  /**
   * Numbers currently blocked for a player at a turn.
   *
   * Catan's robber is the first instance; the concept (a number a player is
   * exposed to but temporarily earns nothing from) is not Catan-specific, which
   * is why it is a method rather than a flag on the event.
   */
  getBlockedNumbersAtTurn(
    playerId: string,
    turnNumber: number,
    events: BoardExposureEvent[],
  ): number[];

  /** Production stats for one player, reduced to the cross-mode subset. */
  getProductionStats(
    player: Player,
    rollEvents: RollEvent[],
    events: BoardExposureEvent[],
  ): ModeProductionStats;

  /** True when this session carries board state worth aggregating. */
  hasBoardState(session: GameSession): boolean;
}
