/**
 * The robber, as a position on the board rather than a number.
 *
 * WHAT WAS WRONG, AND IT WAS TWO THINGS
 * -------------------------------------
 * **1. Blocks never lifted.** Every 7 wrote a `robberBlockStarted` and nothing
 * ever wrote the matching `robberBlockEnded` except a manual action buried in
 * the development modal. `getActiveRobberBlockedNumbers` unions every block it
 * finds, so a player's blocked set only ever GREW: after five sevens, five
 * numbers were treated as permanently robbed. Production was progressively
 * under-counted for the rest of the game, silently, in the one direction that
 * makes a player look unluckier than they were.
 *
 * The robber cannot be in two places. Moving it is what ends the previous
 * block, and that is now enforced here rather than left to the player.
 *
 * **2. It blocked a NUMBER, not a TILE.** Two hexes can carry the same number.
 * Blocking "5" blocked both of them, so a player whose settlement sat on the
 * OTHER 5 lost production the robber never touched. The robber occupies one
 * tile; who it hurts follows from the six corners of that tile.
 *
 * WHAT THE MODEL IS NOW
 * ---------------------
 * One robber, on one hex, from the turn it moves until it moves again. Who is
 * blocked is DERIVED from the board — the players holding a building on that
 * hex's corners — rather than asked for. The number blocked is the number
 * printed on that hex.
 *
 * On-disk shape is unchanged. `robberBlockStarted` / `robberBlockEnded` keep
 * their names and their `rblock_` ids, because those are names in storage on
 * real devices; the hex rides along in the optional `robberHexIndex`. A block
 * with no hex is a legacy number-block and is still honoured.
 */

import { getAllIntersections, HEX_COUNT } from '@/services/catanBoard';
import { generateId } from '@/types/models';
import type { BoardSnapshot } from '@/services/catanBoardState';
import type { CatanPlayerExposureEvent } from '@/types/models';

/** Prefix every robber block id carries, so it cannot collide with a corner. */
export const ROBBER_BLOCK_PREFIX = 'rblock_';

export interface ActiveRobberBlock {
  blockId: string;
  playerId: string;
  /** Hex the robber sits on, or null for a legacy number-only block. */
  hexIndex: number | null;
  numbers: number[];
  turnNumber: number;
}

/**
 * Every robber block still standing at a turn, across all players.
 *
 * Same started/ended bookkeeping the stats engine does, but board-wide and
 * carrying the hex, so callers can end them when the robber moves.
 */
export function activeRobberBlocks(
  events: readonly CatanPlayerExposureEvent[],
  throughTurn: number = Number.MAX_SAFE_INTEGER,
): ActiveRobberBlock[] {
  const live = new Map<string, ActiveRobberBlock>();
  const relevant = events
    .filter(
      e =>
        e.turnNumber <= throughTurn &&
        (e.eventType === 'robberBlockStarted' || e.eventType === 'robberBlockEnded'),
    )
    .sort((a, b) => a.turnNumber - b.turnNumber);

  for (const e of relevant) {
    const blockId = e.hexIdentifiers?.[0];
    if (!blockId) continue;
    if (e.eventType === 'robberBlockStarted') {
      live.set(blockId, {
        blockId,
        playerId: e.playerId,
        hexIndex: typeof e.robberHexIndex === 'number' ? e.robberHexIndex : null,
        numbers: e.affectedNumbers,
        turnNumber: e.turnNumber,
      });
    } else {
      live.delete(blockId);
    }
  }
  return [...live.values()];
}

/**
 * Where the robber is, as far as the log knows.
 *
 * The most recently started block that names a hex. Returns null for a game
 * that has only ever recorded legacy number-blocks, or none at all.
 */
export function currentRobberHex(
  events: readonly CatanPlayerExposureEvent[],
  throughTurn: number = Number.MAX_SAFE_INTEGER,
): number | null {
  const placed = activeRobberBlocks(events, throughTurn)
    .filter(b => b.hexIndex !== null)
    .sort((a, b) => b.turnNumber - a.turnNumber);
  return placed[0]?.hexIndex ?? null;
}

/**
 * Which players hold a building on this hex.
 *
 * A hex has six corners and the robber hurts whoever stands on any of them —
 * that, and not "who has this number", is what the piece actually does.
 */
export function playersOnHex(hexIndex: number, snapshot: BoardSnapshot): string[] {
  const corners = new Set(
    getAllIntersections()
      .filter(i => i.hexIndices.includes(hexIndex))
      .map(i => i.id),
  );
  const out = new Set<string>();
  for (const [cornerId, building] of snapshot.buildings) {
    if (corners.has(cornerId)) out.add(building.playerId);
  }
  return [...out];
}

export interface RobberMove {
  sessionId: string;
  hexIndex: number;
  /** The number printed on that hex, or null for the desert. */
  hexNumber: number | null;
  turnNumber: number;
  snapshot: BoardSnapshot;
  /** Every event so far, to find the blocks that need ending. */
  events: readonly CatanPlayerExposureEvent[];
}

/**
 * The events that record the robber moving to a hex.
 *
 * Returns ENDS for every block still standing and STARTS for whoever the
 * robber now sits on. Both in one array, in that order, so a caller appends
 * once and cannot half-apply a move.
 *
 * Moving to the desert, or to a hex nobody is on, is a legitimate outcome and
 * produces ends with no starts — which is exactly right, and is the case the
 * old flow could not express at all.
 */
export function robberMoveEvents(move: RobberMove): CatanPlayerExposureEvent[] {
  const { sessionId, hexIndex, hexNumber, turnNumber, snapshot, events } = move;
  const out: CatanPlayerExposureEvent[] = [];

  for (const block of activeRobberBlocks(events, Number.MAX_SAFE_INTEGER)) {
    out.push({
      id: generateId(),
      sessionId,
      playerId: block.playerId,
      eventType: 'robberBlockEnded',
      turnNumber,
      timestamp: new Date().toISOString(),
      affectedNumbers: block.numbers,
      hexIdentifiers: [block.blockId],
      productionWeight: 0,
      robberBlocked: false,
    });
  }

  // The desert produces nothing, so sitting on it blocks nothing — but the
  // move still had to end whatever came before, which is why this returns the
  // ends regardless.
  if (hexNumber !== null) {
    for (const playerId of playersOnHex(hexIndex, snapshot)) {
      out.push({
        id: generateId(),
        sessionId,
        playerId,
        eventType: 'robberBlockStarted',
        turnNumber,
        timestamp: new Date().toISOString(),
        affectedNumbers: [hexNumber],
        hexIdentifiers: [ROBBER_BLOCK_PREFIX + generateId()],
        productionWeight: 0,
        robberBlocked: true,
        robberHexIndex: hexIndex,
      });
    }
  }

  return out;
}

/** Is this a hex index that exists on the board? */
export function isBoardHex(hexIndex: number): boolean {
  return Number.isInteger(hexIndex) && hexIndex >= 0 && hexIndex < HEX_COUNT;
}
