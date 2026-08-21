/**
 * Board state — the mode-agnostic half of a game with a board.
 *
 * Catan is the first mode to use this, not the only intended one. Anything here
 * must make sense for any game where players hold positions that are exposed to
 * dice numbers over time; anything that only makes sense for Catan belongs in
 * `types/modes/catan.ts` instead.
 */

/**
 * A player's exposure to dice numbers at a point in the game.
 *
 * Deliberately narrower than any single mode's event. It carries only what a
 * cross-mode consumer (career stats, luck, accolades) can reason about without
 * knowing the game: who, when, which numbers, and how heavily.
 *
 * Two fields present on Catan's version are absent on purpose:
 *
 *   - `eventType` — every mode has its own vocabulary of building actions.
 *   - `robberBlocked` — "blocked" is universal, but what does the blocking is
 *     not, and the field name is already on disk. Ask the mode adapter via
 *     `isBlockedAtTurn` rather than reading a flag off the event.
 *
 * Modes extend this. They must not rename its fields: these are the names in
 * storage on real devices.
 */
export interface BoardExposureEvent {
  id: string;
  sessionId: string;
  playerId: string;
  /** Turn number when this event took effect */
  turnNumber: number;
  timestamp: string; // ISO 8601
  /** Dice numbers this position is exposed to */
  affectedNumbers: number[];
  /**
   * How heavily the position produces on those numbers.
   * 0 means removed or blocked; modes define what higher values mean.
   */
  productionWeight: number;
  notes?: string;
}

/**
 * A position a player holds on the board, resolved to a point in time.
 *
 * Catan's `BuildingState` extends this with its resource. Every field here is
 * one a cross-mode consumer can use without knowing the game.
 */
export interface BoardPosition {
  /** Stable identifier for the place this position occupies */
  locationId: string;
  /** Dice numbers this position produces from */
  affectedNumbers: number[];
  /** How heavily it produces; modes define the scale */
  productionWeight: number;
}
